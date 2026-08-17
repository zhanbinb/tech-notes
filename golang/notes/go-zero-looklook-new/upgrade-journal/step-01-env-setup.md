# Step 1：开发环境搭建（Apple Silicon 适配）

> 日期：2026-08-04  
> 目的：把 v1 项目的中间件在 Apple Silicon (arm64) Mac 上跑起来

## 目标

- 把 v1 完整代码 copy 到 `go-zero-looklook-new/`
- 启动 11 个中间件（mysql/redis/kafka/es/kibana/jaeger/prometheus/grafana/filebeat/go-stash/asynqmon）
- 验证都能 running

## 改动文件清单

- `go-zero-looklook-new/docker-compose-env.yml`（4 处版本升级 + 2 处 platform: linux/amd64）
- `/tmp/pull-images.sh`（新增：串行拉镜像脚本，绕开 compose 的并发 pull bug）
- `/tmp/docker-compose-env.yml.new`（改完 4 处版本号的完整 yaml）

## 关键改动

### 改动 1：4 处镜像版本升级（适配 arm64）

```diff
  prometheus:
-   image: prom/prometheus:v2.28.1
+   image: prom/prometheus:v2.55.0
    container_name: prometheus

  grafana:
-   image: grafana/grafana:8.0.6
+   image: grafana/grafana:11.3.0
+   platform: linux/amd64
    container_name: grafana
    user: root

  go-stash:
    image: kevinwan/go-stash:1.1.1
+   platform: linux/amd64
    container_name: go-stash

  redis:
-   image: redis:6.2.5
+   image: redis:7.4-alpine
    container_name: redis
```

### arm64 兼容性矩阵（v1 原版镜像）

| 镜像 | 版本 | arm64 | 替代方案 |
|---|---|---|---|
| `grafana/grafana:8.0.6` | 8.0.6 | ❌ | 升级到 11.3.0（arm64 原生） |
| `prom/prometheus:v2.28.1` | v2.28.1 | ❌ | 升级到 v2.55.0 |
| `redis:6.2.5` | 6.2.5 | ❌ | 升级到 7.4-alpine |
| `kevinwan/go-stash:1.1.1` | 1.1.1 | ❌ | 强制 `platform: linux/amd64`（kevwan 自家镜像只 build 了 amd64） |
| 其余 7 个（jaeger/es/kibana/filebeat/kafka/asynqmon/mysql） | 全部 ✅ | |

## 踩坑记录

### 坑 1：4 个老镜像没有 arm64 manifest

**现象**：
```
go-stash   Error   no matching manifest for linux/arm64/v8 in the manifest entries
grafana    Error   no matching manifest for linux/arm64/v8 in the manifest entries
```

**原因**：v1 的 `docker-compose-env.yml` 用了 2021-2022 年的镜像版本，那时候 Elastic/Docker 还没全面 build arm64 manifest。

**修复**：
- prometheus / grafana / redis：升级到最新稳定版
- go-stash：作者 kevwan 只 build 了 amd64，必须用 `platform: linux/amd64` 强制走 Rosetta 2 emulation

### 坑 2：Docker Compose v2.35.1 并行 pull 崩溃

**现象**：
```
fatal error: concurrent map writes

goroutine 57 [running]:
github.com/docker/compose/v2/pkg/compose.(*composeService).pullRequiredImages.func1.1()
        github.com/docker/compose/v2/pkg/compose/pull.go:328 +0x198
```

**原因**：Docker Compose v2.28-v2.35 的已知 bug（compose issue #12241、#12380），并行拉 11 个镜像时 progress writer 出现并发 map 写入 panic。v2.30+ 修了大部分，但极端 case 仍复现。

**修复**：写 `/tmp/pull-images.sh`，**先串行 `docker pull` 完所有镜像，再 `docker-compose up -d`**，完全绕开 compose 的并行 pull 路径。

```bash
# 脚本核心：每个镜像单独 pull
docker pull --platform linux/arm64 jaegertracing/all-in-one:1.63.0
docker pull --platform linux/arm64 prom/prometheus:v2.55.0
docker pull --platform linux/arm64 grafana/grafana:11.3.0
# ... 一共 11 个
docker-compose -f docker-compose-env.yml up -d
```

### 坑 3：docker-compose-env.yml 顶部 `version: '3'` 已过时

**现象**：
```
WARN[0000] /Users/.../docker-compose-env.yml: the attribute `version` is obsolete
```

**原因**：Docker Compose v2 不再需要 `version` 字段（v1 时代的 v3/v2 schema 区分已废弃）。

**修复**：暂时不管，等 Step 5 全量改文件时一起删。

### 坑 4：usercenter.yaml sed 替换漏了 127.0.0.1 前缀

**现象**：
```
$ curl -X POST http://127.0.0.1:1004/usercenter/v1/user/register -d '{"mobile":"18721432599","password":"test123456"}'
{"code":100005,"msg":"数据库繁忙,请稍后再试"}
```

rpc 日志也指向 MySQL 失败：
```
fail - direct:/127.0.0.1:2004/pb.usercenter/register - ...
  rpc error: code = Code(100005) desc = 数据库繁忙,请稍后再试
```

**原因**：
原计划执行 `sed -i '' 's|Host: redis:6379|Host: 127.0.0.1:36379|g'`，期望把 docker 服务名换成 host 端口。但实际执行后变成 `Host: redis:36379`（**漏了 `127.0.0.1.` 前缀**）。usercenter 进程去找 `redis:36379` 这个主机名，host 上解析不到 → 950ms 超时 → "数据库繁忙"。mysql 同样踩坑（`mysql:33069` 缺 `127.0.0.1.` 前缀）。

