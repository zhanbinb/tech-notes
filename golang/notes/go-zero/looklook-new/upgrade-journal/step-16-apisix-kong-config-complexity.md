# step-16: APISIX vs KONG 配置/上手复杂度对比

## §0 文档目标

承接 step-13 第 7 节"APISIX vs Kong 产品对比"（侧重功能/社区）,
本节专注**实战角度的配置复杂度**：上手需要多少文件、多少命令、多少时间,
踩坑多少, 日常运维复杂度如何. 给"要选哪个"提供可执行依据.

---

## §1 一句话结论

> 两者**架构、配置模型、复杂度几乎一样**, 都是"OpenResty + 插件化 + 声明式"那一套.
> 上手时间都在**半天到 1 天**之间. 选哪个更多**取决于生态偏好**（中文 vs 国际、企业版需求），
> 不是复杂度差异.

---

## §2 部署复杂度对比

| 维度 | APISIX | KONG |
|---|---|---|
| 启动方式 | `docker compose up` 一行 | `docker compose up` 一行 |
| 必选依赖 | etcd（必须） | PostgreSQL（DB-less 模式可省）|
| 端口 | 9080(Proxy) / 9180(Admin) / 9443(HTTPS) | 8000(Proxy) / 8001(Admin) / 8443(HTTPS) |
| 配置持久化 | etcd 持久化 | Postgres 持久化（或 DB-less 模式用 YAML） |
| 高可用 | 多节点 + etcd 集群 | 多节点 + Postgres 集群 |
| 我们今天的体验 | 5 个坑（3.x schema / alpine musl / socat / ENTRYPOINT 等） | 类似坑（Postgres schema 升级、Kong 版本兼容等） |

**结论**: 两者部署复杂度**几乎一样**, 都是"启动容器 + 写 conf + 验证". 区别只在存储依赖（etcd vs Postgres）.

---

## §3 配置方式对比

```
       APISIX                              KONG
───────────────────────────────────────────────────────────────────
命令行 curl Admin API (9180)             curl Admin API (8001)
UI Dashboard :9000                       Kong Manager :8002 (Kong 企业版 OSS 部分受限)
声明式 YAML Standalone 模式              decK 工具 (推荐)
       (conf dir + 启动时/定期 reload)        (deck sync -s kong.yml)
插件启用 资源上挂 plugins:{}             资源上挂 plugins:{}
插件命名 短 (jwt-auth, limit-count)       带前缀 (jwt, rate-limiting)
存储  etcd                                Postgres / DB-less 时本地 YAML
```

### 3.1 APISIX 上手步骤（参考 step-15 实操）

```
1. 部署 docker compose         5 分钟
2. 写 config.yaml (3.x schema) 5 分钟
3. 写 4 个 shell 脚本:        30 分钟
   - dev-apisix-upstreams.sh
   - dev-apisix-consumer.sh
   - dev-apisix-routes.sh
   - dev-apisix-verify.sh
4. 跑脚本 (幂等可重复)         1 分钟
5. 验证 6 条路径               5 分钟
总计: 半天 (含踩坑排查 2-3 小时)
```

### 3.2 KONG 上手步骤（理论推演）

```
1. 部署 docker compose         5 分钟 (含 Postgres)
2. 写 decK 配置 (kong.yml)     30 分钟 (一个文件含 service/route/plugin)
3. deck sync -s kong.yml       1 分钟 (一次性同步所有)
4. 验证 (curl Proxy 8000)     5 分钟
总计: 1-2 小时 (比 APISIX 略快)
```

**decK 优势**: 一个 YAML 文件描述所有资源（service + route + plugin + upstream + consumer）,
`deck sync` 一条命令全部生效. APISIX 用 curl 一条一条建（我们搞了 4 个脚本就是为了一键化）.

### 3.3 两种"声明式"的对比

| | APISIX Standalone | KONG decK |
|---|---|---|
| 文件格式 | 多文件 (routes/xxx.yaml + upstreams/xxx.yaml + plugins/xxx.yaml) | 单文件 kong.yml |
| 同步命令 | 启动时自动加载 / 定期 reload | `deck sync -s kong.yml` |
| 增量同步 | 不支持 (全量加载) | 支持 (`deck diff` 看变化) |
| 校验 | 启动时 schema 校验 | sync 前校验 |
| GitOps 友好 | ⚠️ 一般 | ✅ 优秀 |

**KONG 的 decK 更适合 GitOps 工作流** (CI/CD 同步 Kong 配置). APISIX Standalone 模式稍弱,
但 APISIX 的 Admin API + GitOps 工具链 (如 apisix-ingress-controller) 可以补齐.

---

## §4 插件生态对比

### 4.1 核心插件覆盖（两者都有）

