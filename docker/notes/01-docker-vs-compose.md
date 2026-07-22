# 01 · Docker vs Docker Compose 区别

> 记录时间：2026-07-17
> 来源：go-clean-arch 项目运行过程的问答

## 一句话区别

- **Docker**：管**单个容器**
- **Docker Compose**：管**一组容器**（用一份 YAML 配置文件描述它们）

## 直观对比

```bash
# Docker：每次只能操作一个
docker run -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=root --name mysql mysql:8.3
docker run -d -p 9090:9090 -e DATABASE_HOST=mysql --name web my-web-app

# Docker Compose：用一份 YAML 描述两个容器，一条命令全拉起
docker compose up -d
```

## 对应关系

| 想做的事 | Docker | Docker Compose |
|---|---|---|
| 启动一个容器 | `docker run ...` | 在 `compose.yaml` 里写一段 |
| 启动多个容器 | 写多次 run | 写一份 yaml |
| 启停一组 | 逐个 `docker stop/start` | `docker compose up/down` |
| 看一组状态 | `docker ps` 一堆 | `docker compose ps` |
| 删除一组 | 逐个 `docker rm` | `docker compose down` |
| 网络/卷 | 手动 `--network --volume` | yaml 里 `networks:` `volumes:` 声明式 |

## YAML 长啥样（go-clean-arch 项目的 compose.yaml）

```yaml
services:
  web:                  # ← 一个服务 = 一个容器
    image: go-clean-arch
    ports: ["9090:9090"]
    depends_on:
      mysql:             # ← 依赖 mysql 先起来
        condition: service_healthy

  mysql:                # ← 另一个服务
    image: mysql:8.3
    ports: ["3306:3306"]
    volumes:
      - ./article.sql:/docker-entrypoint-initdb.d/init.sql
```

`docker compose up -d` 会**自动**做这些事：
1. 创建一个隔离的 network
2. 把 web 和 mysql 接到这个 network 里
3. 按 `depends_on` 顺序启动（web 等 mysql healthy 才起）
4. 挂载文件、映射端口
5. 两个容器之间可以用**服务名**（`mysql`）当 hostname 互访

用手写 `docker run` 就要自己处理上面所有事，命令会很长。

## 本质

- **Docker 是引擎**（daemon + CLI），负责镜像、容器、网络、卷的底层操作
- **Docker Compose 是编排工具**，本质上是：
  1. 一份声明式 YAML 配置
  2. 一个 CLI（`docker compose` 子命令）
  3. 内部还是会调 Docker Engine 的 API 来做事

它**不替代 Docker**，是**站在 Docker 之上**的便利层。

## ⚠️ 老坑要避开：V1 vs V2

历史上有两个版本：
- `docker-compose`（**带横线**，V1，Python 写的，已废弃）
- `docker compose`（**带空格**，V2，Go 写的，集成进 Docker CLI）

新机器装的都是 V2，写法是 `docker compose ...`（**空格**）。网上老教程的 `docker-compose ...`（**横线**）要看清版本。

检查你机器上是哪个：

```bash
docker compose version     # V2（推荐）
docker-compose --version   # V1（已废弃）
```

## 🎯 记忆口诀

> **Docker 管"盒子"（container）**  
> **Compose 管"盒子们"（一组 container + 它们的网络/卷/启动顺序）**

## 关联笔记

- [02 · Dockerfile vs compose.yaml 区别](./02-dockerfile-vs-compose-yaml.md)
- [03 · go-clean-arch 本地跑通实战](./03-go-clean-arch-local-run.md)
