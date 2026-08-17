# step-22: 告警体系落地 (Alerting Implementation)

> 日期：2026-08-12
> 状态：✅ **端到端跑通**（firing + resolved 两条 webhook 都收到）
> 关联：[step-21 评估](step-21-alerting-assessment.md) / [step-replan §7](step-replan-2026-08-05.md) / [README P3](README.md)

---

## §0 一句话结论

> **Grafana 8.0.6 → 11.4.0 + Prometheus 2.28.1 → 2.55.1 双双升级（零业务破坏），基于 11.4 Unified Alerting 跑通单条指标告警链路，webhook → 本地 mock 收到 firing + resolved 两条 payload。**

总耗时 ~2 小时（含 3 次 UI 误判 + API schema 调试）。端到端 demo 可在 6-7 分钟内复现。

---

## §1 起点

承接 step-21 评估笔记，结论是「Grafana 11 + Prometheus 2.50+ 双升级后再上告警」。当时实际状态：

| 组件 | 版本 |
|---|---|
| Grafana | 8.0.6（legacy alerting，UI 已被踩坑 3 次）|
| Prometheus | 2.28.1 |
| 告警链路 | 0 条 rule / 0 个 contact point / 0 个 notification policy |
| mock-webhook | 8.0.6 时建过，被 11.4 当 orphan drop 掉 |

---

## §2 升级决策

### 2.1 为什么升级而不是留着 8.0.6

| 路线 | 评估 |
|---|---|
| 留 8.0.6 + 用 API 建 rule | 8.0.6 legacy alerting 的 alert rule 必须在 dashboard panel 里建，UI 路径绕；API 在 8.0.6 schema 也不稳 |
| 升 11.4 + Unified Alerting | 11.4 是真正的现代化告警，UI/API 我都熟，provisioning as-code 稳，**顺便把 component-upgrade-candidates ch 13 的 P3 候选升级一起做掉** |

走第二条。

### 2.2 选版本

| 组件 | 目标版本 | 理由 |
|---|---|---|
| Grafana | 11.4.0 | Unified Alerting GA 2 年+，稳定；我对 11.4 UI/API 都很熟 |
| Prometheus | 2.55.1 | 2.50+ 有新 PromQL 函数；2.55 LTS；Go 1.23.2 |
| 其他 | 不动 | Kibana 8.12.2 / ES 8.12.2 / Kafka 3.9.0 / Jaeger 1.63 都已是 2026 主流 |

---

## §3 升级操作

### 3.1 改 `docker-compose-env.yml`

```diff
- prom/prometheus:v2.28.1
+ prom/prometheus:v2.55.1

- grafana/grafana:8.0.6
+ grafana/grafana:11.4.0
```

Grafana service 的 `environment:` 增加（避免 9+ 默认首次登录改密码）：

```yaml
GF_SECURITY_ADMIN_PASSWORD: admin
GF_USERS_ALLOW_SIGN_UP: "false"
```

> ⚠️ **坑**：docker-compose `environment:` 是 map 风格时不能混入 list 风格（`- KEY=value`），YAML 解析会报 `did not find expected key`。已写成 `KEY: value`（map）保持一致。

### 3.2 拉镜像 + 重启

```bash
docker compose -f docker-compose-env.yml pull prometheus grafana
docker compose -f docker-compose-env.yml up -d prometheus grafana
```

镜像大小：

| 镜像 | 大小 |
|---|---|
| grafana/grafana:11.4.0 | 486MB |
| prom/prometheus:v2.55.1 | 290MB |

### 3.3 升级后验证

