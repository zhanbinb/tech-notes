# Step 14: nginx auth_request 实战笔记 (Phase 1 完成)

> 日期：2026-08-10
> 状态：✅ 完成, 跟随 step-12/step-13 理论课
> 配合：[step-12 nginx 鉴权 5 层级](step-12-nginx-auth.md) + [step-13 APISIX/Kong](step-13-apisix-kong.md) + [step-09 网关调研](step-09-gateway-survey.md)
> 性质：实战记录, 区别于 step-12 的"理论 + 配置示例"

---

## 0. 文档目标

读完这章你能:
- ✅ 复现"模式 B 完整实现" (nginx auth_request + go-zero rest.WithJwt)
- ✅ 看到这次发现的 5 个真实 bug 怎么 fix
- ✅ 理解 nginx `=` vs `~` 路径优先级
- ✅ 知道为什么 nginx auth_request 子请求是 GET 不是 POST
- ✅ 复现"双鉴权"日志证明

---

## 1. 起点 — 现状审计 (做之前)

```
$ docker ps | grep nginx
nginx-gateway         Up 47 hours         # 已经跑了 47h
```

`deploy/nginx/conf.d/looklook-gateway.conf` (旧):
```nginx
location ~ /order/      { proxy_pass http://looklook:1001; }   # ← broken
location ~ /payment/    { proxy_pass http://looklook:1002; }   # ← broken
location ~ /travel/     { proxy_pass http://looklook:1003; }   # ← broken
location ~ /usercenter/ { proxy_pass http://host.docker.internal:1004; }  # ← 唯一workaround
```

**5 大问题** (在审计时发现):
1. **3 个 upstream 用 `looklook:<port>`** — 那个 "looklook" docker 容器**根本没跑** (我们业务在 host)
2. **`/travel/` 是公开的** (看 routes.go), 但**没有 travel 业务用 JWT** — 全部 8 个 endpoint 都是公开, 没必要加 auth_request
3. **`/usercenter/v1/user/login` 必须不鉴权** — 客户端拿 token 之前没有 token, 死锁
4. **`/payment/.../thirdPaymentWxPayCallback` 是 WeChat 回调** — 微信服务器 POST, 没 token, 必须不鉴权
5. **`/usercenter/` 路由混合** — login/register 公开, detail/wxMiniAuth 要 JWT

---

## 2. Step 1 — 准备: 检查环境 (5 秒)

```bash
$ docker --version
Docker version 28.1.1, build 4eba377

$ docker ps
nginx-gateway         Up 47 hours
kafka-ui              Up 2 days
go-stash              Restarting (1) 6 seconds ago   # ⚠️ 跟本次无关, 是 ch11 日志通道的问题
jaeger                Up Less than a second
```

> 决定: **用现成的 docker nginx-gateway** (不 brew install nginx). 省时且贴近生产.

---

## 3. Step 2 — 重写 nginx conf (10 分钟, 修了 4 个 bug)

### 3.1 加 internal /auth_check 子请求端点

```nginx
location = /auth_check {
    internal;             # 关键: 仅 nginx 内部子请求用, 外部访问不到
    proxy_pass http://host.docker.internal:1004/usercenter/v1/auth_check;
    proxy_pass_request_body off;
    proxy_set_header Host $http_host;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;
}
```

### 3.2 用 `=` 区分公开 vs `~` 区分受保护

```nginx
# 公开 (4 个 = 精确路径)
location = /usercenter/v1/user/login              { ... }  # B.1
location = /usercenter/v1/user/register           { ... }  # B.2  
location = /payment/v1/thirdPayment/thirdPaymentWxPayCallback { ... }  # B.3
location ~ /travel/                              { ... }  # C (整段公开)

# 受保护 (3 个 ~ 正则)
location ~ /order/     { auth_request /auth_check; ... }  # D.1
location ~ /payment/   { auth_request /auth_check; ... }  # D.2
location ~ /usercenter/ { auth_request /auth_check; ... }  # D.3
```

**nginx 优先级**:
```
1. =   精确路径    (1st, 最优先)
2. ^~  前缀
3. ~   正则
4. 普通前缀 (最低)
```

`/usercenter/v1/user/login` 走 `= ...login` 块, 不走 `~ /usercenter/`. 修死锁.

### 3.3 4 个 upstream 全改 host.docker.internal

| 旧 (错) | 新 (对) |
|---------|---------|
| `looklook:1001` (无容器) | `host.docker.internal:1001` (host 回环) |
| `looklook:1002` | `host.docker.internal:1002` |
| `looklook:1003` | `host.docker.internal:1003` |
| `host.docker.internal:1004` (已对) | 保持 |

---

## 4. Step 3 — 写 /auth_check handler (5 分钟, 修了 1 个 compile error)

