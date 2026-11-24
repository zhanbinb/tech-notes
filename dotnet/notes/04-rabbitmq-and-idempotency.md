# RabbitMQ 消息队列与消费幂等：ACK · ON CONFLICT · 事务边界

> OrderManagement 阶段 27~28 实战：连接池与事务边界 → RabbitMQ 选型/部署/Producer/Consumer → `ProcessedMessages` 幂等去重（已实测通过）。

## 核心要点

- **连接池**：DbContext 生命周期 ≠ 连接占用时间（查询结束即归还）；耗尽五因 = 泄漏/长事务/慢 SQL/事务内 HTTP/超池并发；Npgsql 键 `Maximum Pool Size`、`Timeout`
- **事务边界铁律**：外部 HTTP 调用不进 DB 事务 —— 查询(AsNoTracking) → 外部调用 → 短事务只包 DB 写
- **RabbitMQ vs Kafka**：业务任务分发（智能路由、即发即消）vs 事件流（Offset 回放、高吞吐）
- **五概念**：Producer → Exchange --(Binding)--> Queue → Consumer；四种 Exchange：Direct（精确）/ Topic（`*`/`#` 通配）/ Fanout（广播）/ Headers
- **手动 ACK + At-least-once**：`autoAck:false`，**业务事务 Commit 成功后才 Ack**；失败 `Nack(requeue:false)`（无 DLX 即丢消息）；`requeue:true` 有毒消息死循环风险
- **消费幂等三要素**：唯一业务标识（MessageId）+ DB 唯一约束 + 事务原子性；`ON CONFLICT DO NOTHING` 按**受影响行数**判重，去重记录与业务操作同事务提交

## 关键示例 / 命令

```csharp
// Consumer 幂等核心（BackgroundService 每消息建 Scope）
await using var scope = _scopeFactory.CreateAsyncScope();   // Singleton 不能直接注入 Scoped DbContext
var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
await using var tx = await db.Database.BeginTransactionAsync(ct);
var inserted = await db.Database.ExecuteSqlInterpolatedAsync($"""
    INSERT INTO "ProcessedMessages" ("MessageId", "ProcessedAt")
    VALUES ({message.MessageId}, {DateTime.UtcNow})
    ON CONFLICT ("MessageId") DO NOTHING
    """, ct);
if (inserted == 0) { /* 重复消息：Commit + Ack + return */ }
// 首次：执行业务（同事务）→ Commit → BasicAckAsync   // 先 Commit 后 Ack
```

```bash
docker compose up -d rabbitmq          # rabbitmq:4-management，5672/15672
POST /api/Message/publish              # 固定 TestMessageId 发两次 → 第二次日志 Duplicate message detected
dotnet ef migrations add AddProcessedMessages   # MessageId 唯一索引
```

## 常见坑

1. **compose 数据卷**必须在最外层 `volumes:` 声明，否则 `refers to undefined volume`
2. **同名队列改参数** → `PRECONDITION_FAILED`，删队列重建
3. **测试环境没有 RabbitMQ 配置**（只在 appsettings.Development.json）→ consumer 连接失败拖垮 Host → `TestServer disposed`（本项目 8 个测试失败的根因）
4. Producer 入门版每次新建连接 → 生产要复用连接 + Publisher Confirms
5. 去重与业务**不同事务** = 「记了去重但业务没做」或反之
6. HTTP 幂等同理：`RequestId` + `ProcessedRequests` 唯一索引 + 同事务「记 RequestId → 扣库存 → 存结果」

## 相关链接

- 项目代码：`OrderManagement/src/OrderManagement.Api/Messaging/`、`Entities/ProcessedMessage.cs`
- 项目笔记：`OrderManagement/docs/08-消息队列与幂等-阶段28.md`

---
#dotnet #rabbitmq #idempotency #background-service #messaging
