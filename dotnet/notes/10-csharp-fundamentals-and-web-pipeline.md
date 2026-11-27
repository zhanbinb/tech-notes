# C# 核心基础与 ASP.NET Core 请求机制：值/引用 · LINQ · Model Binding · 路由约束

> OrderManagement 阶段 33 补漏（对话 22/24/25）：高级 .NET 面试的 C# 五节复习 + Web 核心机制七节，全部带检查题纠错。

## 核心要点

- **值/引用与装箱**：值类型复制数据、引用类型复制引用；`struct` 属性是**副本**（`user.Point.X=99` 丢修改）；装箱产生堆分配，`List<int>` 免装箱而 `ArrayList` 每次装箱
- **OOP 辨析**：abstract class（字段/构造、单继承）vs interface（能力契约、多实现）；**`override` 参与虚分发而 `new` 只隐藏** —— `A obj = new C()` 时 `new` 调 A 的实现
- **委托**：`Action`（无返回）/ `Func`（有返回）/ `Predicate<bool>`；`event` 只能 +=/-=；**C# event ≠ 领域事件**（后者跨进程靠 Outbox+MQ）
- **IEnumerable vs IQueryable**：后者是**表达式树 + 查询提供程序**，`Where` 只构建表达式、`ToListAsync()` 才转 SQL；`AsEnumerable()` 后再 Where = 全表拉内存（EF 头号陷阱）
- **IDisposable/GC**：DI 管的 DbContext 不手动 Dispose；Gen 0/1/2、LOH ≥85KB；观测 dotnet-counters
- **Model Binding 推断**（`[ApiController]`）：参数名匹配路由→Route、简单类型→Query、复杂类型→Body、`IFormFile`→Form、DI 类型→`[FromServices]`；无 `[ApiController]` 时复杂类型不读 JSON Body；一个 Action 只能一个 `[FromBody]`
- **路由约束**：`{id:int:min(1)}`、`{id?}`、`{*filePath}`；**约束不匹配 → 404**（不是 400），验证失败 → 400
- **API Versioning**（`Asp.Versioning.Mvc`）：URL/Query/Header 三种传法；**破坏性变更才升版**；OpenAPI 是规范、Swagger UI 是展示
- **请求生命周期**：Kestrel → Middleware 洋葱 → Routing → AuthN → AuthZ → Model Binding → Validation → Action → Result；`UseAuthentication` 先于 `UseAuthorization`

## 关键示例 / 命令

```csharp
// 绑定推断与约束
[HttpGet("{id:int:min(1)}")] public Task<IActionResult> Get([FromRoute] long id, [FromQuery] int page);
[HttpGet("files/{*filePath}")]                       // catch-all

// API 版本
builder.Services.AddApiVersioning(o => {
    o.DefaultApiVersion = new ApiVersion(1, 0);
    o.AssumeDefaultVersionWhenUnspecified = true;
    o.ReportApiVersions = true;
}).AddMvc();                                          // [ApiVersion(1.0)] [Route("api/v{version:apiVersion}/orders")]

// IQueryable 陷阱
await _db.Orders.Where(x => x.Status == s).ToListAsync();   // ✅ SQL 下推
await _db.Orders.AsEnumerable().Where(x => ...);            // ❌ 全表进内存
```

## 常见坑

1. `user.Point.X = 99` 改的是 struct 副本，属性没生效
2. `A obj = new C()` 用 `new` 隐藏时调 A 方法（面试选择题高频）
3. 复杂类型没自动读 Body → 检查是否丢了 `[ApiController]`
4. 路由约束不匹配 404 被当成「接口不存在」——其实是参数格式不符
5. EF 查询 `AsEnumerable()` 提前终结 → N+1/全表加载
6. 手动 Dispose DI 管理的 DbContext → ObjectDisposedException

## 相关链接

- 项目实验：`OrderManagement/src/ConsoleApp1/Program.cs`（值/引用）
- 项目笔记：`OrderManagement/docs/14-CSharp核心基础与Web机制-阶段33.md`

---
#dotnet #csharp #aspnet-core #model-binding #interview
