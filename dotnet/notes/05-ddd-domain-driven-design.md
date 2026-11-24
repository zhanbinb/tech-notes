# DDD 领域驱动设计实战：聚合根 · 值对象 · EF OwnsMany · 领域事件

> OrderManagement 阶段 30 实战：渐进拆出 Domain/Application/Infrastructure 三类库，跑通订单四条链路，落地领域异常映射与 6 个毫秒级领域单测。

## 核心要点

- **依赖规则**：Api → Application → **Domain** ← Infrastructure；Domain **零外部依赖**（不引用 EF Core）→ 换库只动 Infrastructure，且最适合单元测试
- **值对象**：`public record Money(decimal Amount, string Currency)` —— record 值相等、不可变、方法返回新对象；EF 用 `OwnsOne` 展开成 `UnitPrice`/`Currency` 两列
- **聚合根不变性**：私有 set + 领域方法守卫（`EnsurePending()`）+ `_items` 私有集合只读暴露（`IReadOnlyCollection`）+ 子实体 `internal` 构造
- **聚合 = 事务边界**：一次 `SaveChangesAsync()` 默认事务；跨聚合用领域事件 + Saga + Outbox，禁止大事务包 HTTP/MQ
- **查询策略三原则**：完整聚合操作 `Include` / 只读展示 `Select` 投影下推 / 纯字段更新 `ExecuteUpdateAsync`（绕过 ChangeTracker 慎用）；未 Include 的子集合不会被 SaveChanges 误删
- **领域异常 → HTTP**：`BusinessException→409`、`KeyNotFound→404`、`ArgumentException→400`、其余 500（`IExceptionHandler` switch 映射）
- **领域事件 vs 集成事件**：进程内分发会丢消息，可靠投递必须 Outbox；顺序 SaveChanges → Dispatch → ClearDomainEvents

## 关键示例 / 命令

```csharp
// EF Core 映射（Infrastructure）
builder.Ignore(x => x.TotalAmount);                      // 计算属性不落库
builder.OwnsMany(x => x.Items, item => {                 // 明细是聚合一部分
    item.ToTable("OrderItems");
    item.WithOwner().HasForeignKey("OrderId");           // 级联删除
    item.OwnsOne(x => x.UnitPrice, m => {                // Money 展开两列
        m.Property(x => x.Amount).HasColumnName("UnitPrice").HasPrecision(18, 2);
        m.Property(x => x.Currency).HasColumnName("Currency").HasMaxLength(3);
    });
});
```

```bash
dotnet new classlib -f net10.0 && dotnet sln add ...    # 建类库
dotnet ef migrations add CreateDddOrderTables \
  --project src/OrderManagement.Infrastructure \
  --startup-project src/OrderManagement.Api \
  --context OrderManagementDbContext --output-dir Persistence/Migrations
# 先人工检查 Up()（Money 展开/FK 级联/索引）再 database update；独立库 OrderManagementDddDb 避免与旧表冲突
```

## 常见坑

1. `private Order(){}` 与 `public Order(){}` 并存 → **CS0111**；EF 物化要 public 无参构造
2. **包版本铁律**：EF Core Provider/Tools 与 TFM 主版本一致 —— Npgsql 11.0.0 要求 net11.0 → **NU1202**
3. `Unable to resolve service for type IOrderRepository while activating OrderApplicationService` → 组合根漏注册（`AddScoped<IOrderRepository, OrderRepository>` + ApplicationService）
4. `Assert.Throws` 要求**精确类型**：领域抛 `BusinessException` 而测试写 `InvalidOperationException` 会失败 → 用 `Assert.ThrowsAny<>` 或改对类型
5. 聚合太大（1000 明细改一个要全加载）是**聚合设计问题**，应按不变性边界拆聚合，不是跨聚合查一半
6. 迁移命令多项目时必须 `--startup-project` 指向含连接串的 Api 项目

## 相关链接

- 项目代码：`OrderManagement/src/OrderManagement.{Domain,Application,Infrastructure}/`
- 项目笔记：`OrderManagement/docs/10-DDD实战-阶段30.md`
- 配套：[02 · 工程化进阶](02-aspnet-core-engineering-redis-testing-docker-ci.md)

---
#dotnet #ddd #ef-core #aggregate #clean-architecture
