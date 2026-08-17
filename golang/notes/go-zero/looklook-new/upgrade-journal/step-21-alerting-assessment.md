# step-21: 告警体系评估 (Alerting System Assessment)

> 日期：2026-08-12
> 状态：📋 评估完成，等待决策后落地
> 范围：基于现有 Prometheus + Grafana + Kibana + ES 栈，给出最小可行告警方案
> 关联：[README §"已知未完成"P3](README.md)、[step-replan §5/ch13](step-replan-2026-08-05.md)、[step-17 ch13 监控](step-17-ch13-monitoring.md)、[step-19 ch11 日志](step-19-ch11-logging.md)

---

## §0 一句话结论

> 本项目当前**不需要上 Alertmanager**。落地"指标+日志告警"的最小成本路径是：
>
> **Grafana Unified Alerting（指标）+ Kibana Rules（日志）双轨，通知统一走 Webhook → 本地 mock server**。
>
> 不引入 Alertmanager 服务，不破坏现有 docker-compose-env.yml。后续如需飞书/邮件，再把 Webhook 换成飞书机器人/邮件网关。

理由见 §5 推荐方案。

---

## §1 现状盘点（已验证）

### 1.1 指标层（Prometheus）

| 项 | 状态 | 来源 |
|---|---|---|
| Prometheus 2.28.1 容器 | ✅ Up | docker-compose-env.yml `prometheus` 服务 |
| 抓取目标数 | 12 个全 up | `prometheus.yml` 12 个 `job_name`（11 service + prom 自己）|
| scrape interval | 15s | `global.scrape_interval: 15s` |
| `rule_files` 段 | ❌ 不存在 | prometheus.yml 未配置 |
| `alerting` 段 | ❌ 不存在 | prometheus.yml 未配置 |
| Alertmanager 服务 | ❌ 未部署 | docker-compose-env.yml 无该容器 |
| `/api/v1/rules` | 应返回空 | 上次会话未现场复核（沙箱无 localhost 权限） |

**已暴露的指标面（来自 step-17 摸底）**：

```
# Go runtime（每个 service 都有）
go_goroutines, go_memstats_alloc_bytes, process_resident_memory_bytes,
process_cpu_seconds_total, go_gc_duration_seconds

# go-zero HTTP server 自动暴露
http_server_requests_code_total{code, method, path}
http_server_requests_duration_ms_sum / _count / _bucket{le=...}

# go-zero RPC server（rpc/mq 自动起）
同名指标，labels 含 rpc method
```

**未暴露的指标（业务层）**：

- ❌ 没有 `trade_state` gauge
- ❌ 没有 `pay_status` gauge
- ❌ 没有 `order_count` / `payment_success_total` 等业务 counter
- ❌ 没有 asynq 队列深度 gauge
- 业务状态目前**只在 MySQL**（`homestay_order.trade_state`、`third_payment.pay_status`）和**业务日志**里

### 1.2 日志层（Kibana + ES）

| 项 | 状态 | 来源 |
|---|---|---|
| Elasticsearch 8.12.2 | ✅ Up | docker-compose-env.yml |
| Kibana 8.12.2 | ✅ Up | `kibana` 服务，端口 5601 |
| Data view | ✅ `looklook-*` | step-19 已建 |
| 索引命名 | `looklook-{yyyy-MM-dd}` | `deploy/go-stash/etc/config.yaml` |
| 字段清洗 | drop + remove_field + transfer message→data | go-stash 配置 |
| Kafka topic | `looklook-log` | filebeat → go-stash |
| 已建规则 | ❌ 0 条 | Kibana Rules 是空的 |
| 已建连接器 | ❌ 0 个 | Kibana Connectors（webhook / 飞书 等） |

**可告警的日志字段**（来自 step-19）：

```
log_type: keyword        # "looklook_business" | "docker_container"
level: keyword           # "info" | "warn" | "error" | ...
message / data: text     # 业务日志正文
http.status_code: long   # 部分中间件日志里有
@timestamp: date
service: keyword         # 各 service 自己注入
```

### 1.3 通知渠道现状

