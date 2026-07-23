# RESTful API 与 gRPC：设计、通信和工程实践对比

> REST 与 gRPC 都可以作为 Clean Architecture 的 Interface/Delivery Adapter。它们的差异主要在协议和接口层；进入 Application Service 后，应复用相同的业务核心。

## TL;DR

- REST 以资源和 HTTP 语义为中心，JSON 可读、生态广，最适合公网、浏览器和开放 API。
- gRPC 以 Service/RPC Method 为中心，使用 HTTP/2 + protobuf，类型严格、性能和流式通信能力强，常用于内部服务通信。
- 二者不是简单的“谁替代谁”。常见架构是：公网对外用 REST，内部服务间用 gRPC。
- Clean Architecture 中应让 REST Handler 与 gRPC Handler 共同调用 Application Service，而不是复制业务逻辑。

## 一、核心模型不同

### REST：面向资源

REST 使用 URI 表示资源，HTTP Method 表示动作：

```http
GET    /api/v1/articles/1
POST   /api/v1/articles
PUT    /api/v1/articles/1
DELETE /api/v1/articles/1
```

它强调：

```text
资源：articles
动作：GET / POST / PUT / DELETE
结果：HTTP Status + Response Body
```

### gRPC：面向服务和方法

gRPC 用 `.proto` 定义服务和方法：

```protobuf
service ArticleService {
  rpc GetArticle(GetArticleRequest) returns (GetArticleResponse);
  rpc CreateArticle(CreateArticleRequest) returns (CreateArticleResponse);
}
```

完整方法名：

```text
/article.v1.ArticleService/GetArticle
/article.v1.ArticleService/CreateArticle
```

它强调：

```text
Service：ArticleService
Method：GetArticle
Input：GetArticleRequest
Output：GetArticleResponse
```

## 二、总体对比

| 维度 | RESTful API | gRPC |
|---|---|---|
| 抽象模型 | 资源 + HTTP Method | Service + RPC Method |
| 常用传输 | HTTP/1.1，也可 HTTP/2 | HTTP/2 |
| 常用编码 | JSON | Protocol Buffers |
| 可读性 | 高，可直接阅读 JSON | 二进制不可直接阅读 |
| 契约 | OpenAPI 可选，弱约束到强约束均可 | `.proto` 强契约 |
| 类型系统 | JSON 类型较弱 | protobuf 类型严格 |
| 客户端 | 可手写，也可生成 | 通常生成强类型 Client |
| 服务端骨架 | 框架路由与 Handler | 生成 Server 接口与注册代码 |
| 错误模型 | HTTP Status + JSON Body | gRPC Code + Message + Details |
| 流式通信 | 通常需 SSE/WebSocket 等补充 | 原生支持四类 RPC |
| 浏览器支持 | 原生友好 | 浏览器通常需要 gRPC-Web/代理 |
| 调试工具 | curl、Postman、Swagger | grpcurl、grpcui、Reflection |
| 缓存 | HTTP/CDN 生态成熟 | 默认不如 REST/CDN 直接 |
| 性能 | JSON 体积和解析成本通常更高 | 二进制紧凑，长连接复用优秀 |
| 典型场景 | 公网、浏览器、开放平台 | 内部微服务、低延迟、流式调用 |

## 三、同一业务在两种协议中的表达

### REST

```http
GET /api/v1/articles/1
Authorization: Bearer <token>
```

响应：

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "id": 1,
  "title": "Clean Architecture"
}
```

### gRPC

协议：

```protobuf
rpc GetArticle(GetArticleRequest) returns (GetArticleResponse);

message GetArticleRequest {
  int64 id = 1;
}
```

Go Client：

```go
resp, err := client.GetArticle(ctx, &articlev1.GetArticleRequest{Id: 1})
```

二者表达同一个用例，但接口风格不同：

```text
REST：GET + URI 定位资源
gRPC：Service + Method 定位远程过程
```

## 四、在 Clean Architecture 中的位置

REST 与 gRPC 都属于外层 Interface Adapter：

```text
HTTP Client → REST Router → REST Handler ┐
                                         ├→ Application Service
 gRPC Client → grpc.Server → gRPC Handler┘
                                              ↓
                                      Repository Interface
                                              ↓
                                      GORM Repository
                                              ↓
                                           MySQL
