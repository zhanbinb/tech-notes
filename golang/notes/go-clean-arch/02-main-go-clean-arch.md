# Go 项目 main.go 拆解 · Clean Architecture 入口视角

> 以 [go-clean-arch](https://github.com/bxcodec/go-clean-arch) 为例，看一个生产级 Go 项目的入口文件是怎么组织"装配 + 启动"流水线的。

## 核心要点

- 整个 `main.go` 只有 **2 个函数**：`init()` + `main()`，没有业务逻辑
- `main()` 本质是一条 9 步装配流水线，**没有 if/else 业务流程**
- "依赖注入"不用任何框架——手工 `New(...)` 层层传参
- 关键 Go 语法点：`init()`、空白导入、`defer`、interface 隐式实现、`sql.Open` 是懒加载

---

## 一、文件结构骨架

```go
package main

import (
    _ "github.com/go-sql-driver/mysql"   // ① 空白导入
)

func init() {                            // ② 自动跑：在 main 之前
    godotenv.Load()                      //    把 .env 灌进进程环境变量
}

func main() {
    // 1. 读 DB env
    // 2. 拼 DSN（parseTime + loc 时区）
    // 3. sql.Open + Ping 校验
    // 4. defer Close 注册
    // 5. echo.New() + 装中间件（CORS、超时）
    // 6. 装配 Repository 层
    // 7. 装配 Service 层
    // 8. 注册 HTTP 路由
    // 9. e.Start 阻塞监听
}
```

---

## 二、9 个阶段拆解

### 阶段 1-2：读 env + 拼 DSN

```go
dbHost := os.Getenv("DATABASE_HOST")
// ... 其他 4 个变量

connection := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s", user, pass, host, port, name)
val := url.Values{}
val.Add("parseTime", "1")              // ← 把 DATETIME 转 time.Time
val.Add("loc", "Asia/Jakarta")         // ← 时区
dsn := fmt.Sprintf("%s?%s", connection, val.Encode())
```

DSN 拼出来长这样：
```
user:password@tcp(localhost:3306)/article?loc=Asia%2FJakarta&parseTime=1
```

### 阶段 3：sql.Open + Ping（注意：Open 不真连）

```go
dbConn, err := sql.Open("mysql", dsn)  // ← 只创建连接池对象，不连
if err != nil { log.Fatal(...) }

err = dbConn.Ping()                    // ← 真的去连，校验 DSN/账号/网络
if err != nil { log.Fatal(...) }
```

> 💡 **初学者最常踩的坑**：以为 `sql.Open` 失败就是连不上。其实 `Open` 只校验参数格式，**真正连的是 `Ping` / 第一次 `Query`**。

### 阶段 4：defer Close

```go
defer func() {
    err := dbConn.Close()
    if err != nil {
        log.Fatal("got error when closing the DB connection", err)  // ⚠️ 用 Fatal 不合理
    }
}()
```

⚠️ **小 bug**：`log.Fatal` 在 defer 里会让其他 defer 不跑，且强制退出——关闭资源失败用 `log.Println` 更合适。

### 阶段 5：创建 Echo + 装中间件

```go
e := echo.New()
e.Use(middleware.CORS)                          // 跨域

timeoutStr := os.Getenv("CONTEXT_TIMEOUT")
timeout, err := strconv.Atoi(timeoutStr)        // 解析失败 → 降级默认 30
if err != nil {
    log.Println("failed to parse timeout, using default timeout")
    timeout = defaultTimeout
}
timeoutContext := time.Duration(timeout) * time.Second
e.Use(middleware.SetRequestContextWithTimeout(timeoutContext))
```

两个中间件的**顺序很重要**：CORS 先注册就先执行，超时中间件在内层。

### 阶段 6-7：装配 Repository + Service 层

```go
// Repository 层：返回的是具体 struct 指针
authorRepo := mysqlRepo.NewAuthorRepository(dbConn)
articleRepo := mysqlRepo.NewArticleRepository(dbConn)

// Service 层：接收 interface（隐式实现）
svc := article.NewService(articleRepo, authorRepo)
```

⭐ **关键点**：

- `mysqlRepo.NewArticleRepository(...)` 返回 `*mysqlRepo.ArticleRepository`（具体类型）
- `article.NewService(...)` 接收的参数类型是 `article.ArticleRepository`（**接口**）
- 具体 struct **隐式实现了** interface（Go 不需要 `implements` 关键字）

这就是 Clean Architecture v4 的精髓：**"接口声明在消费侧"**。

### 阶段 8：注册路由（无返回值，直接改 Echo）

```go
rest.NewArticleHandler(e, svc)
```

`NewArticleHandler` 内部直接修改了 `e`：

```go
e.GET("/articles", handler.FetchArticle)
e.POST("/articles", handler.Store)
e.GET("/articles/:id", handler.GetByID)
e.DELETE("/articles/:id", handler.Delete)
```

> 💡 为什么 `e` 是指针传递？要在函数内**修改它**。

### 阶段 9：阻塞监听

```go
address := os.Getenv("SERVER_ADDRESS")
if address == "" {
    address = defaultAddress          // ":9090"
}
log.Fatal(e.Start(address)) //nolint
```

`e.Start` **不会正常返回**——只有出错或被信号中断才返回。下面没有"退出清理"代码。

---

## 三、4 个 Go 核心概念点

### 1. 空白导入（Blank Import）`import _ "..."`

```go
import _ "github.com/go-sql-driver/mysql"
```

下划线 `_` 表示**只为了触发它的副作用**，不直接使用。

mysql driver 包内部有：

```go
func init() {
    sql.Register("mysql", &MySQLDriver{})
}
```

→ import 它后，driver 自动注册到 `database/sql`，之后 `sql.Open("mysql", ...)` 才能识别 `"mysql"`。

### 2. init() 函数

- 同一个包内可以有**多个** `init()`
- 执行顺序：**包的 import 依赖 → 同一包内声明顺序 → 最后 main()**
- 用途：注册驱动、加载配置、初始化全局变量

### 3. defer

- 把一段代码**注册**到当前函数返回前执行
- 多个 defer **LIFO**（后进先出）
- 参数在 defer 语句执行时就求值（不是延迟求值）

### 4. interface 的隐式实现

```go
// article/service.go（消费侧）声明
type ArticleRepository interface {
    Fetch(ctx context.Context, ...) (...)
    Store(ctx context.Context, ...) error
}

// internal/repository/mysql/article.go（实现侧）
type ArticleRepository struct { Conn *sql.DB }
func (m *ArticleRepository) Fetch(...) (...) { ... }  // ← 方法签名对得上就行
func (m *ArticleRepository) Store(...) error { ... }
```

→ `*mysqlRepo.ArticleRepository` 隐式满足 `article.ArticleRepository`，**无需 `implements` 关键字**。

---

## 四、常见坑

| # | 坑 | 避坑方式 |
|---|---|---|
| 1 | `godotenv.Load()` 找不到 `.env` 直接 `log.Fatal` | 在 init 里用 `os.LookupEnv` 优先判断是否已有 env |
| 2 | `sql.Open` 失败 ≠ 连不上数据库 | 必须配合 `Ping()` 验证 |
| 3 | `log.Fatal` 放在 defer 里处理 close 错误 | close 失败应该 `log.Println`，让进程自然退出 |
| 4 | Workbench 用 `localhost` 连 MySQL 容器失败 | 用 `127.0.0.1`（macOS `localhost` 默认走 IPv6） |
| 5 | 容器里 `Asia/Jakarta` 时区报错 | alpine 镜像需要 `apk add tzdata` |
| 6 | macOS 编译的 Mach-O 二进制塞进 Linux 容器跑不起来 | `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build` 交叉编译 |

---

## 五、配套练习

### ⭐ 难度：加一个 health check 端点

```go
// 加在 rest.NewArticleHandler(e, svc) 之后
e.GET("/health", func(c echo.Context) error {
    return c.JSON(200, map[string]string{"status": "ok"})
})
```

→ 体会"分层架构让横切功能几乎零成本添加"。

### ⭐⭐ 难度：让 init() 优雅降级

把：

```go
func init() {
    err := godotenv.Load()
    if err != nil { log.Fatal("Error loading .env file") }
}
```

改成：

```go
func init() {
    if _, ok := os.LookupEnv("DATABASE_HOST"); ok {
        return                                  // 关键 env 已有，不强求 .env
    }
    if err := godotenv.Load(); err != nil {
        log.Println("no .env, rely on process env")
    }
}
```

---

## 六、相关链接

- 仓库：[bxcodec/go-clean-arch](https://github.com/bxcodec/go-clean-arch)
- 同源笔记：[03 · go-clean-arch 本地跑通实战（含踩坑）](../docker/notes/03-go-clean-arch-local-run.md)
- 同源笔记：[07 · 轻量 Web 框架 · Echo vs Gin](go-clean-arch/01-echo-vs-gin.md)
- 官方文档：[Go database/sql](https://pkg.go.dev/database/sql) · [Echo 框架](https://echo.labstack.com/) · [godotenv](https://github.com/joho/godotenv)
- 理论参考：[Uncle Bob · Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

---
#golang #main #clean-architecture #依赖注入 #入口装配
