# Step 4c: go-redis v8 → v9 状态（业务已升级，asynq 暂不处理）

> 日期：2026-08-04  
> 目的：决策记录——go-redis v8 → v9 实际上"已经发生"了，只是我们没显式做  
> 状态：✅ 业务层已完成（白嫖 v9），⏸️ asynq 暂不处理

## 关键发现：业务层已经走 v9 了

| 业务层 | 实际走哪个 go-redis 版本 |
|---|---|
| usercenter (`RedisClient *redis.Redis`) | **v9**（通过 go-zero wrapper） |
| order (`Redis redis.RedisConf`) | **v9**（通过 go-zero wrapper） |
| travel / payment | **v9**（通过 go-zero wrapper） |
| mqueue scheduler / job | **v8**（asynq v0.20.0 内部） |

**业务代码 100% 通过 go-zero 的 wrapper 调用**：

```bash
$ grep -rh ""github.com.*redis"" --include="*.go" | sort -u
        "github.com/zeromicro/go-zero/core/stores/redis"
```

只有 1 种 import：go-zero 的 wrapper。**没有任何业务代码直接 import go-redis v8 或 v9**。

## go-redis v8 / v9 现状

| 库 | 版本 | 状态 | 原因 |
|---|---|---|---|
| `github.com/redis/go-redis/v9` | v9.19.0 | indirect | **go-zero 1.10.2 内部用 v9** |
| `github.com/go-redis/redis/v8` | v8.11.5 | indirect | **asynq v0.20.0 内部用 v8** |

**go-zero 1.10.2 → go-redis v9 的传递升级是 Step 4a 顺带完成的**（go-zero 团队已经在 1.5+ 切到 v9）。

## 候选策略分析

### 策略 A：不动（业务已升级，asynq 暂不处理）✅ **本次选择**
- 业务代码已走 v9（白嫖 go-zero 1.10.2 的升级）
- v8 还在 indirect 纯粹因为 asynq v0.20.0
- **风险**：🟢 零
- **收益**：业务层 100% 已经在 v9，运行时性能/特性享受 v9 的所有改进
- **代价**：go.mod 里 `v8 // indirect` 那一行还在，看着不爽

### 策略 B：升级 asynq 到支持 v9 的版本
- asynq 后续版本（v0.24+）可能切到 v9
- **风险**：🟡 中
  - asynq v0.20 之后有多个版本，要看 release notes 看哪个切 v9
  - 可能带其他 API 变化
- **收益**：v8 从 indirect 消失，go.mod 更干净
- **代价**：要单独做一次 asynq 升级的笔记

### 策略 C：换掉 asynq，用 river / Temporal
- 推倒 mqueue 异步栈
- **风险**：🔴 高
- **收益**：依赖图最干净
- **代价**：mqueue 整套重写，应该跟"切换异步栈"独立项目一起做

## 选择 A 的理由

1. **业务层已经 100% 走 v9**——这是关键。v8 在 indirect 只影响编译产物大小（多几百 KB），不影响运行时
2. **asynq v0.20.0 是 2022 年的老版本**，v0.20 之后有多个版本，单独升级 asynq 也是个独立项目
3. **换 asynq 是大改造**，应该跟"切换异步栈"独立的项目一起做（涉及 mqueue 整套重写）
4. **当前最重要的是验证业务能跑通**，不是清理 indirect 依赖

## 当前 redis 实际调用图

```
业务代码 (5 个服务)
    ↓
go-zero/core/stores/redis (go-zero 1.10.2 wrapper)
    ↓
github.com/redis/go-redis/v9 v9.19.0  ← 业务实际走这里 ✅

(mqueue 的 asynq 内部)
    ↓
github.com/go-redis/redis/v8 v8.11.5  ← 只有 asynq 自己用，业务不感知
```

## 何时回来做 4c 的 B 策略

- **触发条件**：asynq 官方 release notes 说 "upgrade go-redis to v9"
- **触发条件**：社区普遍认为 asynq v0.20+ 稳定，准备做 asynq 升级
- **触发条件**：项目里要替换/废弃 mqueue 服务

## 实际效果

| 检查项 | 结果 |
|---|---|
| 业务代码是否走 v9 | ✅ 是 |
| go.mod 是否还有 v8 | ✅ 还在（asynq 间接） |
| 运行时是否受影响 | ✅ 不受影响 |
| 业务代码是否要改 | ✅ 0 改动 |

## 下一步

- [x] ~~Step 4c: go-redis v8 → v9~~ ✅ 业务层已升级
- [ ] **Step 4d**: pkg/errors → std errors
- [ ] Step 2: 升级开发工具链（modd → air）
- [ ] 部署模式工程化（host vs container）
- [ ] 跑通其他 4 个服务（travel / payment / order / mqueue）
- [ ] 未来回看 asynq 升级（独立项目）

## 反思

### "白嫖"是 go-zero 1.7→1.10 升级的最大隐藏收益

- 4a 升级表面看是"go-zero 升级"
- 实际顺带：**grpc / protobuf / k8s / go-redis 全部跟着升到现代版本**
- go-zero 团队作为"上游"，他们做的升级会自动惠及所有用户
- **教训**：升级主框架时，要看顺带升级的依赖，可能已经"白嫖"了很多现代版本

### "indirect 依赖"不等于"运行时依赖"

- go.mod 里的 `// indirect` 只是"我们没直接 import，但 go-zero 内部 import"
- 运行时实际调用的是 v9（go-zero 内部）
- v8 在 indirect 只是"asynq 内部编译时需要"
- **教训**：不要看到 indirect 就想清掉，要看运行时调用图
