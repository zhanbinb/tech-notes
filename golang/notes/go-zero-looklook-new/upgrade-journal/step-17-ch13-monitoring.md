# step-17: ch 13 监控 (Prometheus + Grafana 完整跑通)

## §0 文档目标

把 looklook 项目的监控链路完整跑通:
1. **Prometheus** 抓 go-zero 各 api/rpc/mq 的 `/metrics`
3. **Grafana** 配数据源 + 手工建 dashboard 展示 QPS/延迟/内存/Goroutine

承接 step-09 (ch 02 网关调研), 属于"基础设施层 (ch 11/12/13)"的第一章.

---

## §1 起点 - 项目现状

### 1.1 中间件状态 (2026-08-11)

| 组件 | 端口 | 状态 |
|---|---|---|
| Prometheus | 9090 | Up 4 days |
| Grafana | 3001 | Up 4 days |
| Filebeat | - | Up (ch 11 用) |
| Jaeger | - | Restarting 循环 (ch 12 要修) |

### 1.2 go-zero 各服务的 metrics 端口 (已内置 Prometheus)

```
order-api        :4001   order-rpc       :4002
payment-api      :4004   payment-rpc     :4005
travel-api       :4006   travel-rpc      :4007
usercenter-api   :4008   usercenter-rpc  :4009
order-mq         :4003
mqueue-job       :4010   mqueue-scheduler :4011
```

每个 service yaml 里 Prometheus 段:
```yaml
Prometheus:
  Host: 0.0.0.0
  Port: 4001   # 各 service 不同
  Path: /metrics
```

go-zero 在 api/rpc 启动时**自动开 goroutine** 监听 `:port/metrics`, 无需额外代码.

### 1.3 实际可抓的指标

curl `http://127.0.0.1:4001/metrics` 看 go-zero + Go runtime 标准指标:

```
# Go runtime
go_gc_duration_seconds         # GC 暂停时间分布
go_goroutines                  # 当前 goroutine 数
go_memstats_alloc_bytes        # 堆内存
process_resident_memory_bytes  # 进程 RSS 内存
process_cpu_seconds_total      # CPU 使用时间

# go-zero HTTP server (暴露的指标名)
http_server_requests_code_total{code, method, path}      # 累计请求数
http_server_requests_duration_ms_sum{...}                # 累计延迟 ms
http_server_requests_duration_ms_count{...}              # 累计请求数
http_server_requests_duration_ms_bucket{..., le=...}    # 延迟直方图 (5/25/50/100/250/500/750/1000/+Inf)
```

---

## §2 Step 1 - 修复 prometheus 配置

### 2.1 摸底现状

最初 prometheus.yml 的 target 都是 `looklook:NNNN`(容器名), 但我们的 go-zero 服务**跑在 host 上**, prometheus 容器无法通过容器名解析到 host. 结果: **active targets = 0**, 12 个 service 都没被抓.

另外 global 段 `scrape_interval:` 没值, prometheus 用默认 **1 分钟**. 这导致 `rate(...[5m])` 算不出 QPS (需要至少 2 个 scrape 周期).

### 2.2 踩坑 1: target 配容器名 → 改 host.docker.internal

```diff
-      - targets: [ 'looklook:4001' ]
+      - targets: [ 'host.docker.internal:4001' ]
```

`host.docker.internal` 是 Docker Desktop for Mac/Windows 的特殊 DNS, 容器内能解析到宿主机. prometheus 容器通过 `extra_hosts: - "host.docker.internal:host-gateway"` (docker-compose-env.yml 已配) 拿到这个别名.

### 2.3 踩坑 2: scrape_interval 默认 1m → 改 15s

```diff
 global:
-  scrape_interval:
+  scrape_interval: 15s
   external_labels:
     monitor: 'codelab-monitor'
```

15s 是**工业实践值** (Grafana Cloud 官方推荐 15s, Prometheus 默认 1m 太慢看不出趋势).

### 2.4 验证配置生效 (2 步)

**a. Status → Targets 页面 (URL: `:9090/targets`)**:
```
✅ 12 个 target 全 up (11 个 service + prometheus 自己)
每个 target 显示 health=up, lastScrape 时间间隔 15s
```

**b. PromQL 查询验证 (`:9090/graph` 输入)**:
```
up                              → 12 行, 全 =1
go_goroutines                   → 12 个服务的 goroutine 数
process_resident_memory_bytes   → 12 个服务的内存
http_server_requests_code_total → 7 个指标的累计计数
```

