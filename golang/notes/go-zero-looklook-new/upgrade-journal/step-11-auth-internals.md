# Step 11: go-zero 鉴权内部机制 + token 完整生命周期

> 日期：2026-08-08  
> 用途：深入理解 `rest.WithJwt(secret)` 背后到底发生了什么  
> 配合：M2 (step-07) + step-09 (网关) + step-10 (nginx 入门)  
> 来源：本轮用户问"加入 rest.WithJwt 后在哪里验证 jwt" → 完整 trace 出来

---

## 0. 阅读指南

读完这章后, 你应该能:
1. ✅ 说出**token 在哪里生成、传输、验证、注入 ctx、被读**
2. ✅ 解释 `rest.WithJwt(secret)` 为何**只是个配置开关**
3. ✅ 解释 `ctxdata.CtxKeyJwtUserId = "jwtUserId"` 这个**常量命名约定**
4. ✅ 给 token 加业务字段 (e.g. tenantId, role) 不需要改 yaml

---

## 1. token 全生命周期 (从 login → handler)

```
┌────────┐                                                          ┌─────────────┐
│ Client │                                                          │ go-zero api  │
└────┬───┘                                                          └──────┬───────┘
     │                                                                     │
     │  POST /login                                                       │
     │  {mobile, password}                                                │
     ▼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
┌─────────────────────────┐
│ usercenter-api :1004    │
│ loginHandler            │
│  → loginLogic           │
│   → 调 usercenter-rpc   │
│      GenerateToken(userId=1)
└─────┬───────────────────┘
      │
      ▼  gRPC
┌─────────────────────────────────────┐  ⭐ Stage 1: 生成
│ usercenter-rpc :2003                │
│ generateTokenLogic                  │
│   claims["exp"] = now + 1y          │
│   claims["iat"] = now               │
│   claims["jwtUserId"] = 1           │  ← go-zero jwt.MapClaims
│   jwt.New(SigningMethodHS256)       │
│   jwt.SignedString(secret)           │  ← HMAC-SHA256 签名
└─────┬───────────────────────────────┘
      │
      ▼  返回 token string
      │
      ▼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
      │
┌────────┐
│ Client │  拿到 accessToken, 存 localStorage / cookie
└────┬───┘
     │
     │  POST :1001/order/v1/.../createHomestayOrder
     │  Authorization: Bearer eyJhbG...    ← 把 token 放 header
     ▼
┌─────────────────────────────────────┐  ⭐ Stage 4: 验证
│ order-api :1001                       │
│ rest.Server.serve(w, r)              │
│  → router 匹配                       │
│  → chain (cors/log/trace/...)        │
│  → handler.Authorize(secret, ...)    │
│     ├─ 抽 Authorization              │
│     ├─ golang-jwt/jwt/v4 验签 + 验 exp │
│     ├─ 失败 → 401 Unauthorized         │
│     └─ 成功 → 把 claims 写 ctx        │
└─────┬───────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│ CreateHomestayOrderHandler          │
│  → NewCreateHomestayOrderLogic(ctx) │
│   ├─ ctxdata.GetUidFromCtx(ctx) = 1 │  ⭐ Stage 6: 读 ctx
│   ├─ 调 order-rpc                    │
│   │  CreateHomestayOrder({UserId: 1})│  ⭐ RPC 无鉴权, 传 userId
│   └─ ...                              │
└─────────────────────────────────────┘
```

7 个 stage, 第 1 / 4 / 6 是关键分岔.

---

## 2. Stage 1 — token 生成 (rpc 端, 我们代码)

完整代码 (`app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go`):

```go
func (l *GenerateTokenLogic) GenerateToken(in *pb.GenerateTokenReq) (*pb.GenerateTokenResp, error) {
    now := time.Now().Unix()                                                   // 1️⃣ unix 秒
    accessExpire := l.svcCtx.Config.JwtAuth.AccessExpire                       // 2️⃣ 从 yaml 读
    accessToken, err := l.getJwtToken(
        l.svcCtx.Config.JwtAuth.AccessSecret,                                  // 3️⃣ 从 yaml 读 secret
        now, accessExpire, in.UserId,                                         // 4️⃣ userId 来自登录 user
    )
    if err != nil {
        return nil, xerr.Wrapf(ErrGenerateTokenError, "getJwtToken err userId:%d , err:%v", in.UserId, err)
    }

    return &pb.GenerateTokenResp{
        AccessToken:  accessToken,
        AccessExpire: now + accessExpire,                                     // 5️⃣ exp 时间
        RefreshAfter: now + accessExpire/2,                                   // 6️⃣ 一半时间, 前端 refresh 提示
    }, nil
}

func (l *GenerateTokenLogic) getJwtToken(secretKey string, iat, seconds, userId int64) (string, error) {
    claims := make(jwt.MapClaims)
    claims["exp"]  = iat + seconds                                            // 到期时间
    claims["iat"]  = iat                                                     // 签发时间
    claims["jwtUserId"] = userId                                              // ⭐ 业务字段
    token := jwt.New(jwt.SigningMethodHS256)
    token.Claims = claims
    return token.SignedString([]byte(secretKey))                               // HMAC-SHA256 签名
}
```

