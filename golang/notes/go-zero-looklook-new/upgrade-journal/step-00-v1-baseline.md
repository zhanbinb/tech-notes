# Step 0：v1 现状摸底

> 日期：2026-08-04  
> 目的：搞清楚 v1（main 分支当前状态）已经升过什么、还差什么，避免无脑升级。

## 一、go.mod 关键依赖

| 依赖 | v1 实际版本 | 状态 | 备注 |
|---|---|---|---|
| Go | `1.22` | ✅ 已升 | 原 README 写的 1.17，作者已升 |
| `github.com/zeromicro/go-zero` | `v1.7.3` | ⚠️ 落后 2 个小版本 | 主流已到 1.9 |
| `google.golang.org/grpc` | `v1.65.0` | ✅ 现代 | |
| `github.com/golang-jwt/jwt/v4` | `v4.5.0` | ❌ 仍 v4 | v5 已 GA，破坏性 API |
| `github.com/go-redis/redis/v8` | `v8.11.5` | ❌ 仍 v8 | v9 已 GA，API 有变 |
| `github.com/pkg/errors` | `v0.9.1` | ❌ 冻结 | 改标准库 errors |

> **关键发现**：原作者已经悄悄升过 go / go-zero / grpc，但 **jwt / redis / errors 这 3 个还是 v1 状态**。升级范围比想象中要小。

## 二、过期/有替代品的技术（按"必须升级"分类）

### 必须升级（不升会出问题）

| 技术 | v1 → 目标 | 原因 |
|---|---|---|
| Go 1.22 → 1.25 | 1.25+ | 新版 go-zero 内部用到 1.22+ 特性 |
| go-zero v1.7.3 → v1.9.x | v1.9+ | goctl 1.5+ 已经改 rpc 协议、模板格式；老教程里的 `goctl rpc proto` 用法在新版已改 |
| golang-jwt v4 → v5 | v5 | v4 已 EOL，v5 是破坏性升级（`jwt.NewWithClaims` 等参数顺序调整） |
| go-redis v8 → v9 | v9 | v8 已被官方标 legacy，v9 改 client 结构 + context 强约束 |
| grpc v1.65 → v1.71+ | v1.71+ | go-zero 1.6+ 推荐配套 |
| k8s.io 0.x → v0.30+ | v0.30+ | indirect 依赖，go-zero 1.5+ 升了 |
| modd → cosmtrek/air | air | modd 近 2 年没大动作，air 已是 Go 生态事实标准 |
| docker-compose v1 → v2 | v2 语法 | `docker-compose` 已 EOL，改 `docker compose` |
| Dockerfile 基础镜像 golang-1.17.7-alpine → golang-1.25-alpine | 1.25 alpine | 1.17 alpine 的 glibc 已不支持 buf、protoc-gen-go 最新版 |
| pkg/errors → 标准库 errors | stdlib | Go 1.20+ 原生 `errors.Is/As/Unwrap/Join` |

### 整段范式已变（建议直接换思路）

| 技术 | 替代品 |
|---|---|
| nginx 当 API 网关 | APISIX / Envoy Gateway / Kong |
| filebeat → kafka → go-stash → es → kibana | Vector + Loki / Vector + ClickHouse |
| Jaeger 直连 | OpenTelemetry SDK + Collector（Jaeger 作后端之一） |
| DTM 专用中间件 | Outbox 模式 + 消息队列 / Temporal |
| Jenkins + GitLab CI | GitLab CI + ArgoCD（GitOps）/ GitHub Actions + ArgoCD |
| go-queue/kq（Kafka 强依赖）| NATS JetStream（轻量场景） / Redis Streams（够用场景） |
| asynq（Redis 延迟队列）| River（Postgres 场景）/ Temporal（工作流场景） |

### 生态完全没变（继续用）

MySQL / Redis / Prometheus / Grafana / Kafka / Harbor / K8s / Docker

## 三、和 2026 年现代项目的差异

> 参考项目：cloudwego/biz-demo（字节）、go-kratos/beer-shop（B 站）、GoogleCloudPlatform/microservices-demo、opentelemetry/opentelemetry-demo

| 维度 | go-zero-looklook v1 | 现代项目 |
|---|---|---|
| 工程结构 | 多 repo（每个服务独立 go.mod 概念） | mono-repo + Go workspace |
| 网关 | nginx + auth_request | APISIX / Envoy Gateway |
| 注册中心 | 直连 / etcd | Nacos / etcd（可插拔） |
| ORM | go-zero sqlx | go-zero sqlx / Ent / GORM Gen |
| 分布式事务 | DTM | Outbox 模式 / 消息队列 / DTM / Temporal |
| 异步任务 | asynq | asynq / River / Temporal |
| 消息队列 | Kafka + go-queue/kq | Kafka / NATS JetStream / RocketMQ |
| 链路追踪 | Jaeger 直连 | OpenTelemetry SDK + Collector |
| 日志 | ELK（自管 filebeat） | Grafana Loki / Vector / ClickHouse |
| 热加载 | modd | cosmtrek/air |
| CI/CD | Jenkins + GitLab | GitLab CI / GitHub Actions + ArgoCD |
| 部署 | k8s + kubectl | k8s + Helm / Kustomize + ArgoCD |
| 错误处理 | 自定义 xerr（uint32 码） | gRPC status + standard error wrapping |

## 四、学习价值评估

- **微服务架构思路 + 业务模型**（api 聚合、rpc 业务、mq 异步、xerr、JWT 范式）→ 仍然非常值得学
- **直接照搬用于新项目** → 不建议，至少要走完 Step 2-4
- **作为升级迁移教材** → 非常合适，每个升级点都有"为什么"
