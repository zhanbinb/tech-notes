# Step 4b: jwt v4 → v5 暂缓（deferred）

> 日期：2026-08-04  
> 目的：决策记录——为什么 jwt v4 → v5 不升，以及什么时候回来做  
> 状态：⏸️ deferred（等 go-zero 升 v5 后再回来）

## 决策

**Step 4b 暂不执行**，`golang-jwt/jwt/v4` 保持 v4.5.2。

## 原因

`go-zero v1.10.2` 内部仍然依赖 `github.com/golang-jwt/jwt/v4 v4.5.2`。

```
$ go list -m all | grep jwt
github.com/golang-jwt/jwt/v4 v4.5.2
```

业务代码 `app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go` 用的也是 v4：
- `jwt.MapClaims`
- `jwt.New(jwt.SigningMethodHS256)`
- `token.Claims = claims`
- `token.SignedString([]byte(secretKey))`

## 候选策略分析

### 策略 A：跟随 go-zero，暂不升级 ✅ **本次选择**
- 保持 jwt v4
- **风险**：🟢 零
- **收益**：维持当前稳定状态
- 后续：等 go-zero 升 v5 后再回来

### 策略 B：业务用 v5，go-zero 用 v4（混用）
- 业务代码用 v5 签发 token
- go-zero 中间件继续用 v4 验证
- **风险**：🟡 中
  - v5 的 `MapClaims["exp"]` 默认是 `NumericDate` 类型，序列化格式跟 v4 不完全一样
  - token 格式可能 v4 中间件验证不通过
  - 但 v5 有 `WithIssuedAt()` 这种 builder 模式可以保持兼容
- **收益**：体验 v5 API
- **结论**：性价比不高，go-zero 升 v5 时还得改一遍

### 策略 C：用 replace 强制统一到 v5
```go
replace github.com/golang-jwt/jwt/v4 => github.com/golang-jwt/jwt/v5 v5.0.0
```
- **风险**：🔴 高
  - go-zero 内部所有用 v4 API 的地方都会被 v5 替换
  - go-zero 团队没在 1.10.x 测过这个组合
  - 任何 `go get` 都可能触发版本冲突
- **收益**：真正"全 v5"
- **结论**：建议别，go-zero 2.0+ 之前不做

## 选择 A 的理由

1. **go-zero 1.10.2 是"jwt v4 时代的最新版"**
   - go-zero 团队没在 1.10.x 升 v5
   - 升 v5 意味着逆向 go-zero 团队的兼容性测试
2. **业务用 v5 + go-zero 用 v4** → token 格式可能不兼容
3. **用 replace 强制升级** → 改了 go-zero 内部依赖，下次 go get 容易崩
4. **go-zero 团队升 v5 的时候**会做完整测试（包括 token 兼容、中间件兼容），跟随最稳

## 何时回来做 Step 4b

- **触发条件 1**：`go-zero` 官方 release notes 说 "upgrade jwt to v5"（估计 go-zero 2.0+ 会有）
- **触发条件 2**：go-zero 团队推 v5 至少有 1 个 minor 版本稳定后再回来
- **触发条件 3**：`go list -m all | grep "jwt/v5"` 能看到 go-zero 间接依赖 v5

## 当前 jwt 状态

| 位置 | 版本 |
|---|---|
| go.mod 直接依赖 | `github.com/golang-jwt/jwt/v4 v4.5.2` |
| go-zero 内部使用 | 同 v4.5.2 |
| 业务代码 | 同 v4.5.2 |
| 三者一致 | ✅ 零冲突 |

## 下一步

- [x] ~~Step 4b: jwt v4 → v5~~ ⏸️ deferred
- [ ] **Step 4c**: go-redis/redis v8 → v9
- [ ] Step 4d: pkg/errors → std errors
- [ ] Step 2: 升级开发工具链（modd → air）
- [ ] 部署模式工程化（host vs container）
