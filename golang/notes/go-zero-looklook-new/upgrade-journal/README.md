# go-zero-looklook 升级日志（upgrade-journal）

> 把 Mikaelemmmm/go-zero-looklook 从 2022-2023 的 v1 状态，升级到 2026 年的现代 Go 微服务栈。
> 一边升级，一边学习。

## 🎯 当前路线（2026-08-05 重新规划）

**新战略**：从"库升级优先"切换到"业务闭环优先"。

完整思路见 **[`step-replan-2026-08-05.md`](step-replan-2026-08-05.md)**。

当前优先级（2026-08-11 更新）：
```
A. 业务闭环（ch 4-8）     ✅ 已闭环     M1-M4 + dev-e2e.sh 回归基线
B. 基础设施贯通（ch 11-13）✅ 已完成     ELK + OTel + Prom 全部跑通（ch 13 含 v3.40 Grafana/Prom 升级 + 告警链路）
C. 纯库升级（4d 等）       🔜 当前 P1    4d 全量迁移（前置已满足）
```

## 已完成清单（history）

| Step | 标题 | 状态 |
|------|------|------|
| 0    | v1 baseline             | ✅ |
| 1    | dev env (11 中间件)     | ✅ |
| 1.5  | JWT 中间件验证          | ✅ |
| 2    | modd → air              | ✅ |
| 2.5  | air 单文件统一          | ✅ |
| 99   | 清理 92M 二进制         | ✅ |
| 4a   | go-zero 1.7.3 → 1.10.2  | ✅ |
| 4b   | jwt v4 → v5             | ⏸️ deferred（go-zero 内部仍 v4）|
| 4c   | go-redis v8 → v9        | ✅（业务通过 go-zero wrapper 已生效）|
| 4d   | pkg/errors → std errors | 🚧 usercenter 试点完成，**全量暂缓**（等业务闭环后做）|
| 99b  | step-05 M1.1-1.6 smoke 全活              | ✅ |
| 99c  | step-06 异步事件深度学习 (api-rpc 链 + asynq + Kafka) | ✅ |
| 99d  | step-07 M2 e2e working doc (跨 5 服务一笔订单) | ✅ (链路通, D 数据待生产化) |
| 99e  | step-08 完整下单流程参考文档 (真实业务 + 模拟对照) | ✅ |
| v3.12 | Kafka Brokers 真实 bug fix (kafka:9092→127.0.0.1:9094) | ✅ |
| 09-16 | 网关学习链 (调研→nginx→鉴权→APISIX 实战→对比) | ✅ (step-09 ~ step-16) |
| 17    | step-17 ch 13 监控 (Prometheus + Grafana) | ✅ v3.33/v3.34 |
| 18    | step-18 ch 12 链路追踪 (Jaeger 1.63 + OTLP) | ✅ v3.35/v3.36 |
| 19    | step-19 ch 11 日志收集 (filebeat→Kafka→go-stash→ES→Kibana) | ✅ v3.37/v3.39 |
| 20    | step-20 M3/M4 关账 + dev-e2e.sh 回归基线 | ✅ 2026-08-11 |
| 21    | step-21 告警体系评估（Grafana Alerting vs Kibana vs AM）| ✅ 2026-08-12 |
| 22    | step-22 告警落地（Grafana 11.4 + Prometheus 2.55.1 升级 + 单条 rule 跑通）| ✅ 2026-08-12 |

## 项目结构

```
go-zero-looklook-study/
├── go-zero-looklook/         # v1 原项目（git clone 下来的基线，只读参照）
└── notes/upgrade-journal/    # 本目录：升级过程的所有记录
    ├── README.md             # 本文件（v2 重写，2026-08-05）
    ├── step-replan-2026-08-05.md   # ⭐ 新战略文档
    ├── step-00-v1-baseline.md
    ├── step-01-env-setup.md
    ├── step-01.5-jwt-validation.md
    ├── step-02-air-trial.md
    ├── step-02.5-air-single-file.md
    ├── step-02.5-air-unified-done.md
    ├── step-03-docker-dev-mode.md        # ⏸️ deferred（M8 评估）
    ├── step-04a-go-zero-upgrade.md
    ├── step-04b-jwt-v5-deferred.md
    ├── step-04c-go-redis-v9-status.md
    ├── step-04d-pkg-errors-migration.md  # 试点完成，全量待业务跑通后
    ├── step-05-business-baseline.md        # M1 working doc (✅ closed)
    ├── step-06-async-event-deep-dive.md    # 异步事件学习
    ├── step-07-m2-e2e.md                   # M2 e2e working doc
    ├── step-08-complete-order-flow.md       # 下单完整流程 (参考文档)
    ├── step-09-gateway-survey.md            # 网关调研
    ├── step-10-nginx-101.md                 # nginx 入门
    ├── step-11-auth-internals.md            # go-zero 鉴权内部机制
    ├── step-12-nginx-auth.md                # nginx 鉴权层级
    ├── step-13-apisix-kong.md               # APISIX / Kong 对比
    ├── step-14-nginx-auth-practice.md       # nginx auth_request 实战
    ├── step-15-apisix-practice.md           # APISIX 实战
    ├── step-16-apisix-kong-config-complexity.md
    ├── step-17-ch13-monitoring.md           # ch 13 监控
    ├── step-18-ch12-tracing.md              # ch 12 链路追踪
    ├── step-19-ch11-logging.md              # ch 11 日志收集
    ├── step-20-m3-m4-e2e-regression.md      # M3/M4 关账 + e2e 回归
    ├── step-06-async-event-deep-dive.md    # 异步事件学习 (api→rpc链 + asynq + Kafka)
    ├── step-99-cleanup-history.md
    ├── progress-day-1.md
    ├── cheatsheet-kafka.md
    ├── compare/                # 升级前后代码对比（待补）
    └── patches/                # 升级用的 diff / 修复文件（待补）
```