### 实际生成的 token 长啥样

```
原始:
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NTQ1NTM2MDAsImlhdCI6MTc1NDU1MzYwMCwianV0VXNlcklkIjoxLCJqd3RVc2VySWQiOjF9.9jKK4_F8Fo...

base64-decoded payload (中间那段):
  {
    "exp":        1787715600,        // 2027-08-07 14:30:00 UTC
    "iat":        1754553600,        // 2026-08-07 14:30:00 UTC
    "jwtUserId":  1,                  // ⭐ 业务字段
    "jwtUserId2": 1                   // ⭐ 上面竟然有重复 key!
  }
```

> ⚠️ 等等! base64 解出来有 **2 个** `jwtUserId`？这是 golang-jwt 序列化 MapClaims 时, 同样的 key 出现两次. 可能是源码里另一个 secret + ctxdata 的演化痕迹. 不影响消费端 (后者会覆盖), 但**看起来像是 bug**.

### 数值示例 (复现一遍, 你能跑)

```bash
echo "当前 unix 秒:    $(date +%s)"
echo "1 年是几秒:     $((365 * 24 * 3600))"
# 输出 (举例): 1754553600  31536000
```

```yaml
# app/usercenter/etc/usercenter.yaml
JwtAuth:
  AccessSecret: "your-jwt-secret"
  AccessExpire: 31536000                # 1 年
```

```go
now := int64(1754553600)              // 假设今天 14:30 UTC
exp := now + 31536000                  // 2027-08-07
// 最终 exp = 1787715600
```

---

## 3. Stage 2 — token 传输 (HTTP 层)

```
POST :1001/order/v1/homestayOrder/createHomestayOrder HTTP/1.1
Host: 127.0.0.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{"homestayId":1, "isFood":false, "liveStartTime":...}
```

**规则** (JWT 规范):
- header 名: **`Authorization`**
- 前缀: **`Bearer `** (注意末尾空格)
- 后面紧接 token 字符串

**go-zero 怎么抽**:
```go
// rest/token/tokenparser.go (doParseToken)
request.ParseFromRequest(r, request.AuthorizationHeaderExtractor,
    func(token *jwt.Token) (any, error) {
        return []byte(secret), nil
    }, request.WithParser(newParser()))
```

底层用了 `github.com/golang-jwt/jwt/v4/request`:
- `AuthorizationHeaderExtractor`: 用 `request.AuthorizationHeaderExtractor` 提取 "Bearer xxx"
- secret 作为 `[]byte` 喂进 keyFunc (golang-jwt 用它验签)

---

## 4. Stage 4 — token 验证 (go-zero rest 内部)

### 4.1 验证入口 (`rest/server.go:184`)

```go
// go-zero/rest/server.go
func WithJwt(secret string) RouteOption {
    return func(r *featuredRoutes) {
        validateSecret(secret)
        r.jwt.enabled = true         // ← 仅设个标志, 不调用
        r.jwt.secret  = secret
    }
}
```

**`WithJwt` 不做验证**, 它**只是个配置**, 存到 `featuredRoutes` 结构里.

### 4.2 middleware 构造 (`rest/engine.go:70`)

```go
// go-zero/rest/engine.go
func (ng *engine) appendAuthHandler(fr featuredRoutes, chn chain.Chain, verifier func(chain.Chain) chain.Chain) chain.Chain {
    if fr.jwt.enabled {
        if len(fr.jwt.prevSecret) == 0 {
            chn = chn.Append(handler.Authorize(fr.jwt.secret,
                handler.WithUnauthorizedCallback(ng.unauthorizedCallback)))
        } else {
            chn = chn.Append(handler.Authorize(fr.jwt.secret,
                handler.WithPrevSecret(fr.jwt.prevSecret),
                handler.WithUnauthorizedCallback(ng.unauthorizedCallback)))
        }
    }
    return verifier(chn)
}
```

