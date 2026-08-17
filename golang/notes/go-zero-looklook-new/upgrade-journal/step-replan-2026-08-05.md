# 重新规划：从"库升级优先"切换到"业务闭环优先"

> 日期：2026-08-05  
> 状态：✅ 已确定，A/B 视角已完成 (2026-08-11 更新, v3.39+)
> 最近更新：M1-M4 业务闭环收尾 (dev-e2e.sh 回归 8/8 PASS)，ch 11/12/13 三件套跑通，下一步 Step 8 (4d 全量)
> 触发：今天把 `doc/chinese/` 下 15 章教程完整扫了一遍，发现业务系统只跑通 1/5

---

## 1. 发现：项目不只是 go-zero 升级

`doc/chinese/` 下其实是 Mikaelemmmm/go-zero-looklook 官方配的 **15 章教程文档**，
覆盖一个完整微服务系统从开发到上线的所有维度。前面我一直在埋头做
`go mod upgrade / pkg/errors migration / air 配置`，但**业务系统本身只完成 1/5**：

| #  | 章节               | 状态                            | 备注 |
|----|--------------------|---------------------------------|------|
| 01 | 开发环境搭建       | ✅ Step 1                       | 11 中间件 + 4 库数据 + topic |
| 02 | nginx 网关         | ✅ nginx auth_request + APISIX 实战 + dashboard 修复 | v3.24-v3.32，step-09~16 |
| 03 | 鉴权服务           | ✅（嵌在 usercenter）           | JWT 中间件已验证 |
| 04 | 用户服务           | ✅ smoke 通过                   | usercenter |
| 05 | 民宿服务           | ✅ M1 smoke 全活 (homestayList/detail/businessList/BussinessList 通) | travel |
| 06 | 订单服务           | ✅ M1 ✅ 含 closeOrder 实验 (trade_state 0→-1 静默生效) | order |
| 07 | 支付服务           | ✅ M1 (Kafka Brokers 已修) + payment-rpc Push 待 M2 联通验证 | payment |
| 08 | 消息/延迟/定时队列 | ✅ M1 完成: asynq 4 类事件摸清 + kafka Brokers 修复 + closeOrder e2e 验证 | kq (kafka) + asynq |
| 09 | 分布式事务         | N/A（本项目不用 dtm）            | — |
| 10 | 错误处理           | 🚧 试点完成，全量待做（下一步 P1）| usercenter 试点完成 |
| 11 | 日志收集           | ✅ v3.37-v3.39                 | filebeat 抓 host 日志 → Kafka → go-stash → ES → Kibana |
| 12 | 链路追踪           | ✅ v3.35-v3.36                 | Jaeger 1.63 + OTLP HTTP，5 服务 trace |
| 13 | 服务监控           | ✅ v3.33-v3.34                 | Prometheus 12 target + Grafana 7 panel |
| 14 | 部署环境搭建       | ❌                              | gitlab+jenkins+harbor+k8s（本期大概率不做）|
| 15 | 发布到 k8s         | ❌                              | jenkins pipeline（依赖 14）|

**这是一个比"go-zero 升级"大得多的图**。我们之前一直刷"库"，但业务的物质基础（5 个服务 + e2e 链路）还没完全搭起来。

## 2. 新的 3 层优先级（之前没梳理清楚）

之前的 roadmap 是平铺的"Step 1 → Step 5"，从环境到升级到推广。
重新分类，本质上是 3 件不同的事：

### 视角 A — 业务闭环（最基础，新 P0）
- **做什么**：跑通 `浏览民宿 → 下单 → 支付 → 订单状态同步 → 取消订单超时回滚` 真实业务链
- **覆盖章节**：ch 4 → ch 5 → ch 6 → ch 7 → ch 8 一条线打穿
- **状态**：1/5 完成（usercenter）
- **价值**：
  - 后面所有事的物质基础
  - **完成度从 1/5 变成 5/5** 是里程碑
  - 学习回报高（kq 生产消费、asynq 延迟定时、跨服务 RPC 都打穿）
- **关键依据**：教程本身的设计逻辑——它先讲业务再讲监控再讲部署，业务不通其他都没意义

