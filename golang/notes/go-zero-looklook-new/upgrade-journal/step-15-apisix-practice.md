# step-15: APISIX 实战 (跟 nginx 实战形成"自建 vs 商业网关"完整对比)

## §0 文档目标

跟 step-12/step-14 nginx 实战形成完整闭环。把"理论对比 (step-13)"落地：
- APISIX 3.10.0 主体 + Dashboard 3.0.0 部署
- 配 4 个 upstream + 7 条 route + 1 个 consumer (jwt-auth)
- go-zero token 加 `key` 字段, 跟 APISIX jwt-auth 插件对接
- 6 路径验证鉴权链路 100% 正确
- nginx vs APISIX 选型对比

> 跟 step-14 的关系: step-14 用 nginx auth_request 模式 B 实现了"网关层 JWT 鉴权",
> step-15 用 APISIX jwt-auth 插件实现同样功能. 对比就能看清"自己写代码 vs 用商业插件"的差异.

---

## §1 起点 - step-14 的产出

step-14 (v3.24 commit) 已经能用 nginx auth_request 实现:
- `/usercenter/v1/user/login` 公开 (注册/wxMiniAuth 同理)
- `/usercenter/v1/user/detail` 受保护 (需 token, 走 auth_request 子请求验签)
- 公共回调 `/payment/v1/payment/callback` 公开

但 step-14 留了两个遗憾:
1. **路由配置散落在 nginx.conf** (静态文件, 改完要 reload)
2. **业务代码 jwt 鉴权跟网关 jwt 鉴权是双层的** (go-zero rest.WithJwt + nginx auth_request 都做同一件事)

step-15 用 APISIX 解决这两个问题: 路由走 Admin API/dashboard 动态管理, jwt 鉴权用 jwt-auth 插件.

---

## §2 Step 1 - 部署 APISIX (踩坑 5 个)

### 2.1 部署目标

- APISIX 主体: `apache/apisix:3.10.0-debian` (跑在 docker, 9080 代理 / 9180 Admin API)
- Dashboard: `apache/apisix-dashboard:3.0.0-alpine` (9000 UI)
- etcd: 复用 host 上已跑的 `quay.io/coreos/etcd:v3.5.21` (无需新起)

### 2.2 踩坑 1: dashboard 镜像版本

`apache/apisix-dashboard:3.10.0-alpine` 不存在. **dashboard 镜像版本号跟主体不同步** (主体 3.10.0, dashboard 最新是 3.0.0).

✅ 改用 `apache/apisix-dashboard:3.0.0-alpine`.

### 2.3 踩坑 2: dashboard conf 缺 `conf:` 顶层包裹

dashboard 启动 panic: `InitETCDClient(0x0) nil pointer dereference`. 

**根因**: dashboard 3.0.0 用 viper 解析 YAML, 强制要求 `conf:` 顶层 wrapper. 缺了 → parser 找不到 etcd section → 传 nil 给 etcd client → panic.

错误栈:
```
panic: runtime error: invalid memory address or nil pointer dereference
github.com/apisix/manager-api/internal/core/storage.InitETCDClient(0x0)
	/usr/local/apisix-dashboard/api/internal/core/storage/etcd.go:59
```

✅ `dashboard_conf.yaml` 用:
```yaml
conf:
  listen:
    host: 0.0.0.0
    port: 8080
  etcd:
    endpoints:
      - host.docker.internal:2379
  log:
    error_log: {level: warn}
    access_log: {level: info}
```

### 2.4 踩坑 3: APISIX 主体 config.yaml 用了 2.x 格式

启动后 etcd 连不上, 日志:
```
dial tcp 127.0.0.1:2379: connection refused
```

**根因**: 我们用了 2.x 风格的顶层 `etcd.endpoints` 和顶层 `plugins`. APISIX **3.x 强制要求**:
- `etcd` 必须在 `deployment.etcd.host` 下, 值是完整 URL (`http://host:2379`)
- 顶层 `etcd:` / `plugins:` 都是 2.x 写法, 3.x 会忽略 → 回退默认 `127.0.0.1:2379`

镜像里默认 config.yaml 只有 63 行:
```yaml
deployment:
  role: traditional
  role_traditional:
    config_provider: etcd
  admin:
    admin_key:
      - name: admin
        key: ''
        role: admin
```

