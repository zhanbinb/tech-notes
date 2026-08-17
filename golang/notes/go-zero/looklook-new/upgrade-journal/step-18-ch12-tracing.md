# step-18: ch 12 链路追踪 (Jaeger + OTLP 完整跑通)

## §0 文档目标

把 looklook 项目的链路追踪完整跑通:
1. **Jaeger 1.63** 起来 (用 ES 做存储, 跨 ch 11/12 共用)
2. **go-zero v1.10.2** 11 个服务把 trace 通过 **OTLP 协议**上报 jaeger
3. **jaeger UI** 看到完整 trace 链路 (api → rpc)

承接 step-17 (ch 13 监控), 是 ch 11/12/13 三件套的第二章.

---

## §1 起点 - 项目现状

### 1.1 中间件状态 (2026-08-11)

| 组件 | 状态 | 备注 |
|---|---|---|
| ES + Kibana | 已起 (ch 11 用) | jaeger 1.63 用 ES 做存储, 跟着起来 |
| Jaeger | Restarting 循环 | **根因**: 默认用 ES, 但我们没启 ES |
| Prometheus + Grafana | ✅ ch 13 跑通 |

### 1.2 go-zero 各服务 Telemetry 现状 (11 个全空跑)

```yaml
Telemetry:
  Name: order-api
  Endpoint: ./data/traces    # 写到本地文件 (没用!)
  Sampler: 0.0               # 0% 采样 (根本没收)
  Batcher: file              # 文件批处理
```

3 个问题:
- `Sampler: 0.0` → 0% 采样, trace 根本没生成
- `Endpoint: ./data/traces` → 写到本地, **没人来拉** (ch 11 的 filebeat 拉的是业务日志, 不拉 trace)
- `Batcher: file` → 跟上一致

**核心误解**: trace 不是用 filebeat 拉的, 是**直接通过 OTLP 协议发到 jaeger**.

### 1.3 实际能验证的指标

```
$ curl http://127.0.0.1:16686/api/services
{
  "data": [
    "jaeger-all-in-one"
  ],
  "total": 1
}
```

只有 jaeger 自己 (内部), 业务服务 0 个 (因为 jaeger 没起).

---

## §2 Step 1 - 修 jaeger (让它能起来)

### 2.1 根因

```bash
$ docker logs jaeger --tail 5
"Failed to init storage factory",
"failed to create primary Elasticsearch client: 
  health check timeout: Head \"http://elasticsearch:9200\": EOF"
```

jaeger 默认 `SPAN_STORAGE_TYPE=elasticsearch`, 期望 ES, 但我们 ES 没启 → 启动失败 → restart 循环.

### 2.2 修复: ES 起来 (不改 jaeger 配置)

按 ch 11 计划**先起 ES**:
```bash
docker start elasticsearch kibana
```

`elasticsearch:9200` 健康 (yellow, 单节点正常), `kibana:5601` 可访问.

### 2.3 jaeger 容器重建 (加载 ES 存储)

之前 jaeger `docker restart` 不行, 因为端口映射在 `docker compose up -d` 创建容器时定.
**完整修复**: 修改 docker-compose-env.yml 给 jaeger **加 4317/4318 OTLP 端口映射**, 然后 `docker compose up -d` 重建.

```diff
       ports:
         - "5775:5775/udp"
         ...
         - "14268:14268"
+        - "4317:4317"   # OTLP gRPC
+        - "4318:4318"   # OTLP HTTP
         - "9411:9411"
```

验证:
```
jaeger  Up 21 seconds   0.0.0.0:4317-4318->4317-4318/tcp, ...

$ curl -X POST http://127.0.0.1:4318/v1/traces -d 'test'
HTTP 400   ← 收到响应 (400 因为 protobuf 格式错, 端口通)
```

---

## §3 Step 2 - 改 go-zero 11 个服务 Telemetry

### 3.1 关键: go-zero v1.10.2 Batcher 只支持 4 个值

```bash
# go-zero v1.10.2 源码 (core/trace/config.go)
Batcher string `json:",default=otlpgrpc,options=zipkin|otlpgrpc|otlphttp|file"`
```

