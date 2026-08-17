# Step 8: 下单完整流程 — 参考文档

> 日期：2026-08-07  
> 状态：📚 参考文档, **不是 working doc**  
> 配合阅读：[step-06 异步事件深度学习](step-06-async-event-deep-dive.md) + [step-07 M2 e2e](step-07-m2-e2e.md)  
> 用途：把"一笔订单从浏览到关单"**完整流程**画清楚，分清楚**真实业务设计** vs **M2 实际模拟做的**

---

## 0. 阅读指南

| 你是 | 看哪一节 |
|------|---------|
| 想搞懂全局 | §1 全景图 |
| 想深挖某个阶段 | §2 各阶段详解 |
| 想知道 M2 模拟的实测结果 | §3 M2 实际做了什么 (vs 真实业务) |
| 想部署到生产 / 跑回归 | §4 真实 vs 测试的 gap |

测试约定 (2026-08-07 标准化):
- 测试 mobile = **18721432599**
- 测试 password = test123456
- 测试用户 id = **1** (usercenter.user.id=1)
- 测试 homestay id = 1, 2, 3 (来自 `seed-travel.sql`)

---

## 1. 完整业务流程全景图

```mermaid
flowchart TD
    Start([用户打开 app/web]) --> Browse
    Browse[📱 浏览民宿列表<br/>travel.homestayList<br/>公开接口] -->|选房| Detail
    Detail[📱 看民宿详情<br/>travel.homestayDetail<br/>公开接口] -->|登录| Login
    Login[🔑 登录拿 JWT<br/>usercenter.login<br/>mobile + password] -->|拿到 token| OrderAPI
    OrderAPI[📱 POST 下单<br/>order.createHomestayOrder<br/>需要 JWT] --> RPC1
    RPC1[order-rpc.CreateHomestayOrder<br/>+ travel-rpc.HomestayDetail 二次校验<br/>+ MySQL INSERT] --> AsynqC
    
    AsynqC[/"asynq.Enqueue<br/>defer:homestay_order:close<br/>N 分钟后 (默认 30 min)"/] --> DeferWait
    DeferWait{⏰ N 分钟内?}
    
    DeferWait -->|未支付<br/>30 min 后| CloseOrder[mqueue-job CloseOrder<br/>查 homestay_order<br/>如果 trade_state=0 → 改 -1<br/>否则 skip]
    DeferWait -->|已支付| PayFlow
    
    PayAPI[📱 调 wx 预付<br/>payment.thirdPaymentWxPay<br/>需要 JWT] --> WXPay
    WXPay[微信返回 prepay_id<br/>前端拉起支付 UI] --> WXCallback
    
    WXCallback[POST 微信回调<br/>payment.thirdPaymentWxPayCallback<br/>不需要 JWT] --> PRpc1
    PRpc1[payment-rpc.UpdateTradeState<br/>+ Kafka Push<br/>topic=payment-update-paystatus-topic] --> KafkaConsumer
    
    KafkaConsumer[order-mq Consume<br/>kq.MustNewQueue<br/>JSON Unmarshal] --> RPC2
    RPC2[order-rpc.UpdateHomestayOrderTradeState<br/>+ MySQL UPDATE homestay_order<br/>trade_state=1 (WaitUse)] --> AsynqD
    
    AsynqD[/"asynq.Enqueue<br/>msg:pay_success:notify_user"/] --> NotifyUser
    NotifyUser[mqueue-job PaySuccessNotifyUser<br/>usercenter.GetUserAuthByUserId<br/>+ SendWxMini 推送] --> Done
    
    CloseOrder --> End
    Done --> End([订单闭环])

    style DeferWait decision
    style CloseOrder stroke:#f90
    style WXPay stroke:#36f
    style NotifyUser stroke:#36f
```

简化版时间线:

