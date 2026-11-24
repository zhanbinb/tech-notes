# 分布式系统与架构设计：分布式事务 · Outbox · 容错 · SOLID · 架构模式

> OrderManagement 阶段 29~30 理论主线：2PC/TCC/Saga、Outbox 可靠发布、容错四件套、微服务拆分、四大设计模式与三大架构对比（面试表达已固化）。

## 核心要点

- **分布式事务三方案**：2PC（同步阻塞、协调者单点）/ TCC（Try-Confirm-Cancel 资源预留，侵入大）/ **Saga**（本地事务 + **补偿是幂等增量新操作而非回滚**）
- **Saga 补偿落地**：`AvailableStock = AvailableStock + 2` 增量更新（不能覆盖历史值）+ 流水表 + `UNIQUE(OrderId, Action)` 幂等表同事务 + 自动为主人工兜底
- **Outbox**：业务数据与 `OutboxMessages(Pending)` 同一 DB 事务 → BackgroundService 扫描发布改 Published；**只保证可靠发布不保证只发一次**，消费端 MessageId 幂等是配套必备
- **容错四件套**：Timeout（3s 硬超时）/ Retry（指数退避 1/2/4s + Jitter，**400 与库存不足不重试**）/ Circuit Breaker（Closed-Open-HalfOpen）/ Fallback；实现用 `AddHttpClient(...).AddStandardResilienceHandler()`
- **微服务**：按业务边界（Bounded Context）拆而非按技术层；Gateway 职责 = 路由/JWT/限流/负载均衡/协议转换，.NET 选 **YARP** 或 Ocelot；小团队优先模块化单体
- **四模式口诀**：工厂（创建）/ 策略（选择，`AddKeyedScoped<IDiscountStrategy, VipDiscount>("VIP")` 替代 if/else）/ 模板方法（流程）/ **装饰器（增强，每层同接口 + `_inner`，组合优于继承）**
- **三大架构**：三层 / Clean（依赖指向内层，DIP 是基础）/ CQRS（读写分离，**≠ Event Sourcing**）；责任链 = Middleware Pipeline；代理 vs 装饰器 = 控制访问 vs 增加功能

## 关键示例 / 命令

```csharp
// Outbox 同事务写入
await using var tx = await db.Database.BeginTransactionAsync(ct);
db.Orders.Add(order);
db.OutboxMessages.Add(new OutboxMessage { EventType = "OrderCreated", Status = "Pending", ... });
await db.SaveChangesAsync(); await tx.CommitAsync();
// BackgroundService：扫描 Pending → 发 MQ → 改 Published（失败保留重试）

// 装饰器
public class LoggingOrderService : IOrderService {
    private readonly IOrderService _inner;
    public async Task<Order> CreateAsync(...) { log; var r = await _inner.CreateAsync(...); log; return r; }
}

// 容错
builder.Services.AddHttpClient("InventoryClient", ...).AddStandardResilienceHandler();
```

## 常见坑

1. Retry 不区分错误类型 → 对 400/库存不足这类**非瞬时错误**重试造成雪上加霜
2. Outbox 只做了发布侧 → 忘记消费端幂等 = 重复消费；还缺 Publisher Confirms、并发扫描认领
3. 蓝绿发布要求 **DB 兼容**（配 Expand-Contract：加兼容字段→切代码→迁数据→删旧字段），否则回滚不了
4. 「架构匹配业务规模」—— 小团队上全套微服务/Saga 是过度设计
5. `lock` 被当成分布式方案（多实例无效）→ 库存扣减用条件原子 UPDATE 按受影响行数判断

## 相关链接

- 项目笔记：`OrderManagement/docs/09-分布式与架构-阶段29-30.md`
- Outbox Pattern：https://microservices.io/patterns/data/outbox-pattern.html

---
#dotnet #distributed #outbox #design-patterns #architecture
