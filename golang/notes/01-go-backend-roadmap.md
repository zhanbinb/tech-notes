# Go 后端学习路线图（融合版 · 2026-07）

> 融合"项目驱动 + 自己实现一遍"的学习哲学与企业系统成长路径，
> 结合 **Go 后端 → Web3 后端 → 兼容 Web2 高级后端** 的长期目标，
> 提炼的 8 阶段学习路径。
>
> **与上一版（v1）相比的关键变化**：
> - 增加阶段 0 补基础，避免阶段 1 起点过高
> - 引入"每个项目自己实现一遍"的硬性要求
> - Web3 权重提升到 35%，并独立成阶段 6
> - 阶段 4–5–7 去重，明确分层
> - 引入明确的时间分配比例（20/30/35/15）
> - 目标定位从"学到能用"升级到"P6/P7 级简历"

## 核心学习原则

1. **项目驱动**——不要只学框架 API，每个阶段都要"做出来"
2. **每个项目都要自己实现一遍**——光看源码不算数
3. **带着问题读源码**——"它为什么这样设计" > "这行代码什么意思"
4. **输出倒逼输入**——每学完一个模块就写笔记
5. **简历导向**——每个阶段产出都能讲 30 分钟

## 时间分配（20 / 30 / 35 / 15）

| 模块 | 占比 | 对应阶段 |
| --- | --- | --- |
| Go 基础与设计模式 | 20% | 阶段 0–1 |
| 企业级项目 | 30% | 阶段 2–3 |
| Web3 基础设施 | 35% | 阶段 6 + 阶段 7 部分 |
| 云原生与工程化 | 15% | 阶段 4–5、7 |

---

## 阶段 0：Go 基础速通（1 周）

**目标**：会写 Go、能读懂标准库源码、能写并发程序。

**必学**：
- 语法：变量、切片、map、结构体、接口（隐式实现）、error、defer
- 并发：**goroutine、channel、select、sync.WaitGroup、sync.Mutex、context**
- 工具：`go mod`、单元测试、`pprof`、`zap` / `zerolog`
- 网络：`net/http` 写简单接口

**小项目**：
- 命令行 Todo 工具
- 并发爬虫（爬 10 个页面）
- 简单 HTTP 接口（用户注册/查询）

**为什么不能跳过**：
很多学习者跳过基础直接进框架，结果在阶段 2 啃 Gitea 源码时连 `interface` 隐式实现、`context` 传值都不熟，回头补基础浪费更多时间。一周补基础能节省后面 2 个月。

---

## 阶段 1：工程规范（1 周）

**目标**：写出来的项目像企业代码。

