# Step 02.5 (done): air 单文件统一管理全部服务

> 日期：2026-08-05  
> 状态：✅ 完成 + 验证通过  
> 提交：v3.8 air unified (modd.conf style)

## 目标
把 air 从「per-service 多配置文件」(air.usercenter.toml + start-usercenter.sh) 改成「**一个 .air.toml 管全部服务**」，对标 modd.conf 的统一管理方式。

## 产出
| 操作 | 文件 |
|---|---|
| 新增 | `.air.toml` (用新版 `entrypoint` 替代已废弃的 `full_bin`) |
| 新增 | `scripts/dev-build.sh` (构建 11 个 binary 到 ./tmp/) |
| 新增 | `scripts/dev-up.sh` (后台启 11 个服务 + trap 清理 + poll loop) |
| 新增 | `scripts/dev-down.sh` (按服务名清理残留, 覆盖任意目录) |
| 新增 | `scripts/dev-status.sh` (端口 + 进程状态) |
| 删除 | `air.usercenter.toml` |
| 删除 | `scripts/start-usercenter.sh` |
| 修改 | 11 个 `app/*/cmd/*/etc/*.yaml` 的 telemetry `Endpoint` (见下) |

## 修的 3 个坑
1. **air v1.67.4 起 `full_bin` 已废弃** —— 改用 `entrypoint = ["./scripts/dev-up.sh"]` (行为完全一致, 已读 air 源码确认).
2. **`dev-down.sh` 按服务名 pkill** —— 之前的 `./tmp/xxx` 模式匹配不到 `tmp/services/` 下的旧进程; 改成按 `usercenter-rpc` 等服务名清理, 覆盖 tmp/ tmp/services/ /tmp/ data/server/ 任意路径.
3. **telemetry `Endpoint` 修复** —— `Batcher: file` 模式下 Endpoint 应是本地文件路径, 但 11 个 yaml 还残留 `http://jaeger:14268/api/traces` URL, 启动时每个服务都报 `file exporter endpoint error`. 改成 `./data/traces`.

## 顺带发现的编辑器问题
Trae CN + Even Better TOML 插件把 `.air.toml` 误关联到了 **posit-dev/air** (R 语言 formatter, 也叫 air, 也用 `.air.toml`) 的 schema, 全字段红线. 项目里加了 `.vscode/settings.json` 关闭 schema 校验 (`.vscode/` 已 gitignore).

## 验证
- ✅ `dev-build.sh` 11 个服务全部编译 (80~92M each, 已 gitignore)
- ✅ `dev-status.sh` 显示 8 个 api/rpc 端口 LISTEN (1001-1004 + 2001-2004)
- ✅ 10/11 进程运行 (`order-mq` 未起, TODO 后续排查 — 在 A1 阶段就被标记为 "log 为空", 非本次回归)

## 关键命令
```bash
# 启动
air -c .air.toml

# 查看状态
./scripts/dev-status.sh

# 停止全部
./scripts/dev-down.sh
```

## 反思
- macOS bash 3.2 不支持 `wait -n`, 用 ps 状态 + wait 收割做 poll loop
- air v1.67.4 在 macOS 用 `syscall.Kill(-pid, SIGKILL)` 杀整个进程组, `send_interrupt=true` 让脚本 trap 先优雅清理

---

## 后续纠错（2026-08-05, v3.9 修复）

上方"10/11 进程运行 (order-mq 未起)"的判断有误，**真相是 dev-up.sh 设计缺陷**：
- 原 `dev-up.sh` 启动服务时 `"$bin" -f "$cfg" &` 完全没有 stdout/stderr 重定向
- log 跟着后台进程飘走，没有文件落地
- 当时 `ls tmp/logs/` 直接报"找不到目录"——所以"日志为空 = 进程死了"的推断证据不充分
- **真相：order-mq / mqueue-scheduler / mqueue-job 一直活着**，阻塞在 `serviceGroup.Start()` / `Scheduler.Run()` / `AsynqServer.Run(mux)`，没产生可见 output

**修复**：v3.9 commit —— dev-up.sh 加 `mkdir -p tmp/logs` + `>> "tmp/logs/${name}.log" 2>&1 &`。

修复后用户已确认 `ls tmp/logs/` 有文件产生，等待 `tail -n 50 tmp/logs/<name>.log` 的内容。

详细诊断过程见 [`step-05-business-baseline.md`](step-05-business-baseline.md) "步骤 ⑨⑩ 发现"section。

> 保留这段历史结论作为 record-of-truth，因为 step-02.5 当时下结论时确实"找不到证据"；但**事实层面"未起"的说法应该被推翻**。