```

应共享：

- Domain Entity 和业务规则；
- Application Service / Use Case；
- Repository Interface；
- Repository 实现和数据库；
- 事务、核心校验和业务错误。

应分别处理：

- REST：路径、Query、Header、JSON、HTTP Status；
- gRPC：Proto Message、Metadata、Interceptor、gRPC Status、Streaming。

不推荐：

```text
REST Handler → gRPC Handler → Service
```

也不推荐：

```text
gRPC Handler → REST Handler → Service
```

正确方式是两个 Adapter 并列依赖 Application Service。

## 五、请求和响应的数据转换

### REST 链路

```text
HTTP Path/Query/JSON
  ↓ bind
Request DTO / Application Input
  ↓
Domain Entity
  ↓
GORM Model
```

返回：

```text
GORM Model
  ↓
Domain Entity
  ↓
Application DTO
  ↓ JSON serialization
HTTP Response
```

### gRPC 链路

```text
protobuf Request Message
  ↓ mapping
Application Input
  ↓
Domain Entity
  ↓
GORM Model
```

返回：

```text
GORM Model
  ↓
Domain Entity
  ↓
Application DTO
  ↓ mapping
protobuf Response Message
```

关键原则：

```text
HTTP DTO 与 Proto Message 都属于边界对象，
不应直接替代 Domain Entity 或渗透到 Repository。
```

## 六、路由与注册机制

### REST 路由

```go
router.GET("/api/v1/articles/:id", handler.GetByID)
router.POST("/api/v1/articles", handler.Create)
```

路由通常由以下内容匹配：

```text
HTTP Method + URL Path
```

### gRPC 注册

```go
articlev1.RegisterArticleServiceServer(grpcServer, articleHandler)
```

生成代码内部注册 `ServiceDesc`，根据以下内容分发：

```text
ServiceName + MethodName
```

例如：

```text
/article.v1.ArticleService/GetArticle
```

REST 通常逐条注册路由；gRPC 通常一次注册整个 Service。

## 七、序列化与性能

### REST + JSON

优势：

- 人类可读；
- 浏览器和调试工具原生支持；
- 多语言无需生成代码也能调用；
- 网关、代理、WAF、CDN 生态成熟。

代价：

- 字段名会重复出现在消息中；
- 消息通常较大；
- 字符串解析和类型转换成本更高；
- 大整数在 JavaScript/JSON 中需注意精度。

### gRPC + protobuf

优势：

- 使用字段编号进行紧凑编码；
- 消息体通常更小；
- 解析速度通常更快；
- 生成强类型代码；
- HTTP/2 支持连接复用和多路复用。

代价：

- 二进制不便直接阅读；
- 依赖代码生成工具链；
- 协议演进必须遵守字段编号兼容规则；
- 浏览器直连和 CDN 缓存不如 REST 自然。

性能不能只看“protobuf 一定快”。真实结果还受以下因素影响：

- 网络延迟；
- 数据库查询；
- 消息大小；
- 并发模型；
- 连接复用；
- 压缩；
- 网关和负载均衡；
- 是否跨地域。

## 八、通信模式

REST 常见模式是一次请求、一次响应。若需要实时或流式能力，常使用：

- SSE；
- WebSocket；
- Chunked Response；
- 长轮询。

gRPC 原生支持四种调用模式：

```protobuf
// Unary
rpc GetArticle(GetRequest) returns (GetResponse);

// Server Streaming
rpc WatchArticles(WatchRequest) returns (stream ArticleEvent);

// Client Streaming
rpc UploadArticles(stream ArticleChunk) returns (UploadResult);

