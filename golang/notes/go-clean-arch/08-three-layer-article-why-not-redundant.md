# 三层 Article 为什么"看起来像但不是冗余"

> 同一份"Article"在 dto.go / entity.go / article_model.go 出现三次，看似重复，实际是 Clean Architecture 里"分层契约"的代价。讲清为啥要分、什么时候合并、合并会丢什么。

## 核心要点

- DTO / Entity / Model 三种类型各管一段"边界约束"，字段同名是因为描述的是同一个业务对象在不同上下文里的形状。
- 合并任意两层都**有明确代价**：破坏分层边界 / 字段污染 / 改 DB 即破 API / 不容易藏敏感字段。
- **当前项目的最佳实践是"三层都保留 + 写一个 `toDTO()`/`toEntity()`/`toModel()` 映射函数"**，而不是合并层。
- 企业级项目（Java Spring / Go Kratos / 大厂字节内部）都是这套思路，只是层数更多（HTTPRequest / HTTPDTO / DomainEntity / PO / ESDoc / CacheItem）。
- 真正"扁平化"（DTO + Entity 合并为带 binding tag 的 entity）只适合小 demo 或一次性脚本；规模一上去很快就拆不开了。

## 关键示例

### 1. 三种 Article 的"性格差异"

```text
                dto.go                    entity.go                article_model.go
                ──────                    ──────────               ──────────────────
所属层          application/article       domain/article            infrastructure/persistence/gorm
关心什么        对外 JSON 长相、binding    业务真相 + 不变式         数据库形状
允许的 tag      json / binding            无 tag                   gorm
import 限制     标准库 + 业务 DTO         同包 + 错误              + gorm.io/gorm
──────────────────────────────────────────────────────────────────────────────────────
```

同一个 `Article` 对象在三层的不同字段对照：

| 字段 | dto.go 的约束 | entity.go 的约束 | article_model.go 的约束 |
|---|---|---|---|
| `Title` | `binding:"required,max=200"` | `if title == ""` + `len > MaxTitleLen` | `gorm:"size:200;not null"` |
| `Content` | `binding:"required"` | `strings.TrimSpace + len==0` | `gorm:"type:text;not null"` |
| `AuthorID` | `binding:"required,gt=0"` | `if authorID <= 0` | `gorm:"index"` |
| `AuthorName` | `json:"...omitempty"` | 业务层存储快照 | `gorm:"default:''"` |
| `UpdatedAt` | JSON time 格式 | `time.Now()` 在 Update / Assign 里维护 | gorm 自动维护 |

三层都在为同一个字段做事——但拦截的是**三个不同层的失败**：

```text
HTTP 请求抵达
   ↓ binding tag 失败 ← 第 1 道闸：客户端发错请求被拦
   ↓
业务方法 NewArticle 失败 ← 第 2 道闸：业务规则不满足被拦
   ↓
数据库写入约束失败 ← 第 3 道闸：DB 兜底校验
```

这就是**洋葱模型**：每层做一次自己最关心的边界检查，越靠内层越接近业务真相。看似重复，实是同心圆。

### 2. 必须遵守的层边界

```go
// ❌ 反模式 1：把 DTO 当 Entity
type Article struct {
    Title string `gorm:"size:200" json:"title" binding:"required"`
}
//    一旦这样写，domain 层反向依赖 ORM + HTTP 协议

// ❌ 反模式 2：把 ORM Model 直接序列化给前端
response.OK(c, articleModel)  // ← DB 列名即 JSON 字段名，改库迁移即破坏前端

// ❌ 反模式 3：Entity 携带 json tag 让前端依赖 domain 内部
```

### 3. 4 种合并方向 + 代价矩阵

| 方向 | 改动 | 代价 | 适合场景 |
|---|---|---|---|
| **A. 合并 DTO + Entity** | 删 dto.go，handler 直接传 entity | 改 entity 字段会同时影响业务+API；domain 反向依赖 gin/json | 极简 demo |
| **B. 合并 Entity + Model** | 删 article_model.go，entity 带 gorm tag | entity 反向依赖 ORM；测试需 mock gorm | 单一 ORM 锁定小项目 |
| **C. 合并 DTO + Model** | 删 dto.go，handler 直接返回 gorm model | 数据库列名 = API 字段名；藏不住敏感字段；改列 = 改 API | 内部 API |
| **D. 保留三层 + 写映射函数** ⭐ | 加 `toDTO(saved)` `m.toEntity()` 等小函数 | 代码量略多但每层独立 | **当前项目** |

### 4. 当前项目的"映射函数"已经在做