```
T+0s      用户点 [预定]
T+1s      order.createHomestayOrder
T+1s      MySQL homestay_order INSERT (trade_state=0=WaitPay)
T+1s      asynq.Enqueue (defer 30min, type=closeOrder)
T+1s      [同时] 用户调 wx 预付接口
T+~3s     微信 APP 弹出支付
T+~10s    用户输密码完成支付
T+~12s    微信回调 payment-rpc.thirdPaymentWxPayCallback
T+~12s    payment-rpc.UpdateTradeState + Kafka.Push
T+~13s    order-mq.Consume (从 Kafka 拉到消息)
T+~13s    order-rpc.UpdateHomestayOrderTradeState (trade_state=1)
T+~13s    asynq.Enqueue (msg:pay_success:notify_user, 立即)
T+~14s    mqueue-job 拉到 D 任务
T+~14s    handler 调 wxmini.Send (用户收到 [支付成功] 推送)
T+~14s    [同时] 任务进 asynq:{default}:processed:2026-08-07

(T+30min) ⚠️ 如果到时间 user 还没支付: mqueue-job CloseOrder 改 trade_state=-1
(T+每天) cron: mqueue-scheduler settleRecordScheduler 每分钟 fire → mqueue-job SettleRecord (目前是 demo)
```

---

## 2. 各阶段详解

### 2.1 用户登录

```
入口:    POST http://usercenter-api:1004/usercenter/v1/user/login
参数:    {"mobile":"18721432599","password":"test123456"}
返回:    {"code":200,"data":{"accessToken":"eyJhbGc...", ...}}
中间件:  无 (login 是公开的)
handler: usercenter/cmd/api/internal/handler/user/loginHandler.go (goctl 生成)
logic:   usercenter/cmd/api/internal/logic/user/loginLogic.go
RPC:     usercenter-rpc.Login(mobile+password → user.Id + JWT)
JWT 设置: 
  - secret = usercenter.yaml: JwtAuth.AccessSecret
  - exp = 1 年 (AccessExpire 配置)
失败:
  - 401: mobile/password 不匹配
```

**关键点**：
- JWT 拿到后存在 **client** (Postman/前端), 后续每个 API 通过 `Authorization: Bearer <token>` 传
- 中间件 `rest.WithJwt` 自动验证
- token 过期要 refresh (本项目没实现 refresh)

### 2.2 浏览民宿

```
入口:    POST :1003/travel/v1/homestay/homestayList (公开)
        POST :1003/travel/v1/homestay/homestayDetail (公开, body: {"id":1})
handler: travel/cmd/api/internal/handler/homestay/* (goctl 生成)
logic:   travel/cmd/api/internal/logic/homestay/* 
        - homestayList: 查 homestay_activity (MySQL), join homestay 表
        - homestayDetail: 调 travel-rpc.HomestayDetail (gRPC 内调用)
DB:      looklook_travel.homestay, looklook_travel.homestay_activity
```

**关键点**：
- homestayList 和 homestayDetail 业务层**走 MySQL** (不是 ES)
- ES 在本项目关停 (macbook air 内存), 不影响业务
- 详情调的是 RPC 不是 MySQL (即 API 跨进程调本服务的 RPC)

### 2.3 下单 (event C 触发点)

```
入口:    POST :1001/order/v1/homestayOrder/createHomestayOrder (需要 JWT)
参数:    {"homestayId":1,"isFood":false,"liveStartTime":...,"liveEndTime":...,
         "livePeopleNum":2,"remark":"..."}
        ↑ liveStartTime/LiveEndTime 是 unix 秒级 int64

调用链 (跨进程):
  order-api :1001 (handler)
    ↓ rest.WithJwt 拦截, ctx 注入 userId
    ↓ NewCreateHomestayOrderLogic
  api-side logic:
    (a) travel-rpc.HomestayDetail({Id:homestayId}) 跨服务校验
    (b) order-rpc.CreateHomestayOrder(...)       跨服务委托
  order-rpc :2001 (server)
    ↓ NewCreateHomestayOrderLogic
  rpc-side logic:
    (1) 校验 LiveStartTime < LiveEndTime
    (2) travel-rpc.HomestayDetail({Id})          再校验一次 (defensive)
    (3) uniqueid.GenSn(HSO_PREFIX) → order.Sn  (雪花算法 ID)
    (4) 计算 liveDays = (LiveEndDate - LiveStartDate) / 86400
    (5) 计算 OrderTotalPrice = HomestayPrice × liveDays [ + FoodPrice × peopleNum × liveDays ]
    (6) HomestayOrderModel.Insert → MySQL homestay_order (trade_state=0=WaitPay)
    (7) asynqClient.Enqueue(DeferCloseHomestayOrder, ProcessIn(30 min))

副作用:
  - MySQL: 新行 (homestay_order)
  - Redis asynq:{default}:scheduled ZSET: 新 defer task
  - 返回: {"data":{"orderSn":"HSO20..."}}
```