| 项 | 状态 |
|---|---|
| 飞书机器人 webhook | ❌ 无配置（grep 仓库零命中）|
| 钉钉/Slack/邮件 | ❌ 无配置 |
| 内置 mock 接收端 | ❌ 无 |

---

## §2 三条路线对比

### 2.1 路线 A：Prometheus Rule + Alertmanager（传统 Prometheus Stack）

**架构**

```
[go-zero services /metrics]
        ↓ scrape
[Prometheus] -- rule_files/*.yml --> firing alerts
        ↓ send
[Alertmanager] -- route: webhook/email/slack/feishu --> 通知
```

**优点**
- 工业最标准。Kubernetes 生态默认就是这套。
- PromQL 表达式能力最强（rate / histogram_quantile / 滑动窗口）。
- Alertmanager 自带去重、分组、静默、抑制（`inhibit`）、路由分发。
- 与现有 Prometheus 容器天然衔接（Prometheus → Alertmanager 一个 `alerting:` 段）。

**缺点（在本项目语境下）**
- **要新增 1 个容器**（Alertmanager）。docker-compose-env.yml 当前很紧凑（11 中间件 + 11 service），且 Alertmanager 配置需单独管（`alertmanager.yml`）。
- **规则文件要单独维护**：每条 alert 一个 `record:` 或 `alert:` 块，要 reload，要 reload-or-restart。
- **与 Grafana 数据源重叠**：现有 Grafana dashboard 已经在用 PromQL，把告警也写在 Grafana 里就能"一套 UI 管两件事"。
- **指标能力受限于 §1.1**（没有业务指标），能告警的多半是 QPS/延迟/5xx/goroutine——这正是 Grafana alert 也能做的事。

**最小落地成本**（估）

```
新增 deploy/prometheus/rules/looklook.rules.yml          # 规则文件
新增 deploy/prometheus/alertmanager/alertmanager.yml     # AM 配置
修改 deploy/prometheus/server/prometheus.yml             # 加 rule_files + alerting
修改 docker-compose-env.yml                              # +1 alertmanager 服务
docker compose up -d alertmanager                        # 启动
手动触发 / curl 验证                                      # 走通链路
```

### 2.2 路线 B：Grafana Unified Alerting（GA 8.0+ 内置）

**架构**

```
[go-zero services /metrics]
        ↓ scrape
[Prometheus] -- 已有 --
        ↓ query (HTTP datasource)
[Grafana 8.0.6] -- Alert Rules (PromQL) --> firing alerts
        ↓ Contact Points: webhook/email/feishu --> 通知
```

**优点**
- **零新增容器**。Grafana 8.0.6 已经跑着，Unified Alerting 是内置功能（8.0 起 GA）。
- **一套 UI 管理**：在已建好的 7 panel dashboard 旁边直接加 alert rule，复用同一数据源。
- **多数据源**：未来加 ES/Loki/Tempo 数据源后，告警规则也能跨源组合（这正是 Unified Alerting 的卖点）。
- **Notification Policies + Contact Points**：自带分组/路由/静默，不输 Alertmanager（功能上 80% 重合）。
- **配置可导出 JSON**：Alert Rules / Contact Points 都支持 Provisioning（`/etc/grafana/provisioning/alerting/`），纳管可走 Git。

**缺点**
- 8.0.6 是早期 GA 版本，某些 advanced 特性（Image renderer、跨 Grafana 同步）比 9/10 弱。
- 官方文档假设你用 provisioning；手工建 dashboard 时 [step-17 §4.2 已踩过 UI datasource 显示 bug](step-17-ch13-monitoring.md)，alerting UI 同样可能踩坑（待验证）。
- 长期工业认可度：Alertmanager 是事实标准，Grafana alerting 是强力"第二选择"。

**最小落地成本**

```
Grafana UI /provisioning 加几条 alert rules（QPS/5xx/goroutine/mem）
Grafana UI /provisioning 加 1 个 Contact Point（webhook → 本地 mock）
手动 trigger / curl 验证
```

**成本大约是路线 A 的 1/3**（不需要新容器，不需要 prometheus.yml 改动）。

### 2.3 路线 C：Kibana Rules + Connectors（日志告警）