API 验证:
```bash
curl 'http://127.0.0.1:9090/api/v1/targets' | jq '.data.activeTargets[].health'
# 全 "up"

curl -G 'http://127.0.0.1:9090/api/v1/query' \
  --data-urlencode 'query=sum(rate(http_server_requests_code_total[5m]))'
# 返回 req/s 数值
```

---

## §3 Step 2 - 配 Grafana 数据源

### 3.1 通过 Admin API 创建 (一行 curl)

```bash
curl -X POST -u admin:admin "http://127.0.0.1:3001/api/datasources" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Prometheus",
    "type": "prometheus",
    "url": "http://prometheus:9090",
    "access": "proxy",
    "isDefault": true
  }'
```

返回 `{ "id": 1, "uid": "9_I6klyDk", "name": "Prometheus" }`.

**注意 url**: Grafana 容器内访问 prometheus, 用**容器名** `prometheus:9090` (同 docker 网络). 不要写 `localhost` 或 host IP.

### 3.2 验证联通

```bash
curl -u admin:admin -X POST "http://127.0.0.1:3001/api/ds/query" \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [{"refId":"A","datasourceId":1,"expr":"up","instant":true}],
    "from":"now-30m","to":"now"
  }'
```

返回 `{ "results": { "A": { "frames": [{ "schema": {...}, "data":": { "values": [[...], [1,1,1,...]] }} ] } } }` → 联通成功.

---

## §4 Step 3 - 创建 Dashboard (★★★ Grafana 手工建)

### 4.1 ⚠️ 踩坑: API 创建的 dashboard 有 bug

通过 Grafana Admin API 创建 dashboard (POST `/api/dashboards/db`), 即使 panel 里配了 datasource `{type, uid}`, 编辑 panel 时 Data source 字段仍显示 `[object Object] - not found`, 数据查不出来.

**根因**: Grafana 8.0.6 的 panel editor 渲染 datasource 对象时**有 bug** (不影响 API 查询, 只影响 UI 编辑器).

**解决方案**: **手动建 dashboard** (推荐 + 学真实流程).

### 4.2 手工创建 Dashboard 完整步骤

#### 4.2.1 创建 dashboard 框架

1. 浏览器打开 `http://127.0.0.1:3000` (admin/admin 登录)
2. 左侧菜单 **+** → **Dashboard** → **Add new panel** (或 **Create dashboard**)
3. 自动进入编辑模式, 先点右上角 **Save dashboard** (磁盘图标) → 命名 "looklook go-zero 监控" → **Save**
4. 之后会反复用到右上角保存按钮

#### 4.2.2 添加一个 stat panel (最简单)

1. 顶部 **Add panel** → 选 **Stat** 类型 → 添加
2. 在 panel 编辑器里 (右侧):
 - **Data source** 下拉 → 选 **Prometheus**
 - **Metric selector** (Metrics 框) → 改成 **PromQL** 模式(右边按钮)
 - 输入 **`sum(go_goroutines)`**
 - 下面会显示绿色 ✅ "Data source is working" + 数据预览
4. 右侧 **Panel options**:
 - **Title**: "总 Goroutines"
5. 右上角 **Apply**
6. **拖 panel** 到合适位置 (顶部第一行), **拉边框** 调大小

#### 4.2.3 添加更多 stat panel (重复操作)

照同样步骤加 3 个 stat panel:

| Panel | PromQL | 单位 |
|---|---|---|
| 总内存 (bytes) | `sum(process_resident_memory_bytes)` | bytes |
| 总 QPS (5m) | `sum(rate(http_server_requests_code_total[5m]))` | reqps |
| 健康 target | `sum(up)` | - |

#### 4.2.4 添加 timeseries panel (折线图)

1. 顶部 **Add panel** → 选 **Time series**
2. 数据源 **Prometheus**, 输入 PromQL (任选):
 - `go_goroutines` (12 条线)
 - `process_resident_memory_bytes / 1024 / 1024` (12 条线, 内存 MB)
 - `sum by (job) (rate(http_server_requests_code_total[5m]))` (4 条线, 每服务 QPS)
3. 右侧 **Panel options** → **Title** 命名
4. 右侧 **Legend**: Display mode = **Table**, Placement = **Bottom**
5. **Apply**

#### 4.2.5 完整 dashboard 结构 (7 panel)

