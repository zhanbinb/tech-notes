# Go Clean Architecture：从 proto 定义到 gRPC 调用的完整链路

> 以 Article 查询接口为例，梳理 `.proto` 设计、Go 代码生成、服务端实现与注册、客户端调用，以及请求如何复用既有 Application、Repository 和 GORM 链路。

## 核心结论

- `.proto` 是客户端和服务端共享的**通信契约**，定义 Service、RPC Method 和 Message。
- `protoc-gen-go` 生成 protobuf 消息及编解码支持；`protoc-gen-go-grpc` 生成 Client、Server 接口、注册函数和底层分发代码。
- 业务开发者不应手写 `ServiceDesc`、底层解码 Handler 或生成文件，而应实现生成的 Server 接口。
- gRPC Handler 只负责协议适配：`Proto Request → Application Input`、错误映射、`Application DTO → Proto Response`。
- 进入 `article.Service` 后，gRPC 与 REST 复用相同的 Domain、Repository Interface、GORM Repository 和数据库。

## 一、整体调用链

```text
gRPC Client / grpcurl
  ↓ protobuf + HTTP/2
Generated Client
  ↓ /article.v1.ArticleService/GetArticle
grpc.Server
  ↓ Generated ServiceDesc / Handler
ArticleServer.GetArticle
  ↓
article.Service.GetByID
  ↓
article.Repository（接口）
  ↓
gorm.ArticleRepository（实现）
  ↓
ArticleModel / MySQL
  ↓
Domain Entity → ArticleDTO → protobuf Response
```

项目中的关键文件可按职责划分：

```text
api/proto/article/v1/article.proto        # 协议源文件
api/gen/go/article/v1/article.pb.go       # 消息生成代码
api/gen/go/article/v1/article_grpc.pb.go  # gRPC Client/Server 生成代码
internal/interfaces/grpc/handler/article.go # 业务协议适配
internal/interfaces/grpc/server.go        # 服务注册
pkg/server/grpc.go                        # Server 生命周期
cmd/grpc/main.go                          # gRPC 可执行程序入口
```

## 二、定义 `.proto`

文件：`api/proto/article/v1/article.proto`

```protobuf
syntax = "proto3";

package article.v1;

option go_package =
  "github.com/zhanbinb/go-clean-arch_demo/api/gen/go/article/v1;articlev1";

service ArticleService {
  rpc GetArticle(GetArticleRequest) returns (GetArticleResponse);
  rpc GetArticleTitle(GetArticleTitleRequest)
      returns (GetArticleTitleResponse);
}

message GetArticleRequest {
  int64 id = 1;
}

message GetArticleResponse {
  Article article = 1;
}

message GetArticleTitleRequest {
  int64 id = 1;
}

message GetArticleTitleResponse {
  int64 id = 1;
  string title = 2;
}

message Article {
  int64 id = 1;
  string title = 2;
  string content = 3;
  int64 author_id = 4;
  string author_name = 5;
  int64 created_at = 6;
  int64 updated_at = 7;
}
```

### 1. RPC 完整名称

由三部分组成：

```text
package article.v1
service ArticleService
method  GetArticleTitle
```

完整名称为：

```text
/article.v1.ArticleService/GetArticleTitle
```

### 2. 字段编号不是默认值

```protobuf
int64 id = 1;
string title = 2;
```

`1`、`2` 是 protobuf 的 field number/tag，会进入二进制协议。协议发布后应保持稳定：

- 不要随意改变已有字段编号；
- 删除字段后不要把旧编号分配给新字段；
- 可使用 `reserved` 保留废弃编号和字段名；
- 新字段应使用新的编号，以保持向前/向后兼容。

### 3. `go_package`

```protobuf
option go_package = ".../api/gen/go/article/v1;articlev1";
```

- 分号前：生成代码的 Go import path；
- 分号后：生成代码的 package name，即 `articlev1`。

## 三、配置与执行代码生成

推荐让 `go_package` 决定生成目录。`buf.gen.yaml` 可采用 module 模式：

```yaml
version: v1
plugins:
  - name: go
    out: .
    opt:
      - module=github.com/zhanbinb/go-clean-arch_demo
  - name: go-grpc
    out: .
    opt:
      - module=github.com/zhanbinb/go-clean-arch_demo
```

需要的工具：

```text
buf
protoc-gen-go
protoc-gen-go-grpc
```

将插件安装到项目 `bin/`：

```bash
GOBIN="$(pwd)/bin" go install \
  google.golang.org/protobuf/cmd/protoc-gen-go@latest

GOBIN="$(pwd)/bin" go install \
  google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

执行生成：

```bash
PATH="$(pwd)/bin:$PATH" make proto
```

期望产物：

```text
api/gen/go/article/v1/article.pb.go
api/gen/go/article/v1/article_grpc.pb.go
```

### 两类生成文件的职责

`article.pb.go` 包含：

- `GetArticleRequest`、`Article` 等 Message；
- `GetId()` 等 getter；
- `ProtoReflect()`、`Reset()` 等 protobuf 支持；
- 标准 protobuf 编解码所需实现。

`article_grpc.pb.go` 包含：

- `ArticleServiceClient`；
- `NewArticleServiceClient`；
- `ArticleServiceServer`；
- `UnimplementedArticleServiceServer`；
- `RegisterArticleServiceServer`；
- `ArticleService_ServiceDesc`；
- `_ArticleService_GetArticle_Handler` 等底层分发函数。

生成文件应通过修改 `.proto` 后重新生成，**不要手工编辑**。

## 四、实现生成的 Server 接口

文件：`internal/interfaces/grpc/handler/article.go`

```go
package handler