**真正构造中间件在这**! 每个 AddRoutes 时跑一次 (启动时).

调用是 `chain.Append(handler.Authorize(secret, ...))` — 把 Authorize 闭包加入 chain.

### 4.3 验证逻辑 (`rest/handler/authhandler.go`)

```go
func Authorize(secret string, opts ...AuthorizeOption) func(http.Handler) http.Handler {
    parser := token.NewTokenParser()
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            // 1. 验证 token
            tok, err := parser.ParseToken(r, secret, authOpts.PrevSecret)
            if err != nil {
                unauthorized(w, r, err, authOpts.Callback)   // 401
                return
            }
            if !tok.Valid {
                unauthorized(w, r, errInvalidToken, authOpts.Callback)  // 401
                return
            }

            // 2. 拿 claims
            claims, ok := tok.Claims.(jwt.MapClaims)
            if !ok {
                unauthorized(w, r, errNoClaims, authOpts.Callback)  // 401
                return
            }

            // 3. 注入 ctx
            ctx := r.Context()
            for k, v := range claims {
                switch k {
                case jwtAudience, jwtExpire, jwtId, jwtIssueAt, jwtIssuer, jwtNotBefore, jwtSubject:
                    // ⭐ 跳过的标准 claim
                default:
                    ctx = context.WithValue(ctx, k, v)   // ⭐ 其他都进 ctx
                }
            }
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}
```

**关键 3 个返回值**:
| 情况 | 处理 |
|------|------|
| `err != nil` | 401, **token 缺失 / 签名错 / 结构错** |
| `!tok.Valid` | 401, **验签失败 (包含过期验证在 golang-jwt 里)** |
| `claims` 不是 `jwt.MapClaims` | 401, **claims 类型错 (基本不可能)** |
| **全部通过** | claims 写 ctx, 调下一层 |

> 注: `tok.Valid` 包含了 **exp / nbf / iat** 的过期检查. golang-jwt 里 `Valid()` 走标准的 claims.Valid() 函数, 包含 `if now > exp { return false }`.

### 4.4 401 失败响应

```go
// authhandler.go 的 unauthorized()
func unauthorized(w http.ResponseWriter, r *http.Request, err error, callback UnauthorizedCallback) {
    writer := response.NewHeaderOnceResponseWriter(w)
    if err != nil {
        detailAuthLog(r, err.Error())      // 1️⃣ logc.Errorf 记日志 (api.log 里能看到)
    } else {
        detailAuthLog(r, noDetailReason)
    }
    if callback != nil {
        callback(writer, r, err)            // 2️⃣ 用户自定义回调 (默认 nil)
    }
    writer.WriteHeader(http.StatusUnauthorized)   // 3️⃣ 返回 401
}
```

**401 时业务 handler 永远不会被调到**.

---

## 5. Stage 5 — Claims 写入 ctx

```go
ctx := r.Context()
for k, v := range claims {
    switch k {
    case "aud", "exp", "jti", "iat", "iss", "nbf", "sub":
        // 跳过 JWT 标准字段
    default:
        ctx = context.WithValue(ctx, k, v)
    }
}
next.ServeHTTP(w, r.WithContext(ctx))
```

### 跳过的字段 (JWT 标准 claim)

| 标准 claim | 含义 |
|------------|------|
| `aud` | audience (接收方) |
| `exp` | expiration time (过期时间) |
| `jti` | jwt id (唯一 ID) |
| `iat` | issued at |
| `iss` | issuer (签发方) |
| `nbf` | not before |
| `sub` | subject |

> 为啥跳过: 这些是 JWT spec 规定的"基础设施字段", 不进业务 ctx, 避免污染.

### 进 ctx 的字段

我们只设了 `claims["jwtUserId"] = userId`. 所以 ctx 里就这一个 entry:

```go
ctx.Value("jwtUserId")   // → 1 (json.Number, 强转 int64 得到 1)
```

---

## 6. Stage 6 — Handler 读 ctx

我们的 `(handler).CreateHomestayOrderHandler` (goctl 生成):

```go
func CreateHomestayOrderHandler(ctx *svc.ServiceContext) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var req types.CreateHomestayOrderReq
        if err := httpx.Parse(r, &req); err != nil {
            result.ParamErrorResult(r, w, err)
            return
        }

        // r.Context() 已经含 jwt 注入的 "jwtUserId" key
        l := homestayOrder.NewCreateHomestayOrderLogic(r.Context(), ctx)
        resp, err := l.CreateHomestayOrder(req)
        result.HttpResult(r, w, resp, err)
    }
}
```