**架构**

```
[go-zero service log file]
        ↓ filebeat
[Kafka] → [go-stash] → [ES looklook-*]
        ↑
[Kibana Rules] -- KQL query on looklook-* --> firing alerts
        ↓ Connectors: webhook/email --> 通知
```

**优点**
- **零新增容器**。Kibana 8.12.2 已经跑着。
- **能告警业务事件**（这是 Prometheus 路线做不到的）：
  - `level: "error" AND log_type: "looklook_business"` → "业务日志有 error"
  - `data: *payment*callback*fail*` → "支付回调失败"
  - `data: *closeOrder*FAIL*` → "关单失败"
  - `data: *kafka*panic*` → "kafka consumer 异常"
- 同样自带 grouping / throttling / action frequency。

**缺点**
- **只能查 ES 索引**（看 looklook-*），看不到 go-zero HTTP metrics。
- **依赖 ES 检索延迟**（5s–30s 级别），QPS/延迟告警不适合放这里（应放 Grafana）。
- **日志告警有"漏报风险"**：如果 filebeat → kafka → go-stash 链路断了，ES 没数据，告警反而**不会触发**（连"无数据"都检测不到）。需要再叠加一条 Kibana meta 规则：`document count in last 5m = 0`。
- 历史日志里 `level: info` 也被刷屏（go-stash 已 drop 一部分，但保留的仍有大量 info），KQL 规则要写准。

**最小落地成本**

```
Kibana Stack Management → Rules → Create rule (ES query, KQL)
Kibana Stack Management → Connectors → Add webhook (mock URL)
手动 trigger 1 条 error 日志 → 验证告警触发
```

**成本与路线 B 相当**（Kibana UI 操作）。

### 2.4 对比总表

| 维度 | A: Prom + AM | B: Grafana Alerting | C: Kibana Rules |
|---|---|---|---|
| 新增容器 | +1 (Alertmanager) | 0 | 0 |
| prometheus.yml 改动 | 加 `rule_files` + `alerting` | 无 | 无 |
| 配置可入 Git | 容易 | 容易（provisioning） | 中（Kibana NDJSON export） |
| 指标告警（QPS/5xx/延迟）| ✅ | ✅ | ❌（要走 ES 衍生指标） |
| 业务日志告警 | ❌（需再走 ELK） | ❌ | ✅ |
| 跨数据源组合 | ❌ | ✅（GA 9+ 强，8.0 弱）| ❌ |
| 通知分组/静默/路由 | ✅ 强 | ✅ 强 | ✅ 中 |
| 工业标准度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 学习价值（教程外）| ⭐⭐⭐⭐⭐（独立组件）| ⭐⭐⭐（Grafana 进阶）| ⭐⭐⭐（Kibana 进阶） |
| 落地工时（估）| 3–4h | 1–2h | 1–2h |
| 长期扩展到 k8s | ✅ 原生 | ✅（可迁） | ✅（可迁） |

---

## §3 本项目能告警什么？(Inventory)

按 §1.1/§1.2 已确认的面，列出"现实可告警"的最小全集：

### 3.1 指标告警（Grafana Alerting 即可）

| 告警名 | PromQL 概要 | 严重度 |
|---|---|---|
| ServiceTargetDown | `up{job=~".*"} == 0` for 2m | critical |
| Service5xxRate | `sum by (job, path) (rate(http_server_requests_code_total{code=~"5.."}[5m])) / sum by (job, path) (rate(http_server_requests_code_total[5m])) > 0.05` for 5m | warning |
| ServiceP95LatencyHigh | `histogram_quantile(0.95, sum by (le, job, path) (rate(http_server_requests_duration_ms_bucket[5m]))) > 1000` for 5m | warning |
| ServiceGoroutineLeak | `go_goroutines > 5000` for 10m | warning |
| ServiceMemoryHigh | `process_resident_memory_bytes > 500 * 1024 * 1024` for 10m | warning |
| ScrapeLagHigh（自监控）| `scrape_duration_seconds{job="prometheus"} > 5` for 5m | info |

### 3.2 日志告警（Kibana Rules）

