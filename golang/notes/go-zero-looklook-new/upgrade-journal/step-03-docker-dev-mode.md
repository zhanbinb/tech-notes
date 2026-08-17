# Step 3 (未来): 全 Docker Dev 模式 (modd 等价方案)

> 日期：2026-08-05  
> 目的：设计"所有服务 + air 全进 docker"方案，跟原 modd 模式对齐  
> 状态：⏸️ **Deferred** - 等待做 (MacBook Air 内存紧张, 现在 host 模式先用着)  
> 触发条件：用户机器有 16G+ 内存 / 或需要 dev=prod 一致性测试

## 目标

实现跟原 modd 模式**完全等价**的 dev 体验：
- 所有 5 个服务 (usercenter / travel / payment / order / mqueue) 跑在 docker 容器里
- 每个容器带 air, 文件改动自动 build + 重启
- 容器 join `looklook_net`, 通过 docker 服务名连 mysql/redis/kafka
- 跟 k8s 生产环境用同一套 yaml 配置

## 跟当前 host 模式对比

| 维度 | host 模式 (现在) | docker 模式 (将来) |
|---|---|---|
| air 跑在哪 | host (macOS) | 容器里 |
| usercenter-rpc 跑在哪 | host (macOS) | 容器里 |
| mysql/redis 怎么连 | `127.0.0.1:33069` (host 端口映射) | `mysql:3306` (docker 服务名) |
| 容器 join looklook_net | 不需要 | **必须** |
| 内存占用 | 11 个中间件 + 5 个 host 进程 | 11 个中间件 + 5 个 dev 容器 |
| 配置文件 | 1 套 (host 端口) | 2 套 (host + docker) |
| dev=prod 一致性 | ❌ | ✅ |

## 设计方案

### 文件结构 (将来创建)

```
go-zero-looklook-new/
├── Dockerfile.dev                    # air + go 1.25 基础镜像
├── docker-compose.dev.yml            # 5 个服务 + air
├── .air.host/
│   ├── air.usercenter.toml           # host 模式 air 配置 (已有, 改名)
│   ├── air.travel.toml
│   ├── air.payment.toml
│   ├── air.order.toml
│   └── air.mqueue.toml
├── .air.docker/                      # 新建
│   ├── air.usercenter.toml           # docker 模式 air 配置
│   ├── air.travel.toml
│   ├── air.payment.toml
│   ├── air.order.toml
│   └── air.mqueue.toml
├── app/usercenter/cmd/rpc/etc/
│   ├── usercenter.yaml               # host 模式 (127.0.0.1:33069)
│   └── usercenter.docker.yaml        # docker 模式 (mysql:3306)
└── ...
```

### Dockerfile.dev (核心镜像)

```dockerfile
FROM golang:1.25-alpine

# 装 air (跟 host 上同一版本)
RUN go install github.com/air-verse/air@v1.65.0@latest

WORKDIR /app

# air 启动命令 (每个服务有自己的 -c 配置)
CMD ["air", "-c", ".air.docker/air.usercenter.toml"]
```

### docker-compose.dev.yml (5 个服务)

```yaml
version: "3.8"

services:
  usercenter-rpc:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: usercenter-rpc-dev
    volumes:
      - .:/app                              # 源码挂载 (热加载靠这个)
    working_dir: /app
    networks:
      - looklook_net
    command: air -c .air.docker/air.usercenter.toml
    ports:
      - "2004:2004"
    # 健康检查 (可选)
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:2004"]
      interval: 10s
      timeout: 3s
      retries: 5

  # travel / payment / order / mqueue 类似...

networks:
  looklook_net:
    external: true                          # 复用 docker-compose-env.yml 启的中间件
```

### .air.docker/air.usercenter.toml (docker 模式 air 配置)

```toml
[build]
  cmd = "go build -o ./tmp/usercenter-rpc ./app/usercenter/cmd/rpc"
  full_bin = "./tmp/usercenter-rpc -f ./app/usercenter/cmd/rpc/etc/usercenter.docker.yaml"
  delay = 1000
  stop_on_error = true
  include_ext = ["go", "yaml", "yml"]
  exclude_dir = ["data", "tmp", "vendor", "deploy", "node_modules", ".git", "notes"]
```

### app/usercenter/cmd/rpc/etc/usercenter.docker.yaml (关键差异)