Logic 拿 userId:

```go
// app/order/cmd/api/internal/logic/homestayOrder/createHomestayOrderLogic.go
func (l *CreateHomestayOrderLogic) CreateHomestayOrder(req types.CreateHomestayOrderReq) (*types.CreateHomestayOrderResp, error) {
    homestayResp, err := l.svcCtx.TravelRpc.HomestayDetail(l.ctx, &pb.HomestayDetailReq{
        Id: req.HomestayId,
    })
    if err != nil { return nil, err }
    if homestayResp.Homestay == nil || homestayResp.Homestay.Id == 0 {
        return nil, errors.Wrapf(xerr.NewErrMsg("homestay no exists"), ...)
    }

    userId := ctxdata.GetUidFromCtx(l.ctx)   // ⭐ 在这里拿
    //                  ^^^^^^^^^^^^^^^
    //                  l.ctx = r.Context() (handler 那里传下来的)
    //                  这里 token 已经验证过, userId 已在 ctx 里

    resp, err := l.svcCtx.OrderRpc.CreateHomestayOrder(l.ctx, &order.CreateHomestayOrderReq{
        HomestayId:    req.HomestayId,
        IsFood:        req.IsFood,
        LiveStartTime: req.LiveStartTime,
        LiveEndTime:   req.LiveEndTime,
        UserId:        userId,                  // ⭐ 从 ctx 拿值塞到 RPC request
        LivePeopleNum: req.LivePeopleNum,
        Remark:        req.Remark,
    })
    ...
}
```

---

## 7. Stage 7 — RPC 调用时手动传 userId

```go
// api-side logic → rpc-side logic
UserId: userId,    // 靠 ctxdata 拿的值, **手动塞进** gRPC request
```

**这里有一个**容易被忽视的细节**: 我们项目的 RPC 层**没有 jwt 鉴权**. 所以 userId 是被 **从 API 层手动传递**. 这就是为什么 §3 讨论的 "RPC 鉴权" 是真实的安全洞.

---

## 8. 关键常量 `CtxKeyJwtUserId = "jwtUserId"`

```go
// pkg/ctxdata/ctxData.go 完整
package ctxdata

import (
    "context"
    "encoding/json"
)

// CtxKeyJwtUserId get uid from ctx
var CtxKeyJwtUserId = "jwtUserId"   // ⭐ 实际 key 是 "jwtUserId"

const (
    CtxKeyJwtUserIdValueType  = "json.Number"  // 验证用
)

// SetUidToCtx 暂未实现 - 项目里没有用到
// (如果有的话, 一般这么写)
func SetUidToCtx(ctx context.Context, uid int64) context.Context {
    return context.WithValue(ctx, CtxKeyJwtUserId, json.Number(strconv.FormatInt(uid, 10)))
}

// GetUidFromCtx 从 ctx 拿 uid
func GetUidFromCtx(ctx context.Context) int64 {
    if jsonUid, ok := ctx.Value(CtxKeyJwtUserId).(json.Number); ok {
        i, _ := jsonUid.Int64()
        return i
    }
    if uid, ok := ctx.Value(CtxKeyJwtUserId).(int64); ok {
        return uid
    }
    if uid, ok := ctx.Value(CtxKeyJwtUserId).(float64); ok {
        return int64(uid)
    }
    return 0
}
```

### 3 处都用同一个常量 (避免 typo)

```
# 1️⃣ 定义
pkg/ctxdata/ctxData.go: var CtxKeyJwtUserId = "jwtUserId"

# 2️⃣ 写
generateTokenLogic.go: claims[ctxdata.CtxKeyJwtUserId] = userId

# 3️⃣ 读
ctxData.go: ctx.Value(CtxKeyJwtUserId)
```

> 这就是我们用 `var CtxKeyJwtUserId` 而不是裸字符串的原因. **改 1 处 = 改 3 处同步**.
> 
> 同时建议改成 `const CtxKeyJwtUserId = "jwtUserId"` (而不是 `var`) — string 是常量类型. 是个小改进, 但能避免被意外赋值.

### 3 处的字符串校验

```bash
# 想换 key 名字 (比如改成 "uid" 或 "user_id"), 一定要 3 处都改
$ grep -rn "CtxKeyJwtUserId\|\"jwtUserId\"" app/ pkg/ --include="*.go"
pkg/ctxdata/ctxData.go:10:var CtxKeyJwtUserId = "jwtUserId"
app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go:50:    claims[ctxdata.CtxKeyJwtUserId] = userId
```