**关键点**：
- api-side 和 rpc-side 都调了 travel-rpc.HomestayDetail (**冗余**, 是 defensive 双校验)
- `CloseOrderTimeMinutes` 是常量 (默认 30), 我们实验时改过 1
- trade_state = 0 (WaitPay) 在这一行 INSERT 时就设立了

### 2.4 微信预付 + 支付 UI (M2 跳过)

```
[前端] POST :1002/payment/v1/thirdPayment/thirdPaymentWxPay (需要 JWT)
参数:    {"orderSn":"HSO...","serviceType":"homestay_order"}

[payment-api] -> [payment-rpc] CreateWxPay (后续)  →  返回 prepay_id
[前端] 拿 prepay_id 调 wx.miniprogram.requestPayment(...)
[微信] 用户在 app 内确认付款
[微信] 异步 POST 回调到: payment-api/thirdPayment/thirdPaymentWxPayCallback
```

**为什么 M2 跳过了**：
- 微信支付需要: 商户号 + AppID + API key + HTTPS 回调域名 (生产) / ngrok 内网穿透 (测试)
- 本地 dev 环境没这些配置

### 2.5 微信回调 → Kafka 推送 (event A 生产)

```
[微信] POST {payment-api hostname}/payment/v1/thirdPayment/thirdPaymentWxPayCallback
body:    XML (微信协议, 不是 JSON)
header:  各种微信签名
handler: payment/cmd/api/internal/handler/thirdPayment/thirdPaymentWxPayCallbackHandler.go
logic:   payment/cmd/api/internal/logic/thirdPayment/thirdPaymentWxPayCallbackLogic.go
status:  必须返回 200 + "SUCCESS" 才算微信确认收到 (否则会重试)

内部流程:
  ThirdPaymentWxPayCallbackLogic
    → (解析 XML, 验证签名)
    → payment-rpc.UpdateTradeState(Sn=..., PayStatus=已支付)

payment-rpc 内部:
  UpdateTradeStateLogic
    → MySQL UPDATE looklook_payment.third_payment (mark paid)
    → KqueuePaymentUpdatePayStatusClient.Push(json) ← ★★★ 关键
       ↓ 推到 Kafka topic=payment-update-paystatus-topic
```

**关键点**：
- 回调里的 `pay_succeed_time`, `out_trade_no` (即 orderSn) 等都进 third_payment 表
- **Kafka 推送是副作用**, 不阻塞支付主链路

### 2.6 Kafka 消费 → 改 trade_state + enqueue D (event A 消费)

```
[order-mq] Kafka consumer 订阅 payment-update-paystatus-topic
[order-mq] Consume(key, val=json字符串)
  1. Unmarshal val → ThirdPaymentUpdatePayStatusNotifyMessage{OrderSn, PayStatus}
  2. execService(message)
     a. PayStatus 映射成 trade_state (1=WaitUse, 0=WaitPay等)
        公式 (getOrderTradeStateByPaymentTradeState):
        - PayStatus 1 → trade_state 1 (WaitUse)
        - PayStatus 2 → trade_state 3 (Refund)  
        - PayStatus 3 → trade_state -1 (Cancel)
        - 其他 → -99 (不变)
     b. order-rpc.UpdateHomestayOrderTradeState({Sn, TradeState})
        → MySQL UPDATE homestay_order SET trade_state=...
        → 如果 TradeState == WaitUse (1), enqueue D
```

**关键点**：
- trade_state 流转: 0 (待支付) → 1 (待使用 = 已支付, 待入住)
- D 事件 (msg:pay_success:notify_user) 是 order-rpc 改 WaitUse 的副作用
- 不是所有 trade_state 都会触发 D, **只有 1 (WaitUse) 会**

### 2.7 推送通知 (event D)

```
[order-rpc] 在 trade_state=1 时:
  asynqClient.Enqueue(MsgPaySuccessNotifyUser, payload)
    payload = PaySuccessNotifyUserPayload{Order: ...homestay_order 全部字段}

[mqueue-job] D handler = PaySuccessNotifyUser
  ProcessTask:
    1. json.Unmarshal(t.Payload()) → p.Order
    2. usercenter-rpc.GetUserAuthByUserId(UserId=p.Order.UserId, AuthType=SmallWX)
       拿 user 的 WeChat OpenID (AuthKey)
       ⚠️ user_auth 表没记录 → 报错 "user no exists" (我们实测到的)
    3. wxmini.Send(订阅消息)
       ⚠️ 没真 wx app 凭证 → http 调用失败 → 5 次 retry → return

返回:
  - nil = 任务成功 (consumer 不重试, counter +1, 移到 processed)
  - error = 任务失败 (asynq 进 retry 25 次, 后移到 failed:DATE)
```