**修复**：
```bash
sed -i '' 's|Host: redis:36379|Host: 127.0.0.1:36379|g' app/usercenter/cmd/rpc/etc/usercenter.yaml
sed -i '' 's|@tcp(mysql:33069)|@tcp(127.0.0.1:33069)|g' app/usercenter/cmd/rpc/etc/usercenter.yaml
```

**教训**：
- sed 替换后必须 `diff` 验证，不能"假设它改对了"就继续
- yaml 里"端口号变了但主机名没变"这种**半改状态**最容易踩坑
- 一开始就要把目标写完整（`127.0.0.1:36379`）而不是分两步改

## 验证步骤

### 1. 覆盖改好的 yaml

```bash
cp /tmp/docker-compose-env.yml.new \
   /Users/yangpeipei/Develop/web3/study/codex_project/go-project/go-zero-looklook-new/docker-compose-env.yml
```

### 2. 跑串行拉镜像 + 启动

```bash
bash /tmp/pull-images.sh
```

### 3. 预期结果

```
==> [11/11] redis:7.4-alpine
==> 全部镜像拉完，开始 up -d
[+] Running 11/11
 ✔ Container mysql         Started
 ✔ Container redis         Started
 ✔ Container kafka         Started
 ✔ Container jaeger        Started
 ✔ Container prometheus    Started
 ✔ Container grafana       Started
 ✔ Container elasticsearch Started
 ✔ Container kibana        Started
 ✔ Container filebeat      Started
 ✔ Container go-stash      Started
 ✔ Container asynqmon      Started
```

### 4. 可能还需要做的（01 文档 3.1/3.2）

```bash
# 创建 kafka topic
docker exec -it kafka /bin/sh
cd /opt/kafka/bin/
./kafka-topics.sh --create --bootstrap-server localhost:9094 --replication-factor 1 --partitions 1 --topic looklook-log
./kafka-topics.sh --create --bootstrap-server localhost:9094 --replication-factor 1 --partitions 1 --topic payment-update-paystatus-topic
exit

# mysql root 远程权限
docker exec -it mysql mysql -uroot -p
# （密码在 docker-compose-env.yml 里 grep MYSQL_ROOT_PASSWORD）
use mysql;
update user set host='%' where user='root';
FLUSH PRIVILEGES;
exit

# 创建业务库 + 导入 SQL
# 数据库：looklook_order / looklook_payment / looklook_travel / looklook_usercenter
# SQL 文件在 deploy/sql/ 目录
```

### 5. 已知可能报错（01 文档 9.x）

| 报错 | 原因 | 修复 |
|---|---|---|
| `mkdir: can't create directory '/var/lib/grafana/plugins': Permission denied` | grafana 数据目录权限 | 已在 yaml 加 `user: root` |
| `Exiting: error loading config file: config file ("filebeat.yml") must be owned by the user identifier (uid=0) or root` | filebeat 配置所有权 | `sudo chown root deploy/filebeat/conf/filebeat.yml` |
| `ElasticsearchException[failed to bind service]; nested: AccessDeniedException[/usr/share/elasticsearch/data/nodes]` | es 数据目录权限 | `sudo chmod 777 data/elasticsearch/data` |

## 升级时长

预计 5-10 分钟（拉镜像占大头，看网络）。

## 产出物

- `go-zero-looklook-new/docker-compose-env.yml`（已升级 4 处版本 + 2 处 platform）
- 11 个容器 running
- 2 个 kafka topic 已建
- 4 个 mysql 业务库已导入数据

## 下一步

跑通 Step 1 后，进入 Step 2：升级开发工具链（modd → air + Dockerfile 基础镜像）。


## 已知未完成（2026-08-04 18:00 状态）

- [x] login + detail 接口完整跑通（验证 token 解析、jwt 中间件）✅ 2026-08-04，详见 step-01.5-jwt-validation.md
- [ ] 跑通其他 4 个服务（travel / payment / order / mqueue）
- [ ] 部署模式工程化：host 模式（127.0.0.1）vs 容器模式（mysql:3306），需要 profile-based config 或 env var 替换

## 补充反思

### 1. "基线复制 + 验证"是升级的最低风险起点

- 不动业务代码，纯粹"复制 + 启动 + 跑通"
- 跑通后再考虑升级 → 每个升级动作都能跟"baseline 跑通状态"对比，知道是升级带来的回归还是原有问题
- 节省"原项目就有 bug"和"我升级引入 bug"的定位时间

### 2. "先 host 跑通 → 再考虑容器化"是务实路径

- 原项目用 modd 容器跑（容器 join looklook_net），yaml 用 docker 服务名 `mysql:3306` / `redis:6379`
- 我们 host 跑必须改 yaml（用 127.0.0.1 + host 端口）
- **不要一开始就想"完全贴合原设计"** —— 先 host 跑通业务，再回头补容器化
- 容器化是"工程化"层面的事，业务跑通后做更稳

### 3. sed 命令一定要 `diff` 验证才执行

- 这次 sed 漏前缀的根因是"没看 diff 就跑下一步"
- 养成 `sed → diff → 跑` 的三步习惯能避免 90% 的脚本报错
- macOS BSD sed 的 `-i ''` 跟 Linux GNU sed `-i` 不一样，更容易写错

### 4. API 字段定义要查 `.api` 文件

- 我最初给的 curl 加了 `nickname` 字段（RegisterReq 实际没有），不会报错但被忽略
- UserInfoReq 是空结构体 `{}`，传 `{"id": 1}` 会被忽略
- 跟 04 文档里展示的字段名不一定一致 —— **写请求体前先 cat .api 文件确认**

### 5. 路由 prefix 一定要在 `@server` 里看

- 文档里写 `/user/register`，实际是 `/usercenter/v1/user/register`
- 404 时第一反应应该是 `grep "@server" xxx.api` 找 prefix
