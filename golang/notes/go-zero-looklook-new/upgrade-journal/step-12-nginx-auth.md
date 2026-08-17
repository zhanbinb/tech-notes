# Step 12: nginx 鉴权 — 5 个层级 + 与 go-zero 对比

> 日期：2026-08-10  
> 配合：[step-10 nginx 入门](step-10-nginx-101.md) + [step-11 jwt internals](step-11-auth-internals.md) + [step-09 gateway survey](step-09-gateway-survey.md)  
> 本步重点：**nginx 能做哪些鉴权, 跟 go-zero 重叠多少**

---

## 0. 为什么 nginx 也要做鉴权?

go-zero 已经在 api 层做 jwt 鉴权了, **为什么 nginx 还要做**?

3 个典型理由:

| 理由 | 例子 |
|------|------|
| **A. nginx 拦截, go-zero 省事** | nginx 把无效 token 直接 401, 后端连进程都不用进 |
| **B. 跨多 service 统一策略** | 4 个 api service 共用同一把 "鉴权开关", 改一处全生效 |
| **C. nginx 还能做鉴权之外的** | 限流 / 黑名单 / WAF / 灰度 — 这些 go-zero 不能做 |

> **重要**: nginx 鉴权**不能替代** go-zero 鉴权. **只能作为前置过滤 + 增强**. 真正的业务鉴权 (rbac / 数据 owner) 必须在 go-zero. 我们 step-11 说过这个.

---

## 1. nginx 鉴权的 5 个层级 (从简单到复杂)

```
┌─────────────────────────────────────────────────────────────┐
│ Level 1: HTTP Basic (auth_basic)                            │  ★ 入门级
│   - 用户名:密码 base64 编码放 Authorization header             │
│   - nginx 内置, 不需要额外模块                              │
│   - 用在内部管理界面 / 简单场景                                │
├─────────────────────────────────────────────────────────────┤
│ Level 2: auth_request (子请求)                              │  ★ 推荐
│   - nginx 内部发子请求到 /auth_check 端点 (你写的 service)   │
│   - 子请求返回 200 = 通过, 401/403 = 拒绝                    │
│   - 子请求可以读 response header, 写到主请求 header            │
│   - 用在 JWT / OAuth / 自定义 token 验证                      │
├─────────────────────────────────────────────────────────────┤
│ Level 3: 第三方 nginx 模块 (auth_jwt)                       │  ★ 中等
│   - 编译进 nginx 的 C 模块, 直接验证 JWT                      │
│   - 不需要外部 service, 但要重新编译 nginx                    │
│   - 例子: nginx-auth-jwt, lua-resty-jwt                      │
├─────────────────────────────────────────────────────────────┤
│ Level 4: OpenResty + Lua (lua-resty-jwt)                    │  ★ 实战级
│   - nginx + LuaJIT (性能)                                    │
│   - 用 Lua 写验证逻辑 (灵活)                                   │
│   - 例子: API 网关, 复杂路由逻辑, 限流                        │
├─────────────────────────────────────────────────────────────┤
│ Level 5: OpenResty + jwt-lua + Redis 黑名单                  │  ★ 大厂级
│   - 在 Level 4 基础上加:                                     │
│   - JWT 撤销 (黑名单, logout 后立即失效)                     │
│   - 多 token 同时验 (refresh token 轮转)                      │
│   - 单机扛 10 万 QPS                                          │
└─────────────────────────────────────────────────────────────┘
```

> 我们项目 (学习/教学规模) 适合 **Level 2**. Level 4-5 是 BAT 级别.

---

## 2. Level 1: `auth_basic` (HTTP Basic Auth)

```nginx
server {
    listen 8089;
    
    location / {
        auth_basic           "Admin Area";      # 弹窗标题
        auth_basic_user_file /etc/nginx/.htpasswd;  # 用户密码文件
        
        # 可选: 限制某些 IP 跳过
        satisfy any;       # 满足任一条件即可
        allow 192.168.1.0/24;
        deny  all;
        
        root /var/www/html;
    }
}
```

```bash
# 生成 .htpasswd 文件 (用户名 + bcrypt 密码)
htpasswd -c /etc/nginx/.htpasswd admin
# 输入密码后生成
admin:$apr1$XYZ...

# 浏览器访问 :8089 → 弹窗输入 admin / password → 通过
```

