# Step 13: APISIX / Kong 作为网关产品对比

> 日期：2026-08-10  
> 配合：[step-09 网关调研](step-09-gateway-survey.md) + [step-10 nginx 入门](step-10-nginx-101.md) + [step-11 jwt internals](step-11-auth-internals.md) + [step-12 nginx 鉴权](step-12-nginx-auth.md)  
> 本步目标：**从理论"为什么需要" → 实战"用了什么"**

---

## 0. 阅读指南

读完这章:
- ✅ 知道 APISIX / Kong / nginx **功能差异在哪**
- ✅ 知道 **JWT plugin 在 APISIX 里怎么配** (替代 step-12 auth_request 的产品级方案)
- ✅ 知道 **本项目是否需要** + **何时需要**

---

## 1. APISIX / Kong 是个啥 (1 段话)

```
nginx (or OpenResty) + Lua 框架 + etcd (config 存储) + 100+ plugins + dashboard
```

**核心差异 vs 自建 nginx**:
- nginx 配路由靠手写 .conf 文件
- APISIX 配路由靠**调 Admin API** (或 dashboard) → 数据进 etcd → 节点热加载
- 100+ 现成 plugin (jwt-auth / limit-count / cors / prometheus / ...) 不用手写

---

## 2. APISIX 架构 (一个最小部署)

```
                                    ┌─────────────────────────┐
                                    │  apache/apisix:latest    │
                                    │  (OpenResty + plugins)   │
                                    │                         │
                                    │  Admin API: :9180        │
                                    │  HTTP Proxy: :9080        │
                                    │  Dashboard: :9000         │
                                    └──────┬───────────────┬──┘
                                           │               │
                                       config store     routes
                                           │               │
                                    ┌──────▼───────────────▼──┐
                                    │  etcd cluster            │
                                    │  (3 节点 / 1 节点 dev)    │
                                    └─────────────────────────┘
                                            │
                                       data store
                                            ▼
                                    ┌─────────────────────────┐
                                    │  Redis / Postgres         │
                                    │  (rate limit counter,    │
                                    │  consumer counters 等)   │
                                    └─────────────────────────┘
                                            ▲
                                            │ 反向代理
                                            │
   client ────► :9080 ────► upstream backend ────► go-zero api
```

**2 个**核心端口:
- `:9080` — 业务流量入口 (客户端走这里)
- `:9180` — Admin API (配置用, 不是给客户端的)

**1 个**可视化:
- `:9000` — Dashboard (UI 配 routes / plugins)

---

## 3. APISIX vs Kong vs nginx 横向对比

| 维度 | nginx | Kong | APISIX |
|------|-------|------|--------|
| **基础** | nginx | OpenResty + Lua | OpenResty + Lua |
| **配置存储** | 文件 | Postgres | **etcd** (K8s 友好) |
| **dashboard** | ❌ | ✅ | ✅ |
| **热改路由** | reload | ✅ | ✅ |
| **插件数** | 0 (手写 Lua) | 1000+ | 100+ |
| **jwt-auth plugin** | ❌ 需手写 | ✅ 1 行 | ✅ 1 行 |
| **OpenID Connect** | ❌ | ✅ | ✅ |
| **限流** | limit_req (简陋) | ✅ | ✅ (Redis 滑窗) |
| **服务发现** | 静态 upstream | consul / etcd / k8s | consul / etcd / k8s / nacos / DNS |
| **协议转换** | ❌ | ✅ HTTP → gRPC/HTTP | ✅ |
| **学习曲线** | 🟢 简单 | 🟡 中 | 🟡 中 |
| **运维** | conf 文件 | Postgres HA | etcd HA |
| **性能** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **生产用得多** | 大厂基础设施 | 国外大厂 | 国内大厂 (字节/滴滴) |
| **我们项目适用度** | ✅ 当前够用 | ❌ 重型 | ❌ 重型 (Phase 2 才考虑) |

---

## 4. APISIX 核心概念 (3 块)

### 4.1 Route (路由)
"什么样的请求 → 转给谁"

```yaml
# 等价于 nginx location
{
  "uri": "/order/*",                          # 匹配路径
  "methods": ["POST", "GET"],                 # 匹配方法
  "upstream_id": "order-upstream",             # 转给谁
  "plugins": {                                # 走哪些 plugin
    "jwt-auth": {...},
    "limit-count": {...}
  }
}
```

### 4.2 Upstream (上游)
"我转给哪个真实地址"

