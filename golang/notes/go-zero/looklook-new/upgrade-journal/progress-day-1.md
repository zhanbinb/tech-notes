# 进度归档 - Day 1（2026-08-04）

> 历史归档：2026-08-04 的 Day 1 快照，仅供回顾；最新状态以 `README.md` 为准。

> 用途：今天的工作总结 + 明天从哪里继续  
> 状态：✅ Day 1 完成，git 干净，4 个 commit 待 push

---

## 今天完成的事

### Step 1：开发环境搭建 ✅
- 复制 v1 原项目到 `go-zero-looklook-new/`
- 启动 11 个中间件（mysql/redis/kafka/es/kibana/jaeger/prometheus/grafana/filebeat/go-stash/asynqmon）
- 导入 4 库数据（looklook_usercenter/order/payment/travel）
- 创建 2 个 kafka topic
- usercenter 跑通 register/login/detail（JWT 中间件验证 OK）
- **commit**: `db4c253`, `95c8d77`, `4ecaa3f`, `28ee06d`
- 笔记: `step-00-v1-baseline.md`, `step-01-env-setup.md`, `step-01.5-jwt-validation.md`

### Step 4a：go-zero v1.7.3 → v1.10.2 ✅
- 业务代码 0 编译错误（跨 3 个 minor 版本）
- 顺带升级 20+ indirect 依赖（grpc 1.65→1.80, k8s 0.29→0.34, 等）
- 配置改动：Telemetry.Batcher jaeger → file（go-zero 1.6+ 移除 jaeger 直连）
- usercenter 重新 build + smoke test 全部通过
- **commit**: `3fcee46`
- 笔记: `step-04a-go-zero-upgrade.md`

### Step 4b：jwt v4 → v5 ⏸️ deferred
- 决策：**不升级**
- 原因：go-zero 1.10.2 内部仍用 jwt v4，强升会冲突
- **commit**: `97f2ba5`
- 笔记: `step-04b-jwt-v5-deferred.md`

### Step 4c：go-redis v8 → v9 ✅ 业务已升级（白嫖）
- 决策：**不需要做**
- 关键发现：业务代码 0 处直接 import go-redis，100% 通过 go-zero wrapper
- go-zero 1.10.2 内部已用 v9，业务运行时实际走 v9
- v8 还在 indirect 是因为 asynq v0.20.0 内部依赖
- **commit**: `9043119`
- 笔记: `step-04c-go-redis-v9-status.md`

---

## 当前项目状态

```
go-zero-looklook-new/  (本地)
├── git: 7 commits, 4 ahead of origin
├── go-zero: v1.10.2 ✅
├── go: 1.22
├── jwt: v4 (deferred to go-zero 升 v5 后)
├── redis: v9 (业务层, 通过 go-zero wrapper)
├── pkg/errors: 仍在用
├── 跑通服务: usercenter (1/5)
└── notes/upgrade-journal/: 6 个 md + 2 个空目录

origin: https://github.com/zhanbinb/go-zero-looklook-new.git
本地领先 origin/main 4 个 commit，待 push
```

---

## 明天要继续的 roadmap

### P0：必做（Step 4d 收尾 + 验证）

#### 4d. pkg/errors → go-zero errorx（策略 B）
- 50+ 处 `errors.Wrapf` 替换
- **推荐分 2 批做**：
  - 4d-1：只改 usercenter（~18 处），验证方案 → 1 个 commit
  - 4d-2：扩展到 order/payment/travel/mqueue → 1 个 commit
- 笔记: `step-04d-pkg-errors-migration.md`
- **预计时间**：2-3 小时（含 build + smoke test）

### P1：重要

#### Step 2：升级开发工具链
- modd → cosmtrek/air（热加载）
- Dockerfile 基础镜像 golang-1.17.7-alpine → golang-1.25-alpine
- **预计时间**：1-2 小时

#### 跑通其他 4 个服务（baseline 完整闭环）
- travel / payment / order / mqueue
- 复制 usercenter 的模式（改 yaml 端口 + go build + smoke test）
- **预计时间**：2-3 小时

### P2：可选

#### 部署模式工程化
- host 模式（127.0.0.1）vs 容器模式（mysql:3306）
- 用 env var 替换或 profile-based config
- 笔记: `step-deployment-mode.md`