**优点**:
- 1 行配置搞定
- nginx 内置
- bcrypt 存密码

**缺点**:
- 每次请求都 Base64 解码 + 验证 (可缓存, 但简陋)
- 只保护 "是否登录", 不能传 user 信息
- 现代浏览器会记住, 不安全
- 不能跟 jwt 共存 (Authorization header 互斥)

**我们项目用**:
- ❌ 不需要. 教学项目 go-zero 已带 jwt. Basic 跟 jwt 互斥.

---

## 3. Level 2: `auth_request` (推荐 — ch02 教程吹的)

### 3.1 概念

```
HTTP POST :8088/order/v1/...
Authorization: Bearer eyJhbG...

      ↓ nginx
  ┌─────────────────────────────────────────┐
  │ 看到 /order/* 路由, 配了 auth_request   │
  │                                          │
  │ 内部发子请求:                             │
  │   POST :8088/auth_check                  │
  │   Authorization: Bearer eyJhbG...        │ ← nginx 自动复制原 header
  │                                          │
  │ 调 /auth_check 端 (你写的 go-zero / 其他)│
  │                                          │
  │ 端返回:                                   │
  │   200 OK                                  │
  │   X-User-Id: 1                            │ ← 你可以塞 header
  │   X-Tenant-Id: 5                          │
  │                                          │
  │ nginx 把 X-User-Id 复制到原请求           │
  │ proxy_set_header X-User-Id $upstream_http_x_user_id;  │
  │                                          │
  │ 最终转给 :1001 (order-api):              │
  │   Authorization: Bearer eyJhbG...        │ ← 原 header 保留
  │   X-User-Id: 1                            │ ← 新增! 从 auth_request 来
  └─────────────────────────────────────────┘
      ↓
   :1001 order-api (go-zero)
     ↓
   这里可以做 2 选 1:
     A) 仍然用 rest.WithJwt 重新验 token (defense in depth)
     B) 改成只读 X-User-Id header (信任 nginx 已经验过, 加快)
```

### 3.2 完整 nginx 配置示例

```nginx
# /tmp/nginx-auth-demo/nginx.conf
worker_processes 1;
events { worker_connections 1024; }

http {
    upstream backend_api {
        server 127.0.0.1:1001;  # order-api
    }
    
    upstream auth_service {
        server 127.0.0.1:1009;  # 我们要新建的 :1009 鉴权服务
    }

    server {
        listen 8088;

        # 共享的 proxy header (跟 step-10 一样)
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # ★ 关键: 把 /auth_check 子请求打到 :1009
        location = /auth_check {
            internal;             # 外部访问不到, 仅内部
            proxy_pass http://auth_service/auth_check;
            proxy_pass_request_body off;
            proxy_set_header Content-Length "";
            proxy_set_header X-Original-URI $request_uri;
        }

        # 业务路由, 强制走 auth_request
        location /order/ {
            auth_request /auth_check;          # ← 先调 /auth_check
            
            # auth_request 成功后, 把子请求的 response header 复制到主请求
            auth_request_set $auth_user_id $upstream_http_x_user_id;
            auth_request_set $auth_tenant_id $upstream_http_x_tenant_id;
            auth_request_set $auth_role $upstream_http_x_role;
            
            proxy_set_header X-User-Id $auth_user_id;
            proxy_set_header X-Tenant-Id $auth_tenant_id;
            proxy_set_header X-Role $auth_role;
            
            proxy_pass http://backend_api;       # ← 真转给 :1001
        }
        
        # 公开接口 (login/register) 不需要鉴权
        location /usercenter/v1/user/login {
            proxy_pass http://backend_api;
        }
    }
}
```

### 3.3 配套的"鉴权服务" (go-zero 实现, :1009)

我们项目已经有 usercenter-rpc 生成 token, 加一个 usercenter-api endpoint:

