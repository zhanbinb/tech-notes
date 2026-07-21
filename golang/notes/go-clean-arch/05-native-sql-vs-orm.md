# 原生 database/sql vs sqlx / gorm / sqlc · Clean Arch 视角下的选型

> 接续 [04 · Repository 层](./04-repository-mysql-layer.md)：go-clean-arch 为什么放着 ORM 不用、纯手写 150 行 `database/sql`？本笔记拆开看选型背后的逻辑、四种方案各自的位置、和一个把当前仓库改写的范例。

## 核心要点

- **bxcodec/go-clean-arch 故意不用 ORM**：是为了把 DB 相关的代码**全部关在 `internal/repository/mysql/` 里**，不让 `gorm:"primaryKey"` 这种 tag 污染最内层 `domain/`。
- **4 种方案的根本分歧**：`domain/` 是否被框架入侵。`database/sql` 和 `sqlc` 不入侵；`sqlx` 加 `db` tag、还凑合；`gorm` 直接改写 struct 行为 —— 最重。
- **够用就好**：表 < 10 用原生 `database/sql` 完全够用；表多了上 **`sqlc`**（生成出来还是 `database/sql` 调用，侵入性最小）；学这个项目想少写样板用 **`sqlx`**（只换类型不改 domain）。
- **本仓库是个"教学骨架"**：作者本人建议生产中引入 sqlx 或 sqlc 减少重复。本笔记最后给一个 `Delete` / `Fetch` 的 sqlx 重写范例。

## 项目里实际用了什么

```bash
# go.mod
require (
    github.com/go-sql-driver/mysql v1.7.1     # 只装了 driver
    gopkg.in/DATA-DOG/go-sqlmock.v1 v1.3.0    # 测试 mock
)
```

`sqlx` / `gorm` / `ent` / `sqlc` **一个都没出现**。仓库里所有 CRUD 用的是这 5 个 stdlib 函数：

| 用途 | 函数 |
|---|---|
| 查询多行 | `m.Conn.QueryContext(ctx, query, args...)` |
| 查询单值 | `rows.Scan(...)` + `rows.Next()` |
| 写操作 | `m.Conn.PrepareContext(ctx, query)` → `stmt.ExecContext(...)` |
| 取自增 ID | `res.LastInsertId()` |
| 取影响行数 | `res.RowsAffected()` |

## 关键对比：同一个 Store 操作的 4 种写法

```go
// ① 原生 database/sql（当前项目，10 行手写）
query := `INSERT article SET title=? , content=? , author_id=?, updated_at=? , created_at=?`
stmt, err := m.Conn.PrepareContext(ctx, query)
if err != nil { return }
res, err := stmt.ExecContext(ctx, a.Title, a.Content, a.Author.ID, a.UpdatedAt, a.CreatedAt)
if err != nil { return }
lastID, err := res.LastInsertId()
if err != nil { return }
a.ID = lastID
```

```go
// ② sqlx：用 struct 字段名绑定
res, err := m.Conn.NamedExecContext(ctx,
    `INSERT INTO article (title, content, author_id, updated_at, created_at)
     VALUES (:title, :content, :author_id, :updated_at, :created_at)`, a)
a.ID, _ = res.LastInsertId()
```

```go
// ③ gorm
m.Conn.WithContext(ctx).Create(a)
```

```go
// ④ sqlc：先有 SQL，跑 `sqlc generate`，生成 article.sql.go
lastID, err := q.InsertArticle(ctx, repository.InsertArticleParams{
    Title: a.Title, Content: a.Content, /* ... */
})
```

**fetch（读多行）版本对比**

```go
// ① 原生（15 行手写 + 字段名手抄）
rows, err := m.Conn.QueryContext(ctx, query, args...)
defer rows.Close()
for rows.Next() {
    t := domain.Article{}
    rows.Scan(&t.ID, &t.Title, &t.Content, &t.Author, ...)
}

// ② sqlx：StructScan 一行
var result []domain.Article
err := m.Conn.SelectContext(ctx, &result, query, args...)

// ③ gorm
var result []domain.Article
err := m.Conn.WithContext(ctx).
    Where("created_at > ?", cursor).
    Order("created_at").
    Limit(int(num)).
    Find(&result).Error

// ④ sqlc（生成的方法签名）
res, err := q.ListArticles(ctx, repository.ListArticlesParams{
    CreatedAt: cursorTime, Limit: num,
})
```

## 对位表

| 痛点 | 原生 | sqlx | gorm | sqlc |
|---|:-:|:-:|:-:|:-:|
| 手抄 `&t.ID, &t.Title, ...` 易错 | 痛 | ✅ StructScan | ✅ 自动 | ✅ 自动 |
| 手写 Prepared Statement 难复用 | 痛 | ✅ NamedStmt | ✅ | ✅ |
| 拼接 SQL 防注入 | 痛（必须 `?` 占位） | ✅ | ✅ | ✅ |
| struct ↔ DB column 名映射 | 痛 | ✅ `db` tag | ✅ | ✅ 生成 |
| 想跑 Raw SQL 直连 | ✅ | ✅ | 也可以 | ✅（强制） |
| **不污染 domain 层** | ✅ | ✅ | ❌ | ✅ |

