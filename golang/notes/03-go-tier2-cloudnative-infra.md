# 第二梯队：云原生基础设施

> 这类项目是"Go 工程能力天花板"。不需要全部读懂，但**带着问题去看模块**收益巨大。
> 阶段 4 之后、求职面试前，挑 1–2 个深读源码。

## Kubernetes（k8s） ⭐⭐⭐⭐⭐

- 仓库：https://github.com/kubernetes/kubernetes
- Star：100k+
- 学习入口（不必全看）：
  - `cmd/kube-apiserver` —— API Server
  - `pkg/scheduler` —— 调度器
  - `pkg/controller` —— Controller 模式（Operator 思想起点）
  - `staging/src/k8s.io/client-go` —— 客户端库（实际写 Operator 用得到）

**核心学习点**：
- **声明式 API + Controller 循环**：`期望状态 → 当前状态 → reconcile`
- **Operator 模式**：把领域知识编码进 Controller
- **client-go 的 Informer/Lister 机制**：本地缓存 + watch，避免每次请求打 apiserver

## Docker（Moby） ⭐⭐⭐⭐⭐

- 仓库：https://github.com/moby/moby
- 学习入口：
  - `daemon/` —— Docker Daemon 主流程
  - `libcontainerd/` —— 容器运行时抽象
  - `container/` —— 容器生命周期管理

**核心学习点**：
- 容器化的整套抽象（image / container / network / volume）
- Daemon 与 containerd 分层的原因
- 实际写 Dockerfile 的最佳实践参考

## Prometheus ⭐⭐⭐⭐⭐

- 仓库：https://github.com/prometheus/prometheus
- 学习入口：
  - `scrape/` —— 抓取模型
  - `storage/` —— 时序存储引擎
  - `rules/` —— 告警规则引擎
  - `web/` —— PromQL 与 HTTP API

**核心学习点**：
- **时序数据库的写入路径**（head block + WAL + compaction）
- **Pull 模型**：为什么监控不用 Push（解耦 + 服务发现友好）
- **Goroutine 并发采集**：每个 scrape 一个 goroutine，通过 channel 串到内存队列

## etcd ⭐⭐⭐⭐⭐

- 仓库：https://github.com/etcd-io/etcd
- 学习入口：
  - `raft/` —— Raft 一致性协议实现
  - `mvcc/` —— 多版本并发控制（key 的 revision 历史）
  - `server/` —— API 层

**核心学习点**：
- **Raft 协议实战**：Leader Election / Log Replication / Snapshot
- **线性一致性读**：ReadIndex vs LeaseRead
- **MVCC + Watch 机制**：K8s 的 apiserver 强依赖

## 学习策略

**不要从头读到尾**，推荐按"问题驱动"：
1. 选一个具体问题，例如"K8s 怎么实现滚动更新"
2. 从 `kubectl rollout` 一路追到 `controller` 再到 `client-go`
3. 把这条链路用图画出来

**写简历可用的角度**：
- "读 K8s Scheduler 源码，理解了调度框架与插件机制"
- "看 etcd Raft 实现，写了篇 leader election 详解"
- "看 Prometheus 存储引擎，理解时序数据压缩原理"