| 场景 | APISIX | KONG |
|---|---|---|
| JWT 鉴权 | jwt-auth | jwt |
| Basic Auth | basic-auth | basic-auth |
| Key Auth | key-auth | key-auth |
| HMAC Auth | hmac-auth | hmac-auth |
| OIDC | openid-connect | openid-connect |
| 限流 (计数/并发) | limit-count / limit-conn | rate-limiting |
| 限流 (漏桶/令牌) | limit-req | rate-limiting (含多种算法) |
| CORS | cors | cors |
| IP 白黑名单 | ip-restriction | ip-restriction |
| UA 黑名单 | ua-restriction | - |
| CSRF | csrf | - |
| Prometheus | prometheus | prometheus |
| gRPC 代理 | grpc-transcode | grpc-gateway |
| Kafka 日志 | kafka-logger | kafka-logger (企业版) |
| **内置插件数** | ~80 | ~100 |
| **Hub 社区插件** | 较少 | Kong Hub 丰富 |

### 4.2 长尾插件（KONG Hub 优势）

KONG Hub  上有大量社区/企业插件，覆盖:
- 高级认证（OIDC、LDAP、SAML、CAS、Kerberos）
- 高级安全（WAF、Bot Detection、Canary）
- 高级流量控制（Canary Release、A/B Testing）
- 高级可观测性（Datadog、Splunk、Zipkin）

APISIX 的插件数量较少，但 90% 常用场景两者都覆盖.

### 4.3 自定义插件开发

| | APISIX | KONG |
|---|---|---|
| Lua | ✅ (跟 Kong 一样) | ✅ |
| Go | ✅ (新! 比 Kong 灵活) | ⚠️ 需用 go-pluginserver |
| Java / Python | ✅ (APISIX 独有) | ❌ |

**APISIX 优势**: 自定义插件支持多语言, 对非 Lua 团队友好.

---

## §5 学习曲线对比

### 5.1 上手时间

| 阶段 | APISIX | KONG |
|---|---|---|
| 基础部署 + 1 个路由 | 半天 | 半天 |
| 鉴权 (JWT) | 1 小时 | 1 小时 |
| 限流 + CORS | 半小时 | 半小时 |
| 多服务 + 路由分层 | 1 天 | 1 天 |
| 自定义插件 | 1-2 周 | 2-3 周 (Lua 为主) |
| K8s Ingress | 1 周 (apisix-ingress-controller) | 1 周 (kong-ingress) |

### 5.2 学习资源

| 维度 | APISIX | KONG |
|---|---|---|
| 中文文档 | ✅ 完善 | ⚠️ 主要英文 |
| 社区活跃度 | 高 (Apache 顶级项目, 2020 后发力) | 高 (2015 起步, 更成熟) |
| GitHub stars | ~13k | ~38k |
| 书籍 | 2-3 本中文 | 1-2 本英文 |
| 国内生产案例 | 阿里/微博/字节/小米 | 较少 |
| 国际生产案例 | 部分 | NASA/PayPal/星巴克 |

### 5.3 概念模型复杂度

APISIX 资源模型:
```
Route → Plugin → Upstream
   │
Consumer (jwt-auth 时用到)
```

KONG 资源模型:
```
Service → Route → Plugin
   │        │
   └── Upstream (target)
   │
Consumer (认证时用到)
```

**KONG 多一层 Service**: Service 抽象了"后端服务", Route 引用 Service, 这样多个 Route 可以共享 Service (复用 + 改一次生效多处). 适合"一个后端多个入口"场景 (如 /api/v1 和 /api/v2 共享同一后端).

APISIX 没有显式 Service, Upstream 直接挂在 Route 上 (Route → Upstream). **简单但灵活性稍弱**. APISIX 用 Plugin Config 共享插件配置做类似的事.

**两者概念复杂度差不多**, KONG 多一层但更灵活, APISIX 更直接.

---

## §6 日常运维复杂度对比

### 6.1 配置修改

| 操作 | APISIX | KONG |
|---|---|---|
| 改 route uri | curl Admin API / dashboard | curl Admin API / Kong Manager / decK sync |
| 加新服务 | 4 条 curl | 1 个 decK sync |
| 上 K8s | 改 Ingress 资源 (kubectl apply) | 改 KongPlugin + Ingress |
| 回滚配置 | etcd 历史 (需要 gitOps) | decK diff + git revert |

**APISIX 优势**: Admin API 直接写 etcd, 有 dashboard 可视化.
**KONG 优势**: decK 做 diff/sync/export, GitOps 体验更完整.

### 6.2 监控/调试

两者都内置 prometheus 插件, 暴露 `/apisix/prometheus/metrics` 或 `/kong/metrics`.

APISIX 还内置 `request-id` / `client-control` / `proxy-control` 三个"基础请求控制"插件 (每个请求都生效, 无需配).