| 告警名 | KQL 概要 | 严重度 |
|---|---|---|
| BusinessErrorLog | `level: "error" AND log_type: "looklook_business"`（count > 5 / 5m） | warning |
| PaymentCallbackFail | `data: *callback* AND level: "error"`（count >= 1 / 1m）| critical |
| OrderCloseFail | `data: *CloseOrder* AND level: "error"`（count >= 1 / 1m）| critical |
| KafkaConsumerPanic | `data: (*panic* OR *kafka.Consumer.Failed*)`（count >= 1 / 1m）| critical |
| LogPipelineStalled | `count of docs in looklook-* in last 5m == 0` | critical（见 §2.3） |
| ESStoragePressure | `GET _cat/indices?v` 衍生（可选 P2）| info |

### 3.3 **不能**靠现有数据告警的（明确盲区）

- ❌ 业务订单停留在 `trade_state = 0`（未支付）超过 X 分钟（数据在 MySQL，没在 metrics 也没在 log）
- ❌ asynq 任务队列堆积深度（asynqmon 8080 有面板但没暴露 metric）
- ❌ Kafka consumer lag（kafka-ui 8082 有面板但没暴露 metric）

要告警这些，**需要新增代码或新增 exporter**：
- 业务层：在 rpc handler 里 `prometheus.NewGauge(...).Set(float64(trade_state))`（侵入式）
- 基础设施层：asynq_exporter（社区有，Go 写的）+ kafka_exporter（jmx_exporter sidecar）

**本期建议**：不补这些。让"业务状态类"告警通过 Kibana log-based 实现近似（错误日志/失败事件触发）。真正的业务状态监控是后续 P1+。

---

## §4 通知渠道决策

通知渠道和告警引擎解耦。三条路线都支持 webhook/email/Slack/钉钉/飞书等（具体取决于 Contact Point / Alertmanager receiver）。

### 4.1 当前可用选项

| 渠道 | 适用度 | 备注 |
|---|---|---|
| **Webhook → 本地 mock HTTP server** | ⭐⭐⭐⭐⭐（学习用）| 起一个 `python3 -m http.server` 收 POST，看 alert payload 长啥样 |
| 飞书机器人 webhook | ⭐⭐⭐⭐ | 公司/团队最常用；需个人 webhook URL（沙箱外网络）|
| 钉钉机器人 | ⭐⭐⭐ | 同上 |
| 邮件 SMTP | ⭐⭐ | dev 环境没必要 |
| Slack | ⭐⭐ | 团队不在用 |

### 4.2 本期建议

> **落地阶段先用 Webhook → 本地 mock**（零依赖、零外网），把告警链路完整跑通。
> 真实渠道（飞书/钉钉）作为下一步"通知渠道"小迭代，**不与告警引擎耦合**。

**为什么不直接接飞书**：沙箱无外网权限；接外部 webhook 需要用户授予；先把链路打通的优先级高于渠道选型。

---

## §5 推荐方案：双轨最小可行

### 5.1 推荐组合

> **指标 → Grafana Unified Alerting（路线 B）+ 日志 → Kibana Rules（路线 C）+ 通知 → Webhook mock**

### 5.2 推荐理由（按权重）

| 权重 | 论点 |
|---|---|
| ⭐⭐⭐⭐⭐ | **零新增容器**：与现有 11 中间件栈无缝衔接，docker-compose-env.yml 不动 |
| ⭐⭐⭐⭐⭐ | **覆盖 3.1 + 3.2 全部告警面**：指标 + 日志双轨，本项目能告的全都覆盖 |
| ⭐⭐⭐⭐ | **学习价值最大**：Grafana alerting + Kibana rules 都是在现有 UI 上"接着做"，比再起一个独立组件更符合"业务闭环后做可观测延伸"的递进 |
| ⭐⭐⭐⭐ | **可扩展**：未来想迁 Alertmanager，只需把 Grafana 规则导出为 PromQL + AM config（PromQL 表达式一致）|
| ⭐⭐⭐ | **配置可入 Git**：Grafana provisioning（YAML） + Kibana NDJSON export 都支持 |
| ⭐⭐ | **不被 Alertmanager 锁死**：将来上 k8s，可以再起 AM 容器，规则可复用 |