```yaml
{
  "id": "order-upstream",
  "type": "roundrobin",                       # 负载均衡
  "nodes": [
    {"host": "10.0.1.5", "port": 1001, "weight": 1},
    {"host": "10.0.1.6", "port": 1001, "weight": 1},
    {"host": "10.0.1.7", "port": 1001, "weight": 1}
  ]
}
```

### 4.3 Plugin (插件)
"路由上加什么能力"

```
常见 plugin:
- jwt-auth: 验 JWT (我们最关心的)
- key-auth: 验 API Key
- limit-count: 限流
- limit-req: QPS 限流
- cors: 跨域
- prometheus: 指标导出
- response-rewrite: 改 response
- fault-injection: 故障注入 (测试用)
- ip-restriction: IP 黑/白名单
```

---

## 5. APISIX JWT plugin (替代 step-12 auth_request)

这是 step-12 的"产品级"等价方案. **目标**: 给 `/order/*` 路由加 JWT 验证 + 失败 401 + 通过把 user_id 写到 header 转给 backend.

### 5.1 思路

```
Step 12 (nginx auth_request):
   client → nginx → 业务
                  ↓ 同步子请求
              /auth_check ← 你写的服务
                  ↑ 200 + X-User-Id header

Step 13 (APISIX jwt-auth plugin):
   client → APISIX → 业务
                   ↓ 用 jwt-auth plugin
              内部用 key + 共享 secret 验 (不用外部 service)
                   ↓ 通过, 写 X-User-Id header 给 backend
```

**差异**: APISIX 直接用 plugin 验 (不调外部), 速度更快, 不用维护 :1009 service.

### 5.2 Admin API 创建 JWT plugin 配置

```bash
# 1) 先建 upstream (我们的 order-api)
curl -X PUT http://127.0.0.1:9180/apisix/admin/upstreams/1 \
  -H "X-API-KEY: ${ADMIN_KEY:-edd1c9f034325f303f3f3f3f3f3f3f3f}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "roundrobin",
    "nodes": [
      {"host": "10.0.1.5", "port": 1001, "weight": 1}
    ]
  }'

# 2) 建 route (/order/* 走 jwt-auth plugin)
curl -X PUT http://127.0.0.1:9180/apisix/admin/routes/1 \
  -H "X-API-KEY: ${ADMIN_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "/order/*",
    "methods": ["POST", "GET", "PUT", "DELETE"],
    "upstream_id": "1",
    "plugins": {
      "jwt-auth": {
        "key": "user-key",
        "secret": "your-jwt-secret",
        "algorithm": "HS256",
        "claims_to_verify": ["exp", "iat"],
        "key_claim": "sub"
      }
    }
  }'

# 完成! 客户端走 :9080/order/... → APISIX 自动验 jwt
```

### 5.3 完整 docker-compose 起 APISIX (dev 模式)

```yaml
# docker-compose-apisix.yml
services:
  etcd:
    image: bitnami/etcd:3.5
    environment:
      ETCD_AUTO_COMPACTION_MODE: periodic
      ETCD_AUTO_COMPACTION_RETENTION: 100ms
      ALLOW_NONE_AUTHENTICATION: "yes"
    ports:
      - "2379:2379"

  apisix:
    image: apache/apisix:3.10.0-debian
    volumes:
      - ./apisix_conf/config.yaml:/usr/local/apisix/conf/config.yaml
      - ./apisix_conf/apisix.yaml:/usr/local/apisix/conf/apisix.yaml
    ports:
      - "9180:9180"   # Admin API
      - "9080:9080"   # HTTP proxy
      - "9000:9000"   # Dashboard
    depends_on:
      - etcd

  apisix-dashboard:
    image: apache/apisix-dashboard:3.10.0-alpine
    ports:
      - "9001:8080"   # Dashboard 端口避开 9000 (apisix 自带 admin web)
    environment:
      APISIX_LISTEN_ADDRESS: "apisix:9080"
    depends_on:
      - apisix

networks:
  default:
    name: looklook_net
```

### 5.4 Dashboard 看路由配置 (可视化)

打开 `http://localhost:9000`:

```
Route List:
┌────┬───────┬──────────┬────────────────┬──────────┐
│ ID │ URI   │ Methods  │ Plugins        │ Status   │
├────┼───────┼──────────┼────────────────┼──────────┤
│ 1  │ /order│ POST/GET │ jwt-auth + ... │ Enabled  │
│    │ /*     │          │ limit-count    │          │
│    │       │          │ cors           │          │
│ 2  │ /paym │ POST/GET │ jwt-auth + ... │ Enabled  │
│ ...│ ent/* │          │                │          │
└────┴───────┴──────────┴────────────────┴──────────┘
```