// Bidirectional Streaming
rpc SyncArticles(stream SyncRequest) returns (stream SyncResponse);
```

| 模式 | Client 发送 | Server 返回 |
|---|---:|---:|
| Unary | 1 条 | 1 条 |
| Server Streaming | 1 条 | 多条 |
| Client Streaming | 多条 | 1 条 |
| Bidirectional Streaming | 多条 | 多条 |

若业务需要持续推送、日志流、实时状态或双向同步，gRPC 的模型更自然。

## 九、错误处理对比

### REST

通常由 HTTP Status 与业务错误 Body 组成：

```http
HTTP/1.1 404 Not Found
```

```json
{
  "code": "ARTICLE_NOT_FOUND",
  "message": "article not found"
}
```

### gRPC

使用标准 Status Code：

```go
return nil, status.Error(codes.NotFound, "article not found")
```

常见映射：

| 语义 | REST | gRPC |
|---|---:|---|
| 参数错误 | 400 | `InvalidArgument` |
| 未认证 | 401 | `Unauthenticated` |
| 无权限 | 403 | `PermissionDenied` |
| 未找到 | 404 | `NotFound` |
| 已存在 | 409 | `AlreadyExists` |
| 限流 | 429 | `ResourceExhausted` |
| 客户端取消 | 499（非标准常见值） | `Canceled` |
| 超时 | 504 | `DeadlineExceeded` |
| 服务不可用 | 503 | `Unavailable` |
| 内部错误 | 500 | `Internal` |

不要把所有业务错误都映射成 `Internal`，否则客户端无法判断是参数错误、资源不存在还是服务故障。

## 十、认证、元数据和中间件

### REST

常用 Header：

```http
Authorization: Bearer <token>
X-Request-ID: ...
```

Gin 中通常通过 Middleware：

```go
router.Use(AuthMiddleware())
```

### gRPC

使用 Metadata：

```go
md := metadata.Pairs("authorization", "Bearer "+token)
ctx := metadata.NewOutgoingContext(context.Background(), md)
```

服务端使用 Unary/Stream Interceptor：

```go
grpc.NewServer(
    grpc.ChainUnaryInterceptor(
        RequestIDInterceptor,
        LoggingInterceptor,
        AuthInterceptor,
        RecoveryInterceptor,
    ),
)
```

大致对应：

```text
REST Middleware ↔ gRPC Interceptor
HTTP Header     ↔ gRPC Metadata
```

## 十一、超时、取消和重试

REST 客户端和 gRPC 客户端都应显式设置超时。

gRPC 示例：

```go
ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
defer cancel()

resp, err := client.GetArticle(ctx, req)
```

gRPC 会通过 Context 传播：

- Deadline；
- Cancellation；
- Metadata；
- Trace 信息。

重试需谨慎：

- 查询类幂等操作通常更适合重试；
- 创建、扣款等非幂等操作不能盲目重试；
- 即使客户端收到超时，服务端操作也可能已经成功；
- 应结合幂等键、请求 ID 和重试策略。

REST 同样存在这些分布式系统问题，并非 gRPC 独有。

## 十二、契约与版本演进

### REST

常见版本方式：

```text
/api/v1/articles
/api/v2/articles
```

OpenAPI 可用于：

- 文档；
- Client 生成；
- Schema 校验；
- API Gateway 集成。

但如果团队不维护 OpenAPI，REST 很容易出现“文档和实现不一致”。

### gRPC

版本通常进入 proto package：

```protobuf
package article.v1;
```

演进规则：

- 新增字段通常是兼容的；
- 不改变已有字段编号；
- 不复用删除字段的编号；
- 用 `reserved` 标记废弃编号；
- 不随意改变字段类型或语义；
- 破坏性变化可创建 `article.v2`。

`.proto` 是可执行契约：Client、Server 和消息代码都由它生成，因此更容易在编译期发现不一致。

## 十三、浏览器、网关与公开 API

REST 对浏览器最自然：

- `fetch` / Axios 直接请求；
- JSON 原生处理；
- HTTP 缓存和 CDN 成熟；
- Swagger/OpenAPI 方便第三方接入。

标准 gRPC 浏览器支持受限，常见解决方案：

- gRPC-Web；
- Envoy 等代理；
- API Gateway；
- grpc-gateway 将 proto 映射为 REST/JSON。

因此常见架构是：

```text
Browser / Third-party
        ↓ REST/JSON
API Gateway / BFF
        ↓ gRPC
Internal Services
```

这不是重复建设，而是为不同边界选择合适协议。

## 十四、可观测性与调试

### REST 工具

```bash
curl http://localhost:9090/api/v1/articles/1
```

- Postman；
- Swagger UI；
- 浏览器 DevTools；
- OpenAPI 文档。

### gRPC 工具

```bash
grpcurl -plaintext localhost:9091 list

grpcurl -plaintext \
  -d '{"id": 1}' \
  localhost:9091 \
  article.v1.ArticleService/GetArticle
