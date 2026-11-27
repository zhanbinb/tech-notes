# .NET

.NET / ASP.NET Core 笔记收录地。

> 在和 AI 一起学习的过程中逐步沉淀，每条知识点单独一个 Markdown 文件，放在 [`notes/`](notes/) 下。
> 重点场景：OrderManagement 订单管理项目实战（.NET 10 + EF Core 10 + PostgreSQL）+ 面试恢复训练主线。

## 笔记目录

### 项目实战与学习路线
- [01 · ASP.NET Core 订单管理项目：学习笔记与四阶段路线图](notes/01-aspnet-core-order-management-study-notes-roadmap.md)
  - 八件套全通：分层 / EF Core / DI 生命周期 / Options / Serilog / 全局异常 / JWT 认证授权 / OpenAPI
  - 四阶段路线图 + 9 个常见坑（SaveChanges 缺失、migration 比较模型 vs Snapshot、-infinity 等）
  - ChatGPT 学习主线索引：Step 01 → 18（当前进度 Step 17.9，下一步 Redis 缓存）
- [02 · 工程化进阶：Redis 缓存 · 测试 · Docker CI · 乐观并发（Step 18~24）](notes/02-aspnet-core-engineering-redis-testing-docker-ci.md)
  - Cache-Aside + 空值缓存防穿透 + 一致性三档（TTL → 重试 → Outbox）；Repository 重构修复落库 Bug
  - xUnit + Moq + WebApplicationFactory 集成测试三坑（Testing 无 User Secrets / EF 双 Provider / 限流 429）
  - Docker 多阶段 + Compose 健康检查启动顺序 + GitHub Actions CI；xmin 乐观并发 → 409
  - 附：高级 .NET 岗位 8 大领域技术地图 + 2026 面试准备策略（项目内 `docs/06-高级岗位与面试准备.md`）
- [03 · C# 异步编程与并发控制：async/await · WhenAll · 线程池 · CTS · 锁](notes/03-csharp-async-and-concurrency.md)
  - async 非多线程、WhenAll 并发/异常语义、ThreadPool Starvation、协作式取消、竞态/lock/Interlocked/SemaphoreSlim
- [04 · RabbitMQ 消息队列与消费幂等：ACK · ON CONFLICT · 事务边界](notes/04-rabbitmq-and-idempotency.md)
  - 连接池与事务边界铁律、四 Exchange、手动 ACK 时机、MessageId + 唯一索引同事务幂等（实测）
- [05 · DDD 领域驱动设计实战：聚合根 · 值对象 · EF OwnsMany · 领域事件](notes/05-ddd-domain-driven-design.md)
  - 四层依赖规则、Money record、不变性守卫、查询三原则、领域异常→HTTP 映射、NU1202 版本铁律
- [06 · 分布式系统与架构设计：分布式事务 · Outbox · 容错 · SOLID · 架构模式](notes/06-distributed-systems-patterns.md)
  - 2PC/TCC/Saga 增量补偿、Outbox 可靠发布、容错四件套、四模式口诀、三层/Clean/CQRS
- [07 · .NET 可观测性与生产诊断：三支柱 · dotnet-counters/trace · 发布策略](notes/07-dotnet-observability-diagnostics.md)
  - 四类故障特征（队列涨+CPU低=饥饿）、counters/trace 实操、蓝绿/金丝雀、Expand-Contract
- [08 · ASP.NET Core 请求管线：Middleware 洋葱模型 · 五种 Filter](notes/08-aspnet-core-pipeline-filters.md)
  - 洋葱模型与短路、Use/Run/Map、五种 Filter 顺序、中间件 vs 过滤器选型口诀
- [09 · PostgreSQL 数据库进阶：事务隔离级别 · 锁与防超卖 · 索引与 EXPLAIN](notes/09-postgresql-transactions-indexes.md)
  - 隔离级别实测、条件原子 UPDATE 防超卖、死锁 40P01、Keyset 深分页、B+Tree 聚簇对比

- [10 · C# 核心基础与 ASP.NET Core 请求机制](notes/10-csharp-fundamentals-and-web-pipeline.md)
  - 值/引用与装箱、override vs new、IEnumerable vs IQueryable、Model Binding 推断、路由约束 404、API Versioning
- [11 · Ocelot API Gateway 与 Consul 服务发现](notes/11-ocelot-gateway-consul.md)
  - 路由/JWT/限流/RoundRobin + Consul 注册发现 + **502 根因排查**（node.Name vs Service.Address）
- [12 · 高并发订单系统设计](notes/12-high-concurrency-order-design.md)
  - 下单幂等（UNIQUE 约束）、支付 Unknown 状态机、秒杀七层防线、Keyset、架构选型与标准面试回答
- [13 · ABP Framework 框架核心](notes/13-abp-framework-core.md)
  - Module 依赖排序、Auto API、UoW（高于 BeginTransaction 可脱离 ABP）、权限三件套、多租户、EventBus Outbox/Inbox、审计/BackgroundJobs

## 写作约定

- 笔记命名：`NN-<topic>.md`，`NN` 为两位数序号。
- 一条笔记对应一个具体知识点，主题尽量独立、颗粒度适中。
- 笔记主体中文；关键字、类型名、API、命令保留英文。