```go
// app/usercenter/cmd/api/internal/handler/usercenter/authCheckHandler.go (新增)
// goctl 不能自动生成, 手动写

func AuthCheckHandler(ctx *svc.ServiceContext) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // 1. 拿 Authorization
        auth := r.GetHeader("Authorization")
        if !strings.HasPrefix(auth, "Bearer ") {
            http.Error(w, "no token", 401)
            return
        }
        token := strings.TrimPrefix(auth, "Bearer ")
        
        // 2. 验证 + parse (跟 step-11 一样, 调 usercenter-rpc)
        // 注意: 这里**重复**验证 token (因为 nginx 调我们, 业务又调)
        // 真实生产可以省: nginx 已经验了, 这里只 parse 拿 userId
        claims, err := jwt.ParseToken(token, secret)
        if err != nil {
            http.Error(w, err.Error(), 401)
            return
        }
        
        // 3. ★ 关键: 把 userId 写 response header (nginx 会读)
        // nginx 用 auth_request_set $x $upstream_http_x_y 取这些
        w.Header().Set("X-User-Id", strconv.FormatInt(claims.UserId, 10))
        // (可以再塞 X-Tenant-Id, X-Role 等)
        
        // 4. 返回 200 OK (nginx 看到 200 = 通过)
        w.WriteHeader(http.StatusOK)
    }
}
```

### 3.4 :1001 (order-api) 端改动

```go
// 之前 (step-11): 走 jwt 完整校验
// 现在 (step-12 升级): 信任 X-User-Id, 跳过 jwt parse (nginx 已经做过)
func (m *CreateHomestayOrderLogic) CreateHomestayOrder(req Req) (*Resp, error) {
    userIdStr := m.ctx.Value("X-User-Id").(string)
    userId, _ := strconv.ParseInt(userIdStr, 10, 64)
    
    // 也可以保留 rest.WithJwt 做"双重保险"
    // 看项目策略: 安全优先 / 性能优先
    ...
}
```

### 3.5 验证测试 (3 步)

```bash
# 1. nginx 起 :8088
nginx -p /tmp/nginx-auth-demo -c nginx.conf

# 2. 用户中心 (usercenter-api) 起 :1009 (含 auth_check endpoint)

# 3. 业务服务 (order-api) 起 :1001
./scripts/dev-up.sh

# 4. 拿 token (跟 step-11 一样)
TOKEN=$(curl -s -X POST :1009/usercenter/v1/user/login \
  -d '{"mobile":"18721432599","password":"test123456"}' \
  | jq -r .data.accessToken)

# 5. 直 curl :1001 (不走 nginx) → 应该 200
curl -X POST :1001/order/v1/.../createHomestayOrder \
  -H "Authorization: Bearer $TOKEN" ...

# 6. 通过 nginx :8088 → 应该也 200, 后端能看到 X-User-Id header
curl -X POST :8088/order/v1/.../createHomestayOrder \
  -H "Authorization: Bearer $TOKEN" ...

# 7. 没 token 走 nginx → nginx 先调 /auth_check, 返回 401 → nginx 401, 业务不到
curl -X POST :8088/order/v1/.../createHomestayOrder
# 预期: 401 Unauthorized, X-User-Id: 空
```

### 3.6 auth_request 的好处

- ✅ **无 token 在 nginx 就 401**, 业务 API 进程不被唤醒
- ✅ **业务不动**: go-zero 仍然完整验 token (defense in depth)
- ✅ **可扩展**: 多服务用同一 auth endpoint, 一处改全部生效
- ✅ **黑名单**: 在 auth service 里查 Redis, 立刻禁某个 token

### 3.7 auth_request 的坑

| 坑 | 说明 |
|----|------|
| **死循环** | /auth_check 自己又被 auth_request 触发 → 用 `internal` 防 |
| **sub-request 阻塞主请求** | /auth_check 慢 = 主请求慢, **不要在 /auth_check 里查慢的 DB** |
| **auth_request 与 limit_req 顺序** | 通常先限流再鉴权, nginx 默认行为, 但要测 |
| **HEADER 大小写** | upstream_http_X_USER_ID vs X-User-Id, 注意 nginx 写法 |

---

## 4. Level 3: 第三方 nginx 模块 `nginx-auth-jwt`

有些**人不想写 auth service**, 想要 nginx **直接**验 JWT. 这就需要编译进 nginx 的 C 模块.

```nginx
# 编译 nginx 时加这个模块
./configure --add-module=../nginx-auth-jwt
make && make install
```