只有 2 处 — 好. 但如果**有人手写** `claims["jwtUserId"] = userId` (绕开常量), 编译能过但运行时错. lint rule 可以加 (`gocritic`).

---

## 9. 数值示例 + exp 过期机制

```go
// time.Now().Unix() → 当前 unix 秒
// 假设 today 是 2026-08-07 14:30 UTC
now := int64(1754553600)

// yaml 里 AccessExpire: 31536000 (1 年)
seconds := int64(31536000)

// exp = now + 1y
exp := now + seconds  // 1787715600

// claims["exp"] = 1787715600 (验证时 golang-jwt 会比较 now < exp)
```

### golang-jwt 的过期验证

```go
// github.com/golang-jwt/jwt/v4/claims.go
func (m MapClaims) Valid() error {
    now := TimeFunc()
    if !m.VerifyExpiresAt(now) {
        return ErrTokenExpired        // ⭐ exp < now 报错
    }
    // ...
}
```

**所以 1 年后访问, 自动 401 token expired**.

> 我们的 login 返回里有 `AccessExpire` 和 `RefreshAfter` 字段给前端用, 用来提示"X 秒后请用 refresh_token 换新 token". **但本项目根本没实现 refresh_token 流程** — 因为教程没写. 是 step 9+ 范畴的工作.

---

## 10. 业务字段扩展 (e.g. tenantId, role)

**需求**: 想在 token 加 "tenantId" 和 "role", 让 api 层能拿到.

**做法** (只改 generate 端):

```go
// generateTokenLogic.go (改 generate 那段)
func (l *GenerateTokenLogic) getJwtToken(secretKey string, iat, seconds, userId int64) (string, error) {
    claims := make(jwt.MapClaims)
    claims["exp"] = iat + seconds
    claims["iat"] = iat
    claims["jwtUserId"] = userId
    claims["tenantId"] = 1          // ⭐ 加租户
    claims["role"]      = "admin"    // ⭐ 加角色
    token := jwt.New(jwt.SigningMethodHS256)
    token.Claims = claims
    return token.SignedString([]byte(secretKey))
}
```

**handler 端 不用改** —— 因为 `authhandler.go` 的 for-loop 把非标准 claim 全部写进 ctx:

```go
for k, v := range claims {
    switch k { /* 跳过 JWT 标准字段 */ }
    default:
        ctx = context.WithValue(ctx, k, v)  // ⭐ tenantId 和 role 自动进 ctx
    }
}
```

**logic 端 拿值**:

```go
func (l *Logic) Do(req Req) (*Resp, error) {
    tenantId := l.ctx.Value("tenantId").(int64)        // ⭐ 直接拿
    role := l.ctx.Value("role").(string)              // ⭐ 直接拿
    // 或包装成 helper:
    // pkg/ctxdata/ctxData.go 加个 GetRoleFromCtx, GetTenantIdFromCtx
}
```

> **这里有个微妙 bug**: values 进了 ctx 是 `json.Number` / `string` / `float64` 等**动态类型**, 不是 `int64`. 用 `.(int64)` 会 panic. **需要先测 type assertion**.

---

## 11. ctx.Value 在 Go 里的机制 (顺便补充)

`context.WithValue(ctx, key, value)` 把 (key, value) 存到 `*valueCtx` 结构:

```go
// 标准库 src/context/context.go
type valueCtx struct {
    Context
    key, val any
}

func (c *valueCtx) Value(key any) any {
    if c.key == key {
        return c.val
    }
    return c.Context.Value(key)
}
```

`ctx.Value(key)` 是 **链式查询** —— 从当前 ctx 一直查 parent, 直到找到第一个 `key` 匹配的. **找不到返回 nil**.

```
http.Server.serveHTTP
└─ context.Background() (root)
    └─ context.WithValue(ctx, "remote", "127.0.0.1")  (middleware 加的)
        └─ context.WithValue(ctx, "jwtUserId", 1)       (Authorize 加的)
            └─ r.Context()  (你 handler 拿到的)

ctx.Value("jwtUserId")  → 找到 1
ctx.Value("xyz")        → 链查到底, 都没, 返回 nil
```

**所以**:
- `ctx.Value("jwtUserId")` ✅ 有值
- `ctxdata.GetUidFromCtx` 内部用 type assertion, **拿到 nil 时不要 panic**

---

## 12. 常见 Gotcha