### 5.3 不推荐 Alertmanager 的理由（反向论证）

- 仅 1 个告警用例（指标），多 1 个容器不划算
- 与 Grafana alerting 功能 80% 重叠，二选一即可
- 项目里**没有自定义指标**（§1.1），能告的指标面 Grafana 已能覆盖
- Alertmanager 最大的卖点（k8s 集成）本期用不到（ch 14-15 不做）

### 5.4 推荐落地的最小工时表

| 步骤 | 工时估 | 是否阻塞 |
|---|---|---|
| Grafana provisioning 写 3–4 条 alert rule（指标面 6 条里挑高价值 3 条）| 30 min | — |
| Grafana 加 1 个 Contact Point（webhook → mock server）| 10 min | — |
| Kibana 加 1 个 Connector（webhook → 同一 mock）| 10 min | — |
| Kibana Rules 建 2–3 条日志告警（error 风暴 + payment/order 关键字）| 20 min | — |
| 起本地 mock HTTP server（`nc -lk 9999` 或 `python3 -m http.server`）| 5 min | — |
| 触发验证：手动注入 error 日志 / 临时停掉某个 service 看 target down 告警 | 30 min | — |
| 写告警 SOP（哪里加规则、阈值怎么调）| 30 min | — |
| **小计** | **~2.5h** | — |

不与 dev-e2e.sh 耦合（告警是观测，e2e 是业务）。

### 5.5 触发"立刻告警"的最小验证脚本

```bash
# 1. 起 mock server（另一个终端）
nc -lk 9999

# 2. 触发业务 error 日志（任意 service 加一行）
echo 'level=error msg="KibanaRulesTest001 - closeOrder FAIL"' >> tmp/logs/order-mq.log

# 3. 触发 target down（临时 kill 一个 service）
pkill -INT order-rpc
# 等 2 分钟（Grafana rule 的 `for: 2m`）

# 4. 在 mock server 看 POST 请求 payload
```

---

## §6 落地后产物（如果决定做）

如果用户拍板"做"，将产生：

```
deploy/grafana/provisioning/alerting/
├── rules.yml                  # PromQL 规则 (3-4 条)
└── contact-points.yml         # webhook mock 配置

notes/upgrade-journal/step-22-alerting-implementation.md   # 落地笔记
README.md (更新)               # P3 状态 → ✅ 落地
step-replan (更新)             # § 7 当前决策加一条
```

**不**产生：

- ❌ `deploy/alertmanager/`（暂不起）
- ❌ 修改 `docker-compose-env.yml`
- ❌ 修改 `prometheus.yml`（保持只读 scrape）

---

## §7 决策点（等你拍板）

1. **是否本期落地告警？**
   - 选项 A：按 §5 双轨落地（推荐，~2.5h）
   - 选项 B：只做 Grafana 指标告警（~1h，最小）
   - 选项 C：暂缓告警，把 P1（4d pkg/errors 全量迁移）做完再来
2. **通知渠道**：先用 webhook mock，还是直接给飞书机器人 URL？
3. **告警阈值**：要不要把 §3.1/§3.2 的建议阈值作为初值，还是空着让你按手感调？

> **建议**：选项 A + webhook mock + 用建议阈值作为初值。落地后即可观测到 dev 环境的"日常噪音"（target 偶抖、error 日志偶发），再据此调阈值。

---

## §8 相关阅读

- [step-17 ch 13 监控](step-17-ch13-monitoring.md) — Prometheus + Grafana 7 panel 跑通
- [step-19 ch 11 日志收集](step-19-ch11-logging.md) — filebeat → Kafka → ES → Kibana 链路
- [step-replan §5.5](step-replan-2026-08-05.md) — 服务监控组件选型（Prom+Grafana vs VictoriaMetrics vs Mimir）
- [doc/chinese/13-服务监控.md §3](../chinese/13-服务监控.md) — 教程里"grafana alert 自行整理"原文
- [README.md §"已知未完成"](README.md) — P3 告警条目来源

---

*创建于 2026-08-12，评估完成，待决策后落地。*


---

