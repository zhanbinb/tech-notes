# ADR-0005 真实后端端口修正（之前猜错了）

- 状态: 已接受
- 日期: 2026-08-12
- 取代: 所有之前写"8000/8001/8002/8003"的文档和 config

## 背景

阶段 1-2 我先入为主猜了后端端口 `8000-8003`，**没查后端 etc 配置文件**。
阶段 7 联调时我又**没跑后端 curl 测试**，把猜测直接当成事实传播到所有文档。

## 真相（来自后端 etc/*.yaml 实际配置）

| 服务           | etc 文件                                     | Port     |
| -------------- | -------------------------------------------- | -------- |
| usercenter-api | `app/usercenter/cmd/api/etc/usercenter.yaml` | **1004** |
| travel-api     | `app/travel/cmd/api/etc/travel.yaml`         | **1003** |
| order-api      | `app/order/cmd/api/etc/order.yaml`           | **1001** |
| payment-api    | `app/payment/cmd/api/etc/payment.yaml`       | **1002** |

**注意**：端口顺序 ≠ 服务顺序。这是 go-zero 项目的内部约定。

## 修正范围

| 文件                                       | 修改                       |
| ------------------------------------------ | -------------------------- |
| `vite.config.ts`                           | 4 个 proxy target 全部修正 |
| `src/main.ts`                              | banner 提示端口号          |
| `src/api/client.ts`                        | 网络错误提示端口号         |
| `docs/api/openapi.yaml`                    | servers description        |
| `docs/api/services-architecture.md`        | 端口表                     |
| `docs/api/inventory.md`                    | 路由基准                   |
| `docs/dev-backend.md`                      | 端口监听验证               |
| `docs/backend/setup.md`                    | 启动指南                   |
| `docs/PRD.md`                              | 模块清单端口               |
| `docs/adr/0003-product-decisions-q1-q3.md` | dev proxy 注释             |
| `scripts/start-backend.sh`                 | 监听验证                   |
| `scripts/use-backend.sh`                   | 提示                       |

## 教训

**不要"凭印象"传递端口号**。每次跨服务引用端口前都跑：

```bash
grep -E "^Port:" /path/to/service/etc/*.yaml
```

`_postTask`: 后续阶段 7/8/9 涉及端口时再次 grep 验证。

## 凭据

- 后端 git sha: 见用户电脑 `cd ../go-zero-looklook-new && git rev-parse HEAD`
- 验证时间: 2026-08-12
- 验证者: Codex (用户报告 8000-8003 错误后)