import (
    "context"

    articlev1 "github.com/zhanbinb/go-clean-arch_demo/api/gen/go/article/v1"
    apparticle "github.com/zhanbinb/go-clean-arch_demo/internal/application/article"
    "github.com/zhanbinb/go-clean-arch_demo/pkg/errcode"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

type ArticleServer struct {
    articlev1.UnimplementedArticleServiceServer
    svc *apparticle.Service
}

func NewArticleServer(svc *apparticle.Service) *ArticleServer {
    return &ArticleServer{svc: svc}
}
```

嵌入 `UnimplementedArticleServiceServer` 可为协议后续新增方法提供默认的 `Unimplemented` 行为，但已承诺提供的方法仍应显式实现。

### 示例：实现 `GetArticleTitle`

```go
func (s *ArticleServer) GetArticleTitle(
    ctx context.Context,
    req *articlev1.GetArticleTitleRequest,
) (*articlev1.GetArticleTitleResponse, error) {
    if req.GetId() <= 0 {
        return nil, status.Error(
            codes.InvalidArgument,
            "article id must be greater than zero",
        )
    }

    dto, err := s.svc.GetByID(ctx, req.GetId())
    if err != nil {
        e := errcode.FromError(err)
        if e.Code == errcode.ErrNotFound.Code {
            return nil, status.Error(codes.NotFound, e.Message)
        }
        return nil, status.Error(codes.Internal, e.Message)
    }

    return &articlev1.GetArticleTitleResponse{
        Id:    dto.ID,
        Title: dto.Title,
    }, nil
}
```

职责边界：

```text
Proto Request
  ↓ 校验与转换
gRPC Handler
  ↓ 调用
Application Service
  ↓ 返回
Application DTO
  ↓ 转换
Proto Response
```

Handler 不应直接依赖 `gorm.DB`、GORM Model 或 SQL。

## 五、DTO 与 protobuf Message 转换

应用层 DTO 与协议对象属于不同层：

```go
func dtoToProto(d *apparticle.ArticleDTO) *articlev1.Article {
    return &articlev1.Article{
        Id:         d.ID,
        Title:      d.Title,
        Content:    d.Content,
        AuthorId:   d.AuthorID,
        AuthorName: d.AuthorName,
        CreatedAt:  d.CreatedAt.Unix(),
        UpdatedAt:  d.UpdatedAt.Unix(),
    }
}
```

完整数据形态转换：

```text
写入：Proto Request → Application Input → Domain Entity → GORM Model
读取：GORM Model → Domain Entity → Application DTO → Proto Response
```

不要让 Application Service 直接返回 `articlev1.Article`，否则应用层会反向依赖 gRPC 协议层。

## 六、错误映射

Application Error 不应原样穿透到客户端，应在接口层映射成 gRPC Status：

| 业务语义 | gRPC Code |
|---|---|
| 参数非法 | `InvalidArgument` |
| 未登录 | `Unauthenticated` |
| 无权限 | `PermissionDenied` |
| 资源不存在 | `NotFound` |
| 资源已存在 | `AlreadyExists` |
| 限流/资源不足 | `ResourceExhausted` |
| 超时 | `DeadlineExceeded` |
| 服务不可用 | `Unavailable` |
| 未知内部错误 | `Internal` |

示例：

```go
return nil, status.Error(codes.NotFound, "article not found")
```

不要向客户端泄露 SQL、DSN、数据库密码或底层驱动错误。

## 七、注册服务

文件：`internal/interfaces/grpc/server.go`

```go
func (h *Handlers) Register(s *grpc.Server) {
    articlev1.RegisterArticleServiceServer(s, h.Article)
}
```

注册的是整个 `ArticleService`，不是逐个注册 RPC Method。生成代码内部使用 `ServiceDesc` 建立分发表：

```text
/article.v1.ArticleService/GetArticle
  → generated GetArticle handler
  → ArticleServer.GetArticle

/article.v1.ArticleService/GetArticleTitle
  → generated GetArticleTitle handler
  → ArticleServer.GetArticleTitle
```

切换为真实生成代码后，应停止维护手写的 Request/Response、`ServiceDesc` 和 `_ArticleService_*_Handler`。

## 八、入口和 Server 生命周期

`cmd/grpc/main.go` 的主要步骤：

```text
读取 APP_ENV
  ↓
wire.New：配置、日志、数据库、Repository、Service
  ↓
创建 grpc.Server
  ↓
创建 ArticleServer 并注入 article.Service
  ↓
RegisterArticleServiceServer
  ↓
监听 gRPC 端口
  ↓
收到 SIGINT/SIGTERM 后优雅停止
```

新增同一 Service 下的 RPC，一般不需要修改 `cmd/grpc/main.go`，因为入口只负责注册整个 Service。

`pkg/server/grpc.go` 负责：

- `net.Listen("tcp", addr)`；
- `grpc.NewServer(opts...)`；
- `grpc.Server.Serve`；
- Reflection；
- `GracefulStop` 与超时后的 `Stop`。

Server 生命周期 Context 与单次 RPC Context 不同：

```text
main 中的 ctx              # 整个进程/Server 生命周期
GetArticle(ctx, req) 的 ctx # 单次 RPC 的 deadline、取消、metadata
```

## 九、构建、启动与调用

生成并构建：

```bash
PATH="$(pwd)/bin:$PATH" make proto
make build-grpc
```

启动：

```bash
make run-grpc
# 或
go run ./cmd/grpc
```

如果端口为 `9091`，利用 Server Reflection 检查：

```bash
grpcurl -plaintext localhost:9091 list

grpcurl -plaintext \
  localhost:9091 \
  list article.v1.ArticleService

grpcurl -plaintext \
  localhost:9091 \
  describe article.v1.ArticleService.GetArticleTitle
```

调用：

```bash
grpcurl \
  -plaintext \
  -d '{"id": 1}' \
  localhost:9091 \
  article.v1.ArticleService/GetArticleTitle
```

protobuf JSON 映射可能把 `int64` 展示成字符串：

```json
{
  "id": "1",
  "title": "文章标题"
}
```

底层 protobuf 二进制仍然是 `int64`。

## 十、Go Client 示例

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    articlev1 "github.com/zhanbinb/go-clean-arch_demo/api/gen/go/article/v1"
    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
)

func main() {
    conn, err := grpc.NewClient(
        "localhost:9091",
        grpc.WithTransportCredentials(insecure.NewCredentials()),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    client := articlev1.NewArticleServiceClient(conn)
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()

    resp, err := client.GetArticleTitle(
        ctx,
        &articlev1.GetArticleTitleRequest{Id: 1},
    )
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("id=%d title=%q\n", resp.GetId(), resp.GetTitle())
}
```

生成的 Client 内部最终调用类似：

```go
cc.Invoke(
    ctx,
    "/article.v1.ArticleService/GetArticleTitle",
    in,
    out,
    opts...,
)
```

## 十一、当前项目的特殊注意点

当前项目曾使用普通 Go struct 和手写 `ServiceDesc` 模拟生成代码。普通 struct 没有实现标准 protobuf Message 所需的反射与编解码能力，因此“可以编译或启动”不等于“标准 protobuf RPC 可以正常调用”。

标准做法应是：

```text
修改 .proto
  ↓
buf generate
  ↓
使用 articlev1 生成类型
  ↓
实现生成的 Server 接口
  ↓
调用生成的 Register 函数
```

## 十二、常见坑

1. **只安装 Buf，没安装生成插件**：`buf generate` 仍会找不到 `protoc-gen-go` 或 `protoc-gen-go-grpc`。
2. **输出目录与 `go_package` 不一致**：优先使用 module 模式，避免出现重复的 `api/proto` 路径。
3. **手改生成代码**：下次生成会被覆盖；应修改 `.proto` 或业务 Handler。
4. **手写类型与生成类型并存**：容易发生类型不匹配和重复注册，应只保留一套协议类型。
5. **proto 已定义但未注册**：存在 `.proto` 不代表服务可调用，还必须生成、实现并注册。
6. **Application 层依赖 `articlev1`**：会让业务层耦合传输协议，破坏依赖方向。
7. **没有校验 proto3 默认值**：普通标量未传时得到零值，如 `int64 id` 为 `0`。
8. **把 gRPC 当成函数直调**：它仍经过网络、HTTP/2、序列化、deadline、status 和连接管理。
9. **没有设置 deadline**：客户端调用可能无限等待；应使用 `context.WithTimeout`。
10. **本地使用 plaintext 忘记生产 TLS**：生产环境应配置 TLS/mTLS 和鉴权 Interceptor。

## 十三、实践检查清单

```text
[ ] proto 定义 Service、Method、Request、Response
[ ] 已规划稳定的字段编号
[ ] go_package 与生成目录一致
[ ] protoc-gen-go 与 protoc-gen-go-grpc 可用
[ ] 成功生成 pb.go 和 grpc.pb.go
[ ] Handler 使用生成类型
[ ] Handler 实现生成的 Server 接口
[ ] Application DTO 与 Proto Message 显式转换
[ ] Application Error 映射为 gRPC Status
[ ] 使用生成的 Register 函数注册
[ ] build 通过
[ ] grpcurl list/describe 成功
[ ] 正常、参数非法、NotFound、Internal 均完成测试
[ ] Go Client 设置 deadline 并调用成功
```

---
#Go #gRPC #Protobuf #CleanArchitecture #代码生成