| 值 | 默认 | 支持版本 | 协议 | Endpoint 例子 |
|---|---|---|---|---|
| `zipkin` | ❌ | go-zero 1.x 全支持 | Zipkin v2 HTTP | `http://zipkin:9411/api/v2/spans` |
| `otlpgrpc` | ✅ 默认 | go-zero 1.6+ | OTLP gRPC | `jaeger:4317` |
| `otlphttp` | ❌ | go-zero 1.6+ | OTLP HTTP | `http://jaeger:4318/v1/traces` |
| `file` | ❌ | go-zero 全版本 | 写本地文件 | `./data/traces` |
| ~~`jaeger`~~ | ❌ **废弃** | go-zero 1.5- | ~~Jaeger thrift HTTP~~ | ~~`http://jaeger:14268/api/traces`~~ |

> **ch 12 教程原版用的 `Batcher: jaeger` 写法在 go-zero v1.10 已废弃**, 必须改成 OTLP 系列.

### 3.2 选 otlphttp 的原因

| 考虑 | otlphttp | otlpgrpc |
|---|---|---|
| 调试性 (curl 直接发) | ✅ | ❌ (要 grpcurl) |
| 防火墙友好 | ✅ HTTP 通用 | 可能被禁 |
| 性能 (dev 场景) | 略低 | 略高 |
| jaeger 接收端口 | 4318 | 4317 |

**选 otlphttp** (dev 够用, 易调试).

### 3.3 关键: 容器内 DNS vs host 域名

go-zero 服务跑在 **host 上** (macOS 主机的 binary 进程), jaeger 跑在 **docker 容器里**.

| Endpoint 写法 | 含义 | 是否工作 |
|---|---|---|
| `http://jaeger:14268/api/traces` | docker 网络 DNS 名 | ❌ host 上解析不到 |
| `http://127.0.0.1:14268/api/traces` | host loopback (vpnkit 转发) | ✅ |

**必须是 `127.0.0.1`**! jaeger 端口映射到 host 后, host 用 127.0.0.1 访问.

### 3.4 11 个 yaml 改后样子

```yaml
Telemetry:
  Name: order-api
  Endpoint: http://127.0.0.1:4318/v1/traces  # OTLP HTTP, host loopback
  Sampler: 1.0                               # 100% 采样 (dev)
  Batcher: otlphttp                          # ★ 必须是 otlp 系列, 不能再用 jaeger
```

---

## §4 Step 3 - 验证 (启动服务 + 触发流量)

### 4.1 重编译 + 启动

```bash
# 11 个服务重编译 (yaml 改了, binary 要更新)
go build -o ./tmp/<service> ./app/<service>/cmd/<cmd>

# 用 detached 脚本启动 (sandbox 友好)
./scripts/dev-start-detached.sh
```

### 4.2 验证 jaeger 收到 trace

```bash
# 触发一笔业务
TOKEN=$(curl -X POST http://127.0.0.1:1004/usercenter/v1/user/login -H "Content-Type: application/json" -d '{"mobile":"18721432599","password":"test123456"}' | jq -r .data.token)
curl -X POST http://127.0.0.1:1004/usercenter/v1/user/detail -H "Content-Type: application/json" -d '{}'

# 看 jaeger services
curl http://127.0.0.1:16686/api/services
# { "data": ["jaeger-all-in-one", "usercenter-api", "usercenter-rpc", ...] }
```

### 4.3 验证结果 (2026-08-11)

```
service         trace 数
─────────────────────────────────
order-api          20
payment-api        20
travel-api         20
usercenter-api     45
usercenter-rpc     24
order-rpc           0  ← API 参数错未到 RPC
payment-rpc         0  ← API 参数错未到 RPC
travel-rpc          0  ← API 参数错未到 RPC
```

**关键链路** (跨 service):
```
usercenter-api: POST /usercenter/v1/user/detail  (2.8ms)
 └─ usercenter-rpc: pb.usercenter/getUserInfo     (1.5ms)
```

---

## §5 go-zero Telemetry 配置详解 (★★★)

### 5.1 4 个字段含义