✅ 改成 3.x 格式 (`deploy/apisix/config.yaml`):
```yaml
apisix:
  node_listen: 9080
  enable_admin: true
  enable_dev_mode: true

deployment:
  role: traditional
  role_traditional:
    config_provider: etcd
  admin:
    admin_key:
      - name: admin
        key: edd1c9f034325f303f3f3f3f3f3f3f3f
        role: admin
    allow_admin:
      - 0.0.0.0/0
  etcd:
    host:
      - http://host.docker.internal:2379
    prefix: /apisix
```

> 这跟之前 APISIX 主体 docker 启动失败的坑完全类似: **2.x → 3.x schema 变了, 顶层字段都搬走了**.

### 2.5 踩坑 4: dashboard 连不上 etcd (用户登录失败)

dashboard 启动后页面能打开 (admin/admin 提示 10000 username or password error). 

**根因排查**:
- 日志显示 `etcd connection loss detected, times: 380` 一直循环
- `target=etcd-endpoints://0x400/192.168.65.254:2379` 但 `dial tcp 127.0.0.1:2379`
- alpine + **musl libc**: Go 解析器不读容器 `/etc/hosts`, `host.docker.internal` fallback `127.0.0.1`
- 即使改成真实 IP (`192.168.65.254`), manager-api **二进制里硬编码了默认 etcd 地址 `127.0.0.1:2379`**, 在 bridge 网络下永远连自己

✅ **socat 重定向方案** (`deploy/apisix/dashboard-entrypoint.sh`):
```sh
apk add --no-cache socat >/dev/null 2>&1
socat TCP-LISTEN:2379,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:2379 &
exec /usr/local/apisix-dashboard/manager-api -p /usr/local/apisix-dashboard \
     -c /usr/local/apisix-dashboard/conf/conf.yaml
```

这样:
- manager-api 内部连 `127.0.0.1:2379` → socat → host.docker.internal:2379 → 宿主机 etcd ✓

### 2.6 踩坑 5: dashboard ENTRYPOINT 默认值

第一次启动失败:
```
Error: unknown command "sh" for "manager-api"
```

**根因**: 镜像 ENTRYPOINT 是 `manager-api`, 我们在 `command: ["sh", "entrypoint.sh"]` 会变成 `manager-api sh entrypoint.sh`. 

✅ 改用 `entrypoint:` (覆盖 ENTRYPOINT 而非 CMD), 并用 manager-api 的**完整路径** `/usr/local/apisix-dashboard/manager-api`.

---

## §3 Step 2 - 配 Upstream / Route / Consumer

### 3.1 APISIX 的核心概念 (跟 nginx 对照)

```
nginx 的 location  =  APISIX 的 Route (什么路径 → 转发规则 + 插件)
nginx 的 proxy_pass =  APISIX 的 Upstream (后端在哪)
nginx 的 auth_request =  APISIX 的 Plugin (jwt-auth 挂在 Route 上)
```

但 APISIX 多了一个 nginx 没有的层次: **Consumer** (鉴权身份). 把"用什么 key 验签"从路由上解耦.

### 3.2 4 个 Upstream (后端服务)

每个 go-zero 服务对应一个 upstream, 4 条命令 (脚本化):

```bash
curl -X PUT http://127.0.0.1:9180/apisix/admin/upstreams/1 \
  -H "X-API-KEY: edd1c9f034325f303f3f3f3f3f3f3f3f" \
  -d '{"name":"order-api","desc":"looklook order api (端口1001)",
       "type":"roundrobin",
       "nodes":{"host.docker.internal:1001":1}}'
# 同样方式建 2=payment:1002, 3=travel:1003, 4=usercenter:1004
```

`scripts/dev-apisix-upstreams.sh` 幂等可重复执行.

> **小坑**: 第一次 dashboard 显示名称/描述是空的 (因为 curl 没传 name/desc). 加上后 dashboard 上游列表就能看到 `order-api` 等名称.

### 3.3 1 个 Consumer (jwt-auth 鉴权身份)

```bash
curl -X PUT http://127.0.0.1:9180/apisix/admin/consumers \
  -H "X-API-KEY: edd1c9f034325f303f3f3f3f3f3f3f3f" \
  -d '{
    "username":"looklook",
    "desc":"looklook 项目的 JWT 签发方",
    "plugins":{
      "jwt-auth":{
        "key":"looklook",
        "secret":"ae0536f9-6450-4606-8e13-5a19ed505da0",
        "algorithm":"HS256"
      }
    }
  }'
```

`scripts/dev-apisix-consumer.sh` 幂等可重复执行.