## §9 实施后真实发现（2026-08-12 补，详见 [step-22](step-22-alerting-implementation.md)）

实施过程推翻/补正了评估的几个关键说法，记录如下。

### 9.1 推翻的说法

| 评估里写的 | 真实情况 | 影响 |
|---|---|---|
| "Grafana 8.0.6 起 Unified Alerting GA" | **错**。8.0.6 是 alpha/beta，需 feature flag；**9.0 才 GA**，11.4 才是默认 UI | step-22 §8.1 |
| "Grafana 11.4 API 创建 alert rule 顺利" | API 实际有 3 个 schema 陷阱：`groups: []` 包装导致 validator 失败；`notificationSettings` 字段被静默忽略；`folderUID` 大小写敏感 | step-22 §4.3, §8.2 |
| "8.0.6 mock-webhook 自动迁移到 11.4" | **错**。孤儿 channel（无 rule 引用）会被 11.4 drop | step-22 §3.3 |

### 9.2 补充的事实

| 项 | 评估时未提及 | 实施发现 |
|---|---|---|
| **默认 Notification Policy** | 没考虑 | Grafana 11.4 默认路由到 `grafana-default-email`（自动建的占位 receiver）；rule 必须改默认 policy 或显式 routing |
| **resolved webhook 速度** | 没测 | firing 后恢复不需要 pending 期，条件一 false 就 resolved → webhook 比 firing 快很多 |
| **mock receiver 选择** | 推荐 `python3 -m http.server` | 实际需要 `BaseHTTPRequestHandler` 才能看到 body；`nc -lk 9999` 只看字节 |
| **docker-compose env 格式** | 没强调 | 同一 `environment:` 块不能 map 风格（`KEY: value`）和 list 风格（`- "KEY=value"`）混用，YAML 解析直接报错 |

### 9.3 评估依然成立的部分

| 评估结论 | 验证情况 |
|---|---|
| Grafana Unified Alerting 是单条指标告警最优选 | ✅ 1m 内端到端跑通，UI/API 都熟 |
| Kibana Rules 是日志告警的另一轨 | 未做（本期范围外）|
| 不引入 Alertmanager | ✅ 验证：内置 Alertmanager 完全够用，0 新容器 |
| 通知走 webhook mock | ✅ payload 已渲染 `title` + `message`，换飞书机器人 URL 即生产 |
| 总工时 ~2.5h 估算 | ✅ 实际 ~2h（含 3 次 UI 误判 + API 调试） |

### 9.4 评估漏掉但应该考虑的事

- **升级前没意识到**：12 scrape target 是纯读 scrape，升级风险接近 0；但**业务 11 个服务（Prometheus target）**和 Grafana 11 个 metric 是两回事，我们升级 Grafana 不影响业务 11 个服务跑在 host 上
- **升级前没意识到**：8.0.6 → 11.4 会执行 **282 个 DB migration**，对开发机瞬间跑完，对生产大 DB 可能要 10+ 分钟
- **升级前没意识到**：Grafana 9+ 默认要求首次登录改密码；要用 `GF_SECURITY_ADMIN_PASSWORD` env 绕过
- **升级前没意识到**：Docker Hub 国内 TLS 不稳；用户已有 mirror 但还要 fallback 重试（这次是 1 次失败后重试成功）

---

## §10 与 step-22 衔接

| step-21 评估 | step-22 实施 |
|---|---|
| §0 推荐 Grafana Alerting + Kibana Rules 双轨 | §3-§5 只做了 Grafana 单轨（最小可行），Kibana Rules 留 §9 TODO |
| §3.1 列出 6 条指标告警 | §4.3 只实现 1 条 mqueue-scheduler-down（其他 5 条留 §9 TODO）|
| §5.5 触发验证脚本 | §5.3 实测时间线 + §5.4 resolved 验证 |
| §6 预期产物 | §7 实际产物清单 |
| §7 决策点 A/B/C | 选了 A（双轨最小可行）+ 通知用 webhook mock + 用建议阈值初值 |

---

*§9-§10 由 step-22 实施后回填，2026-08-12。评估主体仍是路线对比和推荐，落地细节以 step-22 为准。*
