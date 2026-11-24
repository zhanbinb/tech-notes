# ASP.NET Core 请求管线：Middleware 洋葱模型 · 五种 Filter · 中间件 vs 过滤器

> OrderManagement 阶段 26 实战（RequestTimingMiddleware / ActionLogFilter / GlobalExceptionFilter），面试高频「中间件和过滤器怎么选」的完整答案。

## 核心要点

- **洋葱模型**：`await next()` 之后的代码在**响应阶段逆序执行**（计时中间件的 StopWatch 靠这个算总耗时）；**不调 `next()` = 短路**（403 拦截、限流、缓存命中直接返回）
- **Use / Run / Map**：Use 续行可 next、Run 终止管道、Map 按路径分支
- **中间件是 Singleton**：Scoped 依赖必须作为 `InvokeAsync(HttpContext, TScoped dep)` 参数注入（构造注入会 captive dependency）
- **Middleware vs Filter**：Middleware 管**整个 HTTP 管道**（计时/限流/CORS/认证/异常），Filter 只管 **MVC Action**（参数/日志/缓存/授权）—— **异常以 Middleware 为主（IExceptionHandler + ProblemDetails）、Filter 为辅**
- **五种 Filter 执行顺序**：Authorization → Resource → Action → Exception → Result
- 注册三方式：`[ServiceFilter(typeof(T))]`（需 DI 注册）/ `[TypeFilter(typeof(T))]`（自动激活）/ 全局 `AddControllers(o => o.Filters.Add<T>())`
- 分工口诀：**Middleware 管请求、Filter 管 MVC、业务归 Service**

## 关键示例 / 命令

```csharp
// 自定义中间件（计时）
public class RequestTimingMiddleware
{
    private readonly RequestDelegate _next;
    public async Task InvokeAsync(HttpContext context)
    {
        var sw = Stopwatch.StartNew();
        await _next(context);                     // 洋葱：后半段在此之后逆序执行
        sw.Stop();
        _logger.LogInformation("HTTP {Method} {Path} responded {StatusCode} in {Elapsed}ms",
            context.Request.Method, context.Request.Path,
            context.Response.StatusCode, sw.ElapsedMilliseconds);
    }
}
app.UseMiddleware<RequestTimingMiddleware>();     // 注册在 UseRouting 之后、UseAuthorization 之前

// Action Filter（前后织入）
public class ActionLogFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        _logger.LogInformation("before {Action}", ctx.ActionDescriptor.DisplayName);
        var result = await next();                // 执行 Action（或后续 Filter）
        _logger.LogInformation("after {Action}, elapsed {Ms}ms", ...);
    }
}

// 管道顺序（本项目）
// UseExceptionHandler → UseCors → UseRateLimiter → UseRouting → UseAuthentication → UseAuthorization → MapControllers
```

## 常见坑

1. 中间件构造注入 Scoped 服务 → captive dependency；要用 `InvokeAsync` 参数注入
2. `Use` 里忘了 `await next()` → 管道断掉，后续中间件/Endpoint 全不执行（除非故意短路）
3. Filter 里做 DB/缓存等 Action 级逻辑 → 用错层，应放 Service（或 Action Filter 只做横切）
4. 异常处理同时配了 Middleware 和 ExceptionFilter → 以 Middleware 为主，避免双重处理语义混乱
5. 401/403/404 语义混淆：401 未认证、403 无权限、404 不存在

## 相关链接

- 项目代码：`OrderManagement/src/OrderManagement.Api/{Middlewares,Filters}/`
- 项目笔记：`OrderManagement/docs/12-请求管线与数据库进阶-阶段26-27.md`

---
#dotnet #aspnet-core #middleware #filters #pipeline
