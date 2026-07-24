# go-zero 企业级实战学习路线图

> 以“订单交易系统”为主线，在 8～10 周内从 go-zero 基础、API/RPC 代码生成，逐步走到缓存、消息队列、分布式一致性、服务治理、可观测性与 Kubernetes 部署。目标不是记住框架 API，而是能够独立设计、实现和解释一个生产级 Go 微服务项目。

## TL;DR

- **先做单体 API，再拆 RPC 微服务**：业务边界没有想清楚前，不要为了“微服务”而拆分。
- **先理解调用链，再依赖代码生成**：每次执行 `goctl` 后都要追一遍 `route → handler → logic → svc → model/RPC`。
- **以真实业务问题驱动学习**：用订单、库存、支付回调、超时取消等场景练习幂等、事务、缓存和最终一致性。
- **最终交付物**：一个可以一键启动、可测试、可观测、可部署，并能讲清设计取舍的订单交易系统。

## 一、学习目标

完成路线后，应具备以下能力：

1. 使用 `.api`、`.proto` 和数据库表结构生成基础代码。
2. 理解 go-zero API 服务与 zRPC 服务的启动、注册和调用链。
3. 正确组织 `handler`、`logic`、`svc`、`model` 和公共组件。
4. 使用 MySQL、Redis、etcd 和 Kafka 构建多服务系统。
5. 处理超时、重试、幂等、缓存一致性和分布式事务边界。
6. 使用日志、指标和 Trace 定位跨服务问题。
7. 编写单元测试、集成测试、端到端测试与基本压测。
8. 使用 Docker Compose 本地编排，并部署到 Kubernetes。
9. 能够阅读 go-zero 的限流、熔断、服务发现、RPC 与缓存实现。
10. 能在面试或项目复盘中解释“为什么这样设计”，而不只是展示代码。

## 二、最终实战项目：订单交易系统

### 2.1 业务范围

项目至少包含以下真实业务闭环：

- 用户注册、登录和 JWT 鉴权
- 商品列表、商品详情和价格查询
- 库存查询、预占、确认和释放
- 创建订单、查询订单和取消订单
- 支付回调幂等处理
- 超时未支付订单自动关闭
- 订单状态变更事件投递
- 操作日志、指标、Trace 和告警

### 2.2 服务拆分

```text
Client
  │
  ▼
trade-api                  HTTP / REST，对外统一入口
  ├── user-rpc             用户、登录、身份信息
  ├── product-rpc          商品、价格
  ├── inventory-rpc        库存查询、预占、释放
  └── order-rpc            订单创建、状态流转
          │
          ├── MySQL        业务数据
          ├── Redis        缓存、幂等键、短期状态
          └── Kafka        订单事件、异步任务

order-job                  订单超时关闭、事件消费、补偿任务
etcd                       RPC 注册与服务发现
Prometheus + Grafana       指标与监控
OpenTelemetry              跨服务 Trace
```

### 2.3 核心业务状态机

```text
CREATED ──支付成功──▶ PAID ──库存确认──▶ CONFIRMED
   │                    │
   ├──主动取消───────────┴──────────────▶ CANCELED
   │
   └──超时未支付────────────────────────▶ CLOSED
```

状态变化必须满足：

- 非法状态不能跳转。
- 同一支付回调重复到达不会重复扣库存或记账。
- 创建订单接口因网络重试被调用多次时，只生成一笔业务订单。
- 消息重复消费不会产生重复副作用。
- 下游调用失败时，有明确的重试或补偿策略。

## 三、学习前置条件

### 3.1 Go 基础

开始前至少能够解释和使用：

- struct、interface、方法集和隐式接口实现
- error 包装与 `errors.Is/As`
- goroutine、channel、`sync.WaitGroup`、`sync.Mutex`
- `context` 的超时、取消与跨调用传递
- `net/http` 请求生命周期
- `database/sql` 事务和连接池
- Go Modules、单元测试和 benchmark

### 3.2 工具准备

```bash
go version
git --version
docker --version
docker compose version
protoc --version

# 安装 goctl
go install github.com/zeromicro/go-zero/tools/goctl@latest

# 安装 protobuf Go 插件
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

goctl --version
```

