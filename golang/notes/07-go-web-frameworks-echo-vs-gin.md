# 第七梯队补充：轻量 Web 框架 · Echo vs Gin

> 严格说 Echo / Gin 不算"第五梯队业务模板"那种全家桶，它们是更底层的 HTTP 路由 + 上下文 + 中间件框架。
> 单独成篇是因为：
> 1. **面试高频**：Go 后端岗位几乎必问
> 2. **学习项目落地**：很多 Clean Arch / DDD 教学项目选 Echo（如 [go-clean-arch](https://github.com/bxcodec/go-clean-arch)）
> 3. **搞清定位**：和 `go-zero / Kratos / Hertz`（参见 02）的关系——后者是"全家桶"，Echo / Gin 是"内核"，可被前者集成

## 一句话区别

> **Gin = "全家桶式"**（自带模板/JSON 校验/国际化等）
> **Echo = "极简内核 + 生态扩展"**（核心只做路由 + 上下文 + 错误处理）

## 速览对比

| 维度 | **Gin** | **Echo** |
| --- | --- | --- |
| 仓库 / Star | `gin-gonic/gin` · 80k+ | `labstack/echo` · 30k+ |
| 主流版本 | v1.10 | v4.11 |
| 上手难度 | ⭐⭐ | ⭐⭐ |
| HTTP 性能（基准） | 略快 ~5-10% | 略慢但同量级 |
| 内存占用 | 略高 | 略低 |
| 路由 | Radix tree | Radix tree |
| Context | `*gin.Context` | `echo.Context` |
| 中间件机制 | `c.Next() / c.Abort()` | 函数式嵌套 `next(c)` |
| 内置功能 | 较多（binding/validator/render） | 极少，Validator 需自己接 |
| 错误处理 | `c.JSON` 不返 error | 几乎所有方法返 `error` |
| 中文社区 | 资料最多 | 英文为主 |
| 适合 Clean Arch | ⭐⭐⭐ 还行 | ⭐⭐⭐⭐⭐ 天然契合 |

## 代码风格对比

### Hello World

**Gin**（懒人友好，默认带 Logger + Recovery）：
```go
r := gin.Default()
r.GET("/hello", func(c *gin.Context) {
    c.JSON(200, gin.H{"msg": "hello"}) // gin.H = map[string]any
})
r.Run(":8080")
```

**Echo**（纯净，无任何默认中间件）：
```go
e := echo.New()
e.GET("/hello", func(c echo.Context) error {
    return c.JSON(http.StatusOK, map[string]string{"msg": "hello"})
})
e.Logger.Fatal(e.Start(":8080"))
```

> 直观差别：
> - Gin 的 `gin.Default()` 帮你装了常用中间件，**懒人友好**
> - Echo 让你**从零开始**，更符合"显式优于隐式"
> - Gin 的 `c.JSON` 不返回 error，Echo 的 `c.JSON` 返回 `error`（更严谨，便于统一错误处理）

### 路由分组

```go
// Gin
api := r.Group("/api/v1")
admin := r.Group("/admin", AuthMiddleware()) // 分组直接挂中间件

// Echo
api := e.Group("/api/v1")
admin := e.Group("/admin")
admin.Use(AuthMiddleware()) // 中间件单独挂
```

### 中间件写法（差异最明显）

**Gin**（用 `c.Next()` 链式控制）：
```go
func Logger() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        c.Next() // ← 显式放行下一个 handler
        log.Printf("%s %s %v", c.Request.Method, c.Request.URL, time.Since(start))
    }
}
```

**Echo**（函数式嵌套，"洋葱模型"更直观）：
```go
func Logger(next echo.HandlerFunc) echo.HandlerFunc {
    return func(c echo.Context) error {
        start := time.Now()
        err := next(c) // ← next 之前的代码是"请求进入"，之后是"响应返回"
        log.Printf("%s %s %v", c.Request.Method, c.Request.URL, time.Since(start))
        return err
    }
}
```

## 性能对比（参考 TechEmpower Benchmark）

| 框架 | QPS（plaintext） | 内存分配/请求 |
| --- | --- | --- |
| 原生 `net/http` | ~280k | 最低 |
| `gin` | ~250k | 较低 |
| `echo` | ~235k | 略高 |
| `fiber`（基于 fasthttp） | ~600k | 最低 |

> 差距都在 5-10% 量级，**真实业务里两者都足够用**。性能不该是选型主要因素。

## 设计哲学差异

| | Gin | Echo |
| --- | --- | --- |
| 核心思想 | "**给你最好的默认值**" | "**只给你最小内核**" |
| 抽象层次 | 中等（`gin.H`, `gin.Context`） | 极简（只有 `echo.Context`） |
| 扩展性 | 中（很多内置） | 高（核心小，插件丰富） |
| 适用 Clean Architecture | ⭐⭐⭐ 还行 | ⭐⭐⭐⭐⭐ 天然契合 |
| 错误传播 | 中间件要 `Abort` 拦截 | 函数式 `return err` 自然向上抛 |

**为什么 go-clean-arch 选 Echo**（呼应本笔记的来源）：
- 接口设计极简，**符合 Clean Arch "依赖注入 + 解耦" 理念**
- `echo.Context` 是 interface，**容易 mock/替换**
- 中间件写法更清晰，**教学价值高**
- 作者是印尼开发者，与 go-clean-arch 作者 Iman Tumorang 同社区

## 怎么选

| 你的情况 | 推荐 |
| --- | --- |
| 🆕 第一次学 Go web 框架 | **Gin**（中文资料最多，问题好搜） |
| 🏢 做企业级中后台、要分层架构 | **Echo**（更契合 Clean Arch） |
| ⚡ 极致性能要求 | 别选 Echo/Gin，上 `fiber`（fasthttp）或 `gRPC` |
| 🛠️ 团队已有 Gin 技术栈 | 跟团队走 |
| 📚 看 go-clean-arch / DDD 教学项目 | 必须学 Echo |

## 与本笔记其他梯队的关系

```
┌──────────────────────────────────────────────────────────┐
│ 02 第一梯队（全家桶）                                    │
│   go-zero / Kratos / Hertz                              │
│   ↑ 内置 web 框架层就是 Echo / Gin / Hertz（自己）      │
├──────────────────────────────────────────────────────────┤
│ 07 本笔记（轻量 web 框架）                               │
│   Echo / Gin / Fiber                                    │
│   ↑ 业务代码调用的就是这一层                             │
├──────────────────────────────────────────────────────────┤
│ Go 标准库 net/http                                       │
└──────────────────────────────────────────────────────────┘
```

> 也就是说：**先学 Echo / Gin 理解 web 框架本质**（本笔记）→ 再去看 `go-zero / Kratos` 怎么把这一层包装成"全家桶"（02 笔记）。

## 配套资源

- 仓库：[gin-gonic/gin](https://github.com/gin-gonic/gin) · [labstack/echo](https://github.com/labstack/echo)
- 性能基准：[go-web-framework-benchmark](https://github.com/smallnest/go-web-framework-benchmark)
- 教学项目：[bxcodec/go-clean-arch](https://github.com/bxcodec/go-clean-arch)（Echo + Clean Arch）

## 速查 · go-clean-arch 项目里的 Echo 用法

```go
// app/main.go
e := echo.New()                          // 创建实例
e.Use(middleware.CORS)                   // 注册中间件
e.GET("/articles", handler.FetchArticle) // 注册路由
log.Fatal(e.Start(":9090"))              // 启动（阻塞）
```

```go
// internal/rest/article.go
return c.JSON(http.StatusOK, listAr)             // 返回 JSON
return c.JSON(getStatusCode(err), errResponse)   // 错误响应
c.Response().Header().Set("X-Cursor", nextCursor) // 改 Header
```