```nginx
# nginx 配置
location /api/ {
    auth_jwt          "your-secret-string";        # 验签 secret
    auth_jwt_algorithm HS256;                       # 算法
    auth_jwt_claim    sub;                         # 哪个 claim 是 user id
    auth_jwt_header    Authorization;              # 哪个 header
    
    proxy_pass http://backend_api;
}
```

**优点**:
- 不用写外部 service
- 直接 nginx 处理, 性能最好

**缺点**:
- 重新编译 nginx (运维痛)
- 没法查黑名单 (除非再加 redis-nginx-module)
- 灵活性低 (Lua 比 C 模块灵活)

**我们项目用**:
- ❌ 不需要. **brew nginx 不带这个 module**, 装它要重新编译. 学习目的不需要.

---

## 5. Level 4: OpenResty + lua-resty-jwt (大厂最爱)

### 5.1 OpenResty 是什么

```
nginx + LuaJIT + 一堆 Lua 模块 (resty 系列)

优点:
- nginx 所有能力 (反代/限流) + Lua 灵活 (JWT/redis/限流逻辑)
- 高性能 (LuaJIT 跟 C 差不多)
- Kong/APISIX 都基于 OpenResty
```

```bash
brew install openresty/brew/openresty
# 安装后: /opt/homebrew/opt/openresty/bin/openresty
# 配置文件: /opt/homebrew/opt/openresty/nginx/conf/nginx.conf
```

### 5.2 用 lua-resty-jwt 验 token

```nginx
# 在 nginx.conf 的 http 块
init_by_lua_block {
    jwt = require "resty.jwt"
    -- 启动时加载 secret (避免每个请求都读文件)
}

server {
    listen 8088;
    
    location /api/ {
        # 用 access_by_lua_block 写 Lua 验证逻辑
        access_by_lua_block {
            local auth_header = ngx.var.http_authorization
            if not auth_header then
                ngx.status = 401
                ngx.say("no token")
                return ngx.exit(401)
            end
            
            -- 解析 Bearer token
            local _, _, token = string.find(auth_header, "^Bearer%s+(.+)$")
            if not token then
                ngx.status = 401
                ngx.say("malformed")
                return ngx.exit(401)
            end
            
            -- 验证 (用 jwt 库)
            local jwt_obj = jwt:verify(secret, token)
            if not jwt_obj.verified then
                ngx.status = 401
                ngx.say("invalid token")
                return ngx.exit(401)
            end
            
            -- 把 userId 写到变量, 后面 proxy_set_header 用
            ngx.var.user_id = jwt_obj.payload.sub
            
            -- 或写 header
            ngx.req.set_header("X-User-Id", jwt_obj.payload.sub)
        }
        
        proxy_pass http://backend_api;
    }
}
```

**优点**:
- ✅ nginx 直接验 (无外部 service)
- ✅ 灵活: 可以做 Lua 任意逻辑 (查 Redis / 黑名单 / 限流)
- ✅ 性能: LuaJIT 跟 C 一个量级

**缺点**:
- ❌ 学习曲线陡 (要学 OpenResty + Lua)
- ❌ brew nginx 不带 (得另装 openresty)

**我们项目用**:
- ❌ 不需要. 教学项目, Level 2 已经够.

---

## 6. Level 5: 大厂级 (OpenResty + jwt-lua + Redis 黑名单)

```lua
-- 验 JWT
local verified, err = jwt:verify(secret, token)
if not verified then return 401 end

-- ★ 黑名单检查 (logout 后立即失效)
local key = "jwt:blacklist:" .. jwt_obj.payload.jti
local is_blacklisted = redis:get(key)
if is_blacklisted then
    return 401
end

-- ★ 多 token 轮转 (refresh token)
if jwt_obj.payload.typ == "refresh" then
    -- 拒绝 refresh token 访问 api 路由
    return 401
end

-- ★ 自定义 claim 验证 (e.g. 必须有 tenantId)
if not jwt_obj.payload.tenantId then
    return 401
end

-- 通过
ngx.req.set_header("X-User-Id", jwt_obj.payload.sub)
```

**这是大厂级"完整鉴权"**. 我们的教程项目**远不到这个复杂度**.

---

## 7. 与 step-11 (go-zero JWT) 对比

