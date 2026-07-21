# 03 · go-clean-arch 本地跑通实战（含踩坑）

> 记录时间：2026-07-17
> 项目：https://github.com/bxcodec/go-clean-arch （v4 版本）
> 环境：macOS arm64 + Docker Desktop + Go 1.25.5

## 目标

把 go-clean-arch 这个 Clean Architecture 示例项目在自己机器上跑起来，包括 MySQL 和 Go Web 服务。

## 1. 环境前置

```bash
go version        # ≥ 1.20（项目要求；用 1.25.5 也行）
docker --version  # ≥ 20.x
docker compose version
make --version
```

> ❗ 本项目作者推崇 `air`（热重载），但**初学者不装也行**，`go run` 就够。

## 2. clone 项目

```bash
cd ~/Develop/web3/study/codex_project   # 或者你想放的位置
git clone https://github.com/bxcodec/go-clean-arch.git
cd go-clean-arch
```

## 3. 准备配置

```bash
cp example.env .env       # 复制环境变量模板
```

`.env` 长这样（**不要改**，先用默认）：

```env
DEBUG=True
SERVER_ADDRESS=:9090
CONTEXT_TIMEOUT=2
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=user
DATABASE_PASS=password
DATABASE_NAME=article
```

## 4. 启动 MySQL（项目自带 compose）

```bash
docker compose up -d mysql
```

✅ `article.sql` 会**自动**作为初始化脚本导入（见 `compose.yaml` 的 `volumes`）。

等几秒，看到 healthy 就算好了：

```bash
docker ps --filter name=go_clean_arch_mysql --format '{{.Names}} {{.Status}}'
# 期望：go_clean_arch_mysql Up X minutes (healthy)
```

## 5. 启动应用

**两条路任选一条**：

### 路线 A：直接 `go run`（最简单，初学者首选）

```bash
go run ./app/
```

看到这一行就成功了：
```
⇨ http server started on [::]:9090
```

### 路线 B：用 `make`（作者推荐）

```bash
make build      # 编译到 engine 二进制
./engine        # 运行
```

或用 `make up` 一键拉起 MySQL + air（需要先装 air，比较折腾，**新手跳过**）。

## 6. 验证（开另一个终端）

```bash
# 列文章
curl http://localhost:9090/articles

# 取单篇
curl http://localhost:9090/articles/1

# 创建
curl -X POST http://localhost:9090/articles \
  -H "Content-Type: application/json" \
  -d '{"title":"hello","content":"world","author":{"id":1}}'

# 删除
curl -X DELETE http://localhost:9090/articles/1
```

## 7. 跑测试（可选但推荐）

```bash
make tests          # 用 gotestsum，需要先 make install-deps
# 或最朴素：
go test ./...
```

---

## 🐛 跑通过程中踩的 7 个坑

### 坑 1：`docker run mysql` 不带 `MYSQL_ROOT_PASSWORD` 直接失败

```
[ERROR] [Entrypoint]: Database is uninitialized and password option is not specified
    You need to specify one of the following as an environment variable:
    - MYSQL_ROOT_PASSWORD
    - MYSQL_ALLOW_EMPTY_PASSWORD
    - MYSQL_RANDOM_ROOT_PASSWORD
```

**原因**：MySQL 官方镜像的安全设计，防止无意中用空密码 root 暴露。

**解决**：用本项目自带的 `docker compose up -d mysql`，参数都配好了；或者手动加 `-e MYSQL_ROOT_PASSWORD=xxx`。

### 坑 2：Workbench 用 `root` 账号连不上

```
Access denied for user 'root'@'192.168.65.1' (using password: YES)
```

**原因**：MySQL 用户是 `(user, host)` 联合匹配的。`root@localhost` ≠ `root@%`。
`192.168.65.1` 是 Docker Desktop 在 macOS 上的虚拟网关 IP，从 host 访问容器都显示这个。

