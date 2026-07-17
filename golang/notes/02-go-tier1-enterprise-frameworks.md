# 第一梯队：企业级 Go 框架

> 国内 Go 后端招聘出现频率最高的三个框架，覆盖大多数中大型业务的"工程模板"。
> 选其一深耕即可，写进简历前请至少跑通官方 example + 自建 1 个 CRUD 服务。

## go-zero ⭐⭐⭐⭐⭐

- 仓库：https://github.com/zeromicro/go-zero
- Star：40k+
- 公司生态：好未来/腾讯系背景，国内一线互联网高频采用
- 技术栈：Go + gRPC + REST + Redis + MySQL + etcd + Prometheus + K8s

**核心能力**：
- 一键生成 CRUD、API Gateway、RPC 服务
- 内置服务注册与发现、熔断、限流、负载均衡、链路追踪
- 自带 `goctl` 代码生成工具，proto / api 一键产出

**适合学习**：
- 微服务完整工程化（API 网关 + 业务服务 + RPC）
- 服务治理全套（限流/熔断/降级）
- 中间件集成范式（怎么写一个不漏字段的 logx / metricx）

**上手路径**：
1. 跑通 [shorturl](https://github.com/zeromicro/zero-examples) 官方示例
2. 用 `goctl` 从 .api 文件生成一个用户管理服务
3. 接入 etcd 做服务发现、Prometheus 做指标暴露

## Kratos ⭐⭐⭐⭐⭐

- 仓库：https://github.com/go-kratos/kratos
- 公司：哔哩哔哩（B 站）开源
- 风格：DDD（领域驱动设计）+ Protobuf + Wire（依赖注入）

**核心能力**：
- DDD 分层：`api / service / biz / data` 四层，强制依赖倒置
- Wire 编译期 DI，避免运行时反射开销
- 完整的 middleware 体系（logging / metrics / tracing / recovery）

**适合学习**：
- DDD 在 Go 工程里的落地方式
- `biz` 层（领域逻辑）与 `data` 层（仓储实现）的解耦
- 怎么写"可替换"的仓储（interface 在 biz，实现在 data）

**上手路径**：
1. 跑通 [kratos-layout](https://github.com/go-kratos/kratos-layout) 模板
2. 把"用户"模块的 biz / data 分层看懂
3. 替换一个 data 层实现（比如从 MySQL 换成内存），验证分层价值

## Hertz ⭐⭐⭐⭐

- 仓库：https://github.com/cloudwego/hertz
- 公司：字节跳动 CloudWeGo
- 特点：基于自研 Netpoll 网络库，性能极致

**核心能力**：
- 高性能 HTTP 框架（QPS 比 Gin 高 30%+ 在字节内部压测下）
- 与 Kitex（字节的 gRPC 框架）天然配套
- 字节系面试高频考点

**适合学习**：
- 高性能网络框架怎么写（epoll / Netpoll）
- HTTP/1.1 解析器的实现细节
- 字节系微服务全家桶（Hertz + Kitex + Netpoll + Thrift）

**上手路径**：
1. 跑通 hertz-example，做一个简单 echo 服务
2. 对比 Gin 看路由、中间件 API 差异
3. 如果目标是字节/抖音系后端，重点看 Netpoll 调度模型

## 三选一建议

| 目标公司 / 方向 | 建议主学 | 顺带了解 |
| --- | --- | --- |
| 国内互联网主流（业务后端） | **go-zero** | Kratos |
| B 站 / 字节系 / 看重 DDD | **Kratos** | go-zero |
| 字节 / 抖音系 / 性能敏感 | **Hertz** | Kratos |
| 不知道选啥 / 写简历 | **go-zero** | Kratos |
