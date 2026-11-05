# ASP.NET Core 订单管理项目：学习笔记与四阶段路线图

> 基于 OrderManagement 实战项目（.NET 10 + PostgreSQL + EF Core 10，2026-11-02 ~ 11-05）与 5 个 ChatGPT 学习对话（Step 01→18 主线）整理的完整学习笔记与路线图。

## 核心要点

- 项目八件套已全部走通：**分层架构 + EF Core + DI 生命周期 + Options 配置 + Serilog 日志 + 全局异常 + JWT 认证授权 + OpenAPI 文档**
- 学习主线进度：**Step 17.9（策略授权）已完成，下一步 Step 18 Redis 缓存**
- 最重要的一个 Bug：`OrderService.CreateAsync` 只有 `Add()` 没有 `SaveChangesAsync()` —— 接口返回 201 但数据不落库
- Migration 的本质：比较的是**当前模型 vs ModelSnapshot，不是数据库**；Code First 与 Database First 不要混用

## 关键示例 / 命令

### 项目与运行

```bash
dotnet new sln -n OrderManagement
dotnet new webapi -n OrderManagement.Api -o src/OrderManagement.Api --framework net10.0 --use-controllers
dotnet run --project src/OrderManagement.Api

# EF Core 迁移
dotnet ef migrations add <名称> --project src/OrderManagement.Api
dotnet ef database update --project src/OrderManagement.Api
dotnet ef migrations script --idempotent   # 团队多环境发布（DEV → UAT → PRD）

# 敏感配置（JWT）用 user-secrets，不入 Git
dotnet user-secrets set "Jwt:SecretKey" "<value>" --project src/OrderManagement.Api
```

### DI 三种生命周期（实测结论）

| 生命周期 | 同请求两次解析 | 跨请求 | 用途 |
| --- | --- | --- | --- |
| Transient | 不同实例 | 不同实例 | 无状态轻量服务 |
| Scoped | 同一实例 | 不同实例 | `DbContext`（`AddDbContext` 默认 Scoped）、每请求业务服务 |
| Singleton | 同一实例 | 同一实例 | 缓存、`IOptionsMonitor` |

- 严格校验：`UseDefaultServiceProvider(o => { o.ValidateScopes = true; o.ValidateOnBuild = true; })` 把「Scoped 注入 Singleton」提前到启动期报错
- 「Transient 是每次**解析**创建实例，而非每次方法调用」；同 ServiceType 多次注册默认返回最后一个
- Captive Dependency：DbContext 非线程安全，不能进 Singleton

### Options Pattern 三接口（实验：配置 50 → 改 100 不重启）

| 接口 | 生命周期 | 结果 | 说明 |
| --- | --- | --- | --- |
| `IOptions<T>` | Singleton | 恒 50 | 启动缓存，不热更 |
| `IOptionsSnapshot<T>` | Scoped | 100 | 每请求快照，**不可注入 Singleton** |
| `IOptionsMonitor<T>` | Singleton | 100 | `CurrentValue` + `OnChange()`（返回 `IDisposable`） |

```csharp
builder.Services.Configure<OrderSettings>(builder.Configuration.GetSection("OrderSettings"));
builder.Services.AddOptions<OrderSettings>()
    .Bind(builder.Configuration.GetSection("OrderSettings"))
    .ValidateDataAnnotations().ValidateOnStart();
```

- 内部机制：`options.Value` 触发创建 → `IOptionsFactory<T>`（Configure/PostConfigure/Validate）→ `IOptionsMonitorCache<T>`
- Named Options：`Configure<T>("Alipay", section)` + `_options.Get("Alipay")`（`IOptions` 不支持）
- 热更新陷阱：构造函数把 `CurrentValue` 存字段后不再更新，须在调用时读；配置源需 `reloadOnChange`
- 环境变量映射：`OrderSettings__MaxItemsPerOrder`（双下划线 = `:`）

### EF Core 查询与分页范本

```csharp
var orders = await _context.Orders
    .AsNoTracking()                                  // 只读查询不追踪
    .OrderByDescending(x => x.CreatedAt)             // 稳定排序
    .ThenByDescending(x => x.Id)
    .Skip((pageIndex - 1) * pageSize).Take(pageSize)
    .Select(x => new OrderListItemDto { ... })       // 投影，避免 SELECT *
    .ToListAsync();

_logger.LogInformation("SQL: {Sql}", query.ToQueryString());  // 打印实际 SQL
```

### JWT 认证授权要点