**关键点**：
- D 是 MQ 即时任务 (无延迟), mqueue-job 立即拉到
- handler 失败有 25 次 retry (asynq 默认, 间隔 1m→5m→30m→...)
- 我们的环境 D handler 最终会 retry 走完 25 次 (因为是真 wx API 不通)

### 2.8 关单防超时 (event C 触发后)

```
T+30min 后 (如果用户没支付):
[mqueue-job] 30min 后从 asynq:{default}:scheduled 自动移到 :pending, worker 拉到
  ProcessTask (closeOrder.go):
    1. json.Unmarshal → p.Sn
    2. order-rpc.HomestayOrderDetail({Sn=p.Sn})
    3. 如果 trade_state == 0 (WaitPay):
       order-rpc.UpdateHomestayOrderTradeState(Sn, TradeState=-1=Cancel)
    4. 否则 skip (用户已付, 不动)

返回:
  - nil = 任务成功
  - error = asynq retry (但 closeOrder 不易失败, 几乎 always nil)
```

**关键点**：
- 关单 handler 是**幂等的**: 如果用户已经付款(trade_state != 0), skip 不会改
- D 通知和 C 关单可能**撞** (用户在 29:59 付款)
  - C 看到 trade_state=1, skip
  - D 已经 trigger
  - 不会出现 race

### 2.9 商户结算 (event B - cron)

```
[mqueue-scheduler] 启动时 Register("*/1 * * * *", ScheduleSettleRecord)
  每分钟 fire 一次

[mqueue-job] ScheduleSettleRecord handler:
  当前是空 demo: fmt.Printf("shcedule job demo ...")
  (源码 typo: "shcedule" 应为 "schedule")
  
生产化要做:
  - 查 looklook_payment.third_payment 找昨天所有已支付订单
  - 按 homestay_business_id 分组聚合
  - 生成 looklook_payment.settle_records (结算记录表)
  - 给每个商家算应结算金额 - 抽佣
  - 可能后续会: 调第三方提现 → 商家收款
```

**关键点**：
- 是真正的生产 cron, 但代码留空待业务实现
- 如果加上, 状态流转: trade_state=1 (已付) → trade_state=2 (已用) → 结算记录生成

### 2.10 入住完成 (用户到店)

```
[前台] 输入 trade_code (8 位) → 调 order-rpc.HomestayOrderDetail 查 order
       (前端流程, 没具体 RPC 改 trade_state=2)
[生产代码预留] trade_state = 2 (Used)
```

**关键点**:
- 真实业务 trade_state=2 是前台输入 trade_code 时设置
- 本项目教程没写完这部分

---

## 3. M2 实际做了什么 (vs 真实业务)

### 3.1 哪些是真跑的 ✅

| 阶段 | 实际做的 | 通过 | 服务 |
|------|---------|------|------|
| 2.1 登录 | curl 实调 | ✅ 200, JWT 拿到 | usercenter api+rpc |
| 2.2 浏览 | curl 实调 | ✅ 200, 拿到 list | travel api+rpc |
| 2.3 下单 | curl 实调 | ✅ 200, orderSn 拿到 | order api+rpc+travel-rpc |
| 2.6 Kafka 消费 | 真实 subscribe | ✅ offset +1, trade_state 改 1 | order-mq |
| 2.7 D enqueue | 真实 enqueue | ✅ task 9c3958bc 进 Redis | order-rpc + asynq |
| 2.7 D 处理 | 真实 handler 跑 | ⚠️ 失败 (user_auth 缺) | mqueue-job |
| 2.8 关单 | 实验时改 Constant=1 | ✅ 60s 内 trade_state=-1 | mqueue-job |

### 3.2 哪些是模拟的 ⚙️