```yaml
DB:
  DataSource: root:PXDN93VRKUm8TeE7@tcp(mysql:3306)/looklook_usercenter?...
Redis:
  Host: redis:6379
```

**注意**：`mysql:3306` / `redis:6379` 是 docker 服务名，**只在容器内能解析**。在 host 上跑会失败。

### 启动方式 (将来)

**host 模式 (现在用的)**:
```bash
# 在 host 上
air -c .air.host/air.usercenter.toml
```

**docker 模式 (将来)**:
```bash
# 1. 启动中间件 (跟现在一样)
docker compose -f docker-compose-env.yml up -d

# 2. 启动 dev 服务 (新加的)
docker compose -f docker-compose.dev.yml up -d
# 自动 join looklook_net
# 改代码 -> air 检测 -> rebuild -> 重启 usercenter-rpc 容器
```

### 端口冲突处理

**关键问题**：host 模式已经占着 2004/1004 端口，docker 模式也想暴露这些端口。

**方案**：
- host 模式不暴露 2004/1004 给 docker（用 host 内部）
- docker 模式 2004/1004 暴露给 host（方便 smoke test）
- 同时跑两种模式会冲突 → 选一种

或者：
- **dev 模式互斥**（同一时间只跑 host 或 docker）
- 切换前先停掉一种

## MacBook Air 内存预算

启动 5 个 dev 容器 + 11 个中间件容器 = **16 个容器**

每个 Go 容器基础内存 ~50M，5 个 = 250M
每个中间件 ~100-300M，11 个 = 1.5-3GB
air + go build 临时内存 ~1-2GB
**总计**：3-5GB 内存峰值

MacBook Air 8GB 配置下：
- macOS 系统 ~2GB
- 浏览器 ~1GB
- **dev 容器峰值 3-5GB → OOM 风险**

**结论**：MacBook Air 8GB 跑全 docker dev 模式**有风险**，建议：
- 16GB 机器再切换
- 或只把当前在改的服务进 docker (其他 4 个 host 跑)
- 或先停掉所有中间件之外的容器

## 切换流程 (将来)

### Step 3.1: 准备阶段
- [ ] 写 Dockerfile.dev
- [ ] 写 docker-compose.dev.yml 骨架 (先 usercenter-rpc 一个)
- [ ] 写 .air.docker/air.usercenter.toml
- [ ] 写 usercenter.docker.yaml
- [ ] 测试: `docker compose -f docker-compose.dev.yml up usercenter-rpc`

### Step 3.2: 扩展到 5 个服务
- [ ] 给 travel / payment / order / mqueue 写 .air.docker/ 配置
- [ ] 给每个服务写 etc/*.docker.yaml
- [ ] 完整 docker-compose.dev.yml 5 个服务
- [ ] 全部 5 个服务 smoke test 走通

### Step 3.3: 切换工具
- [ ] Makefile 加 `make dev-host` / `make dev-docker` 快捷方式
- [ ] README 更新两种模式说明
- [ ] 笔记: 两种模式取舍 + 何时用哪个

### Step 3.4: 文档化
- [ ] docs/ 加 docker dev 模式说明
- [ ] 笔记 step-03-docker-dev-mode.md (本笔记的"已完成"版本)

## 触发条件 (什么情况下做 Step 3)

- **机器升级**：换 16G+ 内存 Mac
- **多人协作**：项目要 share 给别人, docker dev 模式一次配置多人用
- **CI/CD**：要本地完全模拟生产环境跑 e2e 测试
- **生产一致性**：发现 host 模式跟 k8s 行为不一致 (例如 dns / 端口 / 环境变量)

## 跟 host 模式的关系

- **host 模式不是临时方案**——它就是 dev 模式的一种
- **docker 模式不是 host 模式的升级**——它是 dev 模式的另一种
- **两种模式各有适用场景**:
  - host: 个人快速迭代, 资源有限
  - docker: 团队协作, 生产一致性

## 现状 (2026-08-05)

✅ **host 模式已完成** (Step 2):
- air.usercenter.toml 写好
- 试跑通过
- 笔记 step-02-air-trial.md

⏸️ **docker 模式待做** (Step 3):
- 本笔记是 roadmap
- 等触发条件再动手

## 相关笔记

- `step-02-air-trial.md` - host 模式 air 配置
- `step-04d-pkg-errors-migration.md` - 错误处理改造
- `progress-day-1.md` - 整体进度