建议把版本记录到项目 `README.md`，团队项目中固定 go-zero、goctl 和 Protobuf 插件版本，避免不同成员生成结果不一致。

## 四、总体时间安排

> 默认按业余学习每天 2～3 小时、每周 5～6 天设计。全职学习可以压缩到 4～5 周，但不要跳过阶段验收。

| 阶段 | 时间 | 主题 | 阶段产物 |
| --- | --- | --- | --- |
| 0 | 2～3 天 | 环境与 Go 基础复查 | 环境检查表、基础小练习 |
| 1 | 第 1 周 | go-zero API 与 goctl | 单体用户 API |
| 2 | 第 2 周 | MySQL、Redis 与数据访问 | 带缓存的用户/商品模块 |
| 3 | 第 3 周 | Protobuf、zRPC 与 etcd | API 调用 User RPC |
| 4 | 第 4 周 | 领域拆分与微服务 | 用户、商品、库存、订单服务 |
| 5 | 第 5 周 | Kafka、幂等与最终一致性 | 完整下单与支付业务闭环 |
| 6 | 第 6 周 | 服务治理与故障演练 | 超时、限流、熔断、降级策略 |
| 7 | 第 7 周 | 测试与可观测性 | 测试集、Dashboard、Trace |
| 8 | 第 8 周 | Docker、K8s 与 CI/CD | 一键启动和 K8s 部署清单 |
| 9 | 第 9～10 周 | 源码阅读与项目打磨 | 源码笔记、压测报告、项目文档 |

## 五、分阶段详细路线

## 阶段 0：环境与基础复查（2～3 天）

### 学习内容

- `context.WithTimeout` 如何把截止时间传给数据库和 RPC。
- interface 为什么应靠近消费方定义。
- MySQL 事务的提交、回滚和隔离级别。
- HTTP 状态码与业务错误码的区别。
- REST 与 gRPC 的边界：外部 API 常用 REST，内部服务常用 gRPC。

### 必做练习

1. 用标准库写一个带超时的 HTTP Client。
2. 写一个并发任务池，支持 `context` 取消。
3. 用 `database/sql` 完成一次事务：创建订单并写入订单明细。
4. 定义一个 Repository interface，并分别写内存和 MySQL 实现。

### 验收标准

- 能解释 goroutine 泄漏的常见原因。
- 能解释为什么所有 I/O 调用都应该考虑超时。
- 能独立写出事务的 `defer Rollback + Commit` 流程。

---

## 阶段 1：go-zero API 与 goctl（第 1 周）

### 学习目标

- 跑通官方 `shorturl` 示例。
- 理解 `.api` DSL、代码生成和 API 服务启动过程。
- 独立完成注册、登录、获取用户信息三个接口。

### 第一步：运行官方示例

