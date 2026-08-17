# Step 5 M1: 5 个服务全部 air 起来（业务闭环起点）

> 日期：2026-08-05 开始  
> 范围：从"只跑通 usercenter"扩展到"travel/order/payment/mqueue 全活"  
> 状态：🔜 M1 收尾中 (5/7 smoke 通 + dev-up.sh log fix 已 commit v3.9, docs+tools 已 commit v3.10)  
> 关联：`step-replan-2026-08-05.md` 第 3 节 + `step-02.5-air-unified-done.md`

## 目标

把 go-zero-looklook-new 这套 5 个服务（11 个 binary）的微服务系统，在 host 模式下全部跑起来并各自 smoke test 通过。

## 服务清单（11 个 binary）

| 服务 | API | RPC | Prometheus | 状态 |
|------|-----|-----|------------|------|
| order | 1001 | 2001 | 4002 (rpc) | ✅ userHomestayOrderList smoke 通 |
| payment | 1002 | 2002 | 4005 (rpc) | 🔜 Brokers fix 后 publish 能落 Kafka, e2e 待 M2 验证 |
| travel | 1003 | 2003 | 4006/4007 | ✅ 4 个 listing 接口全 smoke 通 |
| usercenter | 1004 | 2004 | 4009 (rpc) | ✅ done in Step 1.5 |
| order-mq | — | — | 4003 | ✅ Kafka Brokers fix 后 zk consumer init 通过 (v3.12) |
| mqueue-scheduler | — | — | 4011 | ✅ cron `*/1 * * * *` 注册成功, 每分钟 fire demo job |
| mqueue-job | — | — | 4010 | ✅ closeOrder 实验: CloseOrderTimeMinutes=1, 1 分钟后 trade_state=0→-1 静默生效 |

---

## 执行步骤

### ✅ M1.1 中间件状态确认 (2026-08-05)

**用户提供 docker ps 输出**：

```
go-stash              Up 24 hours         ← 我们
jaeger                Up 24 hours         ← 我们
filebeat              Up 24 hours         ← 我们
asynqmon              Up 24 hours         ← 我们
kafka                 Up 24 hours         ← 我们
redis                 Up 24 hours         ← 我们
grafana               Up 24 hours         ← 我们
prometheus            Up 24 hours         ← 我们
mysql                 Up 24 hours (healthy)← 我们
redisinsight          Up 4 days           ← 别人的项目
gz-redis              Up 6 days (healthy) ← 别人的项目
go-clean-arch-mysql   Up 2 weeks (healthy)← 别人的项目
```

**结论**：
- 我们的 9 个核心中间件全活 ✅
- ES + kibana **用户主动停了**（mac air 性能考虑）—— M1-M4 不影响
- 其他 3 个容器属于别的项目，无关

### ✅ M1.2 编译 11 个 binary (15:32-15:35 完成)
✅ 已完成：tmp/ 里 11 个 binary 都是 2026-08-05 15:32-15:35 之间的产物

### ✅ M1.3 启动全部服务 (用户确认 log 有产生)
等你执行 `./scripts/dev-up.sh`（或 `air -c .air.toml`）。

### ✅ M1.4 查看状态 (dev-status.sh 工作)
```bash
./scripts/dev-status.sh
```

### 🔜 M1.5 逐服务 smoke 测试 (5/7 通, ⑨⑩ 待验)
见下表。

### ✅ M1.6 验证 ⑨⑩ 完成 (2026-08-06: v3.12 brokers fix + closeOrder 实验成功)

---

## 重要发现（影响 M1 计划）

### 🔍 travel 不依赖 ES（重要！）

travel-api 的 4 个 listing logic（homestay/business/homestayBusiness）**全部走 MySQL**，
通过 `Masterminds/squirrel` 查询 `looklook_travel.homestayActivity` 等表。

ES 唯一作用：
- ch 11 日志收集的存储目的地
- ch 12 jaeger trace 存储后端