**项目**：[go-backend-clean-architecture](https://github.com/bxcodec/go-clean-arch) ⭐⭐⭐⭐⭐

**学习**：
- 分层结构：`cmd/ / internal/ / pkg/ / config/ / docs/`
- 核心概念：Interface、Repository、Service、Dependency Injection、Clean Architecture
- **不要关注业务**——重点是"为什么这样分层"

**必做**：自己写一个 **Blog**
- 至少包含用户、文章、评论 3 个 domain
- 严格按 `Router → Controller → Usecase → Repository → DB` 分层
- 替换一个 Repository 实现（如从 MySQL 换内存）验证分层价值

---

## 阶段 2：企业后台（2–3 周）

**目标**：理解企业级后台系统的真实样子。

**项目**：[Gitea](https://github.com/go-gitea/gitea) ⭐⭐⭐⭐⭐

**模块学习路径**：
```
用户 → 权限 → Repository → API → Notification → Webhook
```

**核心学习点**：
- RBAC 权限模型
- JWT / Session / OAuth 多种认证方式
- Middleware 体系
- 文件上传、Cache 策略、数据库 schema 演进

**工具箱速通**（阶段 2 开头完成）：
- Gin 路由 + 中间件
- GORM 关联查询 + 事务
- Redis 基本命令 + 缓存模式
- Kafka producer / consumer

**必做**：自己写一个 **Admin System**
- 用户 / 角色 / 菜单 / 部门 完整 RBAC
- 至少 5 个核心模块
- 用 Casbin 做权限

---

## 阶段 3：Go 微服务（2 周）

**目标**：能拆微服务、懂服务治理。

**项目**：[go-zero](https://github.com/zeromicro/go-zero) ⭐⭐⭐⭐⭐

**学习路径**：
```
API → Gateway → RPC → Service → MySQL
```

**核心学习点**：
- RPC、gRPC、Protobuf
- 服务注册与发现（etcd）
- 配置中心、限流、熔断
- Middleware 链

**必做**：自己写 **微服务 Demo**
- 至少 2 个服务：User RPC + Order RPC
- 用 `goctl` 生成代码
- 服务间 gRPC 调用
- 网关聚合 + JWT 鉴权 + 限流

---

## 阶段 4：高并发 + IO（2–3 周）

**目标**：理解"为什么大文件能上传这么快"。

**项目 A**：[MinIO](https://github.com/minio/minio) ⭐⭐⭐⭐

**学习路径**：
```
上传 → Buffer → IO → Object → Storage
```

**核心学习点**：
- `io.Reader` / `io.Writer` 流式处理
- `sync.Pool` 对象复用（减少 GC）
- `context` 取消传播
- Goroutine 在 IO 密集场景的调度

**项目 B**：[Prometheus](https://github.com/prometheus/prometheus) ⭐⭐⭐⭐⭐

**学习路径**：
```
Collector → Metric → Storage
```

**核心学习点**：
- 时序数据库的写入路径（head block + WAL + compaction）
- Pull 模型 vs Push 模型
- 监控指标的"四类"：Counter / Gauge / Histogram / Summary

**必做**：自己写 **对象存储 demo**
- 哪怕只是包装 MinIO SDK
- 实现：上传、下载、断点续传、秒传
- 加 QPS / 延迟 / 错误率 三个 Prometheus 指标

---

## 阶段 5：分布式（2–3 周）

**目标**：理解分布式一致性与协调。

**项目 A**：[etcd](https://github.com/etcd-io/etcd) ⭐⭐⭐⭐⭐

**核心学习点**：
- **Raft 协议实战**：Leader Election / Log Replication / Snapshot
- **Watch 机制**：K8s 的 apiserver 强依赖
- **Lease**：分布式锁、租约
- MVCC 多版本并发控制

**项目 B**：[Kubernetes](https://github.com/kubernetes/kubernetes) ⭐⭐⭐⭐⭐

**重点看三件套**：
- **Controller**：声明式 API → reconcile 循环
- **Informer**：本地缓存 + watch，避免每次请求打 apiserver
- **WorkQueue**：事件去重与重试

**必做**：自己写 **配置中心 demo**
- 用 etcd 做存储
- 实现：配置的增删改查、Watch 订阅、版本回滚
- 至少支持 100 个客户端同时 Watch

---

## 阶段 6：Web3 基础设施（4–6 周）★ 重点

**目标**：能独立做链交互、Indexer、风险监控。

### 项目 A：go-ethereum（重点 60%）

- 仓库：https://github.com/ethereum/go-ethereum ⭐⭐⭐⭐⭐⭐

**重点阅读目录**：
```
ethclient/        # RPC 客户端（最常用）
eth/              # RPC API 实现
rpc/              # JSON-RPC 协议层
core/             # 区块链核心
core/types/       # 交易/收据/日志数据结构
core/txpool/      # 交易池
accounts/         # 账户与签名
```

**核心学习点**：
- **JSON-RPC 协议实现**：namespace 注册机制
- **`ethclient` 客户端封装**：`BlockByNumber / FilterLogs / TransactionReceipt`
- **Event/Log 过滤**：Bloom filter + topic 匹配
- **交易生命周期**：签名 → txpool → 打包 → 状态变更

### 项目 B：Chainlink（了解 30%）

- 仓库：https://github.com/smartcontractkit/chainlink ⭐⭐⭐⭐⭐

**核心学习点**：
- **Job / Pipeline / Task** 三层抽象
- **OCR（Off-Chain Reporting）**：链下聚合签名
- 多链适配（EVM / Solana / Cosmos）

### 项目 C：Cosmos SDK（选学 10%）

> 除非明确要去做应用链，否则优先级可以放后。

**必做 1**：自己写 **区块链 Indexer**
- 订阅合约 Event（ERC20 Transfer 等）并入库
- 支持断点续传、reorg 检测
- 用 Redis 做缓存、Kafka 做事件分发

**必做 2**：自己写 **Risk Engine**
- 监听大额转账、异常授权
- 规则引擎触发告警
- 与 Chainlink Price Feed 集成获取实时价格

---

## 阶段 7：大项目 + 云原生（持续 4–6 周）

**目标**：能独立交付一个生产级 Web3 后端服务。

**项目 A**：[Docker（Moby）](https://github.com/moby/moby) ⭐⭐⭐⭐⭐

**重点看**：
- Daemon → API → Container 的三层架构
- 多阶段构建 Dockerfile 最佳实践

**项目 B**：[Harbor](https://github.com/goharbor/harbor) ⭐⭐⭐⭐

**学习**：
- 企业 DevOps 后端
- 镜像扫描、复制策略、Task 异步队列

**项目 C**：K8s **Operator 模式**

**重点看**：
- Controller Runtime 框架
- 写一个简单的链上事件 Operator
- 把阶段 6 的 Indexer 部署到 K8s

---

## 最终目标：7 个简历级项目

| # | 项目 | 技术栈 | 学习阶段 | 简历亮点 |
| --- | --- | --- | --- | --- |
| 1 | Blog（Clean Architecture） | Gin + GORM + MySQL | 1 | 分层设计、依赖倒置 |
| 2 | Admin System | Gin + JWT + Redis + Casbin | 2 | 企业后台、权限模型 |
| 3 | 微服务 Demo | go-zero + gRPC + etcd | 3 | 服务拆分、RPC、治理 |
| 4 | 对象存储 demo | Go + MinIO SDK + Prometheus | 4 | 高并发、IO、监控 |
| 5 | 配置中心 demo | Go + etcd | 5 | 分布式一致性、Watch |
| 6 | 区块链 Indexer | go-ethereum + Redis + Kafka | 6 | 区块同步、事件监听 |
| 7 | DeFi Risk Engine | Go + Chainlink + PostgreSQL | 6 | 风险监控、清算流程 |
| 8 | K8s Operator | Operator SDK + Docker | 7 | 链上 + 链下交互 |

## 学习节奏建议

- **全职学习**：约 20–24 周（5–6 个月）
- **业余学习（每天 2–3 小时）**：约 9–12 个月
- **每个阶段结束都写一篇笔记**——不只是源码摘录，而是"我做了什么 + 学到什么 + 卡在哪里"

## 推荐项目分级（项目清单详见后续笔记）

> 项目按"类型"分梯队，按"学习顺序"走阶段。两个维度独立。

| 梯队 | 主题 | 笔记 |
| --- | --- | --- |
| 企业级框架 | go-zero / Kratos / Hertz | [02](./02-go-tier1-enterprise-frameworks.md) |
| 云原生基础设施 | K8s / Docker / Prometheus / etcd | [03](./03-go-tier2-cloudnative-infra.md) |
| 存储与消息队列 | MinIO / go-nsq / Kafka | [04](./04-go-tier3-storage-and-mq.md) |
| Web3 区块链 | go-ethereum / Chainlink / Cosmos SDK | [05](./05-go-tier4-web3-blockchain.md) |
| 业务系统模板 | Gitea / Grafana / Harbor / gin-vue-admin 等 | [06](./06-go-tier5-business-systems.md) |
