# 02 · Dockerfile vs compose.yaml 区别

> 记录时间：2026-07-17
> 来源：go-clean-arch 项目运行过程的问答

## 一句话区别

- **Dockerfile**：**怎么做出一个镜像**（构建步骤）
- **compose.yaml**：**怎么把镜像跑成容器**（运行时编排）

## 直观类比

| 概念 | 类比 | 做什么 |
|---|---|---|
| Dockerfile | 菜谱 | 一步步告诉 Docker：用什么原料、怎么烹饪 |
| compose.yaml | 餐桌布置 | 告诉 Docker：上几个菜、盘子怎么摆、菜和菜之间怎么搭配 |

## 拆开看

### Dockerfile —— 镜像的"出生证明"

```dockerfile
# Dockerfile（go-clean-arch 项目里实际的）
FROM golang:1.20.7-alpine3.17 as builder   # 原料1：Go 编译环境
RUN apk update && apk upgrade && apk --update add git make bash build-base
WORKDIR /app
COPY . .                                    # 把代码搬进厨房
RUN make build                              # 烹饪：编译出 engine 二进制

FROM alpine:latest                          # 原料2：极简运行环境
RUN apk add tzdata
WORKDIR /app
EXPOSE 9090
COPY --from=builder /app/engine /app/       # 把成品从厨房端到餐桌
CMD /app/engine
```

跑一遍 `docker build -t go-clean-arch .` 后，**得到一个叫 `go-clean-arch` 的镜像**。

### compose.yaml —— 容器的"运行清单"

```yaml
# compose.yaml（go-clean-arch 项目里实际的）
services:
  web:
    image: go-clean-arch                    # ← 用刚才那个镜像
    ports: ["9090:9090"]
    depends_on:
      mysql: { condition: service_healthy }

  mysql:
    image: mysql:8.3                        # ← 用官方现成镜像（不需要 Dockerfile）
    ports: ["3306:3306"]
    volumes:
      - ./article.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
```

跑 `docker compose up -d` 后，**得到两个正在运行的容器**。

## 核心区别对照表

| 维度 | Dockerfile | compose.yaml |
|---|---|---|
| 关心什么 | **镜像**（静态产物） | **容器**（运行实例） |
| 描述什么 | 如何**从代码构建**出镜像 | 如何**用镜像跑出**容器 |
| 关键动词 | `FROM` `RUN` `COPY` `CMD` | `image` `ports` `volumes` `depends_on` |
| 数量 | 一个项目**通常 1 个** | 一个项目**通常 1 个**，但里面有 N 个服务 |
| 没有它会怎样 | 没有镜像可跑 | 还能用 `docker run` 手动起（但很烦） |
| 对方存在的前提 | 镜像可以来自 Dockerfile **或** registry | 至少要有一个镜像可被 `image:` 引用 |

## 它们是怎么配合的

```
你的代码 (.go / .sql / 配置)
    │
    │  docker build -t go-clean-arch .        ← Dockerfile 在这里被使用
    ▼
镜像 go-clean-arch （已存到本地）
    │
    │  docker compose up                       ← compose.yaml 在这里被使用
    ▼
容器 article_management_api （在跑） + 容器 go_clean_arch_mysql （在跑）
```

## 一个最容易踩的坑

❌ **以为 `compose.yaml` 里的 `image:` 必须是本地自己 build 的**

✅ **不是的**。`image: mysql:8.3` 是个**官方现成镜像**，Docker 会自动从 Docker Hub 拉下来，根本不需要对应的 Dockerfile。

所以你看到 `compose.yaml` 里有这种结构：
```yaml
web:    { image: go-clean-arch }    # 本项目 build 出来的
mysql:  { image: mysql:8.3 }         # Docker Hub 官方镜像
```

两个服务走的是完全不同的来源路径。

## 🎯 记忆口诀

> **Dockerfile = 造轮子**（怎么从 0 造出一个镜像）  
> **compose.yaml = 开车**（怎么把造好的轮子装到车上跑起来）

## 在 go-clean-arch 项目里

| 文件 | 用途 | 跑什么命令用它 |
|---|---|---|
| `Dockerfile` | 把 Go 代码编成 `go-clean-arch` 镜像 | `docker build -t go-clean-arch .` |
| `compose.yaml` | 用 `go-clean-arch` 镜像 + `mysql:8.3` 镜像起服务 | `docker compose up -d` |
| `Makefile` | 一键跑上面这些命令 | `make build` / `make up` |

新手跑通项目用到的就是 `compose.yaml`（mysql 服务），而 `Dockerfile` 还没被用到——因为直接 `go run ./app/` 在 host 跑 Web 服务，**绕过了"造镜像"这一步**。

## 关联笔记

- [01 · Docker vs Docker Compose 区别](./01-docker-vs-compose.md)
- [03 · go-clean-arch 本地跑通实战](./03-go-clean-arch-local-run.md)
