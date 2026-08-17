# Step 9: API 网关调研 (ch 02)

> 日期：2026-08-07 开始  
> 范围：ch 02 教程对应的工作 - 评估和实施 API 网关  
> 状态：🚧 调研中 (本步只调研不实施)  
> 关联：原始教程 [doc/chinese/02-nginx网关.md](../../doc/chinese/02-nginx网关.md)

---

## 0. 文档目标

回答 4 个问题:
1. **现状**：nginx 现在是什么状态? 为什么从来没跑过?
2. **做不做**：我们**是不是真的需要**网关?
3. **怎么做**：如果做, 推荐路径是什么?
4. **换不换**：APISIX 还是 nginx??

---

## 1. 现状审计

### 1.1 配置文件清单

```
deploy/nginx/conf.d/looklook-gateway.conf   # 28 行, 仅 4 个 location 反代
docker-compose-env.yml                       # ❌ 不含 nginx
docker-compose.yml                           # ✅ 含 nginx-gateway 服务
modd.conf                                    # ❌ 不含 nginx (modd 老配置)
```

### 1.2 当前 config (摘录)

```nginx
server {
    listen 8081;
    location ~ /order/      { proxy_pass http://looklook:1001; }
    location ~ /payment/    { proxy_pass http://looklook:1002; }
    location ~ /travel/     { proxy_pass http://looklook:1003; }
    location ~ /usercenter/ { proxy_pass http://looklook:1004; }
}
```

**这就是个**"纯反向代理"**, **没有**:
- ❌ `auth_request` (教程说的"统一鉴权"完全没实现)
- ❌ 限流 / 熔断 / 灰度
- ❌ Header 注入 (业务需要 X-User-Id 等)
- ❌ TLS / HTTPS 配置

### 1.3 docker-compose.yml 中的 nginx 服务

```yaml
nginx-gateway:
  image: nginx:1.21.5
  container_name: nginx-gateway
  ports:
    - 8888:8081                  # host 8888 → 容器 8081
  volumes:
    - ./deploy/nginx/conf.d:/etc/nginx/conf.d
    - ./data/nginx/log:/var/log/nginx
  depends_on:
    - looklook                  # ← 等一个叫 "looklook" 的容器启动
```

### 1.4 实际跑没跑过?

**从来没跑过**. 我们 M1 / M2 一路直接 curl `:1004` `:1001` `:1003`. 也就是 nginx 配了但实际没在 path 里.

### 1.5 为什么没跑 (3 个原因)

| 原因 | 解释 |
|------|------|
| **A. 我们的服务跑在 host, 不是 docker** | proxy_pass `http://looklook:1001` 在 host 上不解析 (没这个 hostname) |
| **B. host 没 `/var/log/nginx` 目录** | conf 写死了 docker 路径, host 跑会因权限失败 |
| **C. 教程 ch02 提到的"auth_request"没在 conf 里** | 教程承诺的统一鉴权是吹牛, 真要做得另外写 location |

---

## 2. 是否真的需要网关?

### 2.1 不需要的场景 (本机 dev)
- 直接 curl `:1004` 的好处是简单可见
- 加网关要再配 conf + 启动 + 排障
- **对单人学习项目, 不值得**

### 2.2 必须的场景
- 多入口 (web/iOS/Android/小程序) → 统一鉴权 + 流量控制
- 微信回调需要 https + 域名 → 必须有反向代理
- k8s ingress / 灰度发布 / 蓝绿 → 必须有 gateway

### 2.3 本项目判定
**dev 阶段不需要**, **生产阶段强需求**.

具体需要与否的检查项:
- [ ] 微信支付回调 (需要 https + 域名)  ← 这是第一个 killer 需求
- [ ] 微信小程序前端 (需要 https)         ← 第二个
- [ ] 多端接入 / 限流 / 监控                ← 锦上添花

如果未来要做"真实接入微信小程序", **网关必修**.

---

## 3. 候选对比

### nginx (现有方案)
| 维度 | 评价 |
|------|------|
| 上手成本 | ⭐⭐ 最低 (我们熟) |
| 配置复杂度 | ⭐⭐ 简单 (4 location 一个 server) |
| 性能 | ⭐⭐⭐⭐⭐ 业界标杆 |
| 鉴权能力 | ⭐ 需手写 location (教程承诺的 auth_request 没实现) |
| 插件生态 | ⭐⭐ 主要靠手写 Lua 模块 |
| Dashboard | ❌ 无 |
| 动态路由 | ❌ 修改需要 reload |
| Service Discovery | ❌ 静态配置 |
| 维护成本 | 🟢 极低 (一个 conf + 进程) |
| 适合本项目 | dev ✅ / 生产 ✅ (大型厂也用) |