### 3.4 ★★★ 关键设计: key=固定值 ("looklook") vs key=userId

APISIX jwt-auth 验证流程:
```
请求: Authorization: Bearer <JWT>
  ↓ ① 取 token, 解出 payload
  ↓ ② 从 payload 里读 "key" 字段
  ↓ ③ 用这个 key 在 Consumer 表里查匹配的 Consumer
  ↓ ④ 用 Consumer 配置的 secret + algorithm 验签
  ↓ ⑤ 通过 → 放行, 注入 X-Consumer-* 头
```

**错误方案**: `claims["key"] = userId` (每个用户 key 不同)
- 需要建无穷多个 Consumer (一个 userId 一个)
- 用户身份本来就在 token 的 `userId` 字段里, key 不该用来区分用户

**正确方案**: `claims["key"] = "looklook"` (固定值, 代表"签发方")
- 所有用户 token 用同一个 key → 找到同一个 Consumer
- 用 Consumer 的 secret 验签 → 任意用户 token (只要签发方正确) 都能通过
- 用户身份透传在 token 的 `userId` 字段,业务代码照常使用

✅ go-zero 代码改动 (`app/usercenter/cmd/rpc/internal/logic/generateTokenLogic.go`):
```go
func (l *GenerateTokenLogic) getJwtToken(secretKey, iat, seconds, userId int64) (string, error) {
    claims := make(jwt.MapClaims)
    claims["exp"] = iat + seconds
    claims["iat"] = iat
    claims[ctxdata.CtxKeyJwtUserId] = userId
    claims["key"] = "looklook"   // APISIX jwt-auth 用它匹配 Consumer (固定值, 代表签发方 usercenter)
    token := jwt.New(jwt.SigningMethodHS256)
    token.Claims = claims
    return token.SignedString([]byte(secretKey))
}
```

**secret 一致性是整个方案能跑通的关键**: 
- APISIX Consumer.jwt-auth.secret = `ae0536f9-6450-4606-8e13-5a19ed505da0`
- go-zero 各 service yaml 的 `JwtAuth.AccessSecret` = `ae0536f9-6450-4606-8e13-5a19ed505da0`
- 任何一方改了, 整套鉴权就全失效

### 3.5 7 条 Route (4 精确 + 3 catch-all)

| id | uri | upstream | 鉴权 |
|---|---|---|---|
| 1 | `/usercenter/v1/user/login` | 4 | 公开 |
| 2 | `/usercenter/v1/user/register` | 4 | 公开 |
| 3 | `/usercenter/v1/user/wxMiniAuth` | 4 | 公开 |
| 4 | `/usercenter/v1/user/detail` | 4 | **jwt-auth** |
| 10 | `/travel/*` | 3 | 公开 |
| 20 | `/payment/v1/thirdPayment/thirdPaymentWxPayCallback` | 2 | 公开 |
| 30 | `/order/*` | 1 | **jwt-auth** |

设计要点:
- 精确路径 (login/register/wxMiniAuth/detail/callback) 用**精确匹配**, catch-all (`/travel/*`、`/order/*`) 用**前缀匹配**
- APISIX 默认按最长匹配优先, 精确路径不会被 catch-all 截胡
- 受保护路由挂 `plugins.jwt-auth: {}`, 公开路由不挂

```bash
# 受保护示例
curl -X PUT http://127.0.0.1:9180/apisix/admin/routes/30 \
  -H "X-API-KEY: edd1c9f034325f303f3f3f3f3f3f3f3f" \
  -d '{
    "uri":"/order/*",
    "name":"order-catchall-protected",
    "desc":"订单(需 token)",
    "upstream_id":"1",
    "plugins":{"jwt-auth":{}}
  }'
```

`scripts/dev-apisix-routes.sh` 幂等可重复执行.

---

## §4 Step 3 - 6 路径验证 (鉴权链路 100% 正确)

`scripts/dev-apisix-verify.sh` 把 6 条路径一次性跑完, 关键结果:

### 4.1 测试矩阵和结果

