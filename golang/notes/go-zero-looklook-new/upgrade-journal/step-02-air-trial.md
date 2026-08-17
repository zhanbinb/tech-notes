# Step 2: 开发工具链升级 modd → air (最小试用)

> 日期：2026-08-05  
> 范围：只配 usercenter-rpc 试跑  
> 状态：✅ 配置文件已写，待 host 安装 air 试跑

## 决策

**只写 `air.usercenter.toml`，不写其他 4 个服务的 .toml，不删 modd.conf**。

理由：
- 试运行，看 air 是否真的比手写 `go build + nohup` 体验好
- 保留 modd.conf 做 rollback 兜底
- 不一次性给所有服务配 air（避免一刀切）

## modd vs air 对比（已确认的关键差异）

| 维度 | modd | air |
|---|---|---|
| 维护状态 | 2021 后低频更新 | 活跃（cosmtrek 维护）|
| 终端 UI | 朴素文本 | 彩色 + 进度条 + web UI |
| Go 专用 | ❌ 通用文件监控 | ✅ 专为 Go 设计 |
| build 错误时 | 杀旧进程 | **保留旧进程**（不打断） |
| 增量 build | 手动配置 | 自动支持 |
| 配置格式 | modd.conf（DSL）| .air.toml（TOML）|
| 监控范围 | 改一个文件 → **11 个服务全 build** | 改一个文件 → **只 build 当前服务** |

## 实际改动

| 文件 | 状态 | 说明 |
|---|---|---|
| `air.usercenter.toml` | ✅ 新建 | air 配置（usercenter-rpc 单服务）|
| `modd.conf` | ⏸️ 保留 | 不删，做 rollback 兜底 |
| `Dockerfile` | ❌ 不写 | 原项目也没有，跳过 |

## air.usercenter.toml 关键配置

```toml
[build]
  cmd = "go build -o ./tmp/usercenter-rpc ./app/usercenter/cmd/rpc"
  bin = "./tmp/usercenter-rpc -f ./app/usercenter/cmd/rpc/etc/usercenter.yaml"
  delay = 1000
  stop_on_error = true
  include_ext = ["go", "yaml", "yml"]
  exclude_dir = ["data", "tmp", "vendor", "deploy", "node_modules", ".git", "notes"]
```

**关键设计**：
- 改 .go **和** .yaml 都触发 build（适配 go-zero 配置驱动开发）
- 排除 `data/`（中间件数据）+ `deploy/`（运维脚本）+ `notes/`（笔记）
- `stop_on_error = true`：build 失败**不杀旧进程**，旧版继续跑（避免开发被打断）

## host 上试跑的步骤

### 1. 安装 air
```bash
go install github.com/cosmtrek/air@latest
```
**注意**：`go install` 默认装到 `$GOPATH/bin`，确保这个目录在 `$PATH` 里。

### 2. 停掉手动跑的 usercenter-rpc
```bash
kill -9 $(lsof -nP -iTCP:2004 -sTCP:LISTEN -t 2>/dev/null) 2>/dev/null
# 也清掉 /tmp/usercenter-rpc-migrated（air 会用 ./tmp/usercenter-rpc 替代）
```

### 3. 在项目根目录跑 air
```bash
cd /Users/yangpeipei/Develop/web3/study/codex_project/go-project/go-zero-looklook-new
air -c air.usercenter.toml
```

### 4. 验证
- air 应该自动 build + 启动 usercenter-rpc
- 改一个 .go 文件（比如 `app/usercenter/cmd/rpc/internal/logic/loginLogic.go` 加个 log）
- 看到 air 自动检测 → rebuild → 重启
- `lsof -nP -iTCP:2004` 看到新 PID
- smoke test 还能通

### 5. 试完评估
- **体验好** → 决定要不要推广到其他 4 个服务
- **体验不好** → 删 air.usercenter.toml，保留 modd.conf 当做"配置占位"（反正从来没在 host 跑过）

## 为什么不用 .air.toml

air 默认读 `.air.toml`（隐藏文件）。我们用 `air.usercenter.toml` 是因为：
- 未来可能要加 `air.travel.toml` / `air.payment.toml` / ...
- 默认文件名只能有 1 个，用命名后缀可以并存
- 显式 `-c air.usercenter.toml` 比隐式更清楚

## 试跑结果（2026-08-05 11:15）

✅ **air v1.67.4 装好**, ✅ **build 成功**, ✅ **自动重启工作**, ✅ **smoke test 通过**

## 踩坑记录

### 坑 10：air 不认 `args` 字段，必须用 `full_bin`

第一版我写：
```toml
[build]
  bin = "./tmp/usercenter-rpc -f ./app/usercenter/cmd/rpc/etc/usercenter.yaml"
```
报错：`/bin/sh: ...usercenter-rpc -f ./...: No such file or directory`
原因：air 把整个 `bin` 当成可执行路径，参数部分被当成路径一部分

第二版我加 `args` 字段：
```toml
[build]
  bin = "./tmp/usercenter-rpc"
  args = ["-f", "./app/usercenter/cmd/rpc/etc/usercenter.yaml"]
```
报错：`config file etc/usercenter.yaml, open etc/usercenter.yaml: no such file or directory`
原因：**新版 air 没有 `args` 字段**（我误以为是有的）

第三版（最终正确）：
```toml
[build]
  full_bin = "./tmp/usercenter-rpc -f ./app/usercenter/cmd/rpc/etc/usercenter.yaml"
```
✅ air 认 `full_bin`，参数正确传递

**教训**：不要靠记忆写 air 字段名，**查源码**（`runner/config.go`）或 `air init` 生成默认配置再改

### 坑 11：air 跟 nohup 不能共存

air 跑的时候占 2004 端口，原来手动 nohup 的 usercenter-rpc 也占 2004
第一个 air 启动失败，提示 `bind: address already in use`

**修复**：跑 air 之前先 `kill` 掉手动跑的进程

## 最终配置（air.usercenter.toml 关键部分）

```toml
[build]
  cmd = "go build -o ./tmp/usercenter-rpc ./app/usercenter/cmd/rpc"
  # 不用 bin + args, 用 full_bin 一行搞定
  full_bin = "./tmp/usercenter-rpc -f ./app/usercenter/cmd/rpc/etc/usercenter.yaml"
  delay = 1000
  stop_on_error = true
  include_ext = ["go", "yaml", "yml"]
  exclude_dir = ["data", "tmp", "vendor", "deploy", "node_modules", ".git", "notes"]
```

## 试跑效果

| 检查 | 结果 |
|---|---|
| 装 air (`go install github.com/air-verse/air@latest`) | ✅ v1.67.4 |
| `which air` 找到 | ✅ `/Users/yangpeipei/.go_path/bin/air` |
| air 启动 build usercenter-rpc | ✅ Build success |
| 端口 2004 LISTEN | ✅ |
| 改 .go 文件 → air 自动 rebuild | ✅ |
| 改 .go 文件 → air 自动重启 usercenter-rpc | ✅ |
| smoke test (login) | ✅ code 200, 拿到 token |
| 彩色输出 + 状态条 | ✅ 体验比 modd 好 |

## 结论

**air 替换 modd 验证通过**, 可以考虑推广到其他 4 个服务.

## 待定事项（试完再决定）

- [ ] air 试跑体验如何？
- [ ] 要不要给其他 4 个服务也写 .air.toml？
- [ ] 要不要删 modd.conf？（如果 air 完全替代）
- [ ] 要不要加 `air` 章节到 README？