#### OpenTelemetry 集成
- go-zero 1.10 Batcher otlpgrpc
- 部署 otel-collector
- 笔记: `step-05-opentelemetry.md`

#### 修复 trace 启动时的 file exporter error
- 当前是 `Sampler: 0.0` 屏蔽 trace
- 集成 OTel 后自然解决

---

## 关键文件位置（明天要看的）

| 文件 | 用途 |
|---|---|
| `app/usercenter/cmd/rpc/etc/usercenter.yaml` | rpc 配置，Tel:host 端口已改 |
| `app/usercenter/cmd/api/etc/usercenter.yaml` | api 配置，Tel:Batcher=file Sampler=0.0 |
| `go.mod` | 当前依赖，go-zero 1.10.2 + go 1.22 |
| `pkg/xerr/` | 自定义错误码包（4d 改造时主要看这个） |
| `app/usercenter/cmd/rpc/internal/logic/` | 4d 试点的目标目录 |
| `notes/upgrade-journal/` | 所有笔记 |
| `/tmp/usercenter-rpc-1.10.2` | 当前跑的二进制（重启用） |
| `/tmp/usercenter-api-1.10.2` | 当前跑的二进制（重启用） |
| `study/notes/upgrade-journal/` | 原 study 下的笔记（保留中） |

---

## 明天从哪一行开始

**从 4d 开始**（P0）：
1. 打开 `pkg/xerr/` 看 xerr 包设计
2. 打开 `app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go` 看典型 Wrapf 用法
3. 决策：选 A（std errors）还是 B（go-zero errorx）—— 昨晚我们已经分析过 B 是推荐
4. 实施 4d-1（usercenter 试点）
5. 笔记 + commit

**或者先做 P1 的"跑通其他 4 个服务"**（如果想先把 baseline 完整闭环）

---

## 已知未完成（按优先级）

- [ ] **明天 P0**: 4d pkg/errors → errorx 改造
- [ ] P1: Step 2 工具链升级（modd → air）
- [ ] P1: 跑通 travel / payment / order / mqueue 4 个服务
- [ ] P2: 部署模式工程化
- [ ] P2: OpenTelemetry 集成
- [ ] P2: asynq 升级（独立项目，让 v8 从 indirect 消失）

---

## 4d 策略回顾（昨天没拍板的事）

| 策略 | 风险 | stack | 推荐度 |
|---|---|---|---|
| A. 完全 std errors | 🟢 简单 | ❌ 丢 stack | ⭐⭐ |
| B. go-zero errorx | 🟡 中 | ✅ 保留 | ⭐⭐⭐⭐⭐ **推荐** |
| C. 不动 | 🟢 零 | ✅ 保留 | ⭐⭐ |
| D. 渐进 | 🟡 中 | 部分 | ⭐⭐⭐ |

**建议**：明天回来直接选 B，分 2 批做（usercenter 试点 + 推广）。

---

## 反思（今天的）

1. **"白嫖"是 go-zero 升级的最大隐藏收益**——4a 顺带把 grpc/k8s/redis 全升了
2. **不要被 minor 数字吓到**——1.7→1.10 跨 3 个 minor 只遇到 1 个破坏性改动
3. **配置破坏性比代码破坏性更隐蔽**——升级后必须先启动一次确认 yaml 能解析
4. **sed 一定要 diff 验证**——昨天踩的坑
5. **跨依赖决策要看运行时调用图，不是 indirect 列表**——4c 的发现

---

## git 状态（明天 push 验证）

```
$ git log --oneline
9043119 v2.2: Step 4c (go-redis v8 -> v9) already done via Step 4a
97f2ba5 v2.1: defer Step 4b (jwt v4 -> v5) due to go-zero constraint
3fcee46 v2.0: upgrade go-zero v1.7.3 -> v1.10.2 (Step 4a)
28ee06d v1.3: validate JWT middleware via login+detail smoke test
4ecaa3f v1.2: append 坑4 + 已知未完成 + 补充反思 to step-01
95c8d77 v1.1: fix usercenter.yaml host port + transfer upgrade-journal notes
db4c253 v1: baseline from Mikaelemmmm/go-zero-looklook

$ git status
On branch main
Your branch is ahead of 'origin/main' by 4 commits.
nothing to commit, working tree clean
```

---

*此文档最后更新：2026-08-04 18:30*
