# 高并发订单系统设计：下单幂等 · 支付 Unknown · 秒杀七层防线 · 架构选型

> OrderManagement 阶段 35 面试系统课（对话 25~27，本批最大 12 万字符）：从下单幂等、Saga 一致性、支付超时到高并发电商订单完整设计，六道检查题全对。

## 核心要点

- **下单幂等**：`Idempotency-Key` 头 + `UNIQUE(UserId, IdempotencyKey)` 是**最终保障**，`RequestHash` 不一致返 409；Redis `SET NX EX` 只做快速拦截 —— **分布式锁 ≠ 幂等**；**接口幂等 ≠ 消息消费幂等**（后者 MessageId + 唯一约束）
- **支付可靠性**：**超时 ≠ 失败** → `PaymentStatus` 增加 `Unknown`；主动查询 + 异步回调 + **定时对账**三合一；`ux_payment_transaction` 唯一索引防重复回调；订单状态与支付状态**分开建模**；Cancelled 后收到支付成功走退款/人工
- **秒杀七层防线**：① Redis **Lua 预扣**（HEXISTS→SISMEMBER→DECR→SADD）② **Redis Stream** 解决扣库存+发消息双写 ③ **DB 原子条件 UPDATE** 终校验（`ExecuteUpdateAsync` 影响行数=0 → 库存不足）④ `InventoryReservations` 状态机补偿（Reserved/Confirmed/Released/Expired，条件 UPDATE 影响行数=1 才恢复 Redis）⑤ 库存分桶 + **`{10001}` Hash Tag** ⑥ 缓存策略（空值/布隆、互斥锁、TTL 随机化）⑦ 韧性四件套
- **缓存与 SQL**：Cache Aside 先更 DB 后删缓存；Keyset 分页 + 索引 `(UserId, CreatedAt DESC, Id DESC)`；慢 SQL 三板斧 `EXPLAIN (ANALYZE, BUFFERS)` / `pg_stat_statements` / `pg_stat_activity`
- **架构选型**：6 人团队 → **模块化单体**（业务模块隔离 + 公开接口/领域事件交互）；微服务按 **Bounded Context** 拆且**独占数据**（共享库表 = 分布式单体）；CQRS 最简只分 Handler **不必双库**；Domain Event vs Integration Event + Outbox
- **韧性**：Timeout/Retry（退避+Jitter，**400/401/403 不重试**）/CircuitBreaker（Closed-Open-HalfOpen）/Fallback/RateLimiting → `AddStandardResilienceHandler()`

## 关键示例 / 命令

```sql
-- 幂等最终保障
CONSTRAINT UQ_OrderRequests_User_Key UNIQUE (UserId, IdempotencyKey)
-- 支付回调幂等（按影响行数）
UPDATE "Payments" SET "Status"='Succeeded' WHERE "PaymentNo"=@no AND "Status" IN ('Pending','Processing');
```

```csharp
// DB 原子扣库存
await _db.Products.Where(p => p.Id == id && p.Stock >= q)
    .ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock - q), ct);
// 补偿幂等：UPDATE InventoryReservations SET Status='Released' WHERE @id AND Status='Reserved'（行数=1 才恢复 Redis）
// 韧性
builder.Services.AddHttpClient<IInventoryService, InventoryService>(...).AddStandardResilienceHandler();
```

```sql
-- Keyset 分页
SELECT * FROM "Orders" WHERE "CreatedAt" < @last OR ( = @last AND "Id" < @lastId)
ORDER BY "CreatedAt" DESC, "Id" DESC LIMIT 20;
```

## 常见坑

1. 把 Redis 预扣当最终正确性 —— **Redis 管入口流量、数据库管最终正确性**
2. 超时直接标失败 —— 必须 `Unknown` + 对账归位
3. 重试前不幂等 —— **重试必须先幂等**（唯一约束是底线）
4. 多实例用 `lock` 防超卖 —— 进程内锁无效，要条件 UPDATE
5. 事务里包外部 HTTP —— 出事务，短事务只包 DB
6. `IN` 里参数不加括号的 OR Keyset 写法漏 `Id` tie-breaker → 分页抖动

## 面试标准回答（背诵版）

- **防超卖**：入口 Redis Lua 预扣拦截 → DB 条件原子 UPDATE 按影响行数兜底；同库多写本地事务（扣库存+建订单+Outbox 同事务），跨服务 Saga 补偿
- **防重复下单**：Idempotency-Key + DB 唯一约束最终保障，Redis SETNX 快速拦截，RequestHash 不一致 409
- **支付一致性**：Unknown 状态 + 查询/回调/对账三合一 + 唯一索引防重回调；订单更新失败靠 Saga/Outbox + 对账兜底

## 相关链接

- 项目笔记：`OrderManagement/docs/16-高并发订单系统设计.md`
- 配套：[04 · RabbitMQ 与幂等](04-rabbitmq-and-idempotency.md)、[06 · 分布式系统与架构](06-distributed-systems-patterns.md)

---
#dotnet #high-concurrency #idempotency #payment #interview
