# Etcd 运维、排错与企业级实践

> 上一篇 [Etcd 服务发现：原理与 go-zero 实战](../golang/notes/go-zero/02-etcd-service-discovery.md) 讲了 etcd 的架构、Lease/Watch/TTL、与 go-zero 的集成。本篇专攻**运维视角**：怎么判断 etcd 在不在跑、Docker 部署常见坑、注册信息怎么可视化、真实企业项目长什么样。

## TL;DR

- **判断 etcd 是否在跑**：`pgrep -fl etcd` + `lsof -nP -iTCP:2379 -sTCP:LISTEN` + `curl http://127.0.0.1:2379/version` + `etcdctl endpoint health` 四件套
- **Docker 起 etcd 的标准命令**：必须显式 `--listen-client-urls=http://0.0.0.0:2379`，否则会因绑定 `localhost` 导致宿主机侧 `connection reset by peer`
- **"connection reset by peer" 的语义**：TCP 握手成功但 gRPC 前缀读失败 → 端口有进程在听，但**那不是 etcd**（或 etcd 还没 ready / TLS 不匹配）
- **查看已注册 RPC**：etcdctl 是 CLI 主力，etcdkeeper 是最快的 GUI 方案
- **企业真实形态**：3/5 节点 Raft 集群 + mTLS + RBAC + 监控告警 + 备份演练；业务代码**几乎不直接连 etcd**

---

## 一、怎么判断 etcd 在不在跑

四件套，**任何一个能跑通就说明至少端口层面 OK**：

```bash
# 1. 进程
pgrep -fl etcd

# 2. 端口监听
lsof -nP -iTCP:2379 -sTCP:LISTEN
# 期望：能看到 etcd 进程（或 com.docker.backend 转发层）

# 3. HTTP 探活（etcd 进程内置 HTTP /version）
curl -sS http://127.0.0.1:2379/version
# 期望：{"etcdserver":"3.5.x","etcdcluster":"3.5.x",...}

# 4. gRPC 端点健康（最权威）
etcdctl --endpoints=127.0.0.1:2379 endpoint health
# 期望：127.0.0.1:2379 is healthy: ... 
```

| 第 N 件通过 | 状态 |
|---|---|
| 4 件全过 | ✅ etcd 真的在跑、gRPC 可用 |
| 1/2 过 + 3/4 失败 | ⚠️ 端口有别的进程占着（典型 `com.docker.backend`），需要进一步定位 |
| 1/2 都失败 | ❌ 端口完全没人听，etcd 没启动 |

补充命令：

```bash
# 看 leader / quorum
etcdctl --endpoints=127.0.0.1:2379 endpoint status -w table
etcdctl --endpoints=127.0.0.1:2379 member list -w table

# 看所有 key 概览（确认有数据）
etcdctl --endpoints=127.0.0.1:2379 get --prefix --keys-only / | head
```

---

## 二、怎么检查 Docker 里有没有装 etcd

```bash
# 1. 运行中的 etcd 容器
docker ps --filter "ancestor=quay.io/coreos/etcd" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
docker ps --filter "name=etcd" --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

# 2. 包含已停止的
docker ps -a | grep -i etcd

# 3. 本地是否拉过镜像
docker images | grep -i etcd
# 常见镜像：quay.io/coreos/etcd  gcr.io/etcd-development/etcd  bitnami/etcd

# 4. compose/Dockerfile 是否声明
grep -RIni "etcd" . \
  --include="docker-compose*.yml" --include="docker-compose*.yaml" \
  --include="Dockerfile"
```

---

## 三、Docker 启动 etcd 的标准命令（最容易踩的坑）

### 3.1 最容易踩的坑：listen URL 不写对

如果你直接 `docker run -d --name etcd -p 2379:2379 quay.io/coreos/etcd:v3.5.21`，**etcd 默认会把 client 监听在 `localhost:2379`**，也就是容器自己的 127.0.0.1。

Docker Desktop 在 macOS 上是通过 `com.docker.backend` 在宿主 2379 做一个 userland proxy，再去连容器的 2379。**当 etcd 只 listen 在容器 lo 上 + HTTP/2 multiplexing** 时，这个 proxy 经常会用 RST 把连接打断。表现就是你在宿主侧看到：