## 工作约定

- 所有"动手"操作在 `go-zero-looklook-new/` 目录
- v1 参照读 `go-zero-looklook-study/go-zero-looklook/`（只读，不动）
- 升级决策记录在 `compare/` 和 `patches/` 目录
- 每篇 step 笔记固定格式：目标 / 改动文件 / 关键 diff / 踩坑 / 验证 / 时长
- **真理来源**：`doc/chinese/` 下 15 章教程 + 我们自己的 step 笔记

## 当前状态（2026-08-11, v3.39+）

**最近进展**：
- ch 13 监控 (v3.33/v3.34): Prometheus 12 target + Grafana 7 panel
- ch 12 追踪 (v3.35/v3.36): Jaeger 1.63 + OTLP HTTP，5 服务跨 api→rpc trace
- ch 11 日志 (v3.37/v3.39): filebeat 抓 host 日志 → Kafka → go-stash → ES → Kibana `looklook-*`
- 网关 (v3.24-v3.32): nginx auth_request 实战 + APISIX 实战 + dashboard 修复
- M3/M4 关账: `scripts/dev-e2e.sh` 可重复回归，happy path 8/8 PASS

**当前进度 (ground truth)**：
- 11/11 binary 全活（dev-status 全绿，`usercenter-rpc` 2004/4009 在线）
- 业务闭环: 登录 → 浏览 → 下单 → Kafka 模拟支付 → trade_state 0→1，e2e 脚本可复跑
- 超时关单: defer 任务已验证 enqueue；等待验证需 `CloseOrderTimeMinutes=1` build + `E2E_CLOSE_VERIFY=1`
- 15 章进度: ch 1-8 业务闭环 ✅，ch 11-13 基础设施 ✅，ch 2 网关 ✅，ch 10 待 4d 全量，ch 14-15 未做

**下一步 (P1)**：Step 8 — `pkg/errors → std errors` 全量迁移，用 `dev-e2e.sh` 做回归。
详细规划见 [step-replan-2026-08-05.md](step-replan-2026-08-05.md) § 6/§ 7。

## 已知未完成（按新优先级）

- [ ] **P1**: Step 8 — 4d `pkg/errors` 全量迁移（前置 M1-M4 已满足，用 dev-e2e.sh 回归）
- [ ] **P2**: 超时关单等待验证（需临时改 `CloseOrderTimeMinutes=1` + `E2E_CLOSE_VERIFY=1`）
- [ ] **P2**: jwt v5 / asynq 升级（free-floating）
- [ ] **P2**: 全 docker dev 模式评估（deferred，M8）
- [x] **P3**: 指标告警（Grafana 11.4 + webhook mock，✅ v3.40，详见 [step-22](step-22-alerting-implementation.md)）；日志告警（Kibana Rules）暂缓
- [ ] **P3**: 生产部署 ch 14-15（本期大概率跳过）

## git 状态

```
$ git log --oneline -5
62056d0 v3.39: docs - step-19 重新整理为标准 markdown 格式
2af7a29 v3.38: docs - step-19 ch 11 日志收集完整笔记 (349 行)
b0dfaf5 v3.37: ch 11 日志收集 (filebeat 抓 host 业务日志)
83de29c v3.36: docs - step-18 ch 12 链路追踪完整笔记 (503 行)
8ad692e v3.35: ch 12 链路追踪 (jaeger 1.63 + OTLP)
...
```

---

*此 README 在 2026-08-05 重写，从"线性 Step 1-5"切换到"3 层视角 (A/B/C)"；2026-08-11 更新到 v3.39+ 状态。*
*老 step 笔记全部保留作为历史，未删除任何内容。*
