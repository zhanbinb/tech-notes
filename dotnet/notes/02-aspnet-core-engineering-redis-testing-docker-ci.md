# ASP.NET Core 工程化进阶：Redis 缓存 · 测试 · Docker CI · 乐观并发（Step 18~24）

> OrderManagement 项目第二阶段（2026-11-06 ~ 11-17）实战沉淀：从「八件套能跑」走向「工程化可靠」，覆盖缓存、测试、部署、CI、安全、并发六大能力，并附高级 .NET 岗位技术地图与 2026 面试准备策略。

## 核心要点

- **Redis Cache-Aside 落地**：`IDistributedCache` + 空值缓存（`__NULL__` 60s 防穿透）+ 2 分钟 TTL + 更新/删除后主动失效；缓存一致性三档：TTL 兜底 → 删除有限重试 → **Transactional Outbox**（业务数据与消息同事务提交，`BackgroundService` 扫描投递）
- **Repository 重构**：Controller → Service → Repository → DbContext，`SaveChangesAsync` 收口 Repository（修复了 Create 不落库 Bug），Service 只依赖 `IOrderRepository` → 可 Mock
- **测试体系**：Moq 单测（Setup/Callback/Verify）+ `WebApplicationFactory` 集成测试（404/201/400/401/403/200 状态码矩阵），CI 自动跑
- **Docker + CI**：多阶段 Dockerfile（先 COPY csproj 吃缓存层）、Compose `depends_on.condition: service_healthy`、GitHub Actions restore→build→test
- **乐观并发（PostgreSQL xmin）**：`uint Version` + `IsRowVersion()` 映射系统列 xmin 无需 migration，双重检查 + `DbUpdateConcurrencyException` → HTTP 409

## 关键示例 / 命令

### Cache-Aside + 空值缓存（OrderService.GetByIdAsync）

```csharp
var cached = await _cache.GetStringAsync(cacheKey);
if (cached == NullCacheValue) return null;               // 空值缓存命中
var order = await _repository.GetByIdAsync(id);
if (order is null) {
    await _cache.SetStringAsync(cacheKey, NullCacheValue,  // 防穿透
        new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60) });
    return null;
}
await _cache.SetStringAsync(cacheKey, JsonSerializer.Serialize(detail),
    new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2) });
// Update/Delete 成功后：await _cache.RemoveAsync(GetCacheKey(id));
```

### 乐观并发（xmin → 409）

```csharp
// 实体：public uint Version { get; set; }
// Fluent：modelBuilder.Entity<Order>().Property(o => o.Version).IsRowVersion();  // Npgsql 映射 xmin，无需 migration
if (order.Version != request.Version) throw new DbUpdateConcurrencyException("订单已被其他用户修改");
try { await _repository.UpdateAsync(order); }
catch (DbUpdateConcurrencyException) { throw; }          // 兜底时间窗口冲突
// Controller：catch (DbUpdateConcurrencyException ex) { return Conflict(new { message = ex.Message }); }
```

### 集成测试三件套（CustomWebApplicationFactory）

```csharp
public partial class Program { }                          // 暴露顶级语句 Program
builder.UseEnvironment("Testing");                        // 不加载 User Secrets → 用 UseSetting 注入 Jwt:*
services.RemoveAll<ApplicationDbContext>();
services.RemoveAll<IDbContextOptionsConfiguration<ApplicationDbContext>>();  // 关键！移除残留 UseNpgsql()
services.AddDbContext<ApplicationDbContext>(o => o.UseInMemoryDatabase(dbName));
services.RemoveAll<IDistributedCache>(); services.AddDistributedMemoryCache();
// 限流：IsEnvironment("Testing") ? 1000 : 5（TestServer 单 IP 会撞 429）
```

### 运维命令

```bash
dotnet test tests/OrderManagement.Tests/OrderManagement.Tests.csproj
dotnet list OrderManagement.slnx package --vulnerable --include-transitive   # 漏洞扫描
dotnet nuget why <csproj> <包名>                                              # 传递依赖链
docker compose up -d --build && curl localhost:8080/health/ready
# ⚠️ 严禁 docker compose down -v（删数据卷）；迁移前先 pg_dump
```

## 常见坑

1. **EF Core 双 Provider 冲突**（`Only a single database provider can be registered`）：必须 `RemoveAll<IDbContextOptionsConfiguration<T>>()` 才能去掉残留的 `UseNpgsql()`，只 Remove DbContext/Options 不够
2. **Testing 环境没有 User Secrets**：`JWT 配置缺失` → `builder.UseSetting("Jwt:Issuer", ...)` 注入
3. **集成测试触发 429**：TestServer 所有请求同一 IP，按环境放宽限流而非删除限流
4. **GET 返回 `version:0`、`createdAt:0001-01-01`**：是 Redis 旧缓存脏数据（旧 DTO 无 Version 字段），不是缺列
5. **InMemory Provider 没有 xmin**：单测无法验证乐观并发，需真库集成测试
6. **Pkcs 9.0.11 高危漏洞**（NU1903）是传递依赖（经 EF Core Design / SqlClient 引入）：`dotnet nuget why` 定位 + 显式引用 10.0.14 覆盖
7. **CodeQL `cs/log-forging`（CWE-117）**：修法是转义用户输入 `\r\n`（LogSanitizer），不是删日志
8. **容器内读不到 User Secrets**：必须环境变量（`Jwt__SecretKey` 双下划线映射 `:`），Compose 用 `.env` 插值

## 路线图与面试衔接

- ✅ 阶段一（Step 01~17.9）：八件套；✅ 阶段二（Step 18~24）：六大工程能力
- 🚧 当前收尾：修失败测试（Version 检查与测试数据不匹配）→ 提交 13 个未提交文件 → Pkcs 升级 → CodeQL 复扫 → Step 24 幂等性实现
- 📌 下一主线（ChatGPT 指定）：**async/await、Task 与线程池**
- 📌 高级岗位技术地图 8 大领域 + 2026 面试准备（四~六周节奏、考点三级优先级、项目故事 STAR、简历写法）见项目内 `docs/06-高级岗位与面试准备.md`

## 相关链接

- 项目完整笔记（6 个专题页导航）：`OrderManagement/docs/学习笔记与路线图.md`
- 上一篇：[01 · 基础篇八件套与四阶段路线图](01-aspnet-core-order-management-study-notes-roadmap.md)
- CodeQL：https://codeql.github.com/ ；Outbox 模式：https://microservices.io/patterns/data/outbox-pattern.html

---
#dotnet #aspnet-core #redis #testing #interview