| 项 | 结果 |
|---|---|
| Grafana `database: ok` | ✅ 282 个 DB migration 自动跑 |
| Grafana `version: 11.4.0` | ✅ commit b58701869e1a |
| Prometheus `version: 2.55.1` | ✅ Go 1.23.2 |
| 12 scrape target | ✅ 全部仍 up（无破坏）|
| Datasource `Prometheus` (uid 9_I6klyDk) | ✅ 自动保留 |
| Dashboard "looklook go-zero (manual fix)" 7 panel | ✅ 自动保留 |
| 旧 `mock-webhook` 通知渠道 | ⚠️ **被 orphan drop**（无 rule 引用 → 11.4 不迁移） |

---

## §4 告警链路搭建

### 4.1 Contact Point（通知渠道）

通过 UI 在 11.4 建：

| 字段 | 填什么 |
|---|---|
| Name | `mock-webhook` |
| Integration | `webhook` |
| URL | `http://host.docker.internal:9999/` |

> 🔑 **`host.docker.internal`** 是 Docker Desktop 给的特殊 DNS，从 Grafana 容器内访问 host 上的 mock receiver 必须用这个。

通过 Test 按钮验证：Terminal A 收到一条测试 payload，证明容器→host 反向打通。

### 4.2 Notification Policy（路由策略）

**默认 policy 把 receiver 从 `grafana-default-email` 改成 `mock-webhook`**：

```bash
curl -s -u admin:admin -X PUT "http://127.0.0.1:3001/api/v1/provisioning/policies" \
  -H 'Content-Type: application/json' \
  -d '{
    "receiver": "mock-webhook",
    "group_by": ["grafana_folder", "alertname"],
    "group_wait": "10s",
    "group_interval": "1m",
    "repeat_interval": "4h"
  }'
```

> 💡 **为什么改默认而不是给 rule 设 `notificationSettings`**：Grafana 11.4 的 `notificationSettings` 字段在 API 创建/更新时**会被静默忽略**（UI 设的能存，API 不存）。改默认 policy 是最干净的做法。

### 4.3 Alert Rule（告警规则）

**通过 API 创建**（11.4 schema 关键发现：POST 用**扁平结构**，不要 `groups: []` 包装）：

```json
{
  "orgID": 1,
  "folderUID": "looklook",
  "ruleGroup": "looklook-services",
  "title": "mqueue-scheduler-down",
  "condition": "C",
  "data": [
    {
      "refId": "A",
      "datasourceUid": "9_I6klyDk",
      "model": {
        "refId": "A",
        "editorMode": "code",
        "expr": "up{job=\"mqueue-scheduler\"}",
        "instant": true,
        "intervalMs": 1000,
        "maxDataPoints": 43200
      }
    },
    {
      "refId": "B",
      "datasourceUid": "__expr__",
      "model": {"type":"reduce","refId":"B","expression":"A","reducer":"last"}
    },
    {
      "refId": "C",
      "datasourceUid": "__expr__",
      "model": {
        "type":"threshold","refId":"C","expression":"B",
        "conditions":[{
          "type":"query",
          "evaluator":{"type":"lt","params":[1]},
          "operator":{"type":"and"},
          "query":{"params":["B"]},
          "reducer":{"type":"last","params":[]}
        }]
      }
    }
  ],
  "noDataState": "OK",
  "execErrState": "Error",
  "for": "1m",
  "annotations": {
    "summary": "🔥 mqueue-scheduler is DOWN",
    "description": "Prometheus up=0 for >1m"
  },
  "labels": {"severity": "critical", "service": "mqueue-scheduler"},
  "isPaused": false
}
```

> ⚠️ **schema 陷阱**：
> - **不要**用 `groups: [{...}]` 包装（会被 validator 报 `folderUID must be set`）
> - **不要**试图 PUT 更新 `notificationSettings` 字段（API 会忽略）
> - `folderUID` / `orgID` / `ruleGroup` 字段名是**大写 D/ID**，Go json tag 决定了大小写敏感

---

## §5 触发 + 验证

### 5.1 mock receiver 启动

Terminal A（保持开着）：

