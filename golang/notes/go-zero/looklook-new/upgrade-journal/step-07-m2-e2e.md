# Step 07 M2: 跨 5 服务一笔订单 e2e

> 日期：2026-08-07 开始  
> 范围：从"M1 服务全活"升级到"M2 一笔订单真正走完业务闭环"  
> 状态：✅ M2 已验证（dev-e2e.sh 可复跑），M3/M4 由 [step-20](step-20-m3-m4-e2e-regression.md) 收尾  
> 前置：[step-06](step-06-async-event-deep-dive.md) 异步事件知识 + [step-05](step-05-business-baseline.md) M1 闭环

---

## 目标

跨 5 个业务服务 + Kafka + Redis **一笔订单**走完整链路：

```
login → browse → order → (pay) → notify → (settle / close)
                  ↑           ↑          ↑           ↑
                  业务服务    异步 Kafka   异步 asynq   异步 asynq
                  RPC 链      pub/sub     queue       defer
```

**核心观测点**：
- MySQL `homestay_order` 表的 **trade_state** 流转（0 → 1 → -1 等）
- Kafka topic `payment-update-paystatus-topic` 的消息产生与消费
- Redis `asynq:{default}:*` 各种 key 的进出

---

## 现在有便捷脚本 (2026-08-07 加)

不用记下面的所有 raw 命令, 直接用 2 个封装好的脚本:

| 任务 | 旧 (手工 docker exec) | 新 (封装脚本) |
|------|---------------------|---------------|
| 推 Kafka 模拟支付 | `docker exec kafka ... kafka-console-producer ...` (50+ 字符) | `./scripts/dev-kafka-push-pay.sh ORDER_SN=HSO...` |
| 看一笔订单全景 | 要跑 7-8 条命令 | `./scripts/dev-mq-trace.sh ORDER_SN=HSO...` |

下面 doc 里**保留** raw 命令当教学用. 真跑请用脚本.

## 跑 M2 之前 — Pre-flight checklist

- [ ] 11 个 binary 全活（`./scripts/dev-status.sh`）
- [ ] 5 个中间件全活（mysql / redis / kafka / jaeger / prometheus）
- [ ] `asynq:{default}:processed:DATE` SCARD = 0 (今日干净 start)
- [ ] 之前实验的下单 (HSO...) 清掉 (truncate homestay_order) 或者忽略测试自己产生的 sn

---

## M2.1 — 完整一笔订单 (happy path: 用户支付成功)

### Stage 1 — 用户身份 + 浏览民宿

```bash
# 1) 拿 token (登录)
TOKEN=$(curl -s -X POST http://127.0.0.1:1004/usercenter/v1/user/login \
  -H 'Content-Type: application/json' \
  -d '{"mobile":"18721432599","password":"test123456"}' \
  | jq -r .data.accessToken)
echo "TOKEN=${#TOKEN} chars"

# 2) 浏览房源列表 (公开接口, 不需要 token)
curl -s -X POST http://127.0.0.1:1003/travel/v1/homestay/homestayList \
  -H 'Content-Type: application/json' -d '{"page":1,"pageSize":5}' | jq '.data.list[0]'
# 预期: title 含 "海景大床房" 等我们 seed 的数据
```

> ✅ 这步我们 M1.5 已经验过, 关键是拿到 token 和确认 homestay 还能查

### Stage 2 — 真实下单 (event C 触发点)

```bash
# 3) 构造时间戳 (10 天后入住, 12 天后离开 = 2 晚)
START=$(date -v+10d +%s)
END=$(date -v+12d +%s)
echo "now=$(date +%s) START=$START END=$END"

# 4) ★ 真正下单
ORDER_RESP=$(curl -s -X POST http://127.0.0.1:1001/order/v1/homestayOrder/createHomestayOrder \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{
    \"homestayId\":1,
    \"isFood\":false,
    \"liveStartTime\":$START,
    \"liveEndTime\":$END,
    \"livePeopleNum\":2,
    \"remark\":\"M2_e2e_test\"
  }")
ORDER_SN=$(echo "$ORDER_RESP" | jq -r .data.orderSn)
echo "ORDER_SN=$ORDER_SN"
# 预期: code=200, orderSn 类似 "HSO20260807_xxxx"
```