```
$ curl -sS http://127.0.0.1:2379/version
curl: (56) Recv failure: Connection reset by peer

$ etcdctl --endpoints=127.0.0.1:2379 endpoint health
error reading server preface: read tcp ... read: connection reset by peer
127.0.0.1:2379 is unhealthy: ...
```

但**容器内部其实是健康的**（`docker exec etcd etcdctl endpoint health` 会返回 healthy）。所以这个错**不是 etcd 的锅，是端口转发层的锅**。

### 3.2 正确启动命令

显式让 etcd 监听 0.0.0.0，问题立刻消失：

```bash
docker rm -f etcd 2>/dev/null
docker run -d --name etcd --restart unless-stopped \
  -p 2379:2379 -p 2380:2380 \
  -v etcd-data:/etcd-data \
  quay.io/coreos/etcd:v3.5.21 \
  /usr/local/bin/etcd \
    --data-dir=/etcd-data \
    --listen-client-urls=http://0.0.0.0:2379 \
    --advertise-client-urls=http://127.0.0.1:2379 \
    --listen-peer-urls=http://0.0.0.0:2380 \
    --initial-advertise-peer-urls=http://127.0.0.1:2380 \
    --initial-cluster=default=http://127.0.0.1:2380

sleep 5
docker logs etcd | grep -E "listen-client-urls|ready to serve"
# 期望看到 "listen-client-urls":["http://0.0.0.0:2379"] 和 "ready to serve client requests"
```

参数含义：

| 参数 | 作用 |
|---|---|
| `--listen-client-urls` | etcd 在容器内**对哪个接口**监听客户端连接。**必须 `0.0.0.0`**，否则只听 lo |
| `--advertise-client-urls` | 告诉客户端"我的地址是 `http://127.0.0.1:2379`"（宿主通过端口映射后访问） |
| `--listen-peer-urls` | 集群节点间通信监听地址（单节点也给 `0.0.0.0`，未来加节点不用改） |
| `--initial-cluster` | 启动时声明自己属于哪个集群。单节点就是 `default=http://127.0.0.1:2380` |
| `-v etcd-data:/etcd-data` | 数据持久化，否则容器重建数据全丢 |

### 3.3 启动后 3 步验证

```bash
# 容器内探活（绕开宿主端口转发）
docker exec etcd etcdctl --endpoints=http://127.0.0.1:2379 endpoint health

# 宿主 HTTP 探活
curl -sS http://127.0.0.1:2379/version

# 宿主 etcdctl 探活
etcdctl --endpoints=127.0.0.1:2379 endpoint health
```

三步全绿才算真正可用。

### 3.4 如果重启后还是 RST —— 绕开 Docker 端口转发

```bash
# 方案 A：直接走容器 IP
CIP=$(docker inspect etcd --format '{{.NetworkSettings.IPAddress}}')
etcdctl --endpoints=http://${CIP}:2379 endpoint health

# 方案 B：试 IPv6 localhost（com.docker.backend 经常 IPv6-only）
curl -sS "http://[::1]:2379/version"

# 方案 C：业务 yaml 改用容器 IP
sed -i.bak "s|127.0.0.1:2379|${CIP}:2379|" etc/transform.yaml
```

---

## 四、错误解读速查表

| 看到的错误 | 真实含义 | 下一步 |
|---|---|---|
| `connection refused` | 端口完全没人听 → etcd 没启动 / 端口错了 | 启动 etcd，或检查 `-p` 端口映射 |
| `connection reset by peer`（紧跟 "error reading server preface"）| 端口有人听但**不是 etcd**；或 etcd listen 在容器 lo；或 TLS/明文协议不匹配 | `docker logs etcd` 看 listen URL；显式指定 `--listen-client-urls=0.0.0.0:2379`；确认 `--enable-v2=true`（如果用 v2 API）|
| `unhealthy cluster: failed to commit proposal` | etcd 起来了但写不进数据（quorum 不足、磁盘满、证书过期）| `endpoint status -w table` 看 leader / raft index；查磁盘与证书 |
| `context deadline exceeded` | 网络层能通但 RPC 超时（多半 backpressure 或 leader 选不出来）| 看 `raft` 模块日志；多节点时检查 `--initial-cluster` 拼写 |
| `wal: read error` / `data corruption` | 数据目录损坏 | 从 `etcdctl snapshot` 恢复；先备份再操作 |

---

## 五、查看已注册的 RPC 服务

### 5.1 CLI 主力

