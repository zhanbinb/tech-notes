# C# 异步编程与并发控制：async/await · WhenAll · 线程池 · CTS · 锁

> OrderManagement 阶段 25 实战（AsyncDemoController 多个实验接口 + 5 道面试题），覆盖 .NET 高级面试第一优先级主题。

## 核心要点

- **async/await 不是多线程**：编译为状态机，`Task.Delay`/异步 I/O 不占线程；ASP.NET Core 无 SynchronizationContext，恢复处线程 ID 相同是正常的
- **连续 await 串行，WhenAll 并发**：`WhenAll` 不创建线程、一个失败其余继续（全部结束后 await 才抛，`Exception.Flatten()` 取全部）；`WhenAny` 只返回第一个完成者且不取消其余（超时控制要配 CTS）
- **线程模型**：`Thread`（自建 OS 线程，不受池管理）/ ThreadPool（`QueueUserWorkItem` 不返回 Task）/ `Task.Run`（提交工作项非创建线程）；.NET 无 goroutine 等价物
- **ThreadPool Starvation**：`.Result`/`.Wait()`/同步 I/O 阻塞工作线程 → 队列涨而 CPU 低 → 吞吐骤降
- **CancellationToken 是协作式取消**：任务必须检查 token 才响应；MVC 的 action token 自动绑定 `RequestAborted`；`CreateLinkedTokenSource` 组合客户端断开 + 超时
- **并发控制三件套**：`count++` 读-改-写非原子（实测 10 万次丢 ~24%）→ `lock`（进程级、锁内不做 I/O）→ `Interlocked`（原子计数）→ `SemaphoreSlim`（异步限流，`WaitAsync` + `finally Release()`）

## 关键示例 / 命令

```csharp
// 并发耗时实验：2s/3s/4s WhenAll → 实测 4001ms（取最慢）
await Task.WhenAll(Task.Delay(2000), Task.Delay(3000), Task.Delay(4000));

// 超时控制：WhenAny + CTS
var done = await Task.WhenAny(realTask, Task.Delay(5000, cts.Token));
if (done != realTask) { cts.Cancel(); return StatusCode(504); }

// 一任务失败取消其余：catch 里 cts.Cancel() 再 throw
// 双触发：CreateLinkedTokenSource(RequestAborted, timeout) + CancelAfter(5s)

// 竞态 vs 修复
Parallel.For(0, 100000, _ => _count++);                    // ≈76321
Parallel.For(0, 100000, _ => { lock (_lock) { _count++; } }); // =100000
Interlocked.Increment(ref _count);                          // 无锁原子

// 信号量限流（10 任务上限 3）
await _sem.WaitAsync(ct); try { ... } finally { _sem.Release(); }
```

```bash
# 实验接口（AsyncDemoController）
GET /api/asyncdemo/sync | /async | /when-all | /thread | /task-run
GET /api/asyncdemo/thread-pool | /thread-pool-info | /cancellation-source | /race-condition | /semaphore
```

## 常见坑

1. **并发查库**：DbContext 非线程安全（`A second operation was started...`）→ `IDbContextFactory<T>` 每操作一个 Context
2. **反模式** `Task.Run(() => _context.Orders.ToList())` → 正确 `await ToListAsync()`（禁用线程池包同步 I/O）
3. **WhenAll 失败不自动取消**其余任务 → 任务内部 catch 后手动 `cts.Cancel()`
4. **WhenAny 返回的可能是失败任务** → 判断 `done != realTask` 而非 `IsCompletedSuccessfully`
5. **`lock` 保护不了多实例** → 分布式场景用 Redis 分布式锁；锁对象用 `private static readonly object`
6. `SemaphoreSlim` 忘了 `finally Release()` → 信号量泄漏，后续全部卡死

## 相关链接

- 项目实验代码：`OrderManagement/src/OrderManagement.Api/Controllers/AsyncDemoController.cs`
- 项目笔记：`OrderManagement/docs/07-CSharp异步编程-阶段25.md`

---
#dotnet #csharp #async-await #threading #interview