| 阶段 | 我们做的 | 跳过原因 |
|------|---------|---------|
| 2.4 微信预付 | 跳过整个支付 UI | 缺商户配置 |
| 2.4 微信回调 | 用 `kafka-console-producer` 手动推 1 条 | 不连微信环境 |
| 2.5 payment-rpc | 调用被绕过 (没让 payment-rpc 收到 UpdateTradeState) | 想直接验 Kafka 路径 |
| 2.10 入住 | 没碰 | 当前交易 demo 不需要 |

### 3.3 模拟命令 (实际跑的 4 件套)

```bash
# Stage 1+2 下单
TOKEN=$(curl -s -X POST :1004/usercenter/v1/user/login \
  -d '{"mobile":"18721432599","password":"test123456"}' | jq -r .data.accessToken)

START=$(date -v+10d +%s); END=$(date -v+12d +%s)
ORDER_SN=$(curl -s -X POST :1001/order/v1/homestayOrder/createHomestayOrder \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"homestayId\":1,\"isFood\":false,
       \"liveStartTime\":$START,\"liveEndTime\":$END,
       \"livePeopleNum\":2,\"remark\":\"M2_test\"}" \
  | jq -r .data.orderSn)

# Stage 3 ★ 模拟"支付完成"——推 Kafka 消息
docker exec kafka /bin/sh -c "
cd /opt/kafka/bin && \
echo '{\"OrderSn\":\"$ORDER_SN\",\"PayStatus\":1}' | \
./kafka-console-producer.sh \
  --bootstrap-server localhost:9094 \
  --topic payment-update-paystatus-topic"

# Stage 4 验证 4 件套
docker exec mysql ... "SELECT trade_state FROM homestay_order WHERE sn=..."  # ①
docker exec kafka ... kafka-consumer-groups.sh --describe ...                  # ②
docker exec -e REDISCLI_AUTH=... redis-cli LRANGE 'asynq:{default}:pending' .. # ③
tail tmp/logs/mqueue-job.log                                                    # ④
```

### 3.4 模拟与真实的关键差异

| 维度 | 模拟 | 真实 |
|------|------|------|
| 触发 Kafka | `kafka-console-producer` 推 1 条 | payment-rpc.Push (在 thirdPaymentWxPayCallback 里) |
| 错误恢复 | 我们手推, 不测试失败重试 | 实际 production 需要测 Kafka 不可达 / consumer 挂掉 |
| 时间精度 | 我们同步等, 不考虑 race | 真实要考虑 30min 关单 vs 用户付款同时发生的 race |
| 幂等性 | 没测 | order-mq.Consume 失败重试, kafka group offset 会回退, payload 重复处理要安全 |
| 状态机 | 我们手动控制 PayStatus=1 | 真实多个 status: 1=WaitUse, 2=Used, 3=Refund, ... |
| 监控/告警 | 我们没配 | 真实需要 Prometheus/Kibana + oncall |

---

## 4. 真实 vs 测试的 gap

### 4.1 dev/prod 必须补的

**A. 微信支付真实接入 (最高优先级)**
- ❌ 商户号、AppID、API 密钥
- ❌ HTTPS 回调域名 (生产) 或 ngrok (dev)
- ❌ WeChat OAuth 流程 (用户在 app 内登录)
- ❌ User 表的 AuthKey (OpenID/UnionID) 真正写入

**B. 监控/可观测**
- ❌ ch 11 日志收集 (filebeat→kafka→go-stash→ES→kibana) — M3 工作
- ❌ ch 12 链路追踪 (OTel collector → Jaeger/Tempo) — M3 工作
- ❌ ch 13 Prometheus + Grafana 验证 — M3 工作

**C. 网关**
- ❌ ch 02 nginx 网关 (auth_request) — M3 工作 / 或升级 APISIX

**D. 业务扩展**
- ❌ cron SettleRecord 实现 (现在是空 demo) — M3+ 工作
- ❌ 入住 trade_code 校验 / trade_state=2 切换 — M4+
- ❌ 退款流程 (PayStatus=3 → trade_state=3) — M4+

### 4.2 改进点 (dev 也可做)

**a. D handler dev 模式跳过**
```go
// paySuccessNotifyUser.ProcessTask
if l.svcCtx.Config.Mode != service.ProMode {
    // dev 模式: 不真发微信, 直接成功
    return nil
}
```
收益: M2 测试 D handler 不需要真 wx 配置也能跑完。