### APISIX
| 维度 | 评价 |
|------|------|
| 上手成本 | ⭐⭐⭐ 需要学 etcd / Admin API / 路由概念 |
| 配置复杂度 | ⭐⭐⭐ YAML/JSON route config, 起步需几小时 |
| 性能 | ⭐⭐⭐⭐⭐ nginx 内核 + etcd 服务发现 |
| 鉴权能力 | ⭐⭐⭐⭐⭐ jwt-auth / key-auth / openid-connect plugin |
| 插件生态 | ⭐⭐⭐⭐⭐ 100+ 官方插件 (限流 / 熔断 / 灰度 / 灰度发布 / 监控) |
| Dashboard | ✅ 完整, host:9000 |
| 动态路由 | ✅ etcd-backed, 热改 |
| Service Discovery | ✅ 集成 consul / nacos / DNS SRV |
| 维护成本 | 🟡 中 (etcd cluster 要维护, 但开发期单点可接受) |
| 适合本项目 | dev ❌ overkill / 生产 ✅ 大流量理想 |

### Kong
| 维度 | 评价 |
|------|------|
| 上手成本 | ⭐⭐⭐⭐ Postgres + 大量概念 |
| 配置复杂度 | ⭐⭐⭐⭐ REST API / declarative YAML |
| 性能 | ⭐⭐⭐⭐ OpenResty 内核 |
| 鉴权能力 | ⭐⭐⭐⭐ plugin 市场类似 APISIX |
| 插件生态 | ⭐⭐⭐⭐ (跟 APISIX 不相上下) |
| Dashboard | ✅ |
| 维护成本 | 🔴 高 (Postgres 部署) |
| 适合本项目 | 一般 |

### Traefik / Higress
- Traefik: 跟 K8s 集成最丝滑, dev/local docker-compose 自动发现一流
- Higress: 阿里出品, 大流量 + Envoy 内核, 国内最 SOTA
- **本项目不适合** (K8s-native, 我们没 K8s)

### 简化结论

| 需求 | nginx | APISIX | Kong |
|------|-------|--------|------|
| dev 单机 + 仅反代 | ✅ 极致简单 | ❌ 重型 | ❌ 重型 |
| dev 单机 + JWT 鉴权 + dashboard | ❌ 需手写 | ✅ 插件现成 | ✅ |
| 生产 + 高 QPS + 限流灰度 | ✅ | ✅✅ | ✅ |
| K8s ingress | ✅ ingress-nginx | ✅ APISIX Ingress | ✅ |

---

## 4. 我的推荐路径

### 🎯 Phase 1 — Phase 3 三步走

#### Phase 1 (本周): 跑通 nginx 做基线 (重在 demo)
- 写一份 host 模式 nginx config (跟 conf.d 同结构, 改 hostname/路径)
- ./scripts/dev-nginx-up.sh (启动 nginx on host:8888)
- curl `http://localhost:8888/usercenter/v1/user/login` 验证
- **commit v3.19 nginx host runbook**

#### Phase 2 (评估 APISIX): 装上跑 demo, 对比
- docker-compose-env.yml 加 `apisix-apisix`, `apisix-etcd`, `apisix-dashboard`
- 通过 Admin API 创建 routes (复制 nginx conf 的 4 个 upstream)
- 对比 nginx vs APISIX 体验
- **决定是否切换**

#### Phase 3 (生产前): 加 jwt-auth + 限流插件
- 在 APISIX 上配 jwt-auth plugin (替代 nginx 的手写 auth_request)
- 配上限流 (jtw limit-count 等)
- **生产版 ready**

### 关于为什么不直接用 APISIX

- 我们的业务在 host 跑, dev 阶段 nginx 的 50 行 conf 完全够用
- APISIX 需要 docker (or host 安装, 比较繁), dev 体验重
- 教学价值: 自己手写 nginx conf + 调试 → 对流量入口/反向代理原理会理解更深
- 后面真要做 K8s ingress / 多端接入, 再换 APISIX 也来得及

