# Go 后端学习路线图（综合规划）

> 综合豆包、Gemini、ChatGPT 三家建议，结合企业级 Go 后端岗位能力要求，
> 提炼出的 4 阶段学习路径。每阶段都有可写进简历的产出。

## 阶段总览

| 阶段 | 时长 | 主题 | 简历级产出 |
| --- | --- | --- | --- |
| 1. 基础与标准库 | 1–2 周 | 语法、并发、`net/http` | 并发爬虫、简单 HTTP 服务 |
| 2. 框架与工程规范 | 2–3 周 | Gin/GORM、Clean Architecture | `gin-vue-admin` 二次开发 |
| 3. 中间件与高并发 | 3–4 周 | Redis、Kafka、限流、分布式锁 | 短链接 / 工单高并发服务 |
| 4. 微服务与云原生 | 4–6 周 | go-zero/Kratos、gRPC、K8s | 3–5 个微服务的电商/IM |

## 阶段 1：基础与标准库（1–2 周）

**目标**：会写 Go、懂并发、能写简单 HTTP 服务。

**必学**：
- 环境：`go mod`、编译、交叉编译
- 语法：变量、切片、map、结构体、接口、error、defer
- 并发：**goroutine、channel、select、sync.WaitGroup、sync.Mutex**
- 网络：`net/http` 写简单接口
- 工具：单元测试、`pprof`、日志（`zap` / `zerolog`）

**小项目**：
- 命令行 Todo 工具
- 并发爬虫（爬 10 个页面）
- 简单 HTTP 接口（用户注册/查询）

## 阶段 2：框架与工程规范（2–3 周）

**目标**：具备去大厂搬砖的规范代码能力。

**必学**：
- **Web 框架**：Gin（主流）或 Fiber（极速）
- **ORM / SQL**：`GORM` 或 `sqlx`，连接池、事务、索引、软删除
- **架构分层**：Controller → Service → Model，或 Clean Architecture
  （参考 [go-backend-clean-architecture](https://github.com/bxcodec/go-clean-arch)）
- **配置 / 日志**：`Viper`、`zap`/`zerolog`
- **认证**：JWT、Casbin（RBAC）

**实战项目**：[gin-vue-admin](https://github.com/flipped-aurora/gin-vue-admin)
- 跑通、看懂目录结构
- 新增"商品管理"模块（CRUD + 分页 + 缓存）
- 理解 JWT 登录、RBAC 权限

## 阶段 3：中间件与高并发（3–4 周）

**目标**：会做"高可用、高并发"服务，面试重点。

**必学**：
- **Redis**：缓存、分布式锁、限流、延迟队列、缓存击穿/雪崩/穿透
- **消息队列**：Kafka / RabbitMQ / NSQ，异步解耦、消息投递语义
  （at-most-once / at-least-once / exactly-once）
- **并发模式**：worker pool、生产者消费者、限流/熔断
- **链路追踪**：`jaeger` / OpenTelemetry
- **容器化**：Docker 多阶段构建，把 Go 应用压到十几 MB

**实战项目**：
- 短链接服务（高并发、Redis 缓存、过期清理、布隆过滤器）
- 或基于 [ferry](https://github.com/lanyulei/ferry) 做一个"简易客服工单系统"

## 阶段 4：微服务与云原生（4–6 周）

**目标**：达到大厂 Go 后端水平，能拆微服务、懂服务治理。

**必学**：
- **微服务框架**：[go-zero](https://github.com/zeromicro/go-zero) /
  [Kratos](https://github.com/go-kratos/kratos) /
  [Hertz](https://github.com/cloudwego/hertz)
- **RPC**：`Protobuf` + `gRPC`，必要时 `grpc-gateway` 对外 REST
- **服务治理**：服务注册与发现（etcd/Nacos/Consul）、配置中心、熔断、限流、降级
- **可观测**：Prometheus 指标 + Grafana 看板 + 日志聚合
- **容器编排**：K8s 基础（Deployment、Service、Ingress、ConfigMap）

**实战项目**：go-zero 电商微服务
- 拆分：用户服务、商品服务、订单服务、库存服务
- 服务间 gRPC 调用 + 网关聚合 + JWT 鉴权 + 限流

## 学习原则（三家共识）

1. **不要只看书不写代码**——直接从 clone 一个模板项目跑通开始
2. **不要贪多**——同一阶段只深耕 1 个项目，避免浅尝辄止
3. **带着问题读源码**——"它为什么这样设计" > "这行代码什么意思"
4. **输出倒逼输入**——每学完一个模块就写一篇笔记（这个仓库就是为此而建）
5. **简历导向**——每个阶段都要有"能讲 30 分钟"的项目作为产出

## 推荐项目分级（详见后续笔记）

| 梯队 | 主题 | 笔记 |
| --- | --- | --- |
| 第一梯队 | 企业级框架（go-zero / Kratos / Hertz） | [02](./02-go-tier1-enterprise-frameworks.md) |
| 第二梯队 | 云原生基础设施（K8s / Docker / Prometheus / etcd） | [03](./03-go-tier2-cloudnative-infra.md) |
| 第三梯队 | 存储与消息队列（MinIO / go-nsq / Kafka） | [04](./04-go-tier3-storage-and-mq.md) |
| 第四梯队 | Web3 区块链（go-ethereum / Chainlink / Cosmos SDK） | [05](./05-go-tier4-web3-blockchain.md) |
| 第五梯队 | 业务系统模板（Gitea / Grafana / Harbor / gin-vue-admin 等） | [06](./06-go-tier5-business-systems.md) |