**改路由不需要 reload, dashboard 点保存就行**.

---

## 6. JWT plugin 在 APISIX 里做什么 (对比 step-11/12)

```
go-zero rest.WithJwt (step-11):
  ✓ Parse Authorization header
  ✓ Validate signature (HMAC + secret)
  ✓ Validate exp/nbf
  ✓ Inject claims into ctx
  ✗ No blacklist
  ✗ No rate limit integration

APISIX jwt-auth plugin (step-13):
  ✓ Parse Authorization header
  ✓ Validate signature (HS256/RS256/etc)
  ✓ Validate exp/nbf/iat
  ✓ Inject X-User-Id header (类似 ctx 注入)
  ✓ Blacklist (Redis)
  ✓ Rate limit (Redis 滑窗)
  ✓ Multiple algos support
  ✓ Different keys per consumer (multi-tenant)
```

**APISIX 比 go-zero 多 4 件事**: 黑名单 / 限流 / 多算法 / 多租户密钥管理.

**但**: **APISIX 也不验 RBAC** (用户能干啥), **仍然要业务层 (go-zero) 做**. 这是 step-12/13 都说过的.

---

## 7. APISIX vs Kong (2 个商业产品比较)

| 维度 | Kong | APISIX |
|------|------|--------|
| **公司** | Kong Inc (旧 Mashape, 美) | Apache 顶级项目 (中国) |
| **配置存储** | Postgres | **etcd** (K8s 友好) |
| **dashboard** | Kong Manager (商业) | Apache 开源 |
| **K8s 集成** | Kong Ingress Controller | APISIX Ingress Controller |
| **插件数** | 1000+ (含社区) | 100+ (官方 + 部分社区) |
| **多协议** | HTTP/gRPC/GraphQL | HTTP/gRPC/Stream |
| **自定义插件** | Lua (Kong PDK) | Lua / Go / Java / Python (新!) |
| **中国市场** | 一些外企 | 字节/滴滴/小米/...广泛 |
| **性能** | 一样 (OpenResty 内核) | 一样 |
| **社区** | 国际为主 | 国内为主 |
| **学习曲线** | 相似 | 相似 |
| **license** | 部分 enterprise 功能收费 | 全开源 |

**国内选 APISIX, 国际选 Kong**. 我们项目**两者都不需要**.

---

## 8. 我们项目应该用吗?

### 8.1 直接答案: **不需要**

理由:
1. **1 个团队, 5 个 service**, APISIX 是给"多团队 50+ service"用的
2. **go-zero 自带 jwt + 限流能力够用**
3. **etcd 集群是运维负担** (3 节点高可用 / dev 期单点)
4. **dashboard 对单人项目是 overkill**

### 8.2 真要上, 什么时机?

| 触发条件 | 选 APISIX 还是 Kong |
|---------|---------------------|
| K8s 化 (>10 service 弹性伸缩) | APISIX (etcd 跟 K8s 一样生态) |
| 跨业务线 (3+ 团队共用 1 个 gateway) | APISIX |
| 多协议 (HTTP + gRPC + Dubbo 同时代理) | APISIX / Kong 都行 |
| 需要 OAuth2 / OpenID Connect (单点登录) | Kong (生态更全) |
| 已经在用 K8s | APISIX Ingress Controller / Kong Ingress |
| 内部管理系统 (单一团队, 简单) | nginx (就够了, 别上 APISIX) |

### 8.3 折中方案 (推荐)

```
现在 (学习):  nginx (Level 1)
           + go-zero rest.WithJwt (业务鉴权)

Phase 1 (host mode):  nginx + auth_request (Level 2)
                     + go-zero 双鉴权 (defense in depth)

Production:           nginx + auth_request  + go-zero 双鉴权 (我们项目规模)
                      OR APISIX + jwt-auth plugin + go-zero 双鉴权 (如果上 K8s + 跨团队)
```

**永远要双鉴权**. APISIX/Kong 都不能取代业务层.

---

## 9. APISIX 实操 (如果你想跑起来看看)

### 9.1 准备 (macOS host 上 docker 跑)