**结论**：M1-M4 业务闭环不需要 ES，可以保持 ES 关闭状态直到 ch 11/12 实施。

### 🔍 order / payment / mqueue 也不依赖 ES
- order-rpc / order-api：MySQL + 调 travel-rpc + usercenter-rpc
- payment-rpc / payment-api：MySQL + 调 order-rpc + usercenter-rpc
- mqueue：Redis (asynq) + Kafka
- order-mq：Kafka

### 🔍 MacBook Air 内存预算
当前实际负担：
- macOS ~2GB
- 我们 9 个中间件容器 ~1.5-2GB
- 别人 3 个容器 ~0.5-1GB
- 浏览器 + 其他 app ~1-2GB
- 总计可能 5-7GB（8GB 临界）

**如果 M1 后变卡**：
- 顺序策略：dev-up.sh 一次性启 11 个 binary 是 "快全活"
- 渐进策略：注释 dev-up.sh 里非核心服务先不启，先验 1-2 个

---

## M1.5 smoke 测试清单（推荐顺序）

按依赖关系从底向上测试，最小耦合的先验：

### 步骤 ①：usercenter 回归（已知 OK，确认 dev-up 没引入回归）
```bash
# 拿 token
TOKEN=$(curl -s -X POST http://127.0.0.1:1004/usercenter/v1/user/login \
  -H 'Content-Type: application/json' \
  -d '{"mobile":"18721432599","password":"test123456"}' \
  | jq -r .data.accessToken)
echo "TOKEN=$TOKEN"
```
预期：返回非空 token；如果失败说明 dev-up 引入了 usercenter 回归

### 步骤 ②：travel 单服务 smoke（验证 RPC）
```bash
# 房源列表（MySQL 查询，不依赖 ES）
curl -s -X POST http://127.0.0.1:1003/travel/v1/homestay/homestayList \
  -H 'Content-Type: application/json' -d '{"page":1,"pageSize":5}'
```
预期：`code=200`，有 homestay 列表（取决于 looklook_travel SQL 是否导入了示例数据）
如果不返回 token 也 OK，homestayList 公开接口

### 步骤 ③：travel homestayDetail（跨 RPC：travel-api → travel-rpc）
```bash
HOMESTAY_ID=$(curl -s -X POST http://127.0.0.1:1003/travel/v1/homestay/homestayList \
  -d '{"page":1,"pageSize":5}' | jq -r '.data.list[0].homestayId // .data.list[0].id')

curl -X POST http://127.0.0.1:1003/travel/v1/homestay/homestayDetail \
  -H 'Content-Type: application/json' \
  -d "{\"homestayId\":$HOMESTAY_ID}"
```
预期：`code=200`，有详情
**这步重要**：验证 travel-rpc 通了 + rpc client → server 链路对

### 步骤 ④：order-api（需要 usercenter 已登录）
```bash
curl -X POST http://127.0.0.1:1001/order/v1/homestayOrder/userHomestayOrderList \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"page":1,"pageSize":5}'
```
预期：`code=200` + 空列表或几个历史订单
**这步重要**：验证 order-rpc + travel-rpc + usercenter-rpc 三方 RPC 通了

### 步骤 ⑤：order-mq（kafka 消费者）
```bash
tail -f tmp/logs/order-mq.log
```
预期：服务起来，看到日志说开始消费 `payment-update-paystatus-topic`
**Step 02.5 笔记里说这个"未起"是已知问题**，这次正面验

### 步骤 ⑥：mqueue-scheduler / job（asynq）
```bash
tail -f tmp/logs/mqueue-scheduler.log tmp/logs/mqueue-job.log
```
预期：scheduler 日志说调度器启动；job 等待任务

### 步骤 ⑦：payment-api
支付回调 URL 通常需要 ngrok，先创建支付订单即可：
```bash
curl -X POST http://127.0.0.1:1002/payment/v1/thirdPayment/createPayment \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"orderSn":"TEST_ORDER_SN"}'
```
预期：code=200 或业务错误码（不是连接失败）