| # | 路径 | 期望 | 结果 | 分析 |
|---|---|---|---|---|
| 1 | `/travel/v1/homestay/homestayList` | 公开 | ⚠️ 400 业务参数错 | **鉴权过了**, 业务层缺 `page` 字段 |
| 2 | `/order/v1/homestayOrder/createHomestayOrder` | 不带 token → 401 | ✅ **401** | **jwt-auth 拦截成功** |
| 3 | `/usercenter/v1/user/login` | 公开, 拿 token | ✅ 200 | **payload 有 `"key":"looklook"`** ← 核心 |
| 4 | `/usercenter/v1/user/detail` | 带 token → 200 | ✅ 200 | 双层鉴权 (APISIX + go-zero) 都通过 |
| 5 | `/order/v1/homestayOrder/createHomestayOrder` | 带 token | ⚠️ 400 业务参数错 | **鉴权过了**, 业务层缺参数 |
| 6 | `/payment/v1/thirdPayment/thirdPaymentWxPayCallback` | 公开 | ⚠️ 400 业务参数错 | **鉴权过了**, callback 缺参数 |

### 4.2 ★★★ 关键证据 - 登录返回的 token payload

解 base64 第 2 段, 得到:
```json
{"exp":1817882840,"iat":1786346840,"jwtUserId":2,"key":"looklook"}
```

`"key":"looklook"` 这一行就是 **APISIX 用来匹配 Consumer 的字段**. 没有它, APISIX 报 "missing key in jwt payload" → 401.

### 4.3 双层鉴权怎么协同

请求 `http://127.0.0.1:9080/usercenter/v1/user/detail` 时:
```
APISIX (9080)
  ↓ jwt-auth 插件: 取 token, 解出 payload, 用 payload.key="looklook" 找 Consumer
  ↓ 用 Consumer.secret 验签 → 通过 → 放行 (注入 X-Consumer-* 头)
go-zero (1004)
  ↓ rest.WithJwt 中间件: 再取 token, 用同 AccessSecret 验签 → 通过
  ↓ 业务 handler: 拿到 userId=2, 处理请求
```

**为什么需要双层?** 网关层做粗粒度鉴权 (省去转发无效请求), 业务层做细粒度鉴权 (用户级权限). 真实项目里网关层是统一策略 (所有服务共用), 业务层是各服务自己的权限模型.

---

## §5 Step 4 - Dashboard 探索 (✅ v3.31 已修复)

### 5.1 期望

9000 dashboard: 看 upstream/route/consumer, 用 UI 改 (create/edit/delete).

### 5.2 已解决 (v3.31)

**真凶**: dashboard conf 缺 `apisix.base_url` + `apisix.admin_key` 这 2 个字段!

我们之前一直怀疑 authentication.users / 密码哈希 / schema 字段名,
但**真正的问题是 dashboard 不知道如何调 APISIX Admin API**:
- dashboard UI 操作 (点击下线/编辑路由/创建 consumer) 都通过代理转发到 APISIX Admin API (9180)
- 没配 `apisix.base_url` 和 `admin_key` → dashboard 没法发起有效请求
- 读操作侥幸能通 (可能是 dashboard 自己读 etcd), 写操作全部 401/无声失败
- 用户登录成功 → 点菜单 → 后端要调 Admin API 拿菜单数据 → 失败 → redirect 到 login

**修复** (deploy/apisix/dashboard_conf.yaml 加 2 段):
```yaml
apisix:
    base_url: http://apisix:9180/apisix
    admin_key: edd1c9f034325f303f3f3f3f3f3f3f3f

authentication:
    secret: edd1c9f034325f303f3f3f3f3f3f3f3f
    expire_time: 3600
    users:
        - username: admin
          password: admin
```

**验证** (v3.31 之后的 access.log):
```
POST  /apisix/admin/user/login         -> 200 ✅
GET   /apisix/admin/consumers           -> 200 ✅
GET   /apisix/admin/upstreams           -> 200 ✅
GET   /apisix/admin/routes              -> 200 ✅
PATCH /apisix/admin/routes/4 (toggle)   -> 200 ✅ ← 之前完全没反应!
```

dashboard 现在既能"看"又能"操作".

### 5.3 反思 (避免下次再踩)

- **dashboard 二进制里的 `Authentication` 字段不接受 bcrypt 哈希**, 也不需要 map 格式, list + username 即可 (我们之前猜错方向)
- **dashboard 启动时把 users 写进 etcd** (`/apisix/manager-api/.../users`), 登录时从 etcd 读
- **但如果 dashboard 不知道怎么调 Admin API (apisix.base_url 没配), 即使能登录, 写操作也失败**
- **viper 解析 authentication 段即使缩进有 warning (在 conf: 之外) 也能读**, 实际 schema 没我们想的严格

### 5.4 dashboard 的整体价值