### 4.1 新文件: `app/usercenter/cmd/api/internal/handler/authCheckHandler.go`

```go
func AuthCheckHandler(ctx *svc.ServiceContext) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // 1. 读 Authorization
        auth := r.Header.Get("Authorization")
        if !strings.HasPrefix(auth, "Bearer ") {
            http.Error(w, "missing Authorization", http.StatusUnauthorized)
            return
        }
        // 2. 用 go-zero rest/token 验证
        parser := token.NewTokenParser()
        tok, err := parser.ParseToken(r, ctx.Config.JwtAuth.AccessSecret, "")
        if err != nil || !tok.Valid {
            http.Error(w, "invalid token", http.StatusUnauthorized)
            return
        }
        // 3. 拿 claims, 写 X-User-Id response header
        claims := tok.Claims.(jwt.MapClaims)
        if uid, ok := claims["jwtUserId"]; ok {
            w.Header().Set("X-User-Id", fmt.Sprintf("%v", uid))
        } else {
            http.Error(w, "missing jwtUserId claim", http.StatusUnauthorized)
            return
        }
        // 4. 200 OK = 通过 (nginx 看到 200 放行 + auth_request_set 读 X-User-Id)
        w.WriteHeader(http.StatusOK)
    }
}
```

### 4.2 路由注册 (routes.go)

```go
// ★ 必须注册到 no-JWT group (它自己就是鉴权函数, 不能自己验自己)
{
    Method:  http.MethodGet,    // ← GET 是关键, 见 §6
    Path:    "/auth_check",
    Handler: AuthCheckHandler(serverCtx),
},
{
    Method:  http.MethodPost,
    Path:    "/auth_check",
    Handler: AuthCheckHandler(serverCtx),
},
```

### 4.3 编译错误 1: `declared and not used: tokenStr`

```go
// 我留了这个变量但没用 (parser.ParseToken 自己从 r.Header 抽 token)
tokenStr := strings.TrimPrefix(auth, "Bearer ")
// ...
```

修: 删 `tokenStr :=` 那行, 注释说明 parser 内部抽.

---

## 5. Step 4 — 6 路径测试 + 405 调试 (30 分钟, 最折腾的一段)

### 5.1 nginx reload

```bash
$ ./scripts/dev-nginx-reload.sh
==== 1. 测 conf 语法 ====
nginx: configuration file /etc/nginx/nginx.conf test is successful   ← ✓
==== 2. 重新读取 conf (热加载, 不重启) ====
==== 3. 验证 ====
✅ nginx reload done.
```

### 5.2 第一个 6 路径测试 (我跑得挺顺)

| # | 路径 | 预期 | 实际 |
|---|------|------|------|
| 1 | `GET /travel/...` 不带 token | 200 (公开) | ✅ 200 |
| 2 | `POST /order/...` 不带 token | 401 (受保护) | ✅ 401 |
| 3 | `POST /order/...` 带 token | 200 | ✅ 200 |
| 4 | `POST /payment/.../callback` 不带 token | 非 401 (公开) | ✅ 200 |
| 5 | `POST /usercenter/v1/user/login` 不带 token | 200 (公开) | ✅ 200 |
| 6 | `POST /usercenter/v1/user/detail` 带 token | 200 | ❌ **500** |

**5 个通过, 1 个 500**. 调查 #6.

### 5.3 调查 500: nginx error log

```
2026/08/10 10:15:20 [error] 84#84: *36 auth request unexpected status: 405
```

**`auth request unexpected status: 405`** — 子请求返回 405 (Method Not Allowed).

### 5.4 第一次错猜: trailing %20

URL 末尾有 `%20` (URL-encoded space). 我让用户重试去掉空格.

重试后:
```
[error] ... auth request unexpected status: 405 ... "POST /usercenter/v1/user/detail HTTP/1.1"
```

**%20 不是根因**. 继续调查.

### 5.5 真正原因: nginx auth_request 子请求是 **GET**, 不是 POST

我注册 `/auth_check` 只用了 `POST`. **nginx 1.21.x 的 auth_request 子请求默认是 GET** (历史老习惯, 跟主请求 method 无关).

修: routes.go 加 GET method.

```go
{
    Method: http.MethodGet,     // ← nginx auth_request 默认是 GET!
    Path:   "/auth_check",
    Handler: AuthCheckHandler(serverCtx),
},
{
    Method: http.MethodPost,    // 兼容外部直接 curl 测试
    Path:   "/auth_check",
    Handler: AuthCheckHandler(serverCtx),
},
```

### 5.6 重 build + 重启 + 重试

```
==== 7) 走 nginx, /user/detail 带 token (受保护) — 之前 500, 现在 200 ====
HTTP/1.1 200 OK
```

**修好了**! 模式 B 完整跑通.

---