---

## 已知问题（待 M1.5 验证）

1. **order-mq 已知未起**：原文档说"A1 阶段就被标记为 log 为空，非本次回归"
   - 这次正面处理：看日志是不是有具体的报错（kafka topic 不存在？yaml 配置错？）
2. **mqueue 没完整验过**：scheduler + job 的 asynq 集成
3. **Telemetry 错配**：所有 yaml Batcher:file + Sampler:0.0，trace 不上报（这是 ch 12 问题，不是 M1 阻塞项）
4. **支付回调**：ch 7 强调需要 ngrok，本期跳过微信回调

---

## 反思（每完成一步填一行）

- 2026-08-05：M1.1 用户确认 9 中间件全活 + 重要发现 travel 不依赖 ES → M1 可继续
- （更多待你跑完一轮后填）

---

*创建/更新于 2026-08-05*

---

## 🚨 重要发现：smoke 测试要看 logic，不看 .api

(2026-08-05 用户主动纠正)

**背景**：准备 smoke travel 4 个接口（list/detail/businessList/commentList）时，前 3 个按 .api 定义都能查到数据，第 4 个我把 `commentList` 的入参写成了 `{"homestayId":1}`。

**用户指出**：`CommentListReq` 实际是 `{lastId, pageSize}`，不是 `homestayId`。

**更严重的发现**：去 `app/travel/cmd/api/internal/logic/homestayComment/commentListLogic.go` 看了真实现，**是空壳**：

```go
func (l *CommentListLogic) CommentList(req types.CommentListReq) (*types.CommentListResp, error) {
	// todo: add your logic here and delete this line
	return &types.CommentListResp{}, nil
}
```

**教训**：
- go-zero 项目的"接口能用吗"标准是 **`logic/*.go`，不是 `desc/*.api`**
- 教程型项目里有一批接口只是 schema 定义了但没实现
- smoke 测试前**先 cat logic** 确认实现存在 + 实现的 SQL 是什么

**影响**：
- M1.5 smoke 步骤 ④ 改成预期 `code=200` 但 `data.list = []`（永远空）
- 这是个具体的 mini-task 候选 —— 后续 M2 阶段可以补这个实现


---

## M1 进展记录

### ✅ M1.5 烟测结果（2026-08-05）

| # | 接口/服务 | 结果 | 备注 |
|---|-----------|------|------|
| ① | usercenter login | ✅ | token 拿到 |
| ② | travel.homestayList | ✅ | `data.list` 返回 3 条 seed 数据 |
| ③ | travel.homestayDetail | ✅ | 入参修正: `{"id":1}` 不是 `homestayId` |
| ④ | travel.businessList | ✅ | 入参 `homestayBusinessId:1` |
| ⑤ | travel.homestayBussinessList | ✅ | 列表正常 |
| ⑥ | ~~travel.commentList~~ | 跳过 | 是空 stub (todo: add your logic here) |
| ⑦ | order.userHomestayOrderList | ✅ | 入参修正: `lastId+pageSize+tradeState` (tradeState 必填, -99=全部) |
| ⑧ payment.createPayment | 🔜 待用真 orderSn 测 (入参已校验: orderSn+serviceType) |

### 🐛 步骤 ⑨⑩ 发现: dev-up.sh 的"未起"假象

**症状**：order-mq / mqueue-scheduler / mqueue-job 三个服务"看起来没跑"，
`tail tmp/logs/*.log` 全是空白。

**真相（用户协助下定位）**：
1. `ls tmp/logs/` —— **目录都不存在**
2. 翻 `scripts/dev-up.sh` —— 启动服务时 `"$bin" -f "$cfg" &` 完全没有 stdout 重定向
3. yaml 里 `Log: Level: error` + 没有 "started" 级别消息 → 启动成功也不产生 output
4. 设计本身：`serviceGroup.Start()` / `Scheduler.Run()` / `AsynqServer.Run(mux)` 都是阻塞死循环，**不会有"started" 日志**