```bash
# 看所有 key
etcdctl --endpoints=127.0.0.1:2379 get --prefix --keys-only /

# 看 transform.rpc 这个服务的所有实例
etcdctl --endpoints=127.0.0.1:2379 get --prefix /transform.rpc

# 表格化输出
etcdctl --endpoints=127.0.0.1:2379 get --prefix /transform.rpc -w table

# 实时观察上下线
etcdctl --endpoints=127.0.0.1:2379 watch /transform.rpc --prefix

# 配合 jq 提取关键字段
etcdctl --endpoints=127.0.0.1:2379 get --prefix /transform.rpc -w json \
  | jq -r '.kvs[] | {key: .key, addr: (.value | fromjson | .addr)}'
```

> go-zero v1.x 注册路径是 `/<Key>/<leaseID>`（**带前导 `/`**）。如果 `get /transform.rpc` 没结果，再试一次 `get transform.rpc` 不带前导（兼容写法）。

### 5.2 Web UI：etcdkeeper（10 秒起）

```bash
docker run -d --name etcdkeeper \
  -p 8088:8080 \
  --restart unless-stopped \
  etcdkeeper/etcdkeeper

open http://127.0.0.1:8088
```
进入后顶栏填 `http://127.0.0.1:2379` → Connect → 左侧看树形 key/value。

### 5.3 用 etcd 自带的 v2 HTTP API（不装任何东西）

```bash
# 仅在 --enable-v2=true 时可用
curl -sS http://127.0.0.1:2379/v2/keys/
curl -sS http://127.0.0.1:2379/v2/keys/transform.rpc
```
v3.4+ 默认禁用 v2；想开就重启容器时加 `--enable-v2=true`。日常更推荐 etcdkeeper。

### 5.4 桌面客户端

- **EtcdWorkbench**（Mac/Win）：原生 v3 客户端
- **Postman/Insomnia**：可打 gRPC 但配置麻烦
- **k9s / kubebox**：Kubernetes 用户的常规工具，间接管 etcd

---

## 六、企业真实项目长什么样

### 6.1 demo vs 真实项目对比

| 维度 | demo / 学习 | 企业真实 |
|---|---|---|
| 节点数 | 1 | 3 / 5 / 7 集群（必须奇数） |
| 部署 | 本机 / Docker | VM 或 K8s，独立可用区 |
| 安全 | 明文 + 无 auth | **mTLS + RBAC + 审计日志** |
| 业务代码 | yaml 里写死 `127.0.0.1:2379` | **业务代码几乎不出现 etcd 地址** |
| 运维 | 手动启停 | Operator/Helm + 监控告警 + 备份演练 |
| 角色 | 唯一服务发现源 | 仅"底座"之一，常配合 Service Mesh / 配置中心 |

### 6.2 etcd 在企业里的 4 个真实角色

**(a) 服务注册/发现** — 业务**不直接连 etcd**，而是：
- Service Mesh（Istio/Linkerd）：Sidecar 自动注册，etcd 是 mesh 后端
- K8s 原生：Service / Endpoint，K8s 内部就用 etcd 存这些
- 框架适配层：go-zero 的 `zrpc` 会被二次封装成 `discovery.Registry` 接口，etcd 只是其中一种实现

**(b) 配置中心** — 大厂最常见的用法：
```bash
etcdctl put /config/user-service '{"timeout":3000,"feature.new_ui":true}'
etcdctl put /config/user-service/db '{"host":"10.0.0.5","max_open":100}'
```
应用 watch 这个前缀，**改配置不用发版、不用重启**。go-zero 的 `config.Center` 也支持 etcd。

**(c) 分布式协调** — leader election / 分布式锁：
```bash
etcdctl put /lock/order-service --lease=12345
```
订单调度、分布式任务、定时调度系统都用 etcd 做选举，比 ZooKeeper 简单。

**(d) K8s 存储后端** — **所有 K8s 集群的真相来源就是 etcd**：Pod/Service/ConfigMap/一切状态都存 etcd。用 K8s 就是在用 etcd，只是没直接看见。

### 6.3 典型集群拓扑