```
[总 Goroutines] [总内存] [总 QPS] [up 健康]    ← stat 行
8 行 timeseries: [Goroutine 每服务] [内存 MB 每服务]
4-8 行 timeseries: [QPS 每服务]
```

#### 4.2.6 触发流量验证 dashboard

打开浏览器新 tab, 跑几笔业务请求, dashboard 就有曲线:
```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:1004/usercenter/v1/user/login -H "Content-Type: application/json" -d '{"mobile":"18721432599","password":"test123456"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
for i in $(seq 1 20); do
  curl -s -X POST http://127.0.0.1:1003/travel/v1/homestay/homestayList -H "Content-Type: application/json" -d '{"page":1,"pageSize":5}' > /dev/null
  curl -s -X POST http://127.0.0.1:1004/usercenter/v1/user/detail -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' > /dev/null
done
```

回到 dashboard 等 15-30 秒 (一次 scrape 周期), panel 就有数据.

---

## §5 prometheus.yml 重要参数详解

完整文件结构 (`deploy/prometheus/server/prometheus.yml`):

```yaml
global:
  scrape_interval: 15s        # 全局默认 scrape 间隔
  external_labels:
    monitor: codelab-monitor  # 投递到远程存储时附加的 label

scrape_configs:
  - job_name: 'order-api'
    static_configs:
      - targets: ['host.docker.internal:4001']
        labels:
          job: order-api        # job 标签 (覆盖 job_name)
          app: order-api
          env: dev
```

### 5.1 global 段

| 参数 | 必填 | 含义 | 推荐值 |
|---|---|---|---|
| `scrape_interval` | 否 | 全局默认 scrape 间隔 | **15s** (工业实践), dev 可用 30s, 监控自身用 1m |
| `scrape_timeout` | 否 | scrape 请求超时 | 10s (默认) |
| `evaluation_interval` | 否 | rules 评估间隔 | 1m (默认) |
| `external_labels` | 否 | 投递到 remote 存储时附加 | dev 环境可省略 |

> **scrape_interval vs scrape_timeout**: scrape_interval 应该 > scrape_timeout, 否则 timeout 比 interval 还长, 数据点会丢.

### 5.2 scrape_configs 段 (核心)

每个 `- job_name: 'xxx'` 是一个**抓取任务**:

| 子字段 | 必填 | 含义 | 例子 |
|---|---|---|---|
| `job_name` | ✅ | job 唯一标识, 也会自动作为 `job` label | `'order-api'` |
| `scrape_interval` | 否 | 覆盖全局, 这个 job 的间隔 | 15s |
| `metrics_path` | 否 | scrape 的 URL path | `/metrics` (默认) |
| `scheme` | 否 | http 或 https | `http` (默认) |
| `static_configs` | ✅ | 静态目标列表 | 见下 |

### 5.3 static_configs 段

```yaml
static_configs:
  - targets: ['host.docker.internal:4001']
    labels:
      job: order-api
      app: order-api
      env: dev
```

| 子字段 | 必填 | 含义 |
|---|---|---|
| `targets` | ✅ | 目标地址 (host:port 数组) |
| `labels` | 否 | 附加到指标的 label (key=value) |

### 5.4 我们的 11 个 job 配置 (节选)

```yaml
- job_name: 'order-api'      → host.docker.internal:4001
- job_name: 'order-rpc'      → host.docker.internal:4002
- job_name: 'order-mq'       → host.docker.internal:4003
- job_name: 'payment-api'    → host.docker.internal:4004
- job_name: 'payment-rpc'    → host.docker.internal:4005
- job_name: 'travel-api'     → host.docker.internal:4006
- job_name: 'travel-rpc'     → host.docker.internal:4007
- job_name: 'usercenter-api' → host.docker.internal:4008
- job_name: 'usercenter-rpc' → host.docker.internal:4009
- job_name: 'mqueue-job'     → host.docker.internal:4010
- job_name: 'mqueue-scheduler' → host.docker.internal:4011
```

**关键点**: 用 `host.docker.internal` 是因为我们的 go-zero 服务**跑在 host 上**(不是容器). 如果服务跑在 docker 容器里, 用容器名或服务名.

### 5.5 service discovery (SD) 的其他方式 (了解)

我们用 `static_configs` 手动列. Prometheus 还支持:
- `file_sd_configs`: 从 JSON/YAML 文件读取 targets (适合动态扩缩)
- `dns_sd_configs`: 通过 DNS 解析 (A/AAAA/SRV 记录)
- `kubernetes_sd_configs`: K8s 自动发现
- `consul_sd_configs`: HashiCorp Consul
- `ec2_sd_configs` / `azure_sd_configs`: 公有云