```bash
python3 -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode()
        print('====== WEBHOOK 收到 ======', flush=True)
        print('时间:', __import__('datetime').datetime.now().isoformat(timespec='seconds'))
        print('路径:', self.path)
        print('请求体:', body)
        print('=========================', flush=True)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 9999), H).serve_forever()
"
```

### 5.2 触发 firing

Terminal B 杀进程：

```bash
kill 501  # mqueue-scheduler 的 pid
```

### 5.3 实测时间线

| t (s) | 事件 | 验证方式 |
|---|---|---|
| 0 | kill mqueue-scheduler | `ps` 看不到进程 |
| 15 | Prometheus 下次 scrape | `curl :9090/api/v1/query?query=up` → `mqueue-scheduler = 0` |
| 30 | Grafana 第 1 次评估 | rule state = pending（API 仍报 active=0）|
| 60 | pending 1m 满足 | rule state = firing |
| ~75 | alertmanager 派发 webhook | Terminal A 打印 payload，`status: firing` |
| **kill + 75s** | **完整告警链路确认** | Terminal A 有 printing |

### 5.4 触发 resolved

Terminal B 重启进程：

```bash
./tmp/mqueue-scheduler -f ./app/mqueue/cmd/scheduler/etc/mqueue.yaml &
```

实测：

| t (s) | 事件 |
|---|---|
| 0 | restart |
| 15 | Prometheus scrape → up=1 |
| ~30 | rule eval：条件 `1<1` = false → resolved（**无需 pending 期**）|
| ~30 | alertmanager 派发 resolved webhook |

Terminal A 收到 `status: "resolved"` 的 payload（比 firing 快很多，**resolve 不需要 pending**）。

---

## §6 webhook payload（生产可用格式）

firing payload 关键字段（实测）：

```json
{
  "receiver": "mock-webhook",
  "status": "firing",
  "alerts": [{
    "status": "firing",
    "labels": {
      "alertname": "mqueue-scheduler-down",
      "app": "mqueue-scheduler",
      "env": "dev",
      "grafana_folder": "looklook",
      "instance": "host.docker.internal:4011",
      "job": "mqueue-scheduler",
      "service": "mqueue-scheduler",
      "severity": "critical"
    },
    "annotations": {
      "summary": "🔥 mqueue-scheduler is DOWN",
      "description": "Prometheus up=0 for >1m"
    },
    "startsAt": "2026-08-12T13:45:50+08:00",
    "generatorURL": "http://localhost:3000/alerting/grafana/ffuxicjbuc268d/view?orgId=1",
    "silenceURL": "http://localhost:3000/alerting/silence/new?...",
    "values": {"A":0,"B":0,"C":1}
  }],
  "title": "[FIRING:1] mqueue-scheduler-down looklook (...)",
  "message": "**Firing**\n\nValue: A=0, B=0, C=1\nLabels:\n - alertname = mqueue-scheduler-down\n...\nSource: http://...\nSilence: http://...",
  "externalURL": "http://localhost:3000/",
  "version": "1"
}
```

> ✅ **`title` + `message` 已经渲染好**，直接拿去当飞书/钉钉 webhook 的标题和正文就能用。
> ✅ **`Silence URL`** 是 Grafana 自动生成的静默链接，发到群里值班同学能直接点。

---

## §7 落地产物清单

| 路径 | 状态 | 内容 |
|---|---|---|
| `docker-compose-env.yml` | ✅ 已 commit-ready | grafana 11.4.0, prometheus 2.55.1, GF_SECURITY_ADMIN_PASSWORD |
| `notes/upgrade-journal/step-22-alerting-implementation.md` | 📝 本文档 | 完整落地日志 |
| `notes/upgrade-journal/step-21-alerting-assessment.md` | 📝 同步更新 | 评估结论 + 真实发现 + 修正项 |
| Grafana DB（`data/grafana/data/`）| ✅ 持久化 | datasource + dashboard + 1 contact point + 1 notification policy + 1 alert rule |
| Prometheus TSDB（`data/prometheus/data/`）| ✅ 持久化 | 12 个 target 的历史指标 |

