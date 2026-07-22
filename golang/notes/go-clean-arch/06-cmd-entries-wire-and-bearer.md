# cmd 双入口、wire 组合根、Swagger 与 Bearer 协议实战

> 围绕 `cmd/rest`、`cmd/grpc`、`cmd/wire.go` 三个入口文件的职责拆解，以及 Swagger BasePath 重复 bug、JWT Bearer 前缀缺失 401 两个真问题。

## 核心要点

- 一个 Go 项目可以有多个 `package main`，每个 `package main` + 各自的 `func main()` 就是**一个独立的可执行程序**。本项目里 `cmd/rest` 和 `cmd/grpc` 编译出**两个**二进制，分别对外提供 REST 和 gRPC。
- `cmd/wire.go` 不是入口（无 `func main`），而是**组合根（Composition Root）**，专门构造运行时依赖，两个 `main` 都 `wire.New(...)` 同一套 DB / Repository / Service。
- REST 和 gRPC 共享业务核心（database、repository、application service），只在外面换"协议适配层"（`internal/interfaces/http` vs `internal/interfaces/grpc`）。
- Swagger 2.0 的 `@securityDefinitions.apikey` 渲染成普通文本输入框，**不会自动补 `Bearer ` 前缀**，必须手动拼上；中间件 `prefix = "Bearer "` 是 strict matching，少一个空格直接 401。
- `@BasePath` 注解若与 Gin 路由组的 `/api/v1` 同名，`swag` 会拼成 `/api/v1/api/v1/xxx`，必须把 `@BasePath` 改成 `/` 让 swag 生成的文件只保留"路由本身注册的路径"。

## 关键示例

### 1. 双 main + 一个组合根的依赖关系

```text
go run ./cmd/rest   ─┐                        ┌─▶ internal/interfaces/http (Gin)
                       │                      /
wire.New(ctx, env) ◀──┤  cmd/wire.go（无 main）
                       │                      \
go run ./cmd/grpc   ─┘                        └─▶ internal/interfaces/grpc (gRPC Server)
```

`cmd/rest/main.go`：

```go
func main() {
    env := os.Getenv("APP_ENV")
    deps, err := wire.New(context.Background(), env)
    ...
    router := httpserver.NewRouter(deps.Cfg, deps.HTTPHandlers, ...)
    httpSrv := server.NewHTTPServer(deps.Cfg.Server.HTTPAddr(), router, ...)
    httpSrv.Run(ctx)
}
```

`cmd/grpc/main.go`：

```go
func main() {
    env := os.Getenv("APP_ENV")
    deps, err := wire.New(context.Background(), env)
    ...
    grpcSrv, _ := server.NewGRPCServer(deps.Cfg.Server.GRPCAddr(), nil, deps.Log.Zap())
    gh := grpchandler.NewHandlers(deps.ArticleSvc)
    gh.Register(grpcSrv.Server())
    grpcSrv.Run(ctx)
}
```

`cmd/wire.go` 准备的关键对象：

```text
config → logger → DB（gorm + sqlDB）→ JWT Manager → RateLimiter → Prometheus Registry
      → Repository（article/author/user）
      → Application Service（article/author/auth）
      → HTTP Handlers（health/auth/article/author）
```

### 2. Swagger BasePath 重复 bug 的根因与修复

**现象**：

```
http://localhost:9090/api/v1/api/v1/auth/login
              ────────┘ ───────┘
              BasePath  Gin 路由路径
```

**两个 `/api/v1` 各来自一个文件**：

| 位置 | 内容 |
|---|---|
| `cmd/rest/main.go:26` | `// @BasePath        /api/v1` |
| `internal/interfaces/http/router.go:86` | `v1 := r.Group("/api/v1")` |
| `docs/swagger/docs.go` 里的 `paths` 字段 | 已经被 `swag` 把 `/api/v1` 拼进每条路由 |

拼接过程：

```text
BasePath(注解)  +  Path(swag 抓到的完整路由)  =  最终 URL
  /api/v1      +  /api/v1/auth/login         =  /api/v1/api/v1/auth/login  ❌
  /            +  /api/v1/auth/login         =  /api/v1/auth/login        ✓
```

**最小修复（两步）**：

```diff
// cmd/rest/main.go
-// @BasePath        /api/v1
+// @BasePath        /
```

```diff
// docs/swagger/docs.go
-BasePath:         "/api/v1",
+BasePath:         "/",
```

接着重新跑 `make swagger`（Makefile target）让注解源改动成为唯一来源。

### 3. JWT 中间件对 Bearer 前缀的严格校验

`internal/interfaces/http/middleware/jwt.go`：

```go
const prefix = "Bearer "
if !strings.HasPrefix(raw, prefix) {
    response.Error(c, errcode.ErrTokenInvalid.WithMsg("expected Bearer scheme"))
    c.Abort()
    return
}
token := strings.TrimPrefix(raw, prefix)
```

**401 错误码速查**：

| 响应 message | 根因 |
|---|---|
| `expected Bearer scheme` | header 缺 `Bearer ` 前缀（最常见） |
| `token invalid: ...` | token 验签失败（过期/签名错/secret 改了） |
| 无 message，code=40100 | header 完全没传 |

Swagger UI 拿到 token 的正确做法：

1. 右上角🔒点 **Authorize** → 弹出 modal 的 `BearerAuth (apiKey)` 输入框
2. 在 `Value` 字段里粘 **`Bearer eyJhbGciOi...`**（B 大写，B 后面**有空格**）
3. 点 Authorize → 关闭弹窗 → 后续所有 🔒 接口自动带这个 header

Swagger UI **不会**自动加 `Bearer ` 前缀，因为 Swagger 2.0 的 `apiKey` 安全方案就是自由文本输入。

## 常见坑

- **找不到 Swagger UI**：确认 config 里 `swagger.enabled` 是 `true`，否则 Swagger 路由根本没注册。
- **改完注解忘了 `make swagger`**：`docs/swagger/docs.go` 是生成产物，里面的内容落后于注解，重启服务前必须重新生成（最差情况手工同步一次 `BasePath`）。
- **复制 token 时丢字符**：尤其是长 token 截屏/手敲时少几位，可能导致 `token invalid`，无法恢复，必须重新登录。
- **想用 `curl` 测试**：必须在 header 里手敲 `Bearer ` 前缀，**不要**让 Swagger UI 帮你加；同样的代码换 Postman/SDK 也要这样处理。
- **改完注解发现 UI 没刷新**：浏览器可能缓存了旧的 `docs.go` 路径，按 `Cmd+Shift+R` 强制刷新，或在 `?ts=` 加时间戳参数。
- **`go build` 报 sandbox 缓存错**：Go 的 `~/Library/Caches/go-build/` 不在工作区，编不动是环境问题；改完用 `gofmt -l <files>` 验证语法即可。

## 相关链接

- 入口拆分 → [02 · main.go 拆解 · Clean Architecture 入口视角](./02-main-go-clean-arch.md)
- Repository/Service 链路 → [07 · Register 五层调用链与 Go 依赖反转](./07-register-call-chain-and-di.md)
- Clean Architecture 整套 → [golang/notes/go-clean-arch/](./)

---
#clean-arch #entry-point #composition-root #swagger #jwt