```

- grpcurl；
- grpcui；
- Server Reflection；
- `.proto` 描述文件。

生产环境中 Reflection 是否开启应根据安全策略决定；外部服务可能选择关闭或仅在内网开放。

两者都应统一接入：

- Request ID / Trace ID；
- Structured Logging；
- Metrics；
- Distributed Tracing；
- Recovery；
- Authentication；
- Rate Limiting。

## 十五、如何选型

### 优先 REST 的场景

- 浏览器直接调用；
- 面向第三方开发者的开放 API；
- 需要 CDN、HTTP Cache、SEO 或标准代理能力；
- 调试便利和低接入门槛优先；
- 调用方语言和环境不可控；
- CRUD 型资源接口为主。

### 优先 gRPC 的场景

- 内部微服务间通信；
- 团队可控制 Client 和 Server；
- 对吞吐、延迟、消息体积敏感；
- 希望通过 `.proto` 获得强契约和生成 Client；
- 需要 Client/Server/Bidirectional Streaming；
- 多语言服务需要统一接口定义。

### 同时使用

典型方案：

```text
外部：REST / JSON
内部：gRPC / protobuf
核心：共享 Application / Domain
```

也可以通过 grpc-gateway 从同一 proto 暴露 REST，但要考虑：

- HTTP 语义映射；
- 错误模型映射；
- 认证与 Header/Metadata 转换；
- 流式接口无法完全等价映射；
- 公网 API 是否真正符合资源化设计。

## 十六、常见误区

### 误区 1：gRPC 就是 Go 函数调用

客户端看起来像调用方法，但实际仍经过：

```text
序列化 → 网络 → HTTP/2 → 服务端分发 → 业务执行 → 网络返回
```

仍需处理超时、重试、部分失败和网络分区。

### 误区 2：用了 HTTP/2 就等于 gRPC

gRPC 还定义了 protobuf 消息、方法路径、状态模型、Metadata、Streaming 和代码生成规范。

### 误区 3：REST 一定慢，gRPC 一定快

数据库、外部服务和网络延迟可能才是主要瓶颈，应通过压测决定，而不是只看协议标签。

### 误区 4：REST 与 gRPC 各写一套 Service

这会复制业务规则。正确做法是两个 Handler 共同调用同一 Application Service。

### 误区 5：有 `.proto` 就表示服务已完成

还必须完成：

```text
生成代码 → 实现 Server → 注册 Service → 启动 → 集成测试
```

### 误区 6：protobuf 字段编号可以随便改

字段编号是线上协议的一部分，错误复用可能导致新旧客户端误解数据。

### 误区 7：gRPC 自带安全

gRPC 不会自动提供业务鉴权。生产环境仍需 TLS/mTLS、Token、Interceptor、权限控制和审计。

## 十七、决策速查表

| 问题 | 是 | 建议 |
|---|---|---|
| 是否由浏览器直接调用？ | 是 | REST 或 gRPC-Web |
| 是否是公开第三方 API？ | 是 | REST/OpenAPI 通常更友好 |
| 是否为内部可控服务通信？ | 是 | 可优先 gRPC |
| 是否需要双向流？ | 是 | 优先 gRPC |
| 是否强依赖 CDN/HTTP Cache？ | 是 | 优先 REST |
| 是否要求多语言强类型 Client？ | 是 | gRPC 很合适 |
| 是否只做普通 CRUD 且性能压力不高？ | 是 | REST 更简单 |
| 是否要同时服务公网与内部系统？ | 是 | 外 REST、内 gRPC、共享核心 |

## 十八、总结

REST 和 gRPC 的本质区别不是“JSON 与 protobuf”这么简单，而是两套不同的接口设计与通信体系：

```text
REST：Resource + HTTP Semantics + JSON/OpenAPI
gRPC：Service + RPC Method + protobuf + HTTP/2
```

在 Clean Architecture 中，最佳实践是把差异限制在接口层：

```text
REST Handler ┐
             ├→ Application Service → Repository → Database
gRPC Handler ┘
```

选型时优先看调用边界、客户端环境、流式需求、契约治理、缓存生态和性能目标；没有必要将二者设计成互斥关系。

---
#Go #RESTful #gRPC #API设计 #CleanArchitecture