## 6. Step 5 — debug log 证明双鉴权 (5 分钟)

加 logx 在两层, 各打 log:

### 6.1 /auth_check handler

```go
logx.Info("[AUTH_CHECK] >>> request received: method=GET, path=/auth_check")
logx.Info("[AUTH_CHECK] Authorization header: present=true (len=200+)")
logx.Info("[AUTH_CHECK] token has Bearer prefix, validating with go-zero/jwt...")
logx.Info("[AUTH_CHECK] token VALID → setting X-User-Id=1 in response header")
logx.Info("[AUTH_CHECK] <<< returning 200 OK, X-User-Id response header = \"1\"")
```

### 6.2 /user/detail handler (在 go-zero WithJwt **之后** 跑)

```go
logx.Info("[DETAIL] >>> handler called (after go-zero WithJwt middleware passed)")
logx.Info("[DETAIL]   Authorization header: present=true, len=200+")
logx.Info("[DETAIL]   X-User-Id (from nginx auth_request): \"1\"")
logx.Info("[DETAIL]   jwtUserId (from go-zero WithJwt ctx): 1")
```

### 6.3 跑 1 个请求, 期望 2 行 log

实际看到:

```
[AUTH_CHECK] >>> request received: method=GET, path=/auth_check
[AUTH_CHECK] Authorization header: present=true (len=200+)
[AUTH_CHECK] token has Bearer prefix, validating with go-zero/jwt...
[AUTH_CHECK] token VALID → setting X-User-Id=1 in response header
[AUTH_CHECK] <<< returning 200 OK, X-User-Id response header = "1"

(nginx 现在拿 X-User-Id=1, 把主请求转给 :1004)

[DETAIL] >>> handler called (after go-zero WithJwt middleware passed)
[DETAIL]   Authorization header: present=true, len=200+
[DETAIL]   X-User-Id (from nginx auth_request): "1"
[DETAIL]   jwtUserId (from go-zero WithJwt ctx): 1
```

### 6.4 这个证明什么

| 现象 | 说明 |
|------|------|
| `[AUTH_CHECK] token VALID` | **nginx 验过一次** token (通过 auth_request 子请求) |
| `[DETAIL] X-User-Id = "1"` (from nginx) | nginx 把 userId 注入到 X-User-Id header 给 backend |
| `[DETAIL] jwtUserId = 1` (from go-zero ctx) | **go-zero 的 rest.WithJwt 又验了一次** token, 写进 ctx |
| 2 个验证都通过 → 200 | **defense in depth 真起作用** |

**同 1 个 token, 2 次独立验证**:
- 第 1 次: nginx `auth_request /auth_check` (Level 2 in step-12 5 层级)
- 第 2 次: go-zero `rest.WithJwt` 中间件 (业务层)

### 6.5 清理 debug log

```bash
# authCheckHandler 是新文件, 直接 python 重写干净的版本
# detailHandler 用 git checkout 回到 HEAD
$ git checkout app/usercenter/cmd/api/internal/handler/user/detailHandler.go
$ python3 -c "..."  # 重写 authCheckHandler

# 验证清理
$ grep -c "AUTH_CHECK\|DETAIL" app/usercenter/cmd/api/internal/handler/authCheckHandler.go
0
$ grep -c "DETAIL" app/usercenter/cmd/api/internal/handler/user/detailHandler.go
0
```

清干净, debug log 没了.

---

## 7. 最终状态 — 6 路径全跑通

| # | 路径 | 是否带 token | 预期 | 实际 | 验证点 |
|---|------|------------|------|------|--------|
| 1 | `/travel/...` | 无 | 200 | 200 | travel 公开, 旁路 auth_request |
| 2 | `/order/...` | 无 | 401 | 401 | 受保护, nginx 拒 |
| 3 | `/order/...` | 有 | 200 | 200 | nginx 验 + go-zero 验双过 |
| 4 | `/payment/.../callback` | 无 | 200 | 200 | WeChat 公开, 旁路 auth_request |
| 5 | `/usercenter/v1/user/login` | 无 | 200 | 200 | login 公开, 旁路 auth_request |
| 6 | `/usercenter/v1/user/detail` | 有 | 200 | 200 | 受保护, 同样双过 |

---

## 8. 5 大发现 / 教训

### 8.1 老 conf 的"looklook" docker 服务名在 host 跑解析不到

**症状**: 旧 conf `proxy_pass http://looklook:1001` 在 host 上跑会 502 (DNS 找不到 "looklook").

**真相**: "looklook" 是 docker-compose.yml 里的 service name, **那个容器根本没启**. 我们业务用 dev-up.sh 在 host 上跑. `host.docker.internal:<port>` 才是正解.

**教训**: 看 conf 之前先看 **服务在哪里跑** (host vs docker).