**解决**：
- 用 `user`/`password` 账号（compose.yaml 给应用准备的）
- 或给 `root@%` 授权（参考下方 Workbench 配置）

### 坑 3：3306 端口被占用

```
Bind for 0.0.0.0:3306 failed: port is already allocated
```

**原因**：本机已有一个 MySQL 容器占了 3306。

**解决**：
```bash
# 查谁在占
lsof -nP -i :3306

# 半残容器清理
docker rm -f scanner-mysql
```

### 坑 4：go-clean-arch mysql 被联动关闭

用 `--network container:go_clean_arch_mysql` 共享网络 namespace 跑 web 容器，**goapp 退出时 mysql 也跟着被 SIGTERM**。

**解决**：非必要不走共享网络 namespace。让 web 用 compose 网络的 `mysql` 服务名直接连。

### 坑 5：macOS 上 `go build` 出来的 Mach-O 二进制不能塞进 linux 容器

```bash
file tmp_app/engine
# Mach-O 64-bit executable arm64
```

**原因**：宿主机是 darwin/arm64，alpine 容器是 linux/aarch64。

**解决**（如确需交叉编译）：
```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o engine-linux ./app/
```

**初学者建议**：直接 `go run ./app/` 在 host 跑，别绕容器。

### 坑 6：alpine 镜像没 tzdata

```
failed to open connection to database unknown time zone Asia/Jakarta
```

**原因**：项目的 MySQL DSN 用了 `loc=Asia/Jakarta`，alpine 基础镜像不包含时区数据。

**解决**：在容器里 `apk add --no-cache tzdata`。

### 坑 7：`godotenv.Load()` 找不到 .env 直接 Fatal

```go
// app/main.go
func init() {
    err := godotenv.Load()
    if err != nil {
        log.Fatal("Error loading .env file")
    }
}
```

**原因**：entrypoint 太严格，找不到文件就退出。

**解决**：`.env` 必须放在**和 `go.mod` 同级目录**，且叫这个名字（项目会从当前工作目录找）。

---

## ⚠️ 跑通后会发现的真实 Bug

`POST /articles` 返回 500：

```
Error 1292 (22007): Incorrect datetime value: '0000-00-00' for column 'updated_at' at row 1
```

**原因**：`article/service.go` 的 `Store()` 方法没设置 `CreatedAt` / `UpdatedAt`，domain.Article 零值时间序列化为 `0000-00-00`，MySQL 8 严格模式拒绝。

**修复**（一行）：
```go
func (a *Service) Store(ctx context.Context, m *domain.Article) (err error) {
    existedArticle, _ := a.GetByTitle(ctx, m.Title)
    if existedArticle != (domain.Article{}) {
        return domain.ErrConflict
    }
    now := time.Now()
    m.CreatedAt, m.UpdatedAt = now, now   // ← 补这行
    err = a.articleRepo.Store(ctx, m)
    return
}
```

对比 `Update` 方法有 `ar.UpdatedAt = time.Now()`，Store 漏掉了。

---

## 🧹 跑通后的清理命令

```bash
# 清理所有 Exited 容器
docker container prune

# 清理项目
docker compose down

# 完全清理（含数据卷）
docker compose down -v
```

> ⚠️ **数据没持久化**。下次 `docker compose down` 再起数据就没了。想保留数据要改 compose.yaml 加 named volume。

---

## 📋 给 MySQL Workbench 用的连接参数

| 字段 | 值 |
|---|---|
| Connection Method | Standard (TCP/IP) |
| Hostname | `127.0.0.1` ⚠️（不要写 localhost） |
| Port | `3306` |
| Username | `user` 或 `root` |
| Password | `password` 或 `root` |

---

## 关联笔记

- [01 · Docker vs Docker Compose 区别](./01-docker-vs-compose.md)
- [02 · Dockerfile vs compose.yaml 区别](./02-dockerfile-vs-compose-yaml.md)
