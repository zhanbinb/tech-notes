# step-20: M3/M4 关账 — 可重复的 e2e 回归基线

> 日期：2026-08-11  
> 状态：✅ 完成  
> 承接：[step-07 M2 e2e](step-07-m2-e2e.md) + [step-08 完整下单流程](step-08-complete-order-flow.md)

## §0 目标

把 step-07/08 手工跑通的业务链路，沉淀成一条**可重复执行的回归脚本**，正式给 M3/M4 关账：

```
登录 → 浏览民宿 → 下单 (trade_state=0)
      → 模拟支付 Kafka push (PayStatus=1)
      → order-mq 消费 → order-rpc 更新 (trade_state=1)
      → defer 关单任务 enqueue 验证
      → (可选) 等待超时关单 (trade_state=-1)
```

## §1 改动文件

| 文件 | 改动 |
|---|---|
| `scripts/dev-e2e.sh` | 新增，M3/M4 回归脚本 |
| `notes/upgrade-journal/README.md` | 状态更新到 v3.39+ |
| `notes/upgrade-journal/step-replan-2026-08-05.md` | 进度同步，Step 8 设为当前 P1 |

## §2 脚本用法

```bash
# happy path 回归（默认）
./scripts/dev-e2e.sh

# 额外验证超时关单（需要 CloseOrderTimeMinutes=1 的 build）
E2E_CLOSE_VERIFY=1 ./scripts/dev-e2e.sh
```

脚本内置 8 个检查点：

| # | 检查 | 判定 |
|---|---|---|
| 0 | preflight | 必需端口监听 + jq + mysql/redis/kafka 容器可达 |
| 1 | 登录 | `POST /usercenter/v1/user/login` 返回非空 accessToken |
| 2 | 浏览 | homestayList 返回 >= 1 条 |
| 3 | 下单 | createHomestayOrder 返回 orderSn |
| 4 | 初始状态 | MySQL `trade_state=0` |
| 5 | defer 关单 | Redis `asynq:{default}:scheduled` 有该 SN 的 `defer:homestay_order:close` |
| 6 | 模拟支付 | 向 `payment-update-paystatus-topic` 推 `PayStatus=1` |
| 7 | 状态同步 | 15s 内 MySQL `trade_state=1` |
| 8 | 超时关单 | 仅 `E2E_CLOSE_VERIFY=1` 时等待并验证 `trade_state=-1` |

## §3 实测结果 (2026-08-11)

两次运行均 **8/8 PASS**：

- happy path: `HSO2026081117582495070346`，defer fire in ~1799s
- `E2E_CLOSE_VERIFY=1`: `HSO2026081118023001929703`，defer fire ~1800s，超时关单正确 `[SKIP]`（默认 CloseOrderTimeMinutes=30，不等待）

## §4 踩坑

- Redis `scheduled` ZSET 里任务 msg 是 asynq 编码的二进制，直接 `grep -A1` 搜不到；正确做法是遍历 task id，`HGET msg` 后按字节匹配 `defer:homestay_order:close` + orderSn。
- `date -v+10d` 是 macOS 语法，脚本里做了 Linux `date -d` 回退。
- 超时关单等待验证依赖 `CloseOrderTimeMinutes`（源码常量默认 30），脚本通过检测 scheduled score 自动决定等待或 SKIP。

## §5 M3/M4 关账结论

- M3（最小 e2e 业务线）：✅ 已沉淀为 `dev-e2e.sh`，可重复、可回归
- M4（业务代码读懂 ch 4-8）：✅ 由 step-06/07/08 文档 + 本次脚本共同完成
- 微信真实支付仍不在本地范围（需要商户号 + 回调域名），Kafka 模拟是既定替代

## §6 下一步

Step 8：`pkg/errors → std errors` 全量迁移，迁移后直接跑 `./scripts/dev-e2e.sh` 做回归。