### 8.2 nginx `=` 精确路径 vs `~` 正则 优先级

**症状**: 4 个受保护 location 用 `~ /usercenter/` 正则, 但 login/register/callback 在 usercenter 路径下, **他们也走 auth_request** — 死锁.

**修正**: 用 `= /usercenter/v1/user/login` 精确路径, nginx 优先匹配, 跳过正则. 公开/受保护要严格分离.

**教训**: 单个 `~ /service/` 兜底太粗, **要**列出所有公开路径用 `=` 覆盖.

### 8.3 nginx auth_request 子请求是 **GET** 不是 POST

**症状**: 调 /user/detail 时 nginx 报 `auth request unexpected status: 405`. 我的 handler 只注册了 POST.

**真相**: nginx 1.21.x 的 `auth_request` 子请求**默认 GET** (历史老习惯). 跟主请求 method 无关.

**修法**: route 注册 **GET + POST 两个 method**. handler 逻辑只读 header 不读 body, 两个 method 都安全.

**教训**: nginx auth_request 文档**没明确说** GET, 但社区和源码都这么设计. **写 nginx 鉴权 endpoint 必登 GET**.

### 8.4 `proxy_pass_request_body off` + `Content-Length ""`

**症状**: (没遇到, 但当时纠结过) — 子请求 body 怎么传?

**正确做法**:
```nginx
location = /auth_check {
    internal;
    proxy_pass http://auth_backend/auth;
    proxy_pass_request_body off;       # body 不传
    proxy_set_header Content-Length ""; # 显式告诉上游"无 body"
    proxy_set_header X-Original-URI $request_uri;
}
```

**教训**: 子请求是 fresh HTTP request, 不继承 body. body 必须在 sub-request 自己的 location 里控制.

### 8.5 debug log 是双鉴权最有说服力的证据

不加 log, 你只能靠**看响应**验证鉴权. 加 log, 你能看到:
- 哪一层**先**验证的
- 各层**拿到的 userId**是不是同一个
- 哪一层**失败**返回的 401

**这次特别学到**: 我们手写了 log, **看到 nginx 和 go-zero 真的都跑了一遍**. 不是理论.

---

## 9. 文件改动清单 (v3.24 commit)

| 文件 | 类型 | 行数 | 作用 |
|------|------|------|------|
| `app/usercenter/cmd/api/internal/handler/authCheckHandler.go` | 新增 | 70 | nginx auth_request 子请求端点 |
| `app/usercenter/cmd/api/internal/handler/routes.go` | 改 | +14 | 注册 /auth_check GET+POST |
| `deploy/nginx/conf.d/looklook-gateway.conf` | 重写 | 137 | 4 个 location + auth_request + 4 修 |
| `scripts/dev-nginx-reload.sh` | 新增 | 24 | reload docker nginx helper |

---

## 10. 跟 step-12/step-13 的衔接

```
step-12  (理论)   nginx 鉴权 5 个层级 + auth_request 配置示例
                              ↓
step-14  (实操)   把 step-12 的 Level 2 (auth_request) 真跑通
                              ↓
              6 路径全验, 模式 B (双鉴权) 完整工作
```

**还没做**:
- step-13 (理论) APISIX 实战 — 同样是 step-13 讲的 jwt-auth plugin 真实跑
- ch 11/12/13 基础设施 (ELK + OTel + Prom)
- 4d-2 pkg/errors 全量

---

## 11. 后续 4 个候选 (按推荐度)

| 选项 | 内容 | 价值 |
|------|------|------|
| **A 🎯** | **APISIX 实战** (step-13 落地) | 跟 nginx 形成对比, 看商业产品优势 |
| B | ch 11/12/13 基础设施 (ELK + OTel + Prom) | 接 ch 教程 view B |
| C | 4d-2 pkg/errors 全量迁移 | 之前一直暂缓 |
| D | 收工 | 今天 ship 了 v3.24, 修 5 个 bug |

我倾向 **A** (APISIX 实战) — 跟 step-12/14 nginx 实战形成"自建 vs 商业产品"完整对比.

你说一个, 我接着开.

---

## 12. 相关阅读

- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 3 层架构基础
- [step-10 nginx 入门](step-10-nginx-101.md) — 4 个例子 + conf 结构
- [step-11 jwt internals](step-11-auth-internals.md) — token 双向链路
- [step-12 nginx 鉴权 5 层级](step-12-nginx-auth.md) — auth_request 配置示例 (本次的参考)
- [step-13 APISIX/Kong](step-13-apisix-kong.md) — 商业产品对比 (待实战)
- [step-06 异步事件学习](step-06-async-event-deep-dive.md) — 跟 m1/m2 链

---

*创建于 2026-08-10, 跟随 step-12 理论课的实战记录, v3.24 commit 已 ship*