**b. 幂等性硬化**
- order-rpc.UpdateHomestayOrderTradeState 加版本号防并发
- Kafka consumer 开 manual ack

**c. M2 失败任务清理**
- 现在 retry 里有 25 次重试未完成的 9c3958bc task (因为没真 wx)
- 生产前清掉:
  ```bash
  docker exec -e REDISCLI_AUTH=G62m50oigInC30sf redis redis-cli \
    DEL 'asynq:{default}:t:9c3958bc-...' 'asynq:{default}:retry'
  ```

### 4.3 部署到测试环境 (staging) 还需要

1. **HTTPS**: 申请 cert, 配置 nginx
2. **域名**: 申请域名, 配 DNS
3. **微信回调**: 配置回调 URL = https://yourdomain/payment/v1/thirdPayment/thirdPaymentWxPayCallback
4. **测试公众号/小程序**: 申请测试 AppID, 配 sandbox 商户
5. **ngrok (本地 dev)**: 注册 ngrok, 启动转发
6. **asynq retention policy**: 默认 retention=0, 调整保留 30 天

---

## 5. 故障排查矩阵

### 5.1 "用户付款了, 但订单还是待支付"

| 排查步骤 | 命令 |
|---------|------|
| Kafka 收到消息了吗 | `kafka-run-class.sh kafka.tools.GetOffsetShell ...` 看 offset |
| order-mq 在跑吗 | `ps aux \| grep order-mq` + `redis-cli KEYS 'asynq:workers'` |
| Brokers 配置对吗 | `grep -A 2 Brokers: app/order/cmd/mq/etc/order.yaml` |
| group offset 有没有更新 | `kafka-consumer-groups.sh --describe --group payment-update-paystatus-group` |
| 处理有错吗 | `tail tmp/logs/order-mq.log` |

### 5.2 "用户付款了, 没收到通知"

| 排查步骤 | 命令 |
|---------|------|
| D 任务进 Redis 了吗 | `redis-cli ZRANGE 'asynq:{default}:pending' 0 -1` |
| mqueue-job worker 在吗 | `redis-cli KEYS 'asynq:servers:*'` |
| handler 失败原因 | `redis-cli HGETALL 'asynq:{default}:t:<taskID>'` (看 LastErr) |
| 用户 WeChat openid 在吗 | `SELECT * FROM looklook_usercenter.user_auth WHERE user_id=... AND auth_type='smallWX'` |

### 5.3 "订单 30 分钟还没关单"

| 排查步骤 | 命令 |
|---------|------|
| defer 任务还在 scheduled 吗 | `redis-cli ZRANGE 'asynq:{default}:scheduled' 0 -1 WITHSCORES` |
| CloseOrderTimeMinutes 是 30 吗 | `grep CloseOrderTimeMinutes app/order/cmd/rpc/internal/logic/createHomestayOrderLogic.go` |
| 二进制编译了吗 | `go build -o ./tmp/order-rpc ./app/order/cmd/rpc` |
| mqueue-job 在跑吗 | `ps aux \| grep mqueue-job` |

### 5.4 "编译失败"

| 排查步骤 | 命令 |
|---------|------|
| go.mod 同步了吗 | `go mod tidy && go mod download` |
| 哪个包冲突 | `go build ./...` 看 error |
| race condition | `go build -race ./...` |

---

## 6. 相关阅读

- [step-06 异步事件深度学习](step-06-async-event-deep-dive.md) — 4 类事件的代码定位
- [step-07 M2 e2e](step-07-m2-e2e.md) — 工作 doc + Stage-by-Stage 命令
- [step-replan](step-replan-2026-08-05.md) — A/B/C 优先级, M1/M2/M3/M4 规划
- [mqueue/cmd/job/README.md](../../app/mqueue/cmd/job/README.md) — job handler 列表
- [mqueue/cmd/scheduler/README.md](../../app/mqueue/cmd/scheduler/README.md) — cron 注册
- [order/cmd/mq/README.md](../../app/order/cmd/mq/README.md) — Kafka consumer 详情
- [doc/chinese/08 消息-延迟-定时队列](../../doc/chinese/08-消息-延迟-定时队列.md) — Mikael 教程原文
- [doc/chinese/06 订单服务](../../doc/chinese/06-订单服务.md) — Mikael 关于订单服务架构

---

*创建于 2026-08-07, 作为 M2.1 验证后的 reference doc*