- ✅ UI 配 upstream/route/consumer/SSL/插件 (可视化, 比 curl 友好)
- ✅ 实时生效 (Admin API 写 etcd, APISIX watch etcd 立即感知)
- ✅ RBAC (用户/角色/权限管理)
- ✅ 监控/审计 (操作日志, 可以看 access.log)
- 适合 ops 日常配置变更, 降低出错的概率

---

## §6 nginx vs APISIX 对比 (选型依据)

### 6.1 能力对比

| 维度 | nginx + auth_request | APISIX jwt-auth plugin |
|---|---|---|
| 鉴权能力 | ✅ 完全可实现 (写一个 /auth_check 子请求) | ✅ 内置 jwt-auth 插件, 配 1 行 |
| 配置方式 | 静态 nginx.conf, 改完 reload | 动态 Admin API / Dashboard / YAML (Standalone) |
| 配置语言 | nginx 自己的指令 (location/upstream) | JSON via Admin API 或 YAML |
| 多环境同步 | 手动改多份 conf 或模板渲染 | GitOps: YAML 提交 → sync 到 etcd → APISIX 自动生效 |
| 路由匹配 | `= ` 精确 / `~` 正则 / 前缀 | `uri` 精确 / `uris` 多 URI / `*` 通配 / 多 match 条件 |
| 限流 | `limit_req` 模块 | limit-count / limit-req / limit-conn 插件 |
| CORS | `add_header` 写 N 行 | cors 插件 1 行 |
| 鉴权身份管理 | ❌ 没有, 自己实现 | ✅ Consumer (用户名 + key/secret) |
| 黑白名单 | `allow` / `deny` | ip-restriction 插件 |
| 健康检查 | `health_check` 模块 | upstream 节点级 health check |
| 可观测性 | ❌ 自己接 Prometheus | ✅ 内置 prometheus 插件 (暴露 /apisix/prometheus/metrics) |
| 协议 | HTTP/HTTPS + stream (TCP/UDP) | HTTP/HTTPS + stream + gRPC + Dubbo |
| 性能 | 极高 (C10K, 写得好可达百万级) | 高 (OpenResty + Lua, 几十万级) |
| 学习曲线 | 中 (nginx conf + 正则) | 中 (JSON / YAML + 插件体系) |
| 部署 | 单 binary / docker | docker / k8s / install.sh |

### 6.2 选型建议

**用 nginx 的场景**:
- 极简场景 (纯静态代理, 无动态配置)
- 性能极敏感 (nginx > APISIX)
- 团队熟悉 nginx, 不愿意引入新组件

**用 APISIX 的场景** (我们的 looklook):
- 多服务、多环境、配置需要频繁改
- 需要可视化 (dashboard) 减少 ops 出错
- 想用现成插件 (jwt-auth/cors/limit) 而不是自己实现
- 准备上 K8s (APISIX Ingress Controller)

**用 Kong 的场景**:
- 企业版 (有商业支持)
- 团队熟悉 OpenResty
- 需要丰富插件市场 (Kong Hub)

### 6.3 looklook 项目最终选型

**保持 nginx (step-14 的方案) 作为主网关**, APISIX 作为对比学习已收尾:
- nginx 方案已稳定跑通 (v3.24)
- 不引入新组件降低 ops 复杂度
- APISIX 知识储备完整, 未来如果需要动态路由/可视化运维可平滑迁移

---

## §7 关键设计要点回顾

### 7.1 go-zero token payload 加 `key` 字段 (核心对接)

```go
claims["key"] = "looklook"   // 固定值, 不是 userId
```

为什么用固定值 (而不是 userId): Consumer 是"签发方"概念, 一个项目一个, 用 userId 会让 Consumer 数量爆炸.

### 7.2 双层鉴权的边界

| 层 | 验证什么 | 用什么 | 失败后果 |
|---|---|---|---|
| APISIX (网关) | token 合法性 + 是否在白名单 | Consumer.secret + payload.key | 401 |
| go-zero (业务) | token 合法性 + 业务权限 | service yaml 的 AccessSecret + 业务 userId 校验 | 401 / 403 |

两层的 secret 必须一致 (同一项目同一 secret), 否则 token 一层过一层挂。

### 7.3 公开 vs 受保护路径