企业级生产用 SD 而不是 static. dev 环境手动列 OK.

---

## §6 Grafana dashboard / panel 手工创建步骤详解

### 6.1 dashboard 操作

| 操作 | 步骤 |
|---|---|
| 新建 dashboard | 左侧 + → Dashboard → Add new panel |
| 保存 dashboard | 顶部磁盘图标 → 命名 → Save |
| 进入编辑模式 | 顶部铅笔图标 |
| 添加 panel | 编辑模式下顶部 Add panel |
| 删除 panel | panel 标题 → X 按钮 |
| 复制 panel | panel 标题右键 → Duplicate |
| 移动 panel | 编辑模式下拖 panel 标题 |
| 改时间范围 | 右上角时间下拉 (Last 30 minutes) |
| 改刷新间隔 | 右上角下拉箭头 (5s/10s/30s/1m/5m) |

### 6.2 panel 通用字段 (每个类型都有)

| 字段 | 含义 |
|---|---|
| **Data source** | 数据源 (选 Prometheus) |
| **Query (PromQL)** | 查询表达式 |
| **Title** | panel 显示名 |
| **Description** | 鼠标 hover 时显示 (可选) |
| **Transparent background** | 背景透明 (可选) |

### 6.3 stat panel 特有

| 字段 | 含义 | 推荐 |
|---|---|---|
| **Graph mode** | 显示模式 (area / none) | Area (有背景渐变) |
| **Color mode** | value / background / gradient | Value (数字本身变色) |
| **Text mode** | auto / value / value_and_name | auto |
| **Orientation** | auto / horizontal / vertical | auto |
| **Calc** | 聚合方式 | Last (not null) (取最新) |
| **Unit** | 单位 | reqps / bytes / ms / short |

### 6.4 timeseries panel 特有

| 字段 | 含义 |
|---|---|
| **Draw style** | line / bars / points |
| **Line interpolation** | linear / smooth / step |
| **Line width** | 1-5 |
| **Fill opacity** | 0-100, panel 背景填充度 |
| **Show points** | 是否显示数据点 |
| **Staircase** | 阶梯图 (适合 counter) |
| **Legend: Display mode** | list / table / hidden |
| **Legend: Placement** | bottom / right |
| **Tooltip mode** | single / multi / none |

### 6.5 我们的 7 个 panel 配置 (详细)

#### Panel 1: 总 Goroutines (stat)

```
Title:    总 Goroutines
PromQL:   sum(go_goroutines)
Graph:    Area
Color:    Value
Calc:     Last (not null)
```

#### Panel 2: 总内存 (stat)

```
Title:    总内存 (bytes)
PromQL:   sum(process_resident_memory_bytes)
Graph:    Area
Color:    Value
Unit:     bytes
```

#### Panel 3: 总 QPS (stat)

```
Title:    总 QPS (5m)
PromQL:   sum(rate(http_server_requests_code_total[5m]))
Graph:    Area
Color:    Value
Unit:     reqps
Decimals: 3
```

#### Panel 4: 健康 target (stat)

```
Title:    健康 target
PromQL:   sum(up)
Color:    Value (期望值 = 11 = 4 api + 4 rpc + mq + 2 mqueue)
```

#### Panel 5: Goroutine 数 (timeseries)

```
Title:    Goroutine 数 (每服务)
PromQL:   go_goroutines
Legend:   {{job}}
Legend mode: table, placement: bottom
```

#### Panel 6: 内存 MB (timeseries)

```
Title:    内存 MB (每服务)
PromQL:   process_resident_memory_bytes / 1024 / 1024
Legend:   {{job}}
Unit:     decmbytes (auto = MB)
Legend:   table, bottom
```

#### Panel 7: 每服务 QPS (timeseries)

```
Title:    QPS (每服务, 5m)
PromQL:   sum by (job) (rate(http_server_requests_code_total[5m]))
Legend:   {{job}}
Unit:     reqps
Legend:   table, bottom
```

### 6.6 常用 PromQL 速查 (后续会反复用)