| 维度 | go-zero `rest.WithJwt` | nginx `auth_request` | nginx Level 4 (Lua) |
|------|------------------------|---------------------|---------------------|
| **位置** | api 层 handler 链 | nginx 入口 | nginx 入口 |
| **验证算法** | HMAC + claims parse | 委托给 service | HMAC + claims parse |
| **失效 token** | 401, 调用链终止 | 401, 后端 0 负载 | 401, 后端 0 负载 |
| **额外能力** | 无 (单纯验) | 黑名单 / 限流 / rbac | 黑名单 / 限流 / rbac / Lua |
| **修改成本** | 改 4 个 service | 改 1 个 service + 1 个 nginx conf | 改 nginx.conf |
| **运维** | 已有, 0 成本 | 加 1 个 service, 1 conf | 加 openresty, Lua 维护 |
| **Token 黑名单** | ❌ 不支持 | ✅ 在 auth service | ✅ Lua 直查 Redis |
| **业务耦合** | 直接 (jwt 包) | 间接 (auth service) | 强耦合 (Lua) |

---

## 8. 我们项目应该用哪个?

### 8.1 现在不需要

我们的项目:
- go-zero `rest.WithJwt` 已经覆盖 HTTP 入向
- dev 阶段 4 service + 教学用
- nginx host mode 都还没跑起来

### 8.2 何时上 nginx auth_request (Level 2)?

**触发条件**:
- 上 production (微信回调需要 https + 域名)
- 多团队协作, 后端 service 暴露给前端
- 想让 401 在 nginx 层就返回, 不进业务进程

**改动量**:
- 加 1 个 usercenter-api endpoint (`/auth_check`)
- 改 nginx host conf (host mode Phase 1 完成后)
- 50 行配置 + 50 行 handler

### 8.3 何时上 OpenResty / APISIX (Level 4-5)?

**触发条件**:
- 多业务线 (>10 service, 跨团队)
- 需要黑名单 / 限流 / RBAC 高级功能
- 团队有 SRE 维护 OpenResty

**我们项目不到这个级别**, **不需要**.

---

## 9. 真正的"模式 B" 实现示例

我们之前聊过, gateway 鉴权 + 业务鉴权 = defense in depth. 这给个**完整跑得动**的例子:

### 9.1 nginx.conf (host mode, ch02 升级版)

```nginx
# /tmp/nginx-mode-b/nginx.conf
worker_processes 1;
events { worker_connections 1024; }

http {
    # 业务 upstream
    upstream order_api    { server 127.0.0.1:1001; }
    upstream usercenter_api { server 127.0.0.1:1004; }
    upstream auth_check    { server 127.0.0.1:1009; }  # 我们刚加的

    server {
        listen 8088;

        # 子请求 /auth_check: 仅内部, 外部不可达
        location = /auth_check {
            internal;
            proxy_pass http://auth_check/auth_check;
            proxy_pass_request_body off;
            proxy_set_header Content-Length "";
            proxy_set_header X-Original-URI $request_uri;
        }

        # 公开 endpoint (登录)
        location = /usercenter/v1/user/login {
            proxy_pass http://usercenter_api;
        }

        # 受保护: 业务路由
        location /order/ {
            auth_request /auth_check;  # ← 先验 token
            
            # 把 auth 子请求的 response header 复制到主请求
            auth_request_set $auth_user_id   $upstream_http_x_user_id;
            auth_request_set $auth_tenant_id $upstream_http_x_tenant_id;
            
            # 主请求转发给业务
            proxy_set_header X-User-Id   $auth_user_id;
            proxy_set_header X-Tenant-Id $auth_tenant_id;
            proxy_set_header Host $http_host;
            proxy_pass http://order_api;
        }
    }
}
```

### 9.2 usercenter-api 加 :1009 鉴权 endpoint