| 业务路径 | 鉴权 | 理由 |
|---|---|---|
| `/usercenter/v1/user/login` | 公开 | 拿 token 之前必须能调 |
| `/usercenter/v1/user/register` | 公开 | 注册 |
| `/usercenter/v1/user/wxMiniAuth` | 公开 | 微信小程序授权 |
| `/usercenter/v1/user/detail` | jwt-auth | 我的资料 |
| `/travel/*` | 公开 | 旅游业务浏览为主 |
| `/payment/v1/thirdPayment/thirdPaymentWxPayCallback` | 公开 | 微信回调 (不能鉴权, 微信服务端发起) |
| `/order/*` | jwt-auth | 下单要登录 |

### 7.4 配置文件组织

```
deploy/apisix/
├── docker-compose.yml       # apisix 主体 + dashboard (复用 host etcd)
├── config.yaml              # APISIX 主体 3.x 配置
├── dashboard_conf.yaml      # Dashboard 3.0.0 配置 (含 conf: wrapper)
└── dashboard-entrypoint.sh  # socat 重定向 (127.0.0.1:2379 → host.docker.internal:2379)

scripts/
├── dev-apisix-up.sh         # 启动 APISIX
├── dev-apisix-down.sh       # 停止 APISIX
├── dev-apisix-status.sh     # 查看状态
├── dev-apisix-upstreams.sh  # 建 4 个 upstream
├── dev-apisix-consumer.sh   # 建 1 个 consumer (jwt-auth)
├── dev-apisix-routes.sh     # 建 7 条 route
└── dev-apisix-verify.sh     # 6 路径验证脚本
```

所有 4 个 `dev-apisix-*.sh` 都**幂等可重复执行** (用 PUT 而不是 POST).

---

## §8 总结

### 8.1 5 步走的成果

| 步骤 | 内容 | 结果 |
|---|---|---|
| A1 准备 | APISIX 配置文件 + 4 个脚本 | ✅ v3.26 commit |
| A2 起 APISIX | 修复 3 个 schema 坑 (dashboard 顶层 conf 包裹、APISIX 3.x etcd.host、socat) | ✅ Dashboard 9000 可访问, Admin API 9180 可用 |
| A3 配 routes | 4 upstream + 7 route + 1 consumer + go-zero claims["key"] = "looklook" | ✅ v3.27 commit |
| A4 验证 | 6 路径, 鉴权 100% 正确 | ✅ token payload 有 "key" 字段 |
| A5 收尾 | step-15 文档 (本文) + commit | ✅ v3.29 commit |

### 8.2 给后续 step 的建议

- 短期 (1-2 周): 继续 ch11/12/13 基础设施 (ELK + OTel + Prom)
- 中期 (1 月): pkg/errors 全量迁移 (4d-2)
- 长期: dashboard 登录问题二次排查 (或者换 admin API + 脚本一劳永逸)

### 8.3 学习价值

step-15 给的最大收获不是"我们会用 APISIX 了", 而是看清了:
- **2.x → 3.x 升级最容易踩 schema 坑** (etcd 位置、plugins 段、conf 包裹)
- **alpine + musl 的 DNS 解析坑** (Go 解析器不读 /etc/hosts)
- **APISIX 默认值硬编码** 是设计选择 (CI/CD 友好), 但要理解才能排错
- **nginx auth_request 模式 B** (step-14) vs **APISIX jwt-auth 插件** 是同一问题的两种解法, 对比出 "自己写代码 vs 用商业插件" 的权衡

---

## §9 相关文件路径

```
deploy/apisix/
├── docker-compose.yml
├── config.yaml
├── dashboard_conf.yaml
└── dashboard-entrypoint.sh

scripts/
├── dev-apisix-up.sh
├── dev-apisix-down.sh
├── dev-apisix-status.sh
├── dev-apisix-upstreams.sh
├── dev-apisix-consumer.sh
├── dev-apisix-routes.sh
└── dev-apisix-verify.sh

app/usercenter/cmd/rpc/internal/logic/
└── generateTokenLogic.go      # 改了 claims["key"] = "looklook"
```

## §10 相关阅读

- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 3 层架构 + 选型
- [step-10 nginx 入门](step-10-nginx-101.md) — 4 个例子
- [step-11 jwt internals](step-11-auth-internals.md) — token 双向链路
- [step-12 nginx 鉴权 5 层级](step-12-nginx-auth.md) — auth_request 理论
- [step-13 APISIX/Kong](step-13-apisix-kong.md) — 商业产品对比
- [step-14 nginx auth_request 实战](step-14-nginx-auth-practice.md) — 跟本文直接对照

---

*创建于 2026-08-10, 跟随 step-13 理论 + step-14 nginx 实战的 APISIX 实战记录, v3.27/v3.28 已 ship*