```bash
# 1) 创建配置目录
mkdir -p ./apisix_conf
cat > ./apisix_conf/config.yaml << 'EOF'
deployment_role: traditional
deployment:
  role: traditional
  admin:
    admin_key:
      - name: admin
        key: edd1c9f034325f303f3f3f3f3f3f3f3f  # 改成你自己的
EOF

cat > ./apisix_conf/apisix.yaml << 'EOF'
routes: []      # 启动后用 Admin API 配
upstreams: []
EOF

# 2) 启 APISIX
docker-compose -f docker-compose-apisix.yml up -d

# 3) 验证
curl http://127.0.0.1:9180/apisix/admin/routes -H 'X-API-KEY: edd1c9f034325f303f3f3f3f3f3f3f3f'
# 预期: {"list":[],"total":0}
```

### 9.2 加业务路由 (curl Admin API)

```bash
ADMIN_KEY="edd1c9f034325f303f3f3f3f3f3f3f3f"

# 加 upstream (我们 go-zero 的 order-api)
curl -X PUT http://127.0.0.1:9180/apisix/admin/upstreams/1 \
  -H "X-API-KEY: $ADMIN_KEY" \
  -d '{"type":"roundrobin","nodes":[{"host":"host.docker.internal","port":1001,"weight":1}]}'

# 加 route (/order/* 用 jwt-auth plugin)
curl -X PUT http://127.0.0.1:9180/apisix/admin/routes/1 \
  -H "X-API-KEY: $ADMIN_KEY" \
  -d '{
    "uri":"/order/*",
    "methods":["GET","POST"],
    "upstream_id":"1",
    "plugins":{
      "jwt-auth":{
        "key":"user-key",
        "secret":"your-jwt-secret",
        "algorithm":"HS256"
      }
    }
  }'

# 测 1: 不带 token → 401
curl -i http://127.0.0.1:9080/order/v1/homestayOrder/userHomestayOrderList

# 测 2: 带 token → 200
TOKEN=$(curl -s -X POST :1004/usercenter/v1/user/login \
  -d '{"mobile":"18721432599","password":"test123456"}' | jq -r .data.accessToken)
curl -i http://127.0.0.1:9080/order/v1/homestayOrder/userHomestayOrderList \
  -H "Authorization: Bearer $TOKEN"
# 预期: 200 + 业务数据 (APISIX 自动验 token, 把 userId 写 header 给 backend)
```

### 9.3 Dashboard 配置

打开 `http://localhost:9000`, 默认账号 admin / admin:

```
Route → + Create → 填表 (uri / plugins / upstream) → 保存
```

---

## 10. APISIX vs step-12 nginx auth_request (代码量对比)

| 任务 | nginx auth_request | APISIX jwt-auth |
|------|-------------------|------------------|
| **nginx conf 行数** | ~30 行 | 1 行 (curl Admin) |
| **额外 service (auth_check)** | **需要写 ~50 行 go-zero handler** | **0** |
| **外部依赖** | 无 (自己写) | etcd 集群 |
| **dashboard** | ❌ | ✅ |
| **运行时改路由** | ❌ reload | ✅ 热改 |
| **学习曲线** | 中 (懂 nginx + go handler) | 高 (懂 nginx + etcd + admin api) |

> **小项目** nginx auth_request 真的够, **但** APISIX 把"dev 体验"做得好得多.

---

## 11. 三件套完整路径 (从 step-09 到 step-13)

```
step-09  网关调研:    3 层架构 + 产品对比 (调研)
   ↓
step-10  nginx 入门:   4 个例子 + 反向代理 (基础)
   ↓
step-11  jwt internals: go-zero 怎么验 token (业务侧)
   ↓
step-12  nginx 鉴权:   5 个层级 + auth_request (nginx 侧鉴权)
   ↓
step-13  APISIX/Kong:   产品级 gateway 替代方案 (当前步)
   ↓
   未来: 真正落地 nginx host mode → auth_request → 跑 M2.1+ 双鉴权
```

**这 5 篇形成完整"网关 + 鉴权"知识体系**. 缺哪个都能单独查.

---

## 12. 相关阅读

- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 3 层架构基础
- [step-10 nginx 入门](step-10-nginx-101.md) — nginx conf 基础
- [step-11 jwt internals](step-11-auth-internals.md) — go-zero token 处理
- [step-12 nginx 鉴权](step-12-nginx-auth.md) — nginx 5 个鉴权层级
- [APISIX 官方文档](https://apisix.apache.org/docs/)


---

*创建于 2026-08-10, APISIX/Kong 产品对比 + JWT plugin 实战*