参考 [zero-examples](https://github.com/zeromicro/zero-examples)，先运行，再追调用链：

```text
main
→ config.Load
→ service.NewServiceContext
→ handler.RegisterHandlers
→ route
→ handler
→ logic
→ model / RPC
```

不要只确认接口能返回结果，还要回答：

- 配置在什么时候加载？
- 依赖为什么集中放在 `ServiceContext`？
- handler 为什么只做协议转换，不写业务逻辑？
- logic 如何取得数据库和 RPC Client？
- 路由是如何从 `.api` 生成出来的？

### 第二步：创建第一个 API 服务

```bash
mkdir trade-system && cd trade-system
go mod init example.com/trade-system

goctl api new user
```

也可以先手写 `user.api`，再生成代码：

```go
syntax = "v1"

type RegisterReq {
    Username string `json:"username"`
    Password string `json:"password"`
}

type UserResp {
    Id       int64  `json:"id"`
    Username string `json:"username"`
}

@server (
    prefix: /api/v1
)
service trade-api {
    @handler Register
    post /users/register (RegisterReq) returns (UserResp)
}
```

```bash
goctl api go -api user.api -dir .
```

### 本周必须掌握

- `.api` 是 HTTP 契约的源文件。
- `types` 负责请求和响应结构。
- `handler` 处理 HTTP 协议层工作。
- `logic` 承载用例和业务规则。
- `ServiceContext` 是依赖装配入口，不是全局变量垃圾桶。
- 配置结构体与 YAML 字段必须对应。
- 统一业务错误码与 HTTP 状态码映射。

### 本周产物

- 注册、登录、获取个人信息接口。
- JWT 保护的 `/api/v1/users/me`。
- API 错误码文档。
- 一张 API 请求完整调用链图。

### 验收标准

- 不看教程即可新增一个 API。
- 能指出哪些文件由 goctl 生成，哪些文件应写业务代码。
- handler 中没有数据库访问和复杂业务判断。

---

## 阶段 2：MySQL、Redis 与数据访问（第 2 周）

### 学习目标

- 使用 go-zero `sqlx` 和 model 代码生成访问 MySQL。
- 理解缓存命中、缓存失效和缓存一致性。
- 完成用户与商品两个真实数据模块。

### 数据表设计

至少创建：

```text
users
products
orders
order_items
inventory
outbox_events
```

所有核心表建议包含：

- 业务主键或分布式 ID
- `created_at`、`updated_at`
- 乐观锁版本号或明确的并发控制方式
- 能支撑查询条件的索引
- 必要的唯一约束，例如用户名、业务订单号、支付回调号

### Model 生成

先阅读帮助，确认当前 goctl 版本参数：

```bash
goctl model mysql datasource --help
```

典型命令：

```bash
goctl model mysql datasource \
  -url="root:password@tcp(127.0.0.1:3306)/trade" \
  -table="users" \
  -dir="./internal/model" \
  -c
```

### 必须掌握

- `sqlx.SqlConn` 的连接与查询方式。
- Model 生成代码的职责和扩展位置。
- Cache Aside：先查缓存，未命中查数据库并回填。
- 更新数据时先写数据库，再删除缓存。
- 缓存穿透、击穿和雪崩的区别。
- 唯一索引如何配合业务幂等。
- 事务不能跨 RPC 隐式传播。

### 必做练习

1. 用户注册时使用唯一索引防止重复用户名。
2. 商品详情加入 Redis 缓存。
3. 更新商品后删除缓存，并测试短暂不一致。
4. 为一个热点 Key 增加随机过期时间。
5. 故意让 Redis 停止，观察服务是否应该失败或降级到数据库。

### 本周产物

- MySQL migration 脚本。
- 用户和商品 Model。
- 商品详情缓存。
- 缓存命中率和数据库查询次数对比记录。

### 验收标准

- 能解释“为什么不能把 Redis 当数据库事务的一部分”。
- 能演示缓存未命中、回填和失效过程。
- 数据库错误不会原样泄露给 HTTP 客户端。

---

## 阶段 3：Protobuf、zRPC 与 etcd（第 3 周）

### 学习目标

- 把用户逻辑从 API 服务拆到 `user-rpc`。
- 使用 Protobuf 定义稳定的内部服务契约。
- 使用 etcd 完成 RPC 注册和服务发现。

### Proto 示例

```proto
syntax = "proto3";

package user;
option go_package = "./user";

service User {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
}

message GetUserRequest {
  int64 id = 1;
}

message GetUserResponse {
  int64 id = 1;
  string username = 2;
}
```

### 生成 RPC 代码

```bash
goctl rpc protoc user.proto \
  --go_out=. \
  --go-grpc_out=. \
  --zrpc_out=.
```

### 必须掌握

- `.proto` 是内部 RPC 契约，不是普通 DTO 文件。
- protobuf 字段编号发布后不能随意复用或修改语义。
- API Service 如何通过 `zrpc.RpcClientConf` 调用 RPC。
- etcd 中注册的 Key 与客户端发现配置如何对应。
- deadline、取消信号和 metadata 如何跨服务传播。
- gRPC 状态码如何映射为业务错误和 HTTP 响应。
- 哪些错误可以重试，哪些错误绝对不能自动重试。

### 必做练习

1. `trade-api` 调用 `user-rpc` 获取用户信息。
2. 给 RPC 设置超时，模拟下游响应超过 deadline。
3. 启动两个 `user-rpc` 实例，观察负载均衡。
4. 停止其中一个实例，观察服务发现和请求恢复。
5. 使用 `grpcurl` 直接调用 RPC，排除 HTTP 层干扰。

### 本周产物

- `user-rpc` 服务。
- API → RPC 完整调用链图。
- RPC 超时与错误码规范。
- etcd 注册信息检查命令记录。

### 验收标准

- 能解释 API 服务与 RPC 服务为什么要分开。
- 能从一次 HTTP 请求追踪到 RPC、Model 和数据库。
- 下游超时不会导致上游请求无限等待。

---

## 阶段 4：领域拆分与微服务（第 4 周）

### 学习目标

- 按业务边界拆分服务，而不是按数据库表拆分。
- 完成用户、商品、库存和订单四个领域。
- 明确每个服务的数据所有权。

### 推荐边界

| 服务 | 负责 | 不负责 |
| --- | --- | --- |
| `user-rpc` | 用户身份、登录凭证、用户状态 | 商品、订单 |
| `product-rpc` | 商品信息、价格、上下架 | 实时库存 |
| `inventory-rpc` | 可用库存、预占、释放、确认 | 订单状态 |
| `order-rpc` | 订单、订单明细、状态机 | 用户密码、商品维护 |
| `trade-api` | HTTP、鉴权、参数转换、服务编排入口 | 直接跨库修改数据 |

### 关键原则

- 每个服务只修改自己拥有的数据。
- 禁止 `order-rpc` 直接更新库存表。
- 跨服务读取通过 RPC，状态变化通过 RPC 或事件。
- 不能因为“少写一个 RPC”就共享数据库表。
- 公共包只放稳定、通用的能力，不能把业务逻辑全部塞入 `common`。

### 必做练习

1. 完成创建订单流程：校验用户 → 查询商品 → 预占库存 → 创建订单。
2. 设计业务订单号，保证全局唯一且便于排查。
3. 为创建订单增加 `Idempotency-Key`。
4. 实现订单状态机，拒绝非法状态跳转。
5. 为每个服务画出拥有的数据表和依赖关系。

### 本周产物

- 四个领域服务。
- 服务边界和数据所有权文档。
- 创建订单时序图。
- 订单状态机测试。

### 验收标准

- 能解释为什么某张表属于某个服务。
- 同一个创建订单请求重复提交不会产生重复订单。
- 服务之间不存在绕过 RPC 的跨库写入。

---

## 阶段 5：Kafka、幂等与最终一致性（第 5 周）

### 学习目标

- 使用消息队列解耦订单后续动作。
- 正确面对“消息可能重复、可能延迟、生产和消费都可能失败”。
- 使用本地事务 + Outbox 或补偿机制实现最终一致性。

### 业务事件

```text
OrderCreated
OrderPaid
InventoryReserved
InventoryConfirmed
InventoryReleased
OrderCanceled
OrderClosed
```

### 推荐下单流程

```text
1. 客户端携带 Idempotency-Key 创建订单
2. order-rpc 检查幂等记录
3. inventory-rpc 预占库存
4. order-rpc 本地事务写入订单和 outbox_events
5. 后台任务把 Outbox 事件投递到 Kafka
6. 消费者处理事件并记录消费幂等表
7. 失败进入重试，超过阈值进入死信或人工处理
```

### 必须掌握

- At-most-once、At-least-once 和 Exactly-once 的真实含义。
- 业务幂等不能只依赖消息队列配置。
- Producer 成功但本地数据库失败，或数据库成功但 Producer 失败的问题。
- Outbox Pattern 的作用与代价。
- Consumer Group、Partition、Offset 和顺序性。
- 重试次数、退避策略、死信和人工补偿。
- 支付回调验签、去重和状态校验。

### 必做故障实验

1. 同一支付回调连续发送 10 次，订单只能支付成功一次。
2. 消费完成但 Offset 未提交，重启消费者，验证重复消费安全。
3. Kafka 暂停后继续创建订单，验证 Outbox 是否保留待投递事件。
4. 库存预占成功但订单创建失败，执行库存释放补偿。
5. 超时订单关闭任务重复执行，不得重复释放库存。

### 本周产物

- Order 事件生产者和消费者。
- Outbox 投递任务。
- 消费幂等表或幂等键设计。
- 故障实验记录。

### 验收标准

- 能解释系统选择的是哪一种投递语义。
- 消息重复和任务重复不会产生额外业务副作用。
- 可以查出失败事件，并执行重试或补偿。

---

## 阶段 6：服务治理与故障演练（第 6 周）

### 学习目标

- 理解 go-zero 内置服务治理能力解决的具体故障。
- 为不同调用设置合理的超时、重试、限流和降级策略。
- 避免重试放大故障和产生重试风暴。

### 学习主题

- API 限流与负载保护
- RPC 熔断与请求保护
- 超时和 deadline 传播
- 重试边界与指数退避
- 服务发现与负载均衡
- Panic Recovery
- 优雅停止和连接排空
- 热点接口保护

### 策略示例

| 场景 | 推荐策略 |
| --- | --- |
| 查询商品详情 | 短超时；必要时允许有限重试；可降级读缓存 |
| 创建订单 | 不盲目自动重试；依赖幂等键后才允许客户端重试 |
| 支付回调 | 验签 + 幂等 + 状态机；失败记录并异步重试 |
| 查询库存 | 短超时；失败时不允许假装库存充足 |
| 日志/埋点上报 | 可异步；失败不阻塞核心业务 |

### 故障演练

1. 给 `product-rpc` 注入 2 秒延迟，观察超时传播。
2. 让 `inventory-rpc` 持续返回错误，观察熔断行为。
3. 对登录和创建订单接口做突发压测，观察限流。
4. 重启一个 RPC 实例，观察请求是否自动转移。
5. 在处理请求时发送终止信号，验证优雅停止。

### 本周产物

- 每个接口的超时预算表。
- 重试与幂等策略表。
- 限流、熔断和降级实验报告。
- 故障演练前后指标截图。

### 验收标准

- 能回答“这个请求为什么可以重试”。
- 下游故障不会无限占用上游 goroutine 和连接。
- 关键写操作有幂等保护，不依赖框架自动保证。

---

## 阶段 7：测试与可观测性（第 7 周）

### 学习目标

- 让系统可以被自动验证和快速定位问题。
- 建立日志、Metrics 和 Trace 三个观察维度。
- 对核心调用链进行压测并保留基线。

### 测试金字塔

```text
少量 E2E 测试
    ↑
RPC / 数据库 / Kafka 集成测试
    ↑
大量 Logic / Domain 单元测试
```

### 测试清单

#### 单元测试

- 订单状态机
- 创建订单幂等判断
- 支付回调重复处理
- 库存预占和释放规则
- 错误码映射

#### 集成测试

- MySQL Repository
- Redis 缓存失效
- API → RPC 调用
- Kafka 重复消费
- Outbox 事件投递

#### 端到端测试

- 注册 → 登录 → 查询商品 → 创建订单 → 支付 → 库存确认
- 注册 → 创建订单 → 超时 → 自动关闭 → 库存释放

### 可观测性

#### 日志

每条关键日志至少包含：

- Trace ID / Request ID
- User ID
- Order ID
- Service Name
- RPC Method 或 API Path
- Error Code
- Duration

禁止记录：

- 明文密码
- 完整 Token
- 支付密钥
- 私钥和敏感个人信息

#### Metrics

至少暴露和观察：

- QPS
- 成功率和错误率
- P50/P95/P99 延迟
- RPC 超时数量
- MySQL 连接池状态
- Redis 命中率
- Kafka 消费积压
- 订单创建成功率
- 支付回调重复次数
- Outbox 待投递事件数量

#### Trace

至少能追踪：

```text
HTTP trade-api
→ order-rpc
→ product-rpc
→ inventory-rpc
→ MySQL / Redis
```

### 压测

使用 `hey`、`wrk` 或 `k6`：

1. 先记录无缓存基线。
2. 加缓存后对比数据库压力和延迟。
3. 增加并发，找到错误率开始升高的拐点。
4. 使用 `pprof` 检查 CPU、内存和 goroutine。
5. 不追求漂亮数字，重点解释瓶颈和优化依据。

### 本周产物

- 自动化测试命令。
- Prometheus Dashboard。
- 一条完整 Trace 截图或记录。
- 压测报告和 pprof 分析结果。

### 验收标准

- 核心业务规则有单元测试。
- 一次跨服务错误可通过 Trace 和日志快速定位。
- 能说明当前系统的主要性能瓶颈。

---

## 阶段 8：Docker、Kubernetes 与 CI/CD（第 8 周）

### 学习目标

- 让其他人可以一条命令启动项目。
- 正确管理配置、密钥、健康检查和数据库迁移。
- 完成一个最小可用的 Kubernetes 部署。

### Docker Compose 环境

至少编排：

```text
MySQL
Redis
etcd
Kafka
Prometheus
Grafana
trade-api
user-rpc
product-rpc
inventory-rpc
order-rpc
order-job
```

目标命令：

```bash
docker compose up -d
docker compose ps
```

### Kubernetes 学习项

- Deployment 和 Service
- ConfigMap 和 Secret
- Readiness Probe 和 Liveness Probe
- Resource Requests/Limits
- Rolling Update
- Horizontal Pod Autoscaler
- Pod 优雅停止
- 数据库 migration Job

### CI 流程

```text
gofmt / gofmt check
→ go vet
→ unit test
→ integration test
→ go build
→ image build
→ vulnerability scan
→ deploy
```

### 安全检查

- JWT Secret 不写入仓库。
- 数据库密码通过环境变量或 Secret 注入。
- 登录接口限流。
- 密码使用 bcrypt/argon2 等安全哈希。
- 支付回调必须验签并防重放。
- 内部 RPC 不能默认等于可信，应考虑网络边界和认证。
- 对外错误不包含 SQL、堆栈和内部地址。

### 本周产物

- `Dockerfile` 和 `compose.yaml`。
- Kubernetes manifests 或 Helm Chart。
- CI Workflow。
- 部署、回滚和故障排查文档。

### 验收标准

- 新环境按照 README 可以启动系统。
- 服务有健康检查和优雅停止。
- 配置和密钥没有硬编码进镜像或仓库。

---

## 阶段 9：源码阅读与项目打磨（第 9～10 周）

### 阅读原则

不要从仓库第一行开始读。每次围绕一个运行中的问题，从自己的项目调用入口追进去。

### 推荐顺序

#### 1. API 启动与路由

重点回答：

- API Server 如何创建和启动？
- 路由、中间件和 handler 如何注册？
- 参数解析、校验和错误返回在哪里完成？

关注目录：

```text
rest/
rest/httpx/
```

#### 2. zRPC 调用链

重点回答：

- RPC Client 如何创建？
- etcd 服务发现结果如何进入负载均衡？
- deadline、拦截器、指标和 Trace 在哪一层处理？

关注目录：

```text
zrpc/
core/discov/
```

#### 3. 熔断与限流

重点回答：

- 什么样的错误会被计入熔断统计？
- 熔断器如何从关闭进入打开，再进入半开？
- 限流和负载保护分别解决什么问题？

关注目录：

```text
core/breaker/
core/limit/
```

#### 4. SQL 与缓存

重点回答：

- SQL 查询如何记录耗时和错误？
- 缓存未命中如何回源？
- 热点 Key 如何避免大量并发回源？

关注目录：

```text
core/stores/sqlx/
core/stores/cache/
core/syncx/
```

#### 5. 配置、日志和统计

关注目录：

```text
core/conf/
core/logx/
core/stat/
```

### 每次源码阅读输出模板

```markdown
## 问题
一次 RPC 调用如何完成服务发现和负载均衡？

## 入口
自己的项目中哪一行开始调用？

## 调用链
A → B → C → D

## 核心数据结构
列出 2～3 个关键 struct/interface。

## 设计取舍
为什么这样设计？替代方案是什么？

## 实验
停掉实例、制造超时或压测，验证理解。
```

### 最终打磨

- 删除无用生成代码和临时配置。
- 统一错误码、日志字段和配置命名。
- 补充架构图、时序图、状态机和 ER 图。
- 记录至少三个真实故障及排查过程。
- 编写压测报告，而不是只贴一张 QPS 截图。
- 给项目打版本标签，例如 `v0.1-api`、`v0.2-rpc`、`v1.0`。

## 六、推荐项目目录

```text
trade-system/
├── services/
│   ├── trade-api/
│   │   ├── trade.api
│   │   ├── etc/
│   │   └── internal/
│   ├── user-rpc/
│   │   ├── user.proto
│   │   ├── etc/
│   │   └── internal/
│   ├── product-rpc/
│   ├── inventory-rpc/
│   ├── order-rpc/
│   └── order-job/
├── common/
│   ├── errorx/
│   ├── idgen/
│   ├── middleware/
│   └── observability/
├── migrations/
├── deploy/
│   ├── docker-compose/
│   └── kubernetes/
├── tests/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── error-codes.md
│   └── runbook.md
├── Makefile
├── go.mod
└── README.md
```

目录设计注意：

- `common` 不能成为没有边界的公共垃圾场。
- 各服务应保持独立配置和清晰启动入口。
- 是否采用单仓库由团队规模决定；学习阶段推荐 Monorepo，便于调试和统一版本。
- 生成代码和手写代码的边界必须写进贡献说明。

## 七、每周学习节奏

### 每天 2～3 小时模板

```text
20 分钟：复习前一天调用链和问题
40 分钟：阅读官方文档或示例
60 分钟：实现一个可运行的小功能
30 分钟：测试和故障实验
20 分钟：记录“做了什么、为什么、踩了什么坑”
```

### 每周结束必须交付

1. 一个可以运行的新能力。
2. 一组自动化测试。
3. 一张调用链、时序图或架构图。
4. 一篇学习笔记。
5. 一个 Git Tag 或明确的阶段 Commit。
6. 一份“本周仍未理解的问题”列表。

## 八、禁止跳过的十个实验

1. API 请求超时后，确认下游 RPC 和 SQL 是否收到取消信号。
2. 连续提交相同 `Idempotency-Key`，确认只生成一笔订单。
3. 重复发送支付回调，确认只发生一次状态变化。
4. 停止 Redis，确认系统行为符合设计，而不是随机失败。
5. 停止一个 RPC 实例，观察服务发现和负载均衡。
6. 让 RPC 持续超时，观察熔断和恢复过程。
7. 消费完成但不提交 Offset，验证重复消费幂等。
8. 数据库成功但 Kafka 不可用，验证 Outbox 能重新投递。
9. 压测热点商品，观察缓存击穿和数据库连接池。
10. 服务处理中终止进程，验证优雅停止和请求排空。

## 九、常见误区

### 误区 1：会用 goctl 就等于会 go-zero

代码生成只解决重复劳动。服务边界、事务、缓存、幂等和错误处理仍需自己设计。

### 误区 2：所有逻辑都写进 Logic 文件

Logic 是用例入口，不等于可以无限膨胀。复杂领域规则应抽成明确的 Domain Service、状态机或策略对象。

### 误区 3：一开始就拆十几个服务

先完成模块化单体或少量服务，确认边界后再拆。服务越多，部署、测试和排障成本越高。

### 误区 4：RPC 调用失败就自动重试

写操作重试可能重复创建订单、扣减库存或发起支付。只有具备幂等条件、明确错误类型和重试预算时才能重试。

### 误区 5：用了 Redis 就解决了性能问题

缓存会引入一致性、穿透、击穿、雪崩和热 Key 问题。必须结合指标判断是否真的需要缓存。

### 误区 6：用了 Kafka 就是最终一致性

消息队列不会自动解决“数据库成功、消息发送失败”。仍需要 Outbox、事务消息或可靠补偿机制。

### 误区 7：框架自带监控，所以不用设计日志

框架指标无法代替业务指标。订单成功率、支付回调重复数和 Outbox 积压必须自己定义。

### 误区 8：生成代码不需要 Review

`.api`、`.proto` 和数据表都是契约源文件。契约变化必须 Review，并检查兼容性和生成 diff。

### 误区 9：所有服务共享一个 Model 包

共享 Model 会模糊数据所有权，使服务可以绕过 RPC 直接修改其他领域数据。

### 误区 10：本地能跑就是完成

企业级项目至少还需要测试、健康检查、配置管理、监控、故障演练、部署和回滚文档。

## 十、阶段性验收清单

### API 与工程结构

- [ ] 可以用 `.api` 生成并新增接口
- [ ] handler 保持轻量，业务规则位于 logic/domain
- [ ] 配置、依赖和启动流程清晰
- [ ] 统一错误码和响应结构

### 数据与缓存

- [ ] 有 migration 和必要索引
- [ ] 事务边界清晰
- [ ] 缓存有失效策略和降级策略
- [ ] Redis 故障行为经过验证

### RPC 与微服务

- [ ] Protobuf 字段遵循兼容性规则
- [ ] RPC 有超时和错误映射
- [ ] 服务边界和数据所有权有文档
- [ ] 服务发现和实例故障经过实验

### 消息与一致性

- [ ] 创建订单、支付回调和消费端都有幂等
- [ ] 有 Outbox 或其他可靠事件方案
- [ ] 有重试、死信和人工补偿入口
- [ ] 订单与库存异常路径经过测试

### 质量与交付

- [ ] 核心规则有单元测试
- [ ] 有集成测试和 E2E 测试
- [ ] 日志、Metrics 和 Trace 可用
- [ ] 有压测和 pprof 记录
- [ ] Docker Compose 可一键启动
- [ ] Kubernetes 有健康检查和资源限制
- [ ] README 能指导新成员运行项目

## 十一、面试与复盘问题

完成项目后，应能独立回答：

1. go-zero API 请求从路由到数据库经过哪些层？
2. `ServiceContext` 解决了什么问题？它可能被滥用成什么？
3. `.api`、`.proto` 和数据库表结构分别是什么契约？
4. API 与 RPC 服务的边界如何确定？
5. etcd 服务发现失败时系统如何表现？
6. 为什么创建订单不能简单自动重试？
7. 如何保证支付回调幂等？
8. 如何避免超卖？库存预占失败怎么处理？
9. 数据库事务和 Kafka 消息如何保证最终一致性？
10. 缓存击穿和热 Key 如何处理？
11. 熔断、限流、降级分别解决什么问题？
12. 如何通过日志、指标和 Trace 排查一次跨服务超时？
13. 为什么不能让所有微服务共享数据库 Model？
14. 系统当前瓶颈在哪里，压测证据是什么？
15. 如果业务量不大，为什么不应该拆成微服务？

## 十二、可选 Web3 扩展

订单交易系统完成后，可以把既有区块扫描能力接入 go-zero，扩展成“链上资产监控平台”：

```text
scanner-job
  ├── 扫描区块和 Event Log
  ├── 检测 Reorg
  └── 投递 Kafka 事件
          │
          ▼
asset-rpc / risk-rpc
  ├── 资产变更
  ├── 大额转账规则
  └── 告警记录
          │
          ▼
monitor-api
  └── 查询地址、交易、事件和告警
```

可以重点练习：

- Scanner 作为 Job 服务运行。
- 区块游标和 Reorg 记录落库。
- Event Log 通过 Kafka 分发。
- `risk-rpc` 执行大额转账和异常授权规则。
- API 提供交易、地址和告警查询。
- 对 RPC Provider 做超时、限流、重试和熔断。
- 监控区块延迟、RPC 错误率、Reorg 次数和消息积压。

## 相关链接

- [go-zero 官方网站与文档](https://go-zero.dev/)
- [go-zero GitHub](https://github.com/zeromicro/go-zero)
- [zero-examples](https://github.com/zeromicro/zero-examples)
- [goctl](https://github.com/zeromicro/go-zero/tree/master/tools/goctl)
- [go-queue](https://github.com/zeromicro/go-queue)
- [gRPC 官方文档](https://grpc.io/docs/languages/go/)
- [Protocol Buffers](https://protobuf.dev/)
- [etcd](https://github.com/etcd-io/etcd)
- [Prometheus](https://prometheus.io/docs/introduction/overview/)
- [OpenTelemetry Go](https://opentelemetry.io/docs/languages/go/)

---
#golang #go-zero #微服务 #gRPC #企业级实战