---

## 5. Phase 1 待办 (nginx host 化)

### 5.1 改造 conf (兼容 host + docker)

新建 `deploy/nginx/conf.d/looklook-host.conf`:

```nginx
# host 模式 nginx (业务服务跑在 host)
# 跟 docker 模式的区别:
#   - listen 8088 (避开 macOS 端口权限)
#   - error_log / access_log 用 ./data/nginx/log (项目内)
#   - proxy_pass 写 127.0.0.1:<port> (host 回环)

server {
    listen 8088;
    access_log ./data/nginx/log/looklook_access.log;
    error_log  ./data/nginx/log/looklook_error.log;

    # /order/* → 127.0.0.1:1001
    location ~ /order/      { proxy_pass http://127.0.0.1:1001; include proxy_params; }
    location ~ /payment/    { proxy_pass http://127.0.0.1:1002; include proxy_params; }
    location ~ /travel/     { proxy_pass http://127.0.0.1:1003; include proxy_params; }
    location ~ /usercenter/ { proxy_pass http://127.0.0.1:1004; include proxy_params; }
}
```

```nginx
# deploy/nginx/conf.d/proxy_params.conf
proxy_set_header Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header REMOTE-HOST $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### 5.2 启动脚本 (host 模式)

新建 `scripts/dev-nginx-up.sh` + `dev-nginx-down.sh` + `dev-nginx-reload.sh`:

```bash
# 前提: nginx 已 brew install (macOS)
#   brew install nginx  → /opt/homebrew/opt/nginx/bin/nginx

NGINX_BIN=$(which nginx)  # 或 brew --prefix nginx 查
CONF=./deploy/nginx/conf.d/looklook-host.conf
LOG=./data/nginx/log

mkdir -p $LOG
$NGINX_BIN -p ./. -c $CONF   # prefix=project root, conf=specific file
```

### 5.3 验证 curl

```bash
# 应该跟直接 curl :1004 等价, 但走 nginx 一层
curl -X POST http://127.0.0.1:8088/usercenter/v1/user/login \
  -d '{"mobile":"18721432599","password":"test123456"}'

# 验证 access log 写了
tail -f ./data/nginx/log/looklook_access.log
```

### 5.4 涉及的文件改动

| 文件 | 状态 | 内容 |
|------|------|------|
| `deploy/nginx/conf.d/looklook-host.conf` | 新建 | host 模式 nginx conf |
| `deploy/nginx/conf.d/proxy_params.conf` | 新建 | 共享 proxy header config |
| `scripts/dev-nginx-up.sh` | 新建 | 启动 host nginx |
| `scripts/dev-nginx-down.sh` | 新建 | 关掉 |
| `scripts/dev-nginx-reload.sh` | 新建 | reload (改 conf 后) |
| `doc/chinese/02-nginx网关.md` | 不动 | 教程原版, 留着 |
| `deploy/nginx/conf.d/looklook-gateway.conf` | 不动 | docker 模式 conf, 给后续 production 用 |

---

## 6. 不做的事

- ❌ 不换 APISIX (Phase 1 时)
- ❌ 实现 auth_request (Phase 3 时, 改在 APISIX)
- ❌ 写 TLS / HTTPS 配置 (生产前才需要)
- ❌ 部署 nginx 在 docker 容器 (Phase 2+ 才考虑)
- ❌ 加 limit_req / 灰度 (k8s ingress 时再考虑)

---

## 7. 注意事项

- **macOS port 80 / 443 需要 root** → 我们用 8088 避开
- **brew install nginx 不要跟 macOS 自带的 nginx 冲突** → conf 显式指定
- **多次启动会报 "address in use"** → dev-nginx-down.sh 处理
- **改了 conf 不 reload 看不到效果** → dev-nginx-reload.sh 一键

---

## 8. 相关文件路径

```
deploy/nginx/conf.d/
├── looklook-gateway.conf        # 教程原版 (docker 模式)
├── looklook-host.conf           # ← 我要新建 (host 模式)
└── proxy_params.conf            # ← 共用 header config

scripts/
├── dev-nginx-up.sh              # ← 新
├── dev-nginx-down.sh            # ← 新
└── dev-nginx-reload.sh          # ← 新
```

---

*创建于 2026-08-07, ch02 网关调研 Phase 1*