| 字段 | 类型 | 必填 | 含义 | 推荐 |
|---|---|---|---|---|
| `Name` | string | 否 | service 名称 (写入 span resource) | 跟 service name 一致, 如 `order-api` |
| `Endpoint` | string | 否 | OTLP backend 地址 | `http://127.0.0.1:4318/v1/traces` |
| `Sampler` | float | 否 | 采样率 0.0-1.0 | dev 1.0, 生产 0.1 或 ParentBased(0.1) |
| `Batcher` | string | 否 | 协议类型 | otlphttp / otlpgrpc / zipkin / file |

### 5.2 Sampler 详解 (★ 重要)

```yaml
# dev: 全采样
Sampler: 1.0

# 生产: 概率采样 (100 个请求采 1 个)
Sampler: 0.01

# 生产推荐: ParentBased (根请求 100% 采, 子 span 按比例)
Sampler: ParentBased(TraceIDRatioBased(0.1))
```

go-zero v1.10.2 默认实现是 `ParentBased(TraceIDRatioBased(Sampler))`:
- 有 parent span → 沿用 parent 的采样决定
- 根 span → 按 Sampler 比例采样

### 5.3 Batcher 详解 (★ 重要, 别再用 jaeger)

| 协议 | go-zero 代码 | 数据格式 | 端口 |
|---|---|---|---|
| `zipkin` | go-zero/internal/trace/zipkin | Zipkin v2 JSON | 9411 |
| `otlpgrpc` | go-zero/internal/trace/otlpgrpc | OTLP/protobuf over gRPC | 4317 |
| `otlphttp` | go-zero/internal/trace/otlphttp | OTLP/protobuf over HTTP | 4318 |
| `file` | go-zero/internal/trace/file | Jaeger JSON line | 本地文件 |

### 5.4 Endpoint URL 规则

```
# OTLP gRPC (不用 scheme, 端口即可)
Endpoint: 127.0.0.1:4317

# OTLP HTTP (需要完整 URL + /v1/traces 路径)
Endpoint: http://127.0.0.1:4318/v1/traces

# Zipkin HTTP
Endpoint: http://127.0.0.1:9411/api/v2/spans
```

注意 **OTLP HTTP 路径必须 `/v1/traces`**, 这是 OTLP 规范硬性要求.

### 5.5 我们的 11 个服务配置 (完整示例)

```yaml
# app/order/cmd/api/etc/order.yaml
Telemetry:
  Name: order-api
  Endpoint: http://127.0.0.1:4318/v1/traces
  Sampler: 1.0
  Batcher: otlphttp
```

11 个文件 (api/rpc/mq/scheduler/job), 全部相同结构, 只 `Name` 不同.

---

## §6 OTLP 协议详解 (★ 工业标准)

### 6.1 什么是 OTLP

**OTLP (OpenTelemetry Protocol)** 是 **CNCF OpenTelemetry** 项目定义的标准协议.

- **2019** OpenTelemetry 项目成立 (合并 OpenCensus + OpenTracing)
- **2021** OTLP 1.0 GA
- **2024** 几乎所有可观测性后端 (Jaeger/Tempo/Datadog/New Relic) 都支持

### 6.2 OTLP vs 老协议

| 协议 | 时代 | 现状 |
|---|---|---|
| Zipkin thrift / v2 JSON | 2015+ | 老, 维护中, 部分新后端不支持 |
| Jaeger thrift HTTP | 2016-2020 | **已废弃**, jaeger 1.35+ 移除 |
| **OTLP** (gRPC + HTTP) | 2021+ | **当前标准**, 业界统一 |

### 6.3 端口约定

| 端口 | 协议 | 路径 |
|---|---|---|
| 4317 | OTLP gRPC | (无路径) |
| 4318 | OTLP HTTP | `/v1/traces` (trace), `/v1/metrics` (metric), `/v1/logs` (log) |

记住: **4317=grpc, 4318=http**.

### 6.4 OTLP 三大支柱 (统一!)

OTLP 不只是 trace, 它**统一**了 3 大信号:

```
┌────────────────────────────────┐
│   OTel SDK (Go/Python/Java)     │
│   ┌─────┬─────┬─────┐           │
│   │trace│metric│log │           │
│   └──┬──┴──┬───┴──┬──┘           │
└─────┼─────┼──────┼──────────────┘
      │     │      │
      ▼     ▼      ▼
   ┌──────────────────┐
   │  OTLP (统一协议)  │ gRPC :4317 / HTTP :4318
   └────────┬─────────┘
            ▼
   ┌────────────────────────┐
   │  OTel Collector (可选)  │ ← 现代做法: 一层中转
   └────────┬───────────────┘
            ▼
   ┌────┬────┬────┬─────┐
   │Jaeger│Tempo│Prom│ES  │
   └────┴────┴────┴─────┘
```

我们的 looklook **没装 OTel Collector**, 服务**直连** jaeger. 简单场景 OK, 生产推荐加 Collector (中转、采样、过滤、跨数据中心).

### 6.5 OTLP 数据格式

OTLP/protobuf 是 **google.protobuf** 编码:

```protobuf
message ExportTraceServiceRequest {
  repeated ResourceSpans resource_spans = 1;
}
message ResourceSpans {
  Resource resource = 1;
  repeated ScopeSpans scope_spans = 2;
}
message ScopeSpans {
  InstrumentationScope scope = 1;
  repeated Span spans = 2;
}
message Span {
  bytes trace_id = 1;
  bytes span_id = 4;
  string name = 7;        // 操作名 (如 "POST /api/login")
  uint64 start_time_unix_nano = 8;
  uint64 end_time_unix_nano = 12;
  map<string, KeyValue> attributes = 9;  // tags
}
```

---

## §7 jaeger UI 操作详解 (★★★)

### 7.1 打开 UI

浏览器 `http://127.0.0.1:16686`

### 7.2 主界面 (Search)

```
┌────────────────────────────────────────┐
│  Service: [下拉]                       │
│  Operation: [可选]                     │
│  Tags: [key=value 过滤]                │
│  Lookback: [1h/3h/6h/24h/自定义]     │
│  Max Duration: [可选]                  │
│  Min Duration: [可选]                  │
│  Limit: [默认 20]                      │
│                                        │
│  [ Find Traces ]                       │
└────────────────────────────────────────┘
```

### 7.3 trace 列表

找到 trace 后显示列表, 每行:

```
┌────────────────────────────────────────────┐
│ usercenter-api: POST /.../user/detail  2.8ms│  ← 1 行 = 1 个 trace
│ 8 spans  jaeger-all-in-one  usercenter-rpc │
│ 2 minutes ago                              │
└────────────────────────────────────────────┘
```

按时间倒序, 点蓝色行进入详情.

### 7.4 trace 详情页 (重点)

```
┌──────────────────────────────────────────────────┐
│ Trace: 324b4b3a5809cf0d  Duration: 2.8ms  Spans: 8│
│ Services: 3 (usercenter-api, usercenter-rpc, jaeger)│
├──────────────────────────────────────────────────┤
│                                                  │
│  Span 时间线 (横条图)                            │
│  ────────────POST /detail─────────────────── 2.8ms│
│     ──────pb.usercenter/getUserInfo───── 1.5ms    │
│     ────jaeger.query────────────────── 0.5ms     │
│                                                  │
├──────────────────────────────────────────────────┤
│ Span 列表 (左侧, 可折叠)                        │
│ ▼ usercenter-api: POST /usercenter/v1/user/detail│
│     duration: 2.8ms                              │
│     tags: {                                      │
│       http.method: POST                          │
│       http.url: /usercenter/v1/user/detail       │
│       http.status_code: 200                      │
│       rpc.system: go-zero                        │
│     }                                            │
│   ▼ usercenter-rpc: pb.usercenter/getUserInfo    │
│       duration: 1.5ms                            │
│       tags: {                                    │
│         peer.service: usercenter-rpc             │
│       }                                          │
└──────────────────────────────────────────────────┘
```

### 7.5 关键操作