### 视角 B — 基础设施贯通（新 P1）
- **做什么**：接 filebeat→kafka→go-stash→ES，让 Kibana 能搜业务日志；修 jaeger Telemetry 让跨服务 trace 可见；验证 prom/grafana 指标出来
- **覆盖章节**：ch 11 + ch 12 + ch 13
- **状态**：中间件全起但**白起**——没有任何业务接进去
- **价值**：go-zero 全家桶最有教学价值的部分；不接就是工业级空转

### 视角 C — 纯库升级（原 P0，降级为新 P2）
- **做什么**：Step 4d (pkg/errors 收尾) + 4b (jwt v5) + asynq 升级 等
- **状态**：核心库已升级完（go-zero 1.10.2 + go 1.24 + air），边际收益递减
- **价值**：在没有业务跑通做"被迁移方"时，**升级只是在打空靶**

**新顺序：A → B → C**

## 3. 起点 ①：A 的 M1（5 个服务全部起起来）

### 3.1 服务清单（11 个 binary，对应 5 个服务）

| 服务         | API 端口 | RPC 端口        | Prometheus    | 配置 |
|--------------|----------|-----------------|---------------|------|
| order        | 1001     | 2001            | api:? rpc:4002 | `app/order/cmd/{api,rpc}/etc/order.yaml` |
| order-mq     | —        | — (服务组)       | 4003          | `app/order/cmd/mq/etc/order.yaml` |
| payment      | 1002     | 2002            | rpc:4005      | `app/payment/cmd/{api,rpc}/etc/payment.yaml` |
| travel       | 1003     | 2003            | api:4006 rpc:4007 | `app/travel/cmd/{api,rpc}/etc/travel.yaml` |
| usercenter   | 1004     | 2004            | rpc:4009      | `app/usercenter/cmd/{api,rpc}/etc/usercenter.yaml` |
| mqueue-scheduler | —   | — (后台)         | 4011          | `app/mqueue/cmd/scheduler/etc/mqueue.yaml` |
| mqueue-job   | —        | — (后台)         | 4010          | `app/mqueue/cmd/job/etc/mqueue.yaml` |

**dev-up.sh 已经编排好全部 11 个** (`./scripts/dev-up.sh`)，air 在 `.air.toml` 里指定 `entrypoint = ["./scripts/dev-up.sh"]`。

### 3.2 M1 执行步骤

| 步骤 | 动作 | 预期 | 验证 |
|------|------|------|------|
| M1.1 | 检查 docker 中间件全活 | mysql/redis/kafka/es/jaeger/prom/grafana 11 个容器 healthy | `./scripts/dev-status.sh` + `docker ps` |
| M1.2 | `./scripts/dev-build.sh` build 11 binary | 全部成功 | `ls tmp/` 有 11 个 binary |
| M1.3 | `./scripts/dev-up.sh` 启 11 服务 | 大部分 listen，**预期 order-mq / mqueue / travel / payment 会失败** | `dev-status.sh` 端口 + 看 `tmp/logs/` |
| M1.4 | **逐服务 smoke** | — | 见下表 |
| M1.5 | 修复失败服务（典型坑：yaml 端口 / 数据库名 / topic 不存在 / mq 服务组调度问题） | 11 个全活 | `dev-status.sh` 显示 8 端口 + 11 进程 |
| M1.6 | commit + 笔记 step-business-baseline.md | git 干净 | `git log -1` |

### 3.3 每个服务的最小 smoke 测试

| 服务 | smoke 路径 | 关键依赖 |
|------|-----------|----------|
| order-api | `POST :1001/order/v1/homestayOrder/createHomestayOrder`（需 usercenter 已注册用户 + travel 房源存在） | order-rpc + travel-rpc + usercenter-rpc |
| order-rpc | grpcurl 或经由 order-api 间接验证 | mysql `looklook_order` + travel 库 |
| order-mq | 看 log 是否在消费 `payment-update-paystatus-topic` | kafka + payment 服务在跑 |
| payment-api | `POST :1002/payment/v1/thirdPayment/wxPay` | order-rpc + payment-rpc + usercenter |
| payment-rpc | 同上间接验证 | mysql `looklook_payment` |
| travel-api | `POST :1003/travel/v1/homestay/homestayList` | travel-rpc + es (elasticsearch 有 travel 索引) |
| travel-rpc | 同上间接验证 | mysql `looklook_travel` + es |
| usercenter-api | (已通) `POST :1004/usercenter/v1/user/login` | ✅ done in Step 1.5 |
| mqueue-scheduler | 看 log 是否定期调度 | asynq (Redis) |
| mqueue-job | 看 log 是否消费任务 | asynq + kafka + 看关单任务的 log |