---

## §8 踩过的坑（避坑指南）

### 8.1 Grafana 8.0.6 vs 11.4

| 旧印象 | 真实情况 |
|---|---|
| "8.0.6 = legacy alerting 已死" | **8.0.6 legacy UI 仍能跑 alert rules 列表，但创建必须在 dashboard panel 里，UI 路径诡异** |
| "Unified Alerting 8.0 起 GA" | **错**。8.0 引入是 alpha/beta，需要 feature flag；**9.0 才 GA**。11.4 是默认 UI |
| "Contact points 9.0+ 才有" | 对，11.4 用 contact points，8.0.6 legacy 用 notification channels |

### 8.2 11.4 API schema 陷阱

| 看到的错误 | 真相 |
|---|---|
| `folderUID must be set` 用 `groups: [{folder: "..."}]` 包装 | 错。**POST 用扁平结构**，不要 `groups: []` 包装 |
| `notificationSettings: None` 用 PUT 更新 | 错。**API 创建/更新时该字段被静默忽略**，要走默认 Notification Policy 兜底 |
| `folderUID` 还是 `folderUid` | 都行（Go json tag case-insensitive），但 GET 输出的是 `folderUID`（大写 D）|

### 8.3 docker-compose env 格式

| 写法 | 是否合法 |
|---|---|
| `TZ: Asia/Shanghai`（map 风格）| ✅ |
| `TZ=Asia/Shanghai`（list 风格 `- "..."`）| ✅（但要全部用 list 风格）|
| 同一个 `environment:` 块混用 | ❌ YAML 解析报 `did not find expected key` |

### 8.4 mock receiver 部署

`nc -lk 9999` 能收到字节但看不到 body。**用 Python `BaseHTTPRequestHandler`**（本笔记 §5.1），能看到完整 JSON payload，调试必备。

---

## §9 生产化路径（TODO）

1. **真通知渠道**：把 `mock-webhook` 的 URL 换成飞书/钉钉机器人 webhook（payload 不用改）
2. **更多 rule**：把 §3 的 alert rule 模板套到其他 10 个 service（order-api / payment-api / 等）
3. **日志告警**：route B 的另一轨（Kibana Rules），覆盖业务错误日志
4. **SLO 告警**：用 `histogram_quantile` 告警 P95/P99 延迟（`http_server_requests_duration_ms_bucket`）
5. **asynq / Kafka exporter**：业务指标面（trade_state / queue depth / consumer lag）
6. **provisioning 入 git**：把 §4.3 的 alert rule JSON 写到 `deploy/grafana/provisioning/alerting/`，挂载到容器，`docker compose restart grafana` 自动加载
7. **静默 / 抑制规则**：用 Silences + Inhibition rule 避免重复打扰
8. **值班轮值**：oncall 路由（PagerDuty / 飞书 oncall）

---

## §10 相关阅读

- [step-21 评估笔记](step-21-alerting-assessment.md) — 评估三条路线对比
- [step-replan §5.5](step-replan-2026-08-05.md) — 服务监控组件选型
- [step-17 ch 13 监控](step-17-ch13-monitoring.md) — Grafana 7 panel + Prometheus 12 target 起头
- [step-19 ch 11 日志](step-19-ch11-logging.md) — Kibana Rules 路线（route B 的另一轨）
- 原始教程 [doc/chinese/13-服务监控.md](../chinese/13-服务监控.md) — 教程里 "grafana alert 自行整理" 原文（我们做的就是这一步）
- [README §"已知未完成"](README.md) — P3 告警条目现状

---

*创建于 2026-08-12，Grafana 11.4.0 + Prometheus v2.55.1 升级后落地单条指标告警，firing + resolved 双链路验证，~2h 总耗时。*