```promql
# 速率 (counter 增加率)
rate(metric_name[5m])          # 5 分钟每秒平均增量
irate(metric_name[5m])         # 瞬时每秒增量 (更敏感, 噪音多)

# 聚合
sum(metric)                     # 求和
sum by (label) (metric)         # 按 label 分组求和
avg by (label) (metric)         # 按 label 分组平均

# 延迟计算
rate(metric_sum[5m]) / rate(metric_count[5m])   # 平均延迟

# 错误率
rate(metric{code=~"5.."}[5m]) / rate(metric[5m])  # 5xx 错误率

# Histogram quantile
histogram_quantile(0.95, sum by (le) (rate(bucket[5m])))   # P95
```

---

## §7 总结

### 7.1 5 步走成果

| 步骤 | 内容 | 状态 |
|---|---|---|
| 摸底 | go-zero 各服务 Prometheus 配置 | ✅ 11 个端口都在 host 监听 |
| 修 prometheus.yml | target looklook → host.docker.internal | ✅ v3.33 commit |
| 配 scrape_interval | 默认 1m → 15s | ✅ v3.33 commit |
| 配 Grafana 数据源 | Admin API POST /api/datasources | ✅ |
| 建 Grafana dashboard | ★★手工建 (API 创建有 bug)★★ | ✅ 7 panel |

### 7.2 关键收获

1. **prometheus 抓取规则**: 容器里的 prometheus 抓 host 服务, 必须用 `host.docker.internal`(Docker Desktop 特殊 DNS). 跨容器抓用容器名.
2. **scrape_interval**: 默认 1m 太慢看不出趋势, dev 用 **15s**, 监控自身用 1m,生产环境根据 SLO 选.
3. **Grafana 8.0.6 API bug**: 通过 API 创建的 dashboard 在 panel editor 里显示 datasource 为 `[object Object] - not found`. **手工建 dashboard 是当前最稳做法** (也顺便学真实使用流程).
4. **rate() 算 QPS**: 需要时间窗口内至少 2 个 scrape 数据点, 所以面板刚加载时 QPS 是 0, 要等一个 scrape 周期.
5. **手工建 dashboard 的好处**: 学到 panel 的**字段含义**(Graph mode, Color mode, Unit, Decimals, Legend 等等), 这些 API 创建时一次性写死的字段, 手工建时才知道每个值的作用.

### 7.3 排查清单 (出问题按这个走)

- [ ] prometheus targets 全 up? (Status → Targets)
- [ ] PromQL 查询有数据? (Graph 输入 `up`)
- [ ] 数据源 URL 在容器内能访问? (`curl http://prometheus:9090` 从 grafana 容器内)
- [ ] dashboard 时间范围包含现在? (右上角 Last 30 minutes)
- [ ] panel Data source 选了 Prometheus? (Edit Panel)
- [ ] panel Expression 有数据? (Edit Panel 看绿色 ✅)
- [ ] 最近 5 分钟内有业务流量? (rate 算 QPS 需要新请求)

---

## §8 相关文件路径

```
deploy/prometheus/server/prometheus.yml     ← prometheus 配置
deploy/grafana/                            ← Grafana 配置 (用挂默认镜像, 数据持久化在 data/grafana/data)
data/grafana/data/                         ← Grafana 数据 (dashboard/用户/datasource)

各服务 yaml:
app/order/cmd/api/etc/order.yaml            ← Prometheus Port: 4001
app/order/cmd/rpc/etc/order.yaml            ← Prometheus Port: 4002
app/payment/cmd/api/etc/payment.yaml        ← Prometheus Port: 4004
...
```

---

## §9 相关阅读

- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 3 层架构 + 选型
- [step-13 APISIX/Kong](step-13-apisix-kong.md) — 同章节不同主题
- [step-15 APISIX 实战](step-15-apisix-practice.md) — 配 dashboard /的
- [step-16 APISIX vs KONG 配置复杂度](step-16-apisix-kong-config-complexity.md) — ch 11/12/13 现代替代方案 (LGTM)
- 原始教程 [ch 13-服务监控](doc/chinese/13-服务监控.md)

---

## §10 后续 (ch 12 / ch 11)

ch 13 收尾. 接下来按顺序:
- **step-18: ch 12 链路追踪** (修 jaeger + 改 sampler=1.0, 让 4 个 api 把 trace 发到 jaeger)
- **step-19: ch 11 日志收集** (起 ES/Kibana + 修 go-stash, 让 filebeat 把日志推到 kafka 再到 ES)

---

*创建于 2026-08-11, ch 13 监控完整跑通 (Prometheus 12 target up + Grafana 7 panel 手工建 + QPS/内存/Goroutine 都可视化), v3.33 commit 已 ship*