```
┌────────────┐  ┌────────────┐  ┌────────────┐
│  etcd-1    │  │  etcd-2    │  │  etcd-3    │   ← 3 节点
│ 10.0.1.11  │  │ 10.0.1.12  │  │ 10.0.1.13  │
└─────┬──────┘  └─────┬──────┘  └─────┬──────┘
      └───────────────┼───────────────┘
                      │
            ┌─────────▼─────────┐
            │  HAProxy / Envoy  │  ← 统一入口 + LB
            │ 10.0.1.10:2379    │     + 客户端证书校验
            └─────────┬─────────┘
                      │
       ┌──────────────┼──────────────┐
       │              │              │
   ┌───▼────┐    ┌────▼───┐    ┌────▼───┐
   │Order   │    │User    │    │Payment │    ← 业务 Pod
   │Service │    │Service │    │Service │
   └────────┘    └────────┘    └────────┘
```

### 6.4 运维标准件

- **部署**：VM 用 Ansible/Terraform；K8s 用 **etcd-operator**
- **监控**：Prometheus + **etcd-exporter**，关键告警：
  - `etcd_disk_wal_fsync_duration_seconds > 10ms`（写盘慢）
  - `etcd_server_leader_changes_seen_total` 突增（选举抖动）
  - `etcd_mvcc_db_total_size_in_bytes` 接近 8GB
- **备份**：`etcdctl snapshot save /backup/etcd-$(date +%F).db` + 定时上传 S3/OSS
- **容量红线**：超过 **8GB 数据**就要警惕，超过 **2GB 推荐 SSD**（fdatasync 延迟敏感）
- **升级**：必须滚动、必须先 snapshot；版本差不能超过 **2 个 minor 版本**

### 6.5 替代品全景

| 选型 | 谁在用 | 特点 |
|---|---|---|
| **Consul** | HashiCorp 全家桶 | 自带 UI、ACL、多数据中心，最省事 |
| **Nacos** | 国内中大型团队（阿里系） | 配置+发现二合一，Sentinel 限流配套，中文文档 |
| **ZooKeeper** | 传统金融/电信 | 老牌强一致，Java 生态，运维复杂 |
| **Eureka** | Netflix / Spring Cloud | AP 系统，牺牲强一致换可用性 |
| **K8s Service** | 云原生团队 | 不用额外组件，Service/Ingress 直接做发现 |
| **Service Mesh** | Istio/Linkerd 用户 | 完全屏蔽底层注册中心 |

**国内趋势**：新项目越来越多人直接 **Nacos**（中文文档、配置+发现二合一）。etcd 多见于 K8s 内部、go-zero 默认实现、以及"我们就是用了 etcd 没必要换"的存量系统。

---

## 七、go-zero 视角的快速对照表

| 现象 | 检查命令 |
|---|---|
| 启动 transform RPC 立即 panic "context deadline exceeded" | 八成是 etcd 没起来；先看本笔记第一章 |
| panic "connection reset by peer" | 容器内 etcd 是好的，宿主端口转发挂了；按 3.4 走 |
| 启动后客户端连不上，"no instance available" | 去看 `etcdctl get --prefix /transform.rpc` 有没有数据；key 大小写是否一致 |
| 多副本时偶发超时 | 走 P2C 负载均衡；同时看 lease TTL 是否过短（建议 5~15s） |
| 生产建议 | 上 3 节点 + mTLS + 监控；`Etcd.Key` 用层级命名（如 `order.rpc/grpc`） |

---

## 八、一句话总结

> demo 里的 `Etcd: Hosts: 127.0.0.1:2379` 是 go-zero 给你的"教学配置"。企业里这个地址大概率一辈子看不到 —— 要么被 K8s Service 屏蔽、要么被 Mesh 屏蔽、要么被 SDK 抽象掉。但 **etcd 的核心能力（强一致 KV + Watch）** 是真实项目天天用的。
>
> 如果你只想跑通 demo：按第三章 3.2 的命令起 etcd，按第一章验证，按第五章看注册。
> 如果你要往生产走：先想清楚第六章 6.5 选型，再决定要不要在 etcd 上投入。

---

## 九、相关链接

- 上一篇：[golang/notes/go-zero/02-etcd-service-discovery.md](../golang/notes/go-zero/02-etcd-service-discovery.md) — etcd 架构与 go-zero 集成原理
- [Etcd 官方文档](https://etcd.io/docs/)
- [etcdkeeper GitHub](https://github.com/etcdkeeper/etcdkeeper)
- [Kubernetes etcd-operator](https://github.com/etcd-io/operator)
- 本地 demo：`go-zero-platform/shorturl/`（go-zero RPC + zrpc 注册 etcd）

---
#etcd #docker #go-zero #运维 #排错 #分布式 #企业级
