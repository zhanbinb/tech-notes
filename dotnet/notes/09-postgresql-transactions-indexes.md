# PostgreSQL 数据库进阶：事务隔离级别 · 锁与防超卖 · 索引与 EXPLAIN

> OrderManagement 阶段 27 实战（PG 隔离级别实测、EF 事务、防超卖三方案、死锁处理、EXPLAIN 实测与 Keyset 分页），数据库面试高频题集中营。

## 核心要点

- **隔离级别（PG 实测）**：默认 **Read Committed**（每条 SQL 新快照，别的事务提交后立刻可见）；**Repeatable Read** 事务内快照一致（实测两次读 1000，PG 实现里也防幻读）；Serializable 需**应用层重试**
- **EF 事务**：单次 `SaveChangesAsync()` 自带隐式事务；多步骤用 `BeginTransactionAsync/Commit/Rollback`；**事务内禁止 HTTP 调用**（连接被占死）
- **防超卖三方案**：① **条件原子 UPDATE（首选）** `UPDATE ... SET stock=stock-@q WHERE id=@p AND stock>=@q` 按**受影响行数**判断 ② `SELECT ... FOR UPDATE` 悲观锁 ③ version 乐观锁；⚠️ `lock` 只在单进程有效，**多实例无效**
- **死锁**：统一加锁顺序；捕获 `SQLSTATE 40P01` 做重试
- **索引**：EXPLAIN 看 `Seq Scan`（缺索引）/ `Index Scan` / `Bitmap Scan`；失效场景 = 函数包列（`LOWER(col)` → 表达式索引）、前置通配 `LIKE '%x'`、隐式转换
- **深分页**：`OFFSET 100000` 越翻越慢 → **Keyset 游标** `WHERE ("CreatedAt","Id") < (@last,@lastId) ORDER BY ... LIMIT 20`
- **覆盖索引**（PG `INCLUDE` 免回表）与**部分索引**（`WHERE Status = 1` 只索引热点）
- **B+Tree**：叶子链表支持有序范围扫描；**InnoDB 聚簇索引叶子存行**（二级索引回表），**PG 无聚簇**（heap 存行，索引存 TID）

## 关键示例 / 命令

```csharp
// EF 显式事务
await using var tx = await _context.Database.BeginTransactionAsync(ct);
try { /* 多次 SaveChanges */ await tx.CommitAsync(ct); }
catch { await tx.RollbackAsync(ct); throw; }

// 原子扣库存（0 行 = 库存不足）
var affected = await _context.Products
    .Where(p => p.Id == productId && p.Stock >= quantity)
    .ExecuteUpdateAsync(s => s.SetProperty(p => p.Stock, p => p.Stock - quantity), ct);

// 索引
builder.HasIndex(x => x.CreatedAt).IsDescending(true);   // → CREATE INDEX ... ("CreatedAt" DESC)
```

```sql
EXPLAIN ANALYZE SELECT ...;                              -- 实测：Seq Scan + Sort → 建索引
CREATE INDEX idx_orders_created_at ON "Orders"("CreatedAt" DESC);
-- Keyset 分页
SELECT * FROM "Orders" WHERE ("CreatedAt","Id") < (@last,@lastId)
ORDER BY "CreatedAt" DESC, "Id" DESC LIMIT 20;
```

## 常见坑

1. 把「一次 SaveChanges 多实体」当多事务 —— 它本来就是一个隐式事务；跨多次 SaveChanges 才需要显式开事务
2. 事务里调支付/HTTP → 连接长时间占用 + 外部失败回滚不了外部操作 → 外部 I/O 出事务（查→调→短事务）
3. 多实例用 `lock`/内存标志防重复下单 → 必须 DB 层（唯一约束/条件 UPDATE/幂等表）
4. `OFFSET` 深分页在百万级数据上是性能杀手 → Keyset
5. 索引建了没生效 → EXPLAIN 验证，检查是否函数包列/类型不匹配

## 相关链接

- 项目笔记：`OrderManagement/docs/12-请求管线与数据库进阶-阶段26-27.md`
- 配套：[04 · RabbitMQ 与幂等](04-rabbitmq-and-idempotency.md)（事务边界同一主题）

---
#dotnet #postgresql #transactions #indexes #interview
