# .NET 可观测性与生产诊断：三支柱 · dotnet-counters/trace · 发布策略

> OrderManagement 阶段 31 实战：Logs/Metrics/Traces 三支柱、四类故障排查思路、dotnet-counters 与 dotnet-trace 实操（已产出 nettrace + speedscope）、发布部署三大策略与 Expand-Contract。

## 核心要点

- **三支柱**：Logs（ILogger/Serilog，本项目已落地）+ Metrics（`System.Diagnostics.Metrics` + Prometheus/Grafana）+ Traces（Activity/OpenTelemetry → Jaeger/Tempo）
- **生产分工**：按需采集（SSH/诊断容器跑工具）vs 常驻监控（Prometheus/OTel）；Trace 不宜长采，Dump 含敏感数据
- **四类故障特征**：CPU 高→trace 找热点；内存泄漏→静态集合/事件未退订；接口慢→N+1（100 订单=101 查询）；**线程池饥饿→`threadpool-queue-length` 涨而 CPU 不高**
- **性能优化顺序**：先 Metrics/Tracing 定位 → SQL/索引 → EF（AsNoTracking + Select 投影 + Keyset 深分页）→ Redis Cache-Aside → 消除同步阻塞 → 对象分配
- **build vs publish**：Framework-dependent（体积小，依赖运行时）vs Self-contained（`-r linux-arm64 --self-contained true`）；Docker 多阶段属前者
- **发布策略**：Rolling 逐台 / **Blue-Green 回滚最快但要求 DB 兼容** / Canary 5%→20%→50%→100%
- **Expand-Contract 无停机迁移**：加兼容字段 → 切代码 → 迁数据 → 删旧字段

## 关键示例 / 命令

```bash
# 实时指标仪表盘
dotnet tool install --global dotnet-counters
dotnet-counters ps
dotnet-counters monitor --process-id <PID> System.Runtime
# 关键指标：cpu-usage / working-set / gc-heap-size / allocation-rate / threadpool-thread-count / threadpool-queue-length

# 采样调用栈 → 可视化
dotnet-trace collect --process-id <PID> --duration 00:00:30 --output ordermanagement.nettrace
dotnet-trace convert --format Speedscope ordermanagement.nettrace   # speedscope.app 打开，Left Heavy 视图找热点

# 发布
dotnet publish src/OrderManagement.Api -c Release -o ./publish
dotnet publish ... -r linux-arm64 --self-contained true             # 自包含
```

## 常见坑

1. **线程池饥饿误判**：看 Queue Length + CPU 组合 —— 队列涨但 CPU 低才是饥饿（CPU 高是热点）
2. `.nettrace` 16MB 级二进制文件**不要提交 Git** → 加 `.gitignore`
3. 生产在 EC2/Docker 里装工具：EC2 按需 SSH 采集；Docker 用独立诊断容器共享诊断 Socket（不污染业务容器）
4. 蓝绿/金丝雀没有 DB 兼容策略 = 回滚灾难（配合 Expand-Contract）
5. 密码走环境变量/云 Secret Manager，绝不进 Git

## 相关链接

- 项目笔记：`OrderManagement/docs/11-可观测性与诊断-阶段31.md`
- speedscope：https://www.speedscope.app/ ；dotnet-counters 文档：https://learn.microsoft.com/dotnet/core/diagnostics/dotnet-counters

---
#dotnet #observability #dotnet-trace #performance #deployment