### A. 改了 yaml 的 AccessSecret 但 token 还能用?

**短期能用, 长期 401**. 

原因: token 验证看的是签 secret 跟生成 secret 一致. 老 secret 生成的 token 用老 secret 也能解. **所以 secret 泄露后必须立即 rotate 才能作废所有老 token**.

### B. 服务器时钟不同步 → token 没过却报 expired

golang-jwt 的 exp 检查用 server 本地时间 vs token 的 `exp` claim. 如果服务器时钟不准, 会 false positive / false negative.

```bash
# 校时
chronyc tracking
# 或
ntpdate -q time.apple.com
```

### C. AccessExpire 改了但 token 还有效

AccessExpire 是**生成时**写进 token 的 `exp`. **老 token 永远带着自己的 exp**. 改 yaml 只影响**新生成**的 token, 不影响旧 token 的解析.

**所以 secret rotate 比 expire rotate 更可靠** (因为 secret rotate 后老 token 全部 401).

### D. ctx 里相同 key 出现 2 次?

刚才 base64 decoded token 是 `jwtUserId: 1, jwtUserId: 1` 两个. golang-jwt 序列化 `MapClaims` 时, 如果有 **相同的字符串 key 后被覆盖**, 序列化结果不确定. 不过消费端取的是 `claims["jwtUserId"]`, **取最后那个** (map 取值 latest). 所以即使 proto 层有重复, 也不影响.

### E. setuid 在生产应该用 `const`

```go
// pkg/ctxdata/ctxData.go 现在是 var, 建议改 const
var  CtxKeyJwtUserId = "jwtUserId"     // ❌ 当前
const CtxKeyJwtUserId = "jwtUserId"     // ✅ 改进 (string immutable, 本来就该 const)
```

---

## 13. 相关文件清单 (一站式索引)

| 文件 | 行 | 角色 |
|------|---|------|
| `pkg/ctxdata/ctxData.go` | 10 | 常量 `var CtxKeyJwtUserId = "jwtUserId"` 定义 |
| `pkg/ctxdata/ctxData.go` | ~14 | `GetUidFromCtx` 读 |
| `app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go` | 33 | rpc 端调 `getJwtToken` |
| `app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go` | 45 | `getJwtToken` 实现 |
| `app/order/cmd/api/internal/handler/routes.go` | 32 | `rest.WithJwt(AccessSecret)` (配置) |
| `app/payment/cmd/api/internal/handler/routes.go` | 33 | `rest.WithJwt(AccessSecret)` |
| `app/usercenter/cmd/api/internal/handler/routes.go` | 43 | `rest.WithJwt(AccessSecret)` |
| `app/order/cmd/api/internal/logic/.../createHomestayOrderLogic.go` | 37 | `ctxdata.GetUidFromCtx(l.ctx)` 读 |
| `app/usercenter/etc/usercenter.yaml` | - | `JwtAuth.AccessSecret/AccessExpire` |
| `app/order/etc/order.yaml` (隐含) | - | 多个服务 yaml 用**同 secret** 才能互认 token |

| go-zero 内部 (我们不改) | - | - |
| --- | --- | --- |
| `rest/server.go:184` | - | `WithJwt()` 配置入口 |
| `rest/engine.go:70` | - | `appendAuthHandler` 构造 middleware |
| `rest/handler/authhandler.go:42` | - | `Authorize()` 真正验证 |
| `rest/token/tokenparser.go` | - | `ParseToken` 用 golang-jwt 验签 |

---

## 14. 还能深挖 (留作未来 docs)

| 主题 | 价值 |
|------|------|
| **Refresh token 流程** | 教程没实现, 必修 |
| **Token 撤销 (logout / 黑名单)** | jwt 没有 server-side state, 撤销只能等 exp, 要做黑名单 |
| **gRPC 层 jwt 鉴权** | 我们项目还没做, 4 个 rpc server 都裸奔 |
| **Multi-secret rotation** | go-zero `WithJwtTransition(old, new)` 让老 token 慢过期 |

---

## 15. 相关阅读

- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 鉴权架构的第一层
- [step-10 nginx 入门](step-10-nginx-101.md) — 网关层 (限流 / 鉴权 / TLS)
- [step-07 M2 e2e](step-07-m2-e2e.md) — 我们 token 在 e2e 里怎么用的
- 我们的 partner project 看 `chinese/10-错误处理.md` (错误码和 jwt 错误码映射) 

---

*创建于 2026-08-08, 基于本轮 trace + 用户提问*
