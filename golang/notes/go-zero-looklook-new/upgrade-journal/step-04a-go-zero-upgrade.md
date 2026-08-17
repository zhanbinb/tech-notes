# Step 4a: go-zero v1.7.3 → v1.10.2 升级

> 日期：2026-08-04  
> 目的：把 go-zero 从 v1.7.3 升到 v1.10.2（与 go-zero-platform 一致），验证 1.7→1.10 跨 3 个 minor 版本的兼容性  
> 状态：✅ 升级成功 + smoke test 通过

## 升级目标

- **go-zero**: v1.7.3 → v1.10.2（跨 1.8 / 1.9 / 1.10 三个 minor 版本）
- 目标版本选择理由：与 go-zero-platform 项目保持一致（platform 已经在 1.10.2 验证过）

## 改动清单

- `go.mod`: go-zero v1.7.3 → v1.10.2
- `go.sum`: 顺带升级 20+ 个 indirect 依赖
- `app/usercenter/cmd/rpc/etc/usercenter.yaml`: Telemetry.Batcher `jaeger` → `file`，Sampler `1.0` → `0.0`
- `app/usercenter/cmd/api/etc/usercenter.yaml`: 同上

## 关键命令

```bash
# 升级
go get github.com/zeromicro/go-zero@v1.10.2
go mod tidy

# 编译
go build -o /tmp/usercenter-rpc-1.10.2 ./app/usercenter/cmd/rpc
go build -o /tmp/usercenter-api-1.10.2 ./app/usercenter/cmd/api
```

## 顺带升级的依赖（go-zero 1.10.2 拉进来的）

| 依赖 | v1.7.3 | v1.10.2 | 备注 |
|---|---|---|---|
| go-zero | v1.7.3 | v1.10.2 | 主升级 |
| google.golang.org/grpc | v1.65.0 | v1.80.0 | 跨 15 个 minor |
| google.golang.org/protobuf | v1.35.1 | v1.36.11 | |
| k8s.io/api | v0.29.3 | v0.34.3 | 跨 5 个 minor |
| k8s.io/apimachinery | v0.29.4 | v0.34.3 | |
| k8s.io/client-go | v0.29.3 | v0.34.3 | |
| golang.org/x/crypto | v0.28.0 | v0.48.0 | |
| golang.org/x/net | v0.30.0 | v0.50.0 | |
| golang.org/x/sys | v0.26.0 | v0.41.0 | |
| golang.org/x/text | v0.19.0 | v0.34.0 | |
| 等等 | | | 共 20+ 个 indirect |

## 关键发现

### 1. 业务代码 0 编译错误

- 跨 3 个 minor 版本升级，**业务代码完全不动**
- 说明 go-zero 1.7 → 1.10 在 API 层向后兼容做得不错
- 二进制大小变化：rpc 72M → 89M（+17M），api 65M → 80M（+15M）—— 可能新增了 OpenTelemetry 相关代码

### 2. **1 个配置破坏性改动：Telemetry.Batcher 字段**

**错误信息**：
```
error: config file ..., error: value "jaeger" is not defined in options "[zipkin otlpgrpc otlphttp file]"
```

**原因**：
go-zero 1.6+ 转向 OpenTelemetry 协议，**移除了 jaeger 直连 batcher**。原项目用 jaeger 直连（`Endpoint: http://jaeger:14268/api/traces` + `Batcher: jaeger`），1.10 不再支持。

**go-zero 1.10 的 Batcher 选项**：

| 选项 | 协议 | 用途 |
|---|---|---|
| `zipkin` | Zipkin | 旧 trace 协议 |
| `otlpgrpc` | OpenTelemetry gRPC | **推荐**，OTLP 标准 |
| `otlphttp` | OpenTelemetry HTTP | OTLP over HTTP |
| `file` | 写本地文件 | 仅用于调试 |

**修复方案**（本次临时用）：
```yaml
Telemetry:
  Sampler: 0.0        # 不采样
  Batcher: file        # 写到本地文件
```

**生产推荐**（未来做 OpenTelemetry 集成时）：
```yaml
Telemetry:
  Endpoint: otel-collector:4317  # OTLP gRPC 标准端口
  Sampler: 1.0
  Batcher: otlpgrpc
```

**注意**：用 file batcher 时，Endpoint 字段不起作用但会启动时报错 `open http://...: no such file or directory`，**不影响业务**。

## 验证结果

- [x] go-zero 1.10.2 安装成功
- [x] go mod tidy 0 错误
- [x] go build rpc/api 都成功
- [x] usercenter 启动成功（端口 2004 + 1004 LISTEN）
- [x] smoke test: register/login/detail 走通（响应格式同 step-01.5）

## 踩坑记录

### 坑 5：go-zero 1.7 → 1.10 第一个破坏性改动（Telemetry.Batcher）

- 错误：`value "jaeger" is not defined in options "[zipkin otlpgrpc otlphttp file]"`
- 修复：Batcher: `file` + Sampler: `0.0`（临时）/ Batcher: `otlpgrpc` + Endpoint: `otel-collector:4317`（生产）
- 教训：升级跨 minor 版本时，**先看 go-zero 官方 changelog 里的 BREAKING CHANGES**。这一步我之前没做，导致启动失败才回头查

### 坑 6：go run 启动的进程 pkill -INT 杀不掉

- 原因：`go run` 的实际进程名是 `go`，pkill usercenter 找不到
- 修复：`pkill -9 -f "usercenter"` 杀完整命令行
- 教训：杀进程要带 `-f` 匹配整个命令行

## 反思

### 1. 跨 3 个 minor 升级其实"风险不大"

- 之前以为 1.7 → 1.10 跨 3 个 minor 会很乱
- 实际只遇到 **1 个**破坏性改动（Telemetry），且是 yaml 字段不是 go 代码
- go-zero 团队的 API 兼容做得不错
- **教训**：不要被 minor 数字吓到，实际破坏性改动经常集中在 1-2 个具体点

### 2. 配置文件破坏性比代码破坏性更隐蔽

- 编译会立刻报代码错误
- 但 yaml 字段错误要**启动时**才发现
- **教训**：升级后**先启动一次**（哪怕失败也行）确认配置文件能解析，比直接调业务接口更高效

### 3. 顺带升级 20+ indirect 依赖是正常的

- 看似可怕（grpc 1.65→1.80 跨 15 个 minor）
- 但 indirect 依赖不直接用，只在 go-zero 内部调用
- go-zero 团队应该测试过这些组合
- **教训**：升级主库时**让 go mod 自己选** indirect 依赖，不要手动指定，否则容易锁死老版本

### 4. "破坏性改动集中在 1.6 那一波"是 go-zero 升级的常识

- 1.6 是 go-zero 从"老式 jaeger 直连"转向"OpenTelemetry"的转折点
- 任何升级跨 1.6 的项目都要准备改 Telemetry 配置
- 这次升级虽然没有跨 1.6（1.7→1.10），但 Batcher 选项是 1.6 改完后继承下来的

## 下一步

- [x] ~~Step 4a: go-zero v1.7.3 → v1.10.2~~ ✅
- [ ] **Step 4b**: golang-jwt v4 → v5
- [ ] Step 4c: go-redis/redis v8 → v9
- [ ] Step 4d: pkg/errors → std errors
- [ ] Step 2: 升级开发工具链（modd → air）
- [ ] 部署模式工程化（host vs container）