### 6.3 升级

| | APISIX | KONG |
|---|---|---|
| 升级难度 | 中 (3.x → 4.x 有 schema 变化) | 中 (2.x → 3.x 有 breaking) |
| 回滚 | etcd 回滚 (需要快照) | Postgres 备份恢复 |
| 数据迁移 | etcd dump + reload | decK export/import |

---

## §7 实战经验汇总 (结合 step-15)

### 7.1 APISIX 我们今天踩的 5 个坑

1. **3.x schema 变化**: etcd 配置位置从顶层 `etcd.endpoints` 变到 `deployment.etcd.host`, 顶层字段被忽略 → 回退默认地址 → 连不上 etcd
2. **dashboard conf 缺 `conf:` 顶层包裹** → InitETCDClient nil panic
3. **alpine + musl libc DNS 解析坑**: Go resolver 不读 `/etc/hosts`, `host.docker.internal` fallback `127.0.0.1`
4. **manager-api 二进制硬编码默认 etcd 127.0.0.1:2379** → bridge 网络下连自己 → 登录失败
5. **dashboard ENTRYPOINT 默认值** → `command: ["sh", "..."]` 不生效, 需用 `entrypoint:` 覆盖

**预计 KONG 也会踩的类似坑**:
- 2.x → 3.x schema 变化 (Admin API 路径变化、DB-less 模式新增)
- docker 镜像版本兼容 (Kong Enterprise vs OSS)
- Postgres schema 升级

### 7.2 上手 APISIX 的最小可用集

```
- 1 个 docker-compose.yml (apisix + dashboard)
- 1 个 config.yaml (3.x schema)
- 1 个 dashboard_conf.yaml (含 conf: 包裹)
- 4 个 shell 脚本 (upstreams/consumer/routes/verify)
- 总计: 5 个文件, 半天跑通
```

### 7.3 上手 KONG 的最小可用集 (推演)

```
- 1 个 docker-compose.yml (kong + postgres)
- 1 个 kong.yml (decK 配置文件, 含所有 service/route/plugin)
- 1 个 decK sync 命令
- 总计: 3 个文件, 1-2 小时跑通
```

---

## §8 选型决策树

```
新项目, 中文团队
├── 上 K8s?
│   ├── 是 → APISIX (Ingress Controller 文档完整)
│   └── 否 → 任意 (都行)
├── 团队熟悉 OpenResty / Lua?
│   ├── 是 → KONG (插件生态更深, Hub 丰富)
│   └── 否 → APISIX (支持多语言插件开发)
└── 需要企业级商业支持?
    ├── 是 → KONG Enterprise
    └── 否 → APISIX (Apache 顶级项目, 全开源)

现有项目, 只是网关选型?
└── nginx 够用就用 nginx (我们的 looklook 选 nginx)
```

---

## §9 looklook 项目选型 (重申)

**保持 nginx** (step-14 方案):
- ✅ nginx 已稳定跑通 (v3.24 commit)
- ✅ 鉴权 / CORS / 限流 / 路由全部用 nginx + auth_request 实现
- ✅ 不引入新组件, 降低 ops 复杂度
- ❌ 路由配置改一次要 reload (但 dev 流量小, 可接受)
- ❌ 缺少可视化 dashboard (但 Admin API 够用)

**APISIX 作为学习储备** (step-15 完成):
- ✅ 理解了云原生网关的运作模式 (Admin API + etcd + 插件)
- ✅ go-zero token payload 加 key 字段的对接模式可复用
- ✅ 6 路径验证证明了 APISIX 鉴权链路完整可行
- 未来如果上 K8s 或需要动态路由, 平滑迁移

**不引入 KONG**:
- 学习价值跟 APISIX 重叠
- decK 优势对我们场景 (dev 模式) 不明显
- 中文社区弱于 APISIX

---

## §10 相关阅读

- [step-13 APISIX/Kong 对比](step-13-apisix-kong.md) — 产品级对比 (公司/社区/插件生态)
- [step-15 APISIX 实战](step-15-apisix-practice.md) — 我们今天完整的 APISIX 上手经验
- [step-14 nginx auth_request 实战](step-14-nginx-auth-practice.md) — 跟 APISIX 实战对照
- [step-09 ch 02 网关调研](step-09-gateway-survey.md) — 3 层架构 + 选型

---

## §11 一句话总结

> **APISIX 和 KONG 配置复杂度相当**（架构/插件/上手都差不多），**选哪个更多看生态偏好**（中文 vs 国际、企业 vs 开源），不是技术复杂度差异. 我们项目保持 nginx 方案已足够, APISIX 作为未来迁移储备.

---

*创建于 2026-08-10, 跟随 step-15 APISIX 实战的"复杂度"专项对比, 跟 step-13 第7节产品对比互补*