### 3.4 预期会踩的坑（先打个预防针）

| 坑 | 症状 | 修法 |
|----|------|------|
| yaml 端口仍是 `mysql:3306` 等 docker 服务名 | host 跑连不上 | 改 `127.0.0.1:33069`（usercenter 改过同样的坑） |
| order-mq / mqueue 在 Step 2.5 已发现"未起" | 日志为空 | 见原 air 单文件笔记，理由未明，需要 ch 8 章节 |
| es 没建索引 | travel 列表返回空 | 检查 go-stash 是否在往 ES 灌数据；或手动建 |
| payment 微信支付回调 URL | payment-wx-pay-callback 测不到 | 教程里讲用 ngrok / 内网穿透，跳过 |
| asynq topic 没注册 | mqueue-job 空转 | 启动时会自动注册（asynq 行为），如果仍空看 redis 是否有 key |

## 4. 路径之后：从 M1 到完整闭环

```
M1 ✅ 11 个服务全活 ─► M2 联调打通 ─► M3 最小 e2e ─► M4 全链路业务联通
                                          │
                                          ▼
                              ch 8 (kq + asynq) 自然验证
```

| Phase | 目标 | 完成标志 |
|-------|------|----------|
| M1 | 11 个服务全起，单独 smoke 可达 | dev-status 全绿 + 单服务 smoke 100% |
| M2 | RPC 联调全通 | 跨服务调用跑通（payment → order → travel → usercenter）|
| M3 | 1 条 e2e 业务线 | `登录 → 浏览 → 下单 → 支付 → 关单` 一笔数据走完 |
| M4 | 全 5 个文档章节摸一遍 | 教程 ch 4-8 在我们自己代码里全部"读得懂" |

## 5. 顺手升级候选（边做边看）

按你新提议——做 M1 的同时观察哪些组件可以换成现代等价物：

### 5.1 网关（ch 2）
| 候选 | 优势 | 劣势 | 适配场景 |
|------|------|------|----------|
| nginx + auth_request | 现有方案，最简单 | 插件生态弱、配置散落 | 当前够用 |
| **APISIX** | Apache 顶级，dashboard + 100+ 插件，开箱限流/认证/可观测 | 部署复杂（依赖 etcd/Postgres）| **值得学；推荐做 M5 时换** |
| Kong | 插件生态最强 | OpenResty 不是 Go，调试链不友好 | 不优先 |
| Higress | 阿里云原生，Go + Envoy | 阿里体系外社区小 | 不优先 |
| Traefik | 纯 Go，配置自动发现 | API gateway 概念弱 | k8s 友好，但单机重 |

**判断**：M5 阶段（ch 2 实施）开始评估 APISIX。
**前提**：跑通 M1 后，且仅在需要限流/复杂插件时才换。

### 5.2 队列（ch 8）
| 候选 | 优势 | 劣势 |
|------|------|------|
| asynq（现）| Redis 后端，Redis-killer 场景 | 项目依赖 redis 集群 |
| **River** | Postgres 后端（同库搞定），现代 Go，类型安全的 job 定义 | 需要 pg（项目没用）|
| **Machinery** | 多 broker 后端（amqp/redis/sqs） | 老牌，代码红海 |
| **Watermill** | 事件流框架 | 抽象层重 |

**判断**：保持 asynq，但读一下源码学设计思想；后续如果是新项目，考虑 River。

### 5.3 日志（ch 11）
| 候选 | 优势 | 劣势 |
|------|------|------|
| ELK + filebeat + go-stash（现）| 经典 | 运维重，go-stash 项目活跃度下降 |
| **Grafana Loki + Promtail + Grafana** | 标签查询友好，与 grafana 共栈 | 大数据量不如 ES |
| **Vector + ES** | 单一 binary 替代 filebeat + go-stash | 写 transform 配置复杂 |

**判断**：现 ELK 保留；M6 阶段评估 Vector 替代 filebeat + go-stash。