**结论**：服务**一直活着**，但 dev-up.sh 不 redirect → log 文件不存在 → step-02.5 笔记的 "order-mq 未起" **证据不充分**。

**修复**：dev-up.sh 加 `mkdir -p tmp/logs` + `>> "tmp/logs/${name}.log" 2>&1`。

```diff
- "$bin" -f "$cfg" &
+ "$bin" -f "$cfg" >> "tmp/logs/${name}.log" 2>&1 &
+ mkdir -p tmp/logs
```

**下一步（用户执行，待回执）**：
```bash
./scripts/dev-down.sh && ./scripts/dev-up.sh
tail -n 50 tmp/logs/order-mq.log
tail -n 50 tmp/logs/mqueue-scheduler.log
tail -n 50 tmp/logs/mqueue-job.log
```

### 📚 本轮共修正的入参错误（3 处）

用户反馈 + 我自查发现的 smoke 入参拼错，记录防复发：

| 接口 | 我之前写的 | 真实定义 | 错因 |
|------|------------|----------|------|
| travel.commentList | `{"homestayId":1}` | `{lastId, pageSize}` + 空实现 | 没看 logic/.go (后来发现是空 stub) |
| order.userHomestayOrderList | `{"page":1,"pageSize":5}` | `{lastId, pageSize, tradeState}` | 字段名错 + 漏必填 tradeState |
| ~~payment.createPayment~~ | (我曾有此接口) | 不存在 — 只有 thirdPaymentWxPay | 凭印象写接口名 |

**新约定**：smoke 入参必须先 `cat desc/*.api` 校验，不准"凭印象 + 不验真"。

工具 `scripts/dev-scan-stubs.sh` 已创建，扫 logic 里 `todo: add your logic here` 空壳。

### 📦 本轮新增资产

| 类型 | 路径 | 行数 | 用途 |
|------|------|------|------|
| 文档 | `step-replan-2026-08-05.md` | 233 | 重新规划 (3 层视角 A/B/C) |
| 文档 | `step-05-business-baseline.md` | (本文) | M1 working doc |
| 文档 | `component-upgrade-candidates.md` | 88 | 边做边更新的组件候选 (nginx/APISIX 等) |
| 文档 | `README.md` v2 | 117 | 重写为薄索引, 保留历史 |
| 脚本 | `scripts/dev-up.sh` patch | +3 行 | redirect log 到文件 |
| 脚本 | `scripts/dev-scan-stubs.sh` | 30 | 扫空 logic |
| 数据 | `deploy/sql/seed-travel.sql` | 90 | 3 间民宿 + 1 店铺 + 3 评论 + 3 activity 映射 |

---

## M1 完成度

- ✅ M1.1 中间件确认（9 个活, ES/Kibana 主动停）
- ✅ M1.2 编译 11 binary
- ✅ M1.3 启动 11 服务（dev-up.sh 修复后能看到 log）
- ✅ M1.4 状态查看 (dev-status.sh)
- ✅ M1.5 smoke 5/7 + 1 跳过 + 1 修复
- ✅ M1.6 commit + push 完成 (v3.9 dev-up fix + v3.10 docs+tools)
- ⏳ M2 (RPC 联调) - 待启动

## 已知 follow-ups (按优先级)

- [ ] M1 收尾（commit v3.9 dev-up fix + v3.10 docs+tools）— **当前**
- [ ] 验证 ⑨⑩ 真在消费 (本轮 a24da59 之后)
- [ ] M2 RPC 全链路联调 (跨 5 服务一笔数据走完)
- [ ] ch 8 (kq + asynq) 章节吃透
- [ ] M3 e2e 1 条完整业务线 (browse → order → pay → settle)
