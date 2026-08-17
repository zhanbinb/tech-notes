# 组件升级候选清单（Component Upgrade Candidates Register）

> 日期：2026-08-05 开始  
> 目的：边做边观察 go-zero-looklook 教程里的"旧组件"在 2026 年是否值得换成现代等价物  
> 用法：每接触到一个新组件，先看这里有没有"候选"，没的话就再加一行  
> 关联：`step-replan-2026-08-05.md` 第 5 节（详细版）

## 表格（按接触时间顺序排列）

### ② 网关 ch 2
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **nginx + auth_request** | ⭐⭐⭐⭐ | 当前 | 现成 `deploy/nginx/conf.d/looklook-gateway.conf` |
| APISIX | ⭐⭐⭐⭐⭐ | ✅ 已实战 | v3.26-v3.32: 4 upstream + 7 route + dashboard 修复；当前与 nginx 对照 |
| Kong | ⭐⭐⭐ | 不优先 | OpenResty 调试链不顺 |
| Higress | ⭐⭐⭐ | 不优先 | 阿里体系 |
| Traefik | ⭐⭐⭐⭐ | 不优先 | k8s 友好，单机可省事 |

### ⑤ 队列 ch 8 — 延迟/定时
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **asynq**（现）| ⭐⭐⭐⭐ | 当前 | Redis 后端，简单 |
| River | ⭐⭐⭐⭐ | 备选 | Postgres 后端，同库搞定，类型安全 |
| Machinery | ⭐⭐ | 不优先 | 老牌，代码复杂 |

### ⑧ 队列 ch 8 — 消息流
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **go-queue kq**（现）| ⭐⭐⭐ | 当前 | kafka 包装，go-zero 自家 |
| kafka client 原生 | ⭐⭐ | 不优先 | 失去 go-zero 集成收益 |
| NATS / Redis Streams | ⭐⭐ | 不优先 | 量小没必要 |

### ⑪ 日志 ch 11
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **ELK + filebeat + go-stash**（现）| ⭐⭐⭐ | 当前 | 经典但重 |
| Loki + Promtail + Grafana | ⭐⭐⭐⭐ | 备选 | 与 grafana 共栈，标签查询 |
| Vector + ES | ⭐⭐⭐ | 备选 | 单一 binary 替代 filebeat+go-stash |

### ⑫ 链路追踪 ch 12
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **jaeger**（现，OTLP 已通）| ⭐⭐⭐ | ✅ 已完成 | v3.35: Jaeger 1.63 + OTLP HTTP，5 服务 trace |
| OpenTelemetry Collector → Jaeger/Tempo | ⭐⭐⭐⭐⭐ | **目标方案** | 厂商中立，主流 |
| SigNoz | ⭐⭐⭐⭐ | 不优先 | 单栈体验好，但与现有 prom/grafana 重叠 |

### ⑬ 服务监控 ch 13
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **Prometheus + Grafana**（现）| ⭐⭐⭐⭐⭐ | 当前 | go-zero 内置，最标准 |
| VictoriaMetrics | ⭐⭐⭐⭐ | 备选 | 协议兼容，存储压缩好 |
| Mimir | ⭐⭐⭐ | 不优先 | 重量级，超出本地规模需要 |

### ④-⑦ 业务框架层
| 候选 | 适用度 | 决策 | 备注 |
|------|--------|------|------|
| **go-zero**（现）| ⭐⭐⭐⭐⭐ | 当前 | 主框架 |
| Kratos / Cloudwego / Hertz | ⭐⭐ | 不切换 | 跨框架是大工程 |

## 接触时机（按 M1-M4 安排）

| Phase | 可能触动 | 关注 |
|-------|----------|------|
| M1    | 全部 5 服务 yaml | 看 Telemetry / Prometheus 字段是否合理 |
| M2    | 跨服务 RPC 配置 | 看 RPC 错误码、retry、timeout 配置 |
| M3/M4 | e2e 回归基线 (dev-e2e.sh) | ✅ 8/8 PASS，见 step-20 |
| ch 12 | Telemetry | ✅ OTLP HTTP 已通 (v3.35/v3.36) |
| ch 11 | filebeat 配置 | ✅ ELK 已通 (v3.37-v3.39)，Loki 留作备选 |
| ch 13 | prometheus.yml | ✅ 12 target + Grafana (v3.33/v3.34) |
| ch 2  | nginx | ✅ APISIX 实战完成 (v3.26-v3.32) |

## 决策原则

1. **新组件必须有"具体痛点"驱动**——比如 ch 11 如果手工运维感到痛苦，再考虑 Loki
2. **学习价值 > 生产价值**——本期目的"学"，所以即使最终不上生产也可以试
3. **不必替换干净**——可以"挂两个"，比如保留 nginx + 旁边跑 APISIX 对比
4. **替换要先做 PoC**——任何大替换前先在 dev 单独跑一遍，再整合

## 排除项

- ❌ Spring Cloud / Dubbo 等 Java 栈（语言不同）
- ❌ 重型商业方案（consul+istio+envoy 这种）
- ❌ 单纯追求"新"的版本（go 1.24 暂不追 1.25，因为 go-zero 兼容性）
- ❌ 更换 RPC 协议（保持 gRPC，与生产对齐）

---

*创建于 2026-08-05，随着 M1-M4 推进实时更新*

---

## 评估历史记录

| 时间 | 候选 | 决定 | 备注 |
|------|------|------|------|
| 2026-08-05 | dev-up.sh log redirect | ✅ 实施 (v3.9) | 原脚本没 stdout 重定向, 误以为 order-mq 未起 |
| 2026-08-05 | seed-travel.sql | ✅ 实施 (v3.10) | 3 民宿 + 1 店铺 + 3 评论足以 smoke 4 个 listing 接口 |
| 2026-08-05 | dev-scan-stubs.sh | ✅ 实施 (v3.10) | 扫 logic 空 stub 工具, 防止凭印象拼 smoke 入参 |
| 2026-08-10 | APISIX 实战 + dashboard 修复 | ✅ 实施 (v3.26-v3.32) | 4 upstream + 7 route + consumer |
| 2026-08-11 | ch 13 监控 | ✅ 跑通 (v3.33/v3.34) | Prometheus 12 target + Grafana 7 panel |
| 2026-08-11 | ch 12 追踪 | ✅ 跑通 (v3.35/v3.36) | Jaeger 1.63 + OTLP HTTP |
| 2026-08-11 | ch 11 日志 | ✅ 跑通 (v3.37/v3.39) | ELK 保留，Loki/Vector 留作对照评估 |
| 2026-08-11 | M3/M4 e2e 回归 | ✅ 实施 (dev-e2e.sh) | 8/8 PASS，step-20 |
| 2026-08-11 | 4d pkg/errors 全量 | 🔜 当前 P1 | 前置 M1-M4 已满足，用 dev-e2e.sh 回归 |
| 待评估 | docker dev mode (ch 03) | ⏸️ 暂缓 | 现有 host 模式够用, MacBook Air 内存约束 |