```go
// app/usercenter/cmd/api/internal/handler/usercenter/authCheckHandler.go (新文件)

func AuthCheckHandler(svcCtx *svc.ServiceContext) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
        if token == "" {
            http.Error(w, "no token", http.StatusUnauthorized)
            return
        }

        // 用 go-zero 的 token 解析 (跟 step-11 一致)
        // 注意: 这里我们**重新验证** token (defense in depth)
        // 真生产 nginx 已验证, 这里可以省, 只 parse 拿 claims
        parser := token.NewTokenParser()
        tok, err := parser.ParseToken(r, svcCtx.Config.JwtAuth.AccessSecret, "")
        if err != nil {
            http.Error(w, err.Error(), http.StatusUnauthorized)
            return
        }
        if !tok.Valid {
            http.Error(w, "invalid", http.StatusUnauthorized)
            return
        }

        // ★ 拿 claims 写 response header (nginx auth_request_set 会读)
        claims := tok.Claims.(jwt.MapClaims)
        if uid, ok := claims["jwtUserId"]; ok {
            w.Header().Set("X-User-Id", fmt.Sprintf("%v", uid))
        }
        if tid, ok := claims["tenantId"]; ok {
            w.Header().Set("X-Tenant-Id", fmt.Sprintf("%v", tid))
        }

        // 200 OK = 通过
        w.WriteHeader(http.StatusOK)
    }
}
```

### 9.3 order-api 加 :8088 走 nginx 后端 / 直连 都能跑

```bash
# A. 直连 :1001 (skip nginx)
curl -X POST :1001/order/v1/homestayOrder/createHomestayOrder \
  -H "Authorization: Bearer $TOKEN" ... 

# B. 走 nginx :8088
curl -X POST :8088/order/v1/homestayOrder/createHomestayOrder \
  -H "Authorization: Bearer $TOKEN" ...

# 两个都应该 200 + trade_state 写入
```

### 9.4 关键改造点 (业务代码)

| 文件 | 改动 |
|------|------|
| `app/usercenter/cmd/api/internal/handler/routes.go` | 注册 `/auth_check` 路由 |
| `app/usercenter/cmd/api/internal/handler/usercenter/authCheckHandler.go` | **新文件** (handler) |
| `app/usercenter/cmd/api/etc/usercenter.yaml` | 加 `ListenOn: 0.0.0.0:1009` (单独的 server block) |
| `app/order/cmd/api/internal/handler/routes.go` | **不改** (双重保险, jwt 继续验) |
| `deploy/nginx/conf.d/looklook-host.conf` | 加 auth_request 配置 |

**改动量**: 1 个新文件 + 3 处小改 ≈ 100 行.

---

## 10. 跟 step-09 的衔接

```
step-09 (ch02 网关调研)       nginx 是 Level 1 反代
step-10 (nginx 入门)           学会 4 个例子
step-11 (jwt internals)        理解 token 在 go-zero 里怎么用
step-12 (nginx 鉴权) ← 你在这  5 种方式 + auth_request 跑通
step-13 (APISIX/Kong)          产品对比 + JWT plugin 配置
```

**step-12 是 step-09 → step-13 的中间桥**:
- step-09 说"nginx 不够完整"
- step-12 教你怎么**补齐** (auth_request + 自定义 header)
- step-13 看"商业产品怎么把这事做掉 (一键 jwt-auth plugin)"

---

## 11. 实际可玩 (如果你想跑)

### 准备 (host mode Phase 1 完成后):

```bash
# 1. 加 :1009 鉴权 endpoint (上面 9.2)
# 2. usercenter-api 配置 listen :1009 (yaml)
# 3. 改 nginx host conf (上面 9.1)
# 4. 启 nginx
./scripts/dev-nginx-up.sh

# 测试 (3 路径)
# A. 无 token 走 nginx → 应该 401 (nginx 直接拒)
curl -X POST :8088/order/v1/.../createHomestayOrder

# B. 有 token 走 nginx → 应该 200, 后端能看到 X-User-Id
curl -X POST :8088/order/v1/.../createHomestayOrder \
  -H "Authorization: Bearer $TOKEN"

# C. 直连 :1001 (绕过 nginx) → 仍然 200 (go-zero 仍然验 token)
curl -X POST :1001/order/v1/.../createHomestayOrder \
  -H "Authorization: Bearer $TOKEN"

# 期望: A=401, B=200, C=200
```

---

## 12. 相关文档

- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 3 层网关视角
- [step-10 nginx 入门](step-10-nginx-101.md) — nginx conf 基本结构
- [step-11 jwt internals](step-11-auth-internals.md) — go-zero 怎么验 token
- [step-13 APISIX/Kong (next)](step-13-apisix-kong.md) — 商业产品

---

*创建于 2026-08-10, nginx 鉴权从基础到企业级完整图谱*