### Stage 3 — ★★ Kafka pub/sub (event A 触发点)

> 这个是最关键的步骤。因为微信支付需要外网回调，
> 我们直接往 Kafka 推一条假消息当"支付完成"。

```bash
# 5) ★ 推一条 Kafka 消息, 模拟"用户已支付 PayStatus=1"
docker exec kafka /bin/sh -c "
cd /opt/kafka/bin && \
echo '{\"OrderSn\":\"$ORDER_SN\",\"PayStatus\":1}' | \
./kafka-console-producer.sh \
  --bootstrap-server localhost:9094 \
  --topic payment-update-paystatus-topic
"
# 预期: 没输出 = 推成功

# 6) 立即看 Kafka consumer offset
docker exec kafka /bin/sh -c "
cd /opt/kafka/bin && \
./kafka-run-class.sh kafka.tools.GetOffsetShell \
  --bootstrap-server localhost:9094 --topic payment-update-paystatus-topic
"
# 预期: ":0:1" (1 条消息)

# 7) ★ 立即看 order-mq.log 有没 consume
tail -n 30 tmp/logs/order-mq.log
```

### Stage 4 — ★★★ 验证 ground truth 4 件套

```bash
# === 4 件套验证 (这是 M2 成功的关键) ===

echo "==== ① MySQL: homestay_order trade_state 应该 0 → 1 ===="
docker exec mysql mysql -uroot -pPXDN93VRKUm8TeE7 looklook_order \
  -e "SELECT sn, trade_state, remark FROM homestay_order WHERE sn='$ORDER_SN'"
# 预期: trade_state=1 (WaitUse = 待使用, 因为 PayStatus=1 = 已支付)

echo ""
echo "==== ② Kafka: consumer offset +1 (刚推 1 条) ===="
docker exec kafka /bin/sh -c "
cd /opt/kafka/bin && \
./kafka-consumer-groups.sh \
  --bootstrap-server localhost:9094 \
  --describe --group payment-update-paystatus-group"
# 预期: 当前 offset 增加了

echo ""
echo "==== ③ Redis: asynq:{default}:pending 应该有 1 条 notify-user 任务 ===="
docker exec -e REDISCLI_AUTH=G62m50oigInC30sf redis redis-cli \
  ZRANGE 'asynq:{default}:pending' 0 -1 | grep -v Warning
# 或者:
docker exec -e REDISCLI_AUTH=G62m50oigInC30sf redis redis-cli \
  LRANGE 'asynq:{default}:pending' 0 -1 | grep -v Warning
# 预期: 看到 msg:pay_success:notify_user:xxx 这种 task ID

echo ""
echo "==== ④ mqueue-job: 立即处理 D 任务 (asynq queue 是即发即执行) ===="
tail -n 30 tmp/logs/mqueue-job.log
# 预期: 看到 paySuccessNotifyUser 相关 log
```

### Stage 5 — 同时验 event C (defer 关单)

```bash
# C 也在跑 (30 分钟后 fire, 但 CloseOrderTimeMinutes 默认 30 这里会等)
# 验 C 已 enqueue:
echo "==== Redis: asynq:{default}:scheduled ZSET 应该有 1 条 defer ===="
docker exec -e REDISCLI_AUTH=G62m50oigInC30sf redis redis-cli \
  ZRANGE 'asynq:{default}:scheduled' 0 -1 WITHSCORES | grep -v Warning
# 预期: defer:homestay_order:close + score (now + 30min)

# ★ 这里有个有意思的现象:
# 因为我们刚才推的 PayStatus=1 把 trade_state 改成 1 (WaitUse),
# 30 分钟后 closeOrder fire 时, 看到 trade_state != 0, 就 skip 改 trade_state
# 这正好是"用户已付款就不关单"的正确逻辑
```

---

## M2.2 — 全链路验证 (把上面 5 个 stage 串起来)

运行后再做一个**反向验证**:

```bash
# 1) 推一笔新单 → 等它跑完 → MySQL trade_state 回到 -1 (关了单)
#    (需要 30 分钟, 不现实用生产值, 临时改 CloseOrderTimeMinutes=1)

# 2) 另一个思路: 同一个 ORDER_SN 推两次 Kafka (一次 PayStatus=1, 然后别的)
#    看 trade_state 流转会不会出意外

# 3) 验证 Redis asynq:{default}:processed:DATE SCARD 增长
SCARD_BEFORE=$(docker exec -e REDISCLI_AUTH=G62m50oigInC30sf redis redis-cli \
  SCARD 'asynq:{default}:processed:2026-08-07')
echo "before SCARD=$SCARD_BEFORE"

# (触发一笔新订单完整流程... 见 M2.1)

SCARD_AFTER=$(docker exec -e REDISCLI_AUTH=G62m50oigInC30sf redis redis-cli \
  SCARD 'asynq:{default}:processed:2026-08-07')
echo "after SCARD=$SCARD_AFTER"
# 预期: $SCARD_AFTER > $SCARD_BEFORE (M2.1 至少产生 1 个 notify-user 处理计数)
```

---

## M2 成功标志 (Pass criteria)

- ✅ MySQL: 那条订单的 `trade_state=1`
- ✅ Kafka: 推到 topic 的消息 offset 推进
- ✅ Redis: 看到 `msg:pay_success:notify_user:xxx` 出现在 `{default}:pending`
- ✅ mqueue-job: 处理了 D 任务 (log 显示)
- ✅ asynq processed:DATE SCARD > 0
- ✅ 不报错: order-mq / order-rpc / payment-rpc 都没 error log

---

## 已知不在 M2 范围 (留作后续)

- ❌ 微信支付真实回调 (需要 ngrok + 商户号, M3 升级)
- ❌ M3 等: 跨多条订单的复杂测试
- ❌ ch 12 (OTel) / ch 11 (ELK 日志通道) — 那是视角 B 的事

---

## 调试清单 (按症状)

| 症状 | 先看 | 怎么排查 |
|------|------|----------|
| Kafka 推不出去 | stderr / exit code | `docker exec kafka /bin/sh` 进入容器试 |
| Kafka 消息没被消费 | order-mq.log + Brokers 配置 | `grep -A 2 'Brokers:' app/order/cmd/mq/etc/order.yaml` |
| MySQL trade_state 没改 | order-rpc.log + order-mq.log | 看 RPC 连接 |
| notify-user 任务没出现 | order-rpc 的 log | 看 WaitUse 转换逻辑 |
| mqueue-job 没消费 D | mqueue-job.log + Redis pending | 看 worker 注册 |

---

*创建于 2026-08-07, M2 工作的 working doc*

---

## §标准化记录 (2026-08-07)

### 测试手机号约定: **18721432599**

**所有后续 M2/M3/M4 实验 + 文档示例，统一用 `mobile=18721432599, password=test123456`**。

**历史变更**：
- Aug 5 之前: 文档散乱用了 `13800138000` (最初的"想当然"值), 实际 DB seed 是 `1384992923` (10 位)
- Aug 5 (step-01.5): 已观察到这个不一致, 标"待查"但没修
- **Aug 7 (M2)**: 决定统一 → 全部替换成 `18721432599` (11 位, 标准手机号格式)

**DB 状态**：
- 实际 user 表可能还是 `1384992923` (如果未同步 DB)
- 建议后续运行一个 SQL 把 user.mobile 也改成 `18721432599`, 与文档一致:

```sql
UPDATE looklook_usercenter.user SET mobile='18721432599' WHERE id=1;
INSERT INTO looklook_usercenter.user_auth (user_id, auth_type, auth_key)
VALUES (1, 'smallWX', 'fake-openid-for-test')
ON DUPLICATE KEY UPDATE auth_key='fake-openid-for-test';
```

(执行后 M2.1 的 D handler 会从 retry 路径变成真 success)

**所有 sed 替换的 doc**:
- step-01-env-setup.md
- step-01.5-jwt-validation.md
- step-04d-pkg-errors-migration.md
- step-05-business-baseline.md
- step-07-m2-e2e.md
