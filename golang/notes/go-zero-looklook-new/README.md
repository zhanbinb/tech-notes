# go-zero-looklook-new（2026 升级版）· 项目笔记归档

> 来源仓库：[zhanbinb/go-zero-looklook-new](https://github.com/zhanbinb/go-zero-looklook-new)（本地路径 `~/Develop/web3/study/codex_project/go-project/go-zero-looklook-new`）
>
> 业务基线：[Mikaelemmmm/go-zero-looklook](https://github.com/Mikaelemmmm/go-zero-looklook)（社区经典民宿短租 demo，go-zero 全家桶实战）
>
> 升级方向：把 2022–2023 的 v1 状态（Go 1.22 / go-zero 1.7.3 / Grafana 8 / modd / DTM）整体升到 2026 现代 Go 微服务栈（Go 1.24 / go-zero 1.10.2 / Grafana 11.4 / air / asynq+kq），同时把可观测性从"指标+日志+Trace"补到"指标+日志+Trace+告警"四件套闭环。

本目录是该项目**全部历史笔记与教程参考**的镜像归档，按主题分为两个子目录：

| 子目录 | 内容 | 文件数 | 角色 |
|---|---|---:|---|
| [`upgrade-journal/`](upgrade-journal/) | 升级过程 step-by-step 笔记（v3.0 → v3.41）| 37（含 compare/、patches/、5 篇 support）| 我们的学习产出（**主**）|
| [`doc-chinese/`](doc-chinese/) | go-zero-looklook 官方中文教程 15 章 | 15 + images/ | 真理来源（**辅**）|

---

## 1. 核心结论 / TL;DR

- **现代 Go 微服务栈** ≈ Go 1.24 + go-zero 1.10.2 + go-redis v9 + kafka 3.9 + MySQL 8 + ES 8 + Prometheus 2.55 + Grafana 11.4 + Jaeger 1.63 + Kibana 8 + air 热重载 + 容器化全部中间件
- **业务闭环 5 服务**：order / payment / travel / usercenter / mqueue，对应 **11 个 binary**（api × 4 + rpc × 4 + mq × 3）
- **可观测四件套**：metrics（Prom + Grafana 7 panel）+ logs（filebeat→kafka→go-stash→ES→Kibana）+ traces（OTel SDK + Jaeger OTLP HTTP）+ alerts（Grafana 11.4 Alerting + Alertmanager mock）—— **每一件都端到端跑通且互相印证**
- **多协议网关**：nginx `auth_request`（默认方案）+ APISIX（已实战对比） + Kong（调研过） + Envoy / Higress（未上）
- **混合消息队列**：Kafka 流式（`kq`） + asynq 延迟 / 定时（基于 Redis） + go-zero 自带 mq 服务组

## 2. 升级路径全景（22 篇 step + 4 篇 support）

```
v1 (2022)  ─►  v2 (库升)  ─►  v3 (业务闭环 + 基础设施)
                                    │
Step 0~2   Step 4a~4d        Step 5~8        Step 9~16       Step 17~22
v1 baseline air/docker       M1~M4           网关            可观测
go.mod 摸底 dev 模式          业务闭环         nginx→APISIX    监控→追踪→
                                                            日志→告警
```

### 阶段 A — 业务闭环（ch 4–8，P0 → ✅ 已闭环）

| Step | 文件 | 主题 | 状态 |
|------|------|------|------|
| 5    | [step-05-business-baseline.md](upgrade-journal/step-05-business-baseline.md) | M1：11 个 binary 全活 | ✅ |
| 6    | [step-06-async-event-deep-dive.md](upgrade-journal/step-06-async-event-deep-dive.md) | 异步事件（api→rpc 链 + asynq + kafka）深度学习 | ✅ |
| 7    | [step-07-m2-e2e.md](upgrade-journal/step-07-m2-e2e.md) | M2：跨 5 服务一笔订单 e2e | ✅ |
| 8    | [step-08-complete-order-flow.md](upgrade-journal/step-08-complete-order-flow.md) | 完整下单流程（真实业务 + 模拟对照） | ✅ |
| 20   | [step-20-m3-m4-e2e-regression.md](upgrade-journal/step-20-m3-m4-e2e-regression.md) | M3/M4 关账 + dev-e2e.sh 回归基线 | ✅ |

### 阶段 B — 基础设施贯通（ch 11–13，P1 → ✅ 已完成）

| Step | 文件 | 主题 | 状态 |
|------|------|------|------|
| 17   | [step-17-ch13-monitoring.md](upgrade-journal/step-17-ch13-monitoring.md) | ch 13：Prometheus 12 target + Grafana 7 panel | ✅ |
| 18   | [step-18-ch12-tracing.md](upgrade-journal/step-18-ch12-tracing.md) | ch 12：Jaeger 1.63 + OTLP HTTP 跨服务 trace | ✅ |
| 19   | [step-19-ch11-logging.md](upgrade-journal/step-19-ch11-logging.md) | ch 11：filebeat→kafka→go-stash→ES→Kibana | ✅ |
| 21   | [step-21-alerting-assessment.md](upgrade-journal/step-21-alerting-assessment.md) | 告警体系评估（4 方案对比） | ✅ |
| 22   | [step-22-alerting-implementation.md](upgrade-journal/step-22-alerting-implementation.md) | Grafana 11.4 + Prom 2.55.1 升级 + 单条 rule 跑通 | ✅ |

### 阶段 C — 网关（ch 2，P1 → ✅ 已完成）

| Step | 文件 | 主题 | 状态 |
|------|------|------|------|
| 9    | [step-09-gateway-survey.md](upgrade-journal/step-09-gateway-survey.md) | 网关选型调研（nginx / APISIX / Kong） | ✅ |
| 10   | [step-10-nginx-101.md](upgrade-journal/step-10-nginx-101.md) | nginx 入门 | ✅ |
| 11   | [step-11-auth-internals.md](upgrade-journal/step-11-auth-internals.md) | go-zero 鉴权内部机制 | ✅ |
| 12   | [step-12-nginx-auth.md](upgrade-journal/step-12-nginx-auth.md) | nginx 鉴权层级 | ✅ |
| 13   | [step-13-apisix-kong.md](upgrade-journal/step-13-apisix-kong.md) | APISIX / Kong 对比 | ✅ |
| 14   | [step-14-nginx-auth-practice.md](upgrade-journal/step-14-nginx-auth-practice.md) | nginx auth_request 实战 | ✅ |
| 15   | [step-15-apisix-practice.md](upgrade-journal/step-15-apisix-practice.md) | APISIX 实战 | ✅ |
| 16   | [step-16-apisix-kong-config-complexity.md](upgrade-journal/step-16-apisix-kong-config-complexity.md) | APISIX / Kong 配置复杂度 | ✅ |

### 阶段 D — 库升级（4a~4d，P2）

| Step | 文件 | 主题 | 状态 |
|------|------|------|------|
| 0    | [step-00-v1-baseline.md](upgrade-journal/step-00-v1-baseline.md) | v1 现状摸底 | ✅ |
| 1    | [step-01-env-setup.md](upgrade-journal/step-01-env-setup.md) | 11 中间件 dev 环境 | ✅ |
| 1.5  | [step-01.5-jwt-validation.md](upgrade-journal/step-01.5-jwt-validation.md) | JWT 中间件验证 | ✅ |
| 2    | [step-02-air-trial.md](upgrade-journal/step-02-air-trial.md) | modd → air 试用 | ✅ |
| 2.5  | [step-02.5-air-single-file.md](upgrade-journal/step-02.5-air-single-file.md) | air 单文件统一（失败尝试） | ✅ |
| 2.5' | [step-02.5-air-unified-done.md](upgrade-journal/step-02.5-air-unified-done.md) | air 单文件统一（终版） | ✅ |
| 3    | [step-03-docker-dev-mode.md](upgrade-journal/step-03-docker-dev-mode.md) | 全 docker dev 模式（M8 deferred） | ⏸️ |
| 4a   | [step-04a-go-zero-upgrade.md](upgrade-journal/step-04a-go-zero-upgrade.md) | go-zero 1.7.3 → 1.10.2 | ✅ |
| 4b   | [step-04b-jwt-v5-deferred.md](upgrade-journal/step-04b-jwt-v5-deferred.md) | jwt v4 → v5（go-zero 内部仍 v4，deferred） | ⏸️ |
| 4c   | [step-04c-go-redis-v9-status.md](upgrade-journal/step-04c-go-redis-v9-status.md) | go-redis v8 → v9（通过 wrapper 已生效） | ✅ |
| 4d   | [step-04d-pkg-errors-migration.md](upgrade-journal/step-04d-pkg-errors-migration.md) | pkg/errors → std errors（试点完成，全量 P1） | 🚧 |
| 99   | [step-99-cleanup-history.md](upgrade-journal/step-99-cleanup-history.md) | 清理 92M 二进制 | ✅ |

### 支持性笔记

| 文件 | 用途 |
|------|------|
| [step-replan-2026-08-05.md](upgrade-journal/step-replan-2026-08-05.md) | ⭐ **新战略文档**：从"库升级优先"切换到"业务闭环优先" |
| [progress-day-1.md](upgrade-journal/progress-day-1.md) | 第 1 天进度 snapshot |
| [component-upgrade-candidates.md](upgrade-journal/component-upgrade-candidates.md) | 组件升级候选清单（边做边观察） |
| [cheatsheet-kafka.md](upgrade-journal/cheatsheet-kafka.md) | kafka 常用命令速查 |
| [README.md](upgrade-journal/README.md) | upgrade-journal 目录的原始 README（保留作 history）|

---

## 3. 教程参考（doc-chinese/，15 章）

来自官方仓库 [`Mikaelemmmm/go-zero-looklook`](https://github.com/Mikaelemmmm/go-zero-looklook) 的中文教程，每章对应一项关注点：

| 章节 | 文件 | 主题 | 在本项目中的状态 |
|------|------|------|---|
| 01 | [01-开发环境搭建.md](doc-chinese/01-开发环境搭建.md) | docker compose dev 环境 | ✅ Step 1 |
| 02 | [02-nginx网关.md](doc-chinese/02-nginx网关.md) | nginx 网关 | ✅ Step 9~16 |
| 03 | [03-鉴权服务.md](doc-chinese/03-鉴权服务.md) | JWT 鉴权 | ✅ Step 1.5 + 11 |
| 04 | [04-用户服务.md](doc-chinese/04-用户服务.md) | usercenter | ✅ M1 |
| 05 | [05-民宿服务.md](doc-chinese/05-民宿服务.md) | travel | ✅ M1 |
| 06 | [06-订单服务.md](doc-chinese/06-订单服务.md) | order | ✅ M1 + M2 |
| 07 | [07-支付服务.md](doc-chinese/07-支付服务.md) | payment（微信支付） | ✅ M1（Kakfa Brokers 已修）|
| 08 | [08-消息-延迟-定时队列.md](doc-chinese/08-消息-延迟-定时队列.md) | kafka + asynq | ✅ Step 6 + 8 |
| 09 | [09-分布式事务.md](doc-chinese/09-分布式事务.md) | DTM（本项目不用）| N/A |
| 10 | [10-错误处理.md](doc-chinese/10-错误处理.md) | xerr 统一错误处理 | 🚧 Step 4d 全量待做 |
| 11 | [11-日志收集.md](doc-chinese/11-日志收集.md) | filebeat→kafka→ES→Kibana | ✅ Step 19 |
| 12 | [12-链路追踪.md](doc-chinese/12-链路追踪.md) | OpenTelemetry + Jaeger | ✅ Step 18 |
| 13 | [13-服务监控.md](doc-chinese/13-服务监控.md) | Prometheus + Grafana | ✅ Step 17 |
| 14 | [14-部署环境搭建.md](doc-chinese/14-部署环境搭建.md) | gitlab+jenkins+harbor+k8s | ❌ 本期不做 |
| 15 | [15-发布服务到k8s.md](doc-chinese/15-发布服务到k8s.md) | jenkins pipeline | ❌ 依赖 14 |

> **优先级说明**：教程本身的逻辑是 "业务 → 监控 → 部署"。本项目按"业务闭环 → 基础设施 → 库升级"重排（见 `upgrade-journal/step-replan-2026-08-05.md`），因为没有业务跑通做"被迁移方"时，升级只是在打空靶。

---

## 4. 阅读建议

### 第一次接触本项目

按下面顺序读 4 篇就能把握全貌：

1. [upgrade-journal/README.md](upgrade-journal/README.md) — 项目当前状态 & 完成度
2. [upgrade-journal/step-replan-2026-08-05.md](upgrade-journal/step-replan-2026-08-05.md) — 为什么按业务闭环优先而不是库升级优先
3. [upgrade-journal/step-08-complete-order-flow.md](upgrade-journal/step-08-complete-order-flow.md) — 真实下单业务流程图（最直观）
4. [upgrade-journal/step-17-ch13-monitoring.md](upgrade-journal/step-17-ch13-monitoring.md) — 可观测性基础设施全貌

### 想复现本项目

```
git clone https://github.com/zhanbinb/go-zero-looklook-new.git
cd go-zero-looklook-new
./scripts/dev-build.sh     # build 11 binary
./scripts/dev-up.sh        # 启 11 服务 + 中间件
./scripts/dev-e2e.sh       # happy path 8/8 回归
```

### 想学某个具体主题

| 你想学 | 直接读 |
|--------|--------|
| go-zero 业务闭环（民宿→下单→支付→关单）| step-05 ~ step-08 + step-20 |
| Kafka + asynq 异步事件 | step-06 + step-08 + cheatsheet-kafka.md |
| 多服务 e2e + 回归脚本 | step-07 + step-08 + step-20 |
| nginx 网关鉴权 | step-09 ~ step-12 + step-14 |
| APISIX / Kong 网关对比 | step-13 + step-15 + step-16 |
| Prometheus + Grafana 监控 | step-17 |
| OpenTelemetry + Jaeger 链路追踪 | step-18 |
| ELK 日志收集 | step-19 |
| Grafana 11 + Prom 2.55 告警落地 | step-21 + step-22 |
| 库升级（go.mod / api / pkg/errors）| step-00 + step-04a~4d |

### 想看官方教程

读 [doc-chinese/](doc-chinese/) 对应章节；本仓库的 step 笔记是"对照 v1 升级到 v3"的实战视角，doc-chinese 是 v1 的原始设计。

---

## 5. 关键脚本 / 命令速查

### 一键启动与回归

```bash
# build 全部 11 个 binary（首次或更新后必跑）
./scripts/dev-build.sh

# 起 11 个服务 + 11 个中间件
./scripts/dev-up.sh

# 跑端到端 happy path 回归（8/8 PASS）
./scripts/dev-e2e.sh

# 查看所有服务端口 / 进程状态
./scripts/dev-status.sh

# 一键关停
./scripts/dev-down.sh
```

### Kafka 调试（cheatsheet-kafka.md）

```bash
docker exec -it kafka /bin/sh
kafka-topics.sh --list --bootstrap-server localhost:9094
kafka-console-consumer.sh --bootstrap-server localhost:9094 \
  --topic payment-update-paystatus-topic --from-beginning
```

### 关键日志路径

- 服务日志 → `./tmp/logs/<service>.log`
- 中间件数据 → `./data/<service>/`（MySQL / Kafka / Redis / Prometheus / Grafana / ES 全本地化）
- Prometheus → `http://localhost:9090`（12 个 target）
- Grafana → `http://localhost:3000`（admin / admin，7 个 panel）
- Jaeger UI → `http://localhost:16686`
- Kibana → `http://localhost:5601`（索引 `looklook-*`）

---

## 6. 相关链接

- 项目 GitHub：https://github.com/zhanbinb/go-zero-looklook-new
- 业务基线：https://github.com/Mikaelemmmm/go-zero-looklook
- go-zero 官方：https://go-zero.dev
- 父目录：[`../go-zero/README.md`](../go-zero/README.md) · [`../go-zero/02-etcd-service-discovery.md`](../go-zero/02-etcd-service-discovery.md)

---

#go-zero #go-microservice #observability #upgrade-journal #devops