### 5.4 链路追踪（ch 12）
| 候选 | 优势 |
|------|------|
| jaeger（现）+ go-zero Batcher=jaeger（已不支持，需迁移）| — |
| **OpenTelemetry Collector → Tempo / Jaeger** | 厂商中立，主流 |
| **SigNoz** | ClickHouse 单栈，可观测一体化 |

**判断**：终点走 OTel Collector；ch 12 实施时一起做。

### 5.5 服务监控（ch 13）
| 候选 | 优势 |
|------|------|
| Prometheus + Grafana（现）| go-zero 内置，最标准 |
| VictoriaMetrics | 与 Prometheus 协议兼容，存储压缩强 |
| Mimir | 长存储 + 多租户 |

**判断**：保持 Prom + Grafana，读一下 go-zero 的 prom 集成代码即可。

## 6. 修订后的 step 编号（取代旧的 Step 1-5）

```
[已完成]
- Step 0 ~ Step 2.5：环境 + 工具链升级 ✅
- Step 4a / 4c：go-zero / go-redis 升级 ✅
- Step 4b：jwt v5 deferred ⏸️
- Step 4d：pkg/errors 试点 ✅，全量暂缓 ⏸️

[新路线]
- Step 5：A 业务闭环（M1~M4）  🔜 M1 ✅, M2 链路验证 ✅, M3/M4 待启动
  ├ M1：5 服务全活 + 实验验证 ✅ v3.12 完成
  ├ M2：跨 5 服务一笔订单 e2e ✅
  │    - 链路全通 (Kafka + asynq 都被消费)
  │    - 详见 step-07 工作 doc
  │    - 完整流程图 + 故障排查 见 step-08
  └ M3/M4：dev-e2e.sh 回归基线 ✅ (8/8 PASS, 2026-08-11)
       - happy path: login → browse → order → kafka pay → trade_state 0→1
       - defer close: 验证 enqueue；等待验证用 E2E_CLOSE_VERIFY=1
       - 详见 step-20
- Step 6：B 基础设施贯通（ch 11/12/13）
  ├ ch 13 监控 ✅ v3.33/v3.34
  ├ ch 12 追踪 ✅ v3.35/v3.36 (Jaeger + OTLP)
  └ ch 11 日志 ✅ v3.37/v3.39 (ELK 保留，Loki/Vector 留作对照评估)
- Step 7：网关（ch 2）
  ├ 7.1 nginx auth_request 实战 ✅ v3.24/v3.25
  └ 7.2 APISIX 实战 + dashboard 修复 ✅ v3.26-v3.32
- Step 8：4d 全量（在业务闭环后做，价值最大）
  └ 🔜 当前 P1：前置 M1-M4 已满足，用 dev-e2e.sh 做端到端回归
- Step 9+：可选（生产部署 ch 14-15 / jwt v5 重试 / asynq 升级）
```

## 7. 当前决策

| 决策 | 内容 |
|------|------|
| 起点 ① (M1) | ✅ v3.12 已完成 (含 Kafka Brokers fix + asynq 实验) |
| 起点 ② (ch 11 日志)  | ✅ v3.37-v3.39 完整跑通 |
| 起点 ③ (ch 12 追踪)  | ✅ v3.35-v3.36 完整跑通 |
| M3/M4 关账           | ✅ dev-e2e.sh 回归 8/8 PASS (2026-08-11) |
| 告警评估 + 落地       | ✅ step-21 + step-22 完整闭环 (2026-08-12, Grafana 11.4 + Prom 2.55.1 升级 + 单条指标告警跑通) |
| 4d 全量              | 🔜 当前 P1（前置已满足，用 e2e 脚本回归）|
| APISIX 评估          | ✅ 已完成实战 + 对比，保留 nginx 作为当前默认 |

## 8. 相关链接

- README.md（v2 更新版）—— 总入口
- progress-day-1.md —— Day 1 进度
- step-04d-pkg-errors-migration.md —— 4d 试点记录（4d 全量暂缓后这篇等下次更新）
- step-02.5-air-unified-done.md —— 5 个服务 air 编排基础设施
- step-03-docker-dev-mode.md —— 全 docker dev 模式（与本路线不冲突，是 M1 host 模式的对照方案）
- doc/chinese/ —— 15 章官方教程（**新的"真理来源"**）

---

*起草：2026-08-05*