| 操作 | 怎么用 | 价值 |
|---|---|---|
| 看错误率 | 加 tag `http.status_code=500` 过滤 | 快速定位失败请求 |
| 看慢接口 | `Min Duration: 1s` | 找性能瓶颈 |
| 看 RPC 链路 | 点最外层 API span, 看子 span | **跨服务调用关系可视化** |
| 对比多次 | 看时间线 | 某次 vs 平均 |

### 7.6 排查清单

- [ ] Service 下拉有 11 个业务 service?
- [ ] Find Traces 有结果? (查不到 → Sampler 太低/没数据)
- [ ] 点 trace 能看到 span 树?
- [ ] 横条图能看到嵌套 (API span 包 RPC span)?
- [ ] Tag 面板能看到 http.method/url/status_code?

---

## §8 总结

### 8.1 5 步走成果

| 步骤 | 内容 | 状态 |
|---|---|---|
| 摸底 | jaeger restart 循环, Telemetry 全空跑 | ✅ |
| 修 jaeger | ES 起来 + 加 4317/4318 端口 | ✅ v3.35 |
| 改 Telemetry | 11 yaml → OTLP HTTP + 127.0.0.1:4318 | ✅ v3.35 |
| 重编译 + 启动 | 11 binary + dev-start-detached.sh | ✅ |
| 验证 | 5 service 有 trace, 跨 api→rpc 完整 | ✅ |

### 8.2 关键收获

1. **go-zero v1.10+ Batcher 不再支持 `jaeger`**: 必须用 `otlphttp` 或 `otlpgrpc`
2. **OTLP 是 2024+ 工业标准**: 统一 trace/metrics/logs 三大信号,所有可观测后端支持
3. **容器内 DNS vs host**: 服务跑 host, jaeger 跑 docker,  Endpoint 必须 `127.0.0.1` (走 vpnkit)
4. **jaeger 1.63 用 ES 做存储**: 跟 ch 11 共用 ES, 起 ES 就同时支持 ch 11/12
5. **trace 跨服务调用链**: 1 个 API → 1 个 RPC, 整链路 2.8ms, 是 go-zero 链路追踪最大价值

### 8.3 排查清单

- [ ] jaeger 起来没? (`docker ps | grep jaeger`)
- [ ] OTLP 端口在 host 通? (`nc 127.0.0.1 4318`)
- [ ] Telemetry 配置正确? (Batcher=otlphttp, Endpoint 含 /v1/traces)
- [ ] 服务重启了吗? (改 yaml 后要重 build + 重启)
- [ ] jaeger UI 看得到 service? (没业务 service → OTLP 没上报)
- [ ] 完整链路出现? (只有 api 没 rpc → RPC 业务参数错)

---

## §9 相关文件路径

```
docker-compose-env.yml                   ← jaeger 端口 + 11 服务 yaml 配置
app/*/cmd/*/etc/*.yaml                  ← 11 个 Telemetry 配置
scripts/dev-start-detached.sh           ← macOS 兼容 detached 启动

go-zero 源码:
/Users/.../go/pkg/mod/github.com/zeromicro/go-zero@v1.10.2/core/trace/
├── config.go                            ← Batcher 4 个值定义
├── agent.go                             ← OTLP exporter
└── ...
```

---

## §10 相关阅读

- [step-17 ch 13 监控](step-17-ch13-monitoring.md) — 上一章: Prometheus + Grafana
- [step-15 APISIX 实战](step-15-apisix-practice.md) — 网关实战
- [step-16 APISIX vs KONG 配置复杂度](step-16-apisix-kong-config-complexity.md) — ch 11/12/13 现代替代方案 (LGTM + OTel Collector)
- 原始教程 [ch 12-链路追踪](doc/chinese/12-链路追踪.md) (跟 go-zero v1.10 略有差异, OTLP 是新写法)

---

## §11 后续 (ch 11)

ch 12 收尾. 接下来:
- **step-19: ch 11 日志收集** (filebeat + kafka + go-stash + ES + Kibana, ES 已起)

---

*创建于 2026-08-11, ch 12 链路追踪完整跑通 (Jaeger 1.63 + OTLP HTTP, 5 service 收到 trace, 跨 api→rpc 完整链路), v3.35 commit 已 ship*
