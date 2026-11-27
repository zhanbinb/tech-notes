# Ocelot API Gateway 与 Consul 服务发现：路由 · JWT · 限流 · 502 排查

> OrderManagement 阶段 34 实战（对话 22~24）：Ocelot 多路由/认证/限流/负载均衡 + Consul 注册发现，含一个真实 502 根因排查案例（面试可讲）。

## 核心要点

- **Gateway 职责**：统一入口 → 路由/认证/限流/负载均衡/聚合；单实例是 SPOF，生产多实例 + 滚动更新（摘除→优雅停机→健康检查→回流）
- **Ocelot vs YARP**：Ocelot 配置驱动开箱即用；YARP 微软反向代理工具包高性能可编程
- **三步接入**：`AddJsonFile("ocelot.json", reloadOnChange)` → `AddOcelot()` → `await app.UseOcelot()`（必须在 Auth 中间件之后）；csproj 要 `CopyToOutputDirectory`
- **JWT**：Gateway 独立 `AddJwtBearer` 共享密钥；路由 `AuthenticationProviderKeys: ["Bearer"]`（**Ocelot 25 是复数**，旧单数已删）；**认证在网关、业务授权在 API（纵深防御）**
- **限流**：`RateLimitOptions { Period, Limit, ClientIdHeader }`；缺 `ClientIdHeader` 报 `Rate limiting client could not be identified`；超限 503/429；多实例默认非分布式
- **负载均衡**：多 DownstreamHost + `LoadBalancerOptions.Type`（RoundRobin/LeastConnection/CookieStickySessions）
- **Consul**：API 侧 `IHostedService` 注册/注销 + 健康检查（Docker 内用 `host.docker.internal`）；Ocelot 侧 `ServiceDiscoveryProvider: { Type: "Consul" }` + 路由用 `ServiceName` 动态发现；包名 **`Ocelot.Discovery.Consul`**（旧 Provider 包已弃）

## 关键示例 / 命令

```bash
docker run -d --name consul-dev -p 8500:8500 hashicorp/consul:latest agent -dev -client=0.0.0.0
curl http://localhost:8500/v1/status/leader
dotnet add package Ocelot.Discovery.Consul --version 25.0.3
```

```jsonc
// ocelot.json 动态发现路由
{ "UpstreamPathTemplate": "/orders/{id}", "DownstreamPathTemplate": "/api/ddd/orders/{id}",
  "ServiceName": "OrderService", "LoadBalancerOptions": { "Type": "RoundRobin" },
  "AuthenticationOptions": { "AuthenticationProviderKeys": ["Bearer"] },
  "RateLimitOptions": { "EnableRateLimiting": true, "Period": "10s", "Limit": 5, "ClientIdHeader": "X-Client-Id" } }
```

```csharp
// ⭐ 502 根因修复：Ocelot 默认返回 node.Name（Docker 节点名）而非 Service.Address
public class CustomConsulServiceBuilder : DefaultConsulServiceBuilder {
    protected override string GetDownstreamHost(ServiceEntry entry, Node node)
        => entry.Service.Address;
}
builder.Services.AddOcelot(builder.Configuration).AddConsul<CustomConsulServiceBuilder>();
```

## 常见坑

1. **502 排查**：Consul UI Passing、直连 200，但经网关 502 —— 根因是 `DefaultConsulServiceBuilder` 取 `node.Name`（Docker 必现）→ 覆写 `GetDownstreamHost`
2. **503 vs 502**：503 是触发限流规则，不是服务不可用；502 才是下游连不上
3. 限流启动报 client 无法识别 → 加 `ClientIdHeader`
4. `reloadOnChange: true` 只热载 JSON 配置，改 Program.cs 仍需重启
5. **服务发现 ≠ 路由发现**：`AddConfigStoredInConsul()` 只集中存配置不生成路由；DynamicRoutes 用 URL 首段作服务名且需 `Routes: []`
6. Docker 容器内健康检查地址不能写 `localhost`（那是容器自己）→ `host.docker.internal`

## 企业 ocelot.json 管理方案

API 管理平台生成 / 读各服务 `swagger.json` 自动生成 / Consul KV 分发 / C# 编程式 `FileConfiguration`。

## 相关链接

- 项目代码：`OrderManagement/src/OrderManagement.Gateway/`、`Services/CustomConsulServiceBuilder.cs`
- 项目笔记：`OrderManagement/docs/15-网关与服务发现.md`

---
#dotnet #ocelot #consul #api-gateway #service-discovery