## 为什么这个项目不用 ORM？

看 `domain/article.go`：

```go
type Article struct {
    ID        int64     `json:"id"`
    Title     string    `json:"title"   validate:"required"`
    Content   string    `json:"content" validate:"required"`
    Author    Author    `json:"author"`
    UpdatedAt time.Time `json:"updated_at"`
    CreatedAt time.Time `json:"created_at"`
}
```

只有 `json` 和 `validate` tag，**没有任何 DB tag**。如果用 gorm，domain 就不得不变成：

```go
type Article struct {
    ID        int64     `json:"id" gorm:"primaryKey"`            // ← framework 入侵
    Title     string    `json:"title"  validate:"required" gorm:"size:45"`
    CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}
```

这就是"domain 被 framework 污染"的代价 —— 换 ORM 时要改 `domain/`，违背 Clean Arch 的同心圆契约。

## 决策树

| 场景 | 建议 |
|---|---|
| 项目小（表 < 10，团队 < 3 人） | 原生 `database/sql` 完全够用 |
| 表多、SQL 多，要类型安全 | 用 **`sqlc`** —— 生成的代码就是 `database/sql` 调用，对 Clean Arch 侵入性最小 |
| 学习 Clean Arch 骨架、想少写样板 | **`sqlx`** —— 不改 domain，只把 `*sql.DB` 换成 `*sqlx.DB` |
| 团队历史包袱、需要复杂关联查询 | 考虑 `gorm`，但要清楚放弃了"domain 不被框架污染"这个核心好处 |

## 用 sqlx 重写当前仓库的范例

只换 struct 字段类型 + 写操作简化，整文件从 150 行降到 ~80 行：

```go
import "github.com/jmoiron/sqlx"

type ArticleRepository struct {
    Conn *sqlx.DB   // ← 只换这一个类型
}

func (m *ArticleRepository) Delete(ctx context.Context, id int64) error {
    res, err := m.Conn.ExecContext(ctx, "DELETE FROM article WHERE id = ?", id)
    if err != nil { return err }
    n, _ := res.RowsAffected()
    if n != 1 {
        return fmt.Errorf("weird Behavior. Total Affected: %d", n)
    }
    return nil
}

func (m *ArticleRepository) Fetch(ctx context.Context, cursor string, num int64) ([]domain.Article, string, error) {
    var res []domain.Article
    decodedCursor, _ := repository.DecodeCursor(cursor)
    err := m.Conn.SelectContext(ctx, &res,
        `SELECT id, title, content, author_id, updated_at, created_at
           FROM article WHERE created_at > ? ORDER BY created_at LIMIT ?`,
        decodedCursor, num)
    if err != nil { return nil, "", err }
    var nextCursor string
    if len(res) == int(num) && len(res) > 0 {
        nextCursor = repository.EncodeCursor(res[len(res)-1].CreatedAt)
    }
    return res, nextCursor, nil
}
```

`Store` / `Store` 类似地可以用 `NamedExecContext`；`fetch` 可以直接砍掉，让所有读复用 `SelectContext`。

## 常见坑

- **用 gorm 后还能"换 repository 吗"**：理论上能，但实际迁移成本高，因为业务代码间接依赖了 gorm 的 chain API（`Where().Order().Limit().Find()`）。
- **`sqlc` 要求 SQL 必须先写好**：强迫 review SQL，是优点也是门槛。
- **`sqlx` 的 `SelectContext` 不报错当心空切片**：`result` 是 `nil` 时 `len(result) == 0`，跟 `make([]T, 0)` 序列化结果不同（前者 `null`、后者 `[]`），记得初始化。
- **不要为了"少写代码"盲目选 gorm**：侵入 domain 之后想退回 `database/sql`，整个 `domain/` 要重写。

## 配套练习

- ⭐ 给当前仓库加 `go-sqlmock` 单测，看 repository 层能不能脱离真实 MySQL 跑测试。
- ⭐⭐ 引入 `sqlx`，重写 `Fetch` / `Delete`，对比行数。
- ⭐⭐⭐ 装 `sqlc`，写一份 `queries/article.sql`，对比生成代码 vs 手写代码的可读性。

## 相关链接

- 上游笔记：[03 · Delivery 层](./03-rest-delivery-layer.md) · [04 · Repository 层](./04-repository-mysql-layer.md)
- 仓库：`github.com/bxcodec/go-clean-arch`
- `sqlx` README：[github.com/jmoiron/sqlx](https://github.com/jmoiron/sqlx)
- `gorm` 文档：[gorm.io](https://gorm.io)
- `sqlc` 文档：[docs.sqlc.dev](https://docs.sqlc.dev/)

---
#clean-architecture #repository-layer #sqlx #gorm #sqlc #database-sql #dependency-inversion
