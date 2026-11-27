# ABP Framework 框架核心：Module · ApplicationService · UoW · 权限 · 多租户 · EventBus

> OrderManagement 阶段 36（对话 27~30 归拢）：ABP 全套主线 —— CLI 排错到 Auto API/Settings 收尾，产出 `abp-learning/OrderManagement.Abp`（12 项目编译通过）。

## 核心要点

- **分层**：HttpApi.Host（运行）/ HttpApi（HTTP 适配）/ Application（用例+DTO）/ Domain.Shared / Domain / EF；构建在 ASP.NET Core 之上，开箱即给 ApplicationService/Repository/UoW/权限/多租户/EventBus/审计
- **CLI 排错**：官方推荐 **`Volo.Abp.Studio.Cli`**（3.x 新版；`Volo.Abp.Cli` 10.x 是 legacy —— 版本号大 ≠ 新）；`DotnetToolSettings.xml` 缺失 → 清 NuGet 缓存；**CS0146 循环基类** = `AbpPageModel : AbpPageModel` 同名遮蔽 → 全限定名
- **Module**：`AbpModule` + `[DependsOn]` 拓扑排序加载；`ConfigureServices`（DI）/ `OnApplicationInitialization`（中间件）
- **ApplicationService**：**Auto API Controllers 按约定生成**（`GetAsync` → `GET /api/app/order/{id}`，`ConventionalControllers.Create(assembly)`）；自带 ObjectMapper/CurrentUser/CurrentTenant/L/Logger；**必须返回 DTO**；`[RemoteService(IsEnabled=false)]` 关闭暴露
- **Repository**：通用 `IRepository<TEntity,TKey>`（`GetQueryableAsync` 不执行 SQL，配 `AsyncExecuter` 才跑）；自定义仓储继承 `EfCoreRepository<TDbContext,TEntity,TKey>`；**只为聚合根建仓储**（OrderItem 不建）
- **UnitOfWork ⭐**：比 `BeginTransaction` 高一层（事务+DbContext+SaveChanges）；AppService 方法自动 UoW（GET 默认无事务、写默认有）；`SaveChangesAsync()` vs `CompleteAsync()`；**EF DbContext 本身就是 UoW，可脱离 ABP 用于传统 DDD**；UoW ≠ 分布式事务，外部 HTTP 不进长事务
- **权限**：常量树 + `PermissionDefinitionProvider.Define`（AddGroup/AddPermission/AddChild）+ `[Authorize(常量)]`；Role vs Permission vs Permission Grant
- **多租户**：共享表+TenantId / 独立 Schema / 独立库；`IMultiTenant` 自动过滤；`_currentTenant.Change()` 切换**≠授权**
- **EventBus**：`ILocalEventBus` vs `IDistributedEventBus`（未配 MQ 默认 Local 不跨服务器！）；`PublishAsync` 两条路径：直发 MQ 或 **Outbox 同事务落库 → 后台 Dispatcher**；都不保证恰好一次 → **Inbox + 幂等**
- **审计/软删除**：`FullAuditedAggregateRoot<Guid>` 全字段；`ISoftDelete` 查询自动过滤，`IDataFilter.Disable()` 临时关闭
- **Background Jobs**：`AsyncBackgroundJob<T>` + `IBackgroundJobManager.EnqueueAsync(delay)`；**默认不持久化** → 关键任务 Hangfire/Quartz
- **Settings vs Options**：Settings = 动态业务配置（Default/Global/Tenant/User 四级范围）；Options = 技术配置（启动绑定）

## 关键示例 / 命令

```bash
dotnet new globaljson --sdk-version 10.0.403
dotnet tool install -g Volo.Abp.Studio.Cli --version 3.1.6 --no-cache
abp new OrderManagement.Abp --template app && dotnet build OrderManagement.Abp.slnx
```

```csharp
// 自动 UoW 手动版
using var uow = _unitOfWorkManager.Begin(requiresNew: true, isTransactional: true);
await _orderRepository.InsertAsync(order);
await uow.CompleteAsync();                       // 不调用不提交

// Outbox 三步
public class XxxDb : AbpDbContext<XxxDb>, IHasEventOutbox { protected override void OnModelCreating(ModelBuilder b) { b.ConfigureEventOutbox(); } }
Configure<AbpDistributedEventBusOptions>(o => o.Outboxes.Configure(c => c.UseDbContext<XxxDb>()));

// 权限
group.AddPermission(Orders.Default).AddChild(Orders.Create, "Create");
[Authorize(OrderManagementPermissions.Orders.Create)]     // 无权限 403
```

## 常见坑

1. `abp new` 日志卡住 → 假死，文件可能已生成（在运行目录根下）
2. ApplicationService 直接返回 Entity → 破坏 DTO 边界（暴露敏感字段 + 耦合）
3. 给 `OrderItem` 建 Repository → 违反 DDD 聚合边界
4. `IDistributedEventBus` 发完就以为可靠 → 没配 Outbox 就会丢，没 Inbox 就会重
5. BackgroundJob 当持久化任务用 → 默认进程内，重启即丢
6. 把 ABP Settings 和 Options 混淆 → 动态业务配置 vs 启动静态技术配置

## 相关链接

- 项目笔记：`OrderManagement/docs/17-ABP框架学习.md`
- ABP 文档：https://docs.abp.io/

---
#dotnet #abp #ddd #unit-of-work #multi-tenancy