```go
// application/article/service.go:toDTO
func toDTO(a *article.Article) *ArticleDTO {
    return &ArticleDTO{
        ID: a.ID, Title: a.Title, Content: a.Content,
        AuthorID: a.AuthorID, AuthorName: a.AuthorName,
        CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
    }
}

// infrastructure/persistence/gorm/article_model.go
func (m *ArticleModel) toEntity() *articleEntity {
    return &articleEntity{
        ID: m.ID, Title: m.Title, Content: m.Content,
        AuthorID: m.AuthorID, AuthorName: m.AuthorName,
        CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
    }
}
```

这就是方向 D 的最小代价版本——**保留分层，用一个短函数做映射**，避免"手抄字段"。

### 5. 三层换来的 3 个救命价值

#### a. 改库列名不破 API

```go
// 数据库迁移
ALTER TABLE articles RENAME COLUMN author_name TO author_display_name;

// 仅改 article_model.go + repo
type ArticleModel struct {
    AuthorDisplayName string `gorm:"column:author_display_name"`  // ← 只这里改
}

// DTO 字段名不动，客户端无感
type ArticleDTO struct {
    AuthorName string `json:"author_name"`  // 前端继续按 author_name 取
}
```

合并后会撞上"`json:"author_name"` `db:"author_display_name"`"这种别扭表达。

#### b. 藏得住敏感字段

```go
// entity 未来可能加 password_hash
type User struct {
    PasswordHash string
}

// DTO 主动省掉，JSON 不会出现
type UserDTO struct {
    // PasswordHash 故意不写
}
```

历史上 GitHub、Twitter 的字段泄露事件就是因为没分层。

#### c. 不同端用不同形状

```text
Web 端  → ArticleDTO 完整字段
iOS 端 → ArticleMobileDTO 缺 Content
ES 索引 → ESDoc 带 ES tag
Cache  → CacheItem 精简字段
       ↑
       全部源自同一个 entity，分头裁剪
```

### 6. 企业级项目的常见做法

| 类别 | 项目举例 | 做法 |
|---|---|---|
| Java Spring | 传统 JPA 项目 | Entity / DTO / VO / DO 四层，BeanUtils.copyProperties 互转 |
| Go Kratos | go-kratos/kratos | `internal/biz` / `service` / `data` 三层对应 entity / dto / po |
| Go demo | gin-vue-admin | Entity + DTO 合一个，binding tag 共用 |
| 大厂字节 | 飞书 / 抖音后端 | 5–6 层（HTTPRequest / HTTPDTO / Entity / PO / ESDoc / CacheItem） |

无论几层，**总的精神一致**：每层定义自己最关切的形状和约束，靠映射函数互通。

### 7. 优化手册：什么场景动什么层

| 需求 | 改哪一层 | 说明 |
|---|---|---|
| 加 JSON 字段 | dto.go | 业务零改动 |
| 改字段长度限制 | 三层都建议动 | 但只要改动经过 dto 就足够常见情况 |
| 改业务规则 | entity.go | 配 entity_test.go 单测 |
| 加表索引 | article_model.go | 数据库迁移 |
| 改 API 端点路径 | router.go | HTTP 边界 |
| 新增第三方客户端 | 加新 DTO | iOS / Web 各一份 |

## 常见坑

- **DTO + Entity 合并后忘改 binding 标签**：删掉分层后 `binding:"max=200"` 跟着 entity 走，一次小改动能影响数据库、API、业务三层。
- **Entity 持有 gorm tag 后测试触线**：gorm 在解析 struct 时会执行少量反射，没数据库不会崩但有副作用，单元测试要避免触碰。
- **ArticleModel 直接 JSON 化**：gorm tag 是给 SQL 用的，写在 JSON 上通常会让前端耦合数据库列名，DB 迁移 = API 破坏。
- **DTO 加字段后忘了 entity 同步**：罕见但是会在时区、序列化格式上撞鬼，比如 `time.Time` 没显式 RFC3339 输出格式。
- **跨层"图省事"传 entity**：service 内部可以用 entity，**但 handler↔client 边界必须用 DTO**，否则未来加 ES 缓存、加 wire 协议会很痛苦。

## 相关链接

- 入口与 Swagger → [06 · cmd 双入口、wire 组合根、Swagger 与 Bearer 协议实战](./06-cmd-entries-wire-and-bearer.md)
- Register 调用链与依赖反转 → [07 · Register 五层调用链与 Go 依赖反转（含接收者与类型别名）](./07-register-call-chain-and-di.md)
- Repository 接口定义 → [04 · Repository 层拆解（internal/repository/mysql/article.go）](./04-repository-mysql-layer.md)
- Delivery 层 → [03 · Delivery 层拆解（internal/rest/article.go）](./03-rest-delivery-layer.md)
- Clean Architecture 整套 → [golang/notes/go-clean-arch/](./)

---
#clean-arch #dto #entity #model #layered-architecture #domain-driven-design #repository-pattern #golang