- 中间件顺序：`UseExceptionHandler → UseAuthentication → UseAuthorization → MapControllers`
- `TokenValidationParameters`：校验 Issuer/Audience/Lifetime/签名，`ClockSkew = 30s`，`RoleClaimType = ClaimTypes.Role`
- 401 = 未认证；403 = 已认证但无权限；`Roles="A,B"` 是 OR，多个 `[Authorize]` 是 AND
- `Configure<JwtSettings>()` 注册的是 `IOptions<JwtSettings>` —— 注入时要 `.Value`（否则 DI 报 `Unable to resolve service for type JwtSettings`）
- Policy 授权必须显式 `AddAuthorization(o => o.AddPolicy(...))`；Token 里要有对应 Claim 否则 403

### 全局异常 + Serilog

```csharp
builder.Services.AddProblemDetails();                       // UseExceptionHandler 的前置依赖
builder.Services.AddExceptionHandler<GlobalExceptionHandler>(); // IExceptionHandler：LogError + ProblemDetails + 500 JSON
builder.Host.UseSerilog((ctx, c) => c.WriteTo.File("logs/order-.log",
    rollingInterval: RollingInterval.Day, retainedFileCountLimit: 30,
    fileSizeLimitBytes: 10 * 1024 * 1024));                 // 结构化占位符 {OrderNo} 而非字符串插值
```

## 常见坑

1. **`Add()` 不落库**：EF Core 必须调 `SaveChangesAsync()` 才写库（本项目 Create 接口实际失效）
2. **Migration 不生成 Up/Down**：scaffold `--force` + 手改 DB 导致 Entity/Snapshot/DB 三者不一致；migration 比较的是模型 vs ModelSnapshot
3. **改属性初始化表达式没有 migration**：`string.Empty` → `null!` 这类不产生 DB 模型差异（要落库需 `.HasDefaultValue("")`）
4. **`CreatedAt = -infinity`**：Npgsql 把 `DateTime.MinValue` 映射为 `-infinity`
5. **`UseExceptionHandler()` 启动报错**：需配套 `AddProblemDetails()`
6. **日志不是 log4net**：是 `Microsoft.Extensions.Logging`，文件滚动/保留由 Serilog 负责
7. **`database update` 中的 `Failed executing DbCommand`**：首次建 `__EFMigrationsHistory` 表的正常流程，看到 `Done.` 即成功
8. **缓存放 EF 实体**：用 `AsNoTracking()` + `FirstOrDefaultAsync` 替代 `FindAsync`，避免跟踪实体进缓存
9. `dotnet-counters` command not found → `~/.dotnet/tools` 未进 PATH

## 路线图（四阶段）

- ✅ **阶段一（已完成）**：八件套全通，对应主线 Step 01~17.9（脚手架 → EF 迁移 → CRUD 分页 → DI 实验 → Options → Serilog/异常 → JWT 三层授权）
- 🚧 **阶段二（1~2 周）**：修 Create 落库 Bug → **Step 18 缓存主线**（18.1 IMemoryCache → 18.2 Docker Redis → 18.3 IDistributedCache → 18.4 Cache-Aside → 18.5 一致性 → 18.6 穿透/击穿/雪崩）→ DataAnnotations 校验 → Controller 零 EF → xUnit 集成测试 → 软删除 QueryFilter
- 📈 **阶段三（1 个月）**：订单状态机（409 冲突）、Repository/MediatR、乐观并发 RowVersion、Docker/CI/HealthChecks、Refresh Token
- 🎯 **阶段四（2~3 月）**：缓存/性能（Keyset 分页、EXPLAIN ANALYZE）、单测覆盖、gRPC/消息队列/OpenTelemetry、前端闭环、DDD/Clean Architecture

## ChatGPT 学习对话索引

| 链接 | 标题 | 覆盖 |
| --- | --- | --- |
| [6aec39ad…](https://chatgpt.com/share/6aec39ad-f65c-83ee-8956-0645d5a52cb5) | 完成 ASP.NET Core 项目 | Step 01~04（环境/建项/DI/Options） |
| [6aec3a91…](https://chatgpt.com/share/6aec3a91-1434-83e8-a633-916a79d37169) | 分支 · 完成 ASP.NET Core 项目 | Options 进阶 + 会话交接提示词 |
| [6aec3a9f…](https://chatgpt.com/share/6aec3a9f-3bcc-83e8-bc43-d82f488f92af) | Options 综合实验 | Options → EF Core → 事务 → 查询优化 → JWT（112 条） |
| [6aec3aae…](https://chatgpt.com/share/6aec3aae-003c-83ee-a1ea-e88c9858c0eb) | Options 综合实验 (1) | Step 17.4~17.9 JWT 授权 |
| [6aec3abb…](https://chatgpt.com/share/6aec3abb-f528-83e8-9587-3860e2e7266b) | Options 综合实验 (2) | Step 18 缓存开篇 |

> 完整版笔记（含 Mermaid 路线图、逐模块详解、速查表）：`OrderManagement/docs/学习笔记与路线图.md`

---
#dotnet #aspnet-core #ef-core #learning-roadmap #jwt
