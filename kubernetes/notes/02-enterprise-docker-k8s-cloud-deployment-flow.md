# 企业级 Docker、Kubernetes 与云服务部署：从代码提交到生产运维的完整流程

> **一句话结论**：企业部署不是“写一个 Dockerfile，再执行一次 `kubectl apply`”，而是一条可审计、可回滚、可观测的交付链：**代码 → 测试 → Docker 镜像 → 镜像仓库 → 云基础设施 → Kubernetes 工作负载 → 流量入口 → 监控告警 → 发布与回滚**。
>
> 本文以 **AWS EKS** 作为具体示例，但把云厂商相关部分单独抽象出来，换成 GKE/AKS/ACK、ECS/Fargate、Cloud Run 等方案时，主流程仍然成立。

## TL;DR

- **Docker** 负责把程序和运行时依赖封装成可分发的镜像；它解决“在什么机器上都尽量一致地运行”。
- **镜像仓库（Registry）**负责保存、权限控制、扫描和分发镜像；生产环境应使用不可变的 commit SHA 或 digest，而不是 `latest`。
- **Kubernetes（K8s）**负责在集群中按照声明式配置运行 Pod，并提供调度、自愈、服务发现、滚动发布和扩缩容。
- **云服务**负责提供 VPC、计算节点、负载均衡、DNS、TLS、数据库、对象存储、密钥和可观测性等基础能力。
- **CI**验证代码并构建制品；**CD/GitOps**把经过验证的同一个制品逐级发布到环境；**IaC**（Terraform/OpenTofu 等）管理云基础设施。
- 生产默认组合通常是：**托管 Kubernetes + 私有节点 + 托管数据服务 + 私有镜像仓库 + IaC + GitOps + 可观测性**。
- 不要为了“云原生”强行上 K8s。单机或小团队可能更适合 **云主机 + Docker Compose**、ECS、Cloud Run 或 App Runner。

---

## 一、先建立全局模型：每一层到底负责什么

### 1.1 四层职责

| 层 | 典型组件 | 主要职责 | 不应该承担的职责 |
| --- | --- | --- | --- |
| 应用层 | Go/Java/Node/Python 服务 | 业务逻辑、协议、优雅退出、健康检查、指标 | 管理节点、手工重启进程 |
| 容器层 | Dockerfile、Docker、BuildKit | 打包运行时、构建镜像、隔离进程 | 多节点调度、跨机高可用 |
| 编排层 | Kubernetes、Deployment、Service、HPA | 调度、复制、自愈、服务发现、发布 | 替代数据库备份，自动修复业务 bug |
| 云基础设施层 | VPC、EKS/EC2、ALB、RDS、S3、IAM | 网络、计算、托管数据、身份、入口和基础运维 | 代替应用设计和发布流程 |

可以把一次请求理解为：

```text
用户
  │
  ▼
DNS → CDN/WAF → 云负载均衡器（ALB/NLB/Cloud Load Balancer）
  │
  ▼
Kubernetes Ingress / Gateway
  │
  ▼
Service（稳定的虚拟地址）
  │
  ▼
Pod（容器实例）
  │
  ├── RDS / Cloud SQL / Azure Database
  ├── Redis / ElastiCache / Memorystore
  ├── S3 / GCS / Blob Storage
  └── Kafka / SQS / Pub/Sub / Service Bus
```

### 1.2 一次发布的完整链路

```mermaid
flowchart LR
    A[开发者提交代码] --> B[Pull Request]
    B --> C[CI: lint/test/build]
    C --> D[构建 Docker 镜像]
    D --> E[扫描 SBOM 签名]
    E --> F[推送 Registry]
    F --> G[更新部署清单中的镜像 digest]
    G --> H[CD 或 GitOps 同步到 Staging]
    H --> I[集成测试与验收]
    I --> J{发布门禁}
    J -->|通过| K[Promote 同一 digest 到 Production]
    J -->|失败| L[停止发布并修复]
    K --> M[Kubernetes 滚动/金丝雀发布]
    M --> N[监控 SLO 与业务指标]
    N --> O{健康?}
    O -->|是| P[完成发布]
    O -->|否| Q[回滚到上一版本]
```

### 1.3 关键对象关系

```text
代码仓库
  └── Dockerfile ──构建──> Image
                              └──推送──> Registry
                                           └──拉取──> Node 上的 Container
                                                              └──归属──> Pod
                                                                           └──管理──> Deployment
                                                                                        └──暴露──> Service/Ingress
```

- **Image** 是不可变制品；**Container** 是 Image 的一次运行实例。
- **Pod** 是 Kubernetes 的最小调度单元，通常包含一个业务容器，也可能包含 sidecar。
- **Node** 是运行 Pod 的机器，可以是 EC2、虚拟机、物理机或 Fargate 计算环境。
- **Deployment** 管理无状态 Pod 的副本和版本；它不直接对外提供稳定网络地址。
- **Service** 为一组符合 label selector 的 Pod 提供稳定地址和负载分发。
- **Ingress/Gateway** 把外部 HTTP(S) 流量路由到 Service；云负载均衡器通常由 Controller 自动创建。

---

## 二、阶段 0：部署前的架构与边界决策

部署前先回答“为什么用哪种平台”，而不是先写 YAML。

### 2.1 先给工作负载分类

| 工作负载 | 推荐 Kubernetes 对象 | 典型例子 | 重点风险 |
| --- | --- | --- | --- |
| 无状态 HTTP/gRPC 服务 | `Deployment` + `Service` | API、BFF、微服务 | 会话、临时文件、优雅退出 |
| 定时任务 | `CronJob` | 对账、清理、报表 | 重入、重复执行、超时 |
| 一次性任务 | `Job` | 数据初始化、迁移 | 失败重试、幂等、锁 |
| 有状态服务 | 优先托管服务；必要时 `StatefulSet` | Kafka、特殊缓存 | 持久卷、备份、故障转移 |
| Daemon 类任务 | `DaemonSet` | 节点日志、监控 agent | 节点权限、资源侵占 |
| 高吞吐异步消费者 | `Deployment` 或 `Job` | MQ consumer、批处理 | 消费幂等、扩缩容指标 |

> 企业中的常见原则：**应用服务尽量无状态；数据库、Redis、消息队列优先使用云厂商托管服务**。把数据库简单地塞进 K8s 并不会自动得到高可用、备份和可恢复能力。

### 2.2 选择部署形态

| 场景 | 推荐起点 | 何时升级 |
| --- | --- | --- |
| 本地开发、依赖服务联调 | Docker Compose | 不把 Compose 当成生产编排平台 |
| 单机、小流量、运维人力有限 | 云主机 + Docker Compose / systemd | 多机、自动扩缩容、频繁发布时升级 |
| 容器化但不需要完整 K8s 生态 | ECS/Fargate、Cloud Run、Azure Container Apps | 需要统一 K8s API、复杂调度或多团队平台时升级 |
| 多服务、多团队、需要标准云原生生态 | EKS/GKE/AKS/ACK | 通过平台工程降低集群复杂度 |
| 事件驱动、短任务、突发流量 | Lambda/Cloud Functions/Jobs | 长连接、复杂运行时或稳定常驻服务不一定适合 |

**判断标准**不是“公司是否使用 K8s”，而是：自动化、自愈、弹性、隔离和统一治理带来的收益，是否超过集群的学习与运维成本。

### 2.3 环境隔离策略

至少区分：

- `dev`：开发者本地或共享开发环境，允许快速迭代；
- `test/qa`：自动化测试、接口测试、回归测试；
- `staging`：尽量接近生产的预发布环境；
- `prod`：生产环境，变更需要审批、审计和回滚方案。

成熟团队通常做**账号/项目隔离 + 集群/命名空间隔离**的组合：

```text
云组织
├── shared-services（镜像、日志、DNS、CI 共享能力）
├── dev account/project
├── staging account/project
└── prod account/project（更严格权限与网络隔离）
```

只用 namespace 隔离生产和开发并不等于强隔离。生产数据、IAM、网络和账单边界越重要，越应该使用独立云账号或项目。

---

## 三、阶段 1：让应用具备“可容器化、可编排”条件

K8s 能自动重启进程，但不能修复不适合云环境的应用。应用代码需要先完成以下改造。

### 3.1 配置与密钥外置

- 镜像只放代码和非环境相关的默认值；
- 数据库地址、队列地址、开关、日志级别通过环境变量或挂载文件注入；
- 密码、token、证书放在云 Secret Manager/KMS/Vault，再同步给 Pod；
- 不把 `.env`、私钥、生产连接串提交到 Git；
- 配置变更要有版本、审计、回滚和生效策略。

`ConfigMap` 适合非敏感配置；Kubernetes `Secret` 的 YAML 默认只是 base64 编码，**不是“放进 Git 就安全”**。生产建议使用 External Secrets Operator、Secrets Store CSI Driver 或云厂商原生 Secret 集成。

### 3.2 无状态化

应用 Pod 随时可能被删除或迁移，因此：

- 不把用户 session 只存在进程内存，使用 Redis、数据库或无状态 token；
- 不把上传文件只写在容器文件系统，使用对象存储或持久卷；
- 不依赖固定主机名、固定 IP 或本地磁盘中的临时数据；
- 缓存丢失后应用仍能恢复；
- 多副本之间不假设执行顺序或共享内存。

### 3.3 优雅退出与连接排空

Pod 被删除时，Kubernetes 会发送 `SIGTERM`，等待 `terminationGracePeriodSeconds` 后再强制结束。应用应该：

1. 收到 `SIGTERM` 后停止接收新请求；
2. 将正在处理的请求、消息或事务处理完；
3. 关闭数据库、MQ、HTTP/gRPC 连接；
4. 在合理时间内退出；
5. 超时后允许 K8s 强制终止。

对于长连接、消息消费者和 WebSocket，要特别设计排空逻辑；单纯把 `terminationGracePeriodSeconds` 调大并不能保证数据不丢。

### 3.4 健康检查端点

建议至少提供三个语义清晰的端点：

| 检查 | 含义 | 失败后的动作 |
| --- | --- | --- |
| `startup` | 程序是否完成启动、加载模型或迁移 | 暂不执行 liveness，避免启动慢的应用被误杀 |
| `readiness` | 当前是否可以接收流量 | 从 Service endpoints 移除，不一定重启 |
| `liveness` | 进程是否陷入不可恢复状态 | 重启容器 |

`readiness` 不要无脑检查所有下游依赖。数据库短暂抖动时，如果所有 Pod 同时变成 NotReady，可能形成雪崩；应按业务设计依赖降级和超时。

### 3.5 日志、指标和链路

- 日志写 `stdout/stderr`，让平台统一采集；不要依赖容器内轮转文件；
- 输出结构化 JSON，带 `timestamp`、`level`、`request_id`、`trace_id`、`service`、`version`；
- 暴露 Prometheus 指标或通过 OpenTelemetry SDK/Collector 上报；
- 为 HTTP/gRPC、数据库、MQ 设置超时、重试上限和熔断；
- 记录版本、commit SHA 和构建时间，便于故障定位。

### 3.6 数据库迁移要独立设计

不要在每个 API Pod 启动时都执行不可控的 schema migration。推荐：

```text
向后兼容的 expand migration
  ↓
发布同时兼容旧/新 schema 的应用
  ↓
回填或异步迁移数据
  ↓
切换读写路径
  ↓
确认无旧版本后执行 contract migration
```

迁移应作为受控的 `Job`、流水线步骤或独立迁移工具运行，并具备锁、超时、幂等和回滚/前滚方案。

---

## 四、阶段 2：设计代码仓库与交付物

一个便于企业交付的仓库可以采用如下结构：

```text
order-service/
├── cmd/api/                    # 程序入口
├── internal/                   # 业务代码
├── migrations/                 # 数据库迁移
├── Dockerfile
├── .dockerignore
├── compose.yaml                # 本地依赖编排
├── deploy/
│   ├── base/                   # 与环境无关的 K8s 基础清单
│   │   ├── kustomization.yaml
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── serviceaccount.yaml
│   │   ├── hpa.yaml
│   │   ├── pdb.yaml
│   │   └── networkpolicy.yaml
│   └── overlays/
│       ├── dev/
│       ├── staging/
│       └── prod/
├── charts/order-service/       # 若团队选择 Helm，可替代或配合 Kustomize
├── infra/                     # Terraform/OpenTofu 模块与环境
│   ├── modules/
│   └── envs/{dev,staging,prod}/
└── .github/workflows/          # 或 GitLab CI/Jenkins/云原生 CI
```

### 4.1 应用仓库与环境仓库是否分离

两种常见方式：

- **单仓库**：应用代码与部署清单在一起，简单直观，适合小团队；
- **应用仓库 + 环境仓库**：应用仓库产出镜像，环境仓库只记录要部署的 digest/Helm values，适合多团队、多环境和 GitOps。

无论哪种方式，都应该保证：

- 环境差异显式存在，不靠人工在生产机器上改文件；
- 每次发布都有 commit、审批人、时间和制品 digest；
- 回滚是恢复 Git 版本或选择上一 digest，而不是“登录服务器手工改镜像”。

---

## 五、阶段 3：用 Docker 构建可生产运行的镜像

### 5.1 Dockerfile 的企业实践

下面是一个以 Go 服务为例的多阶段构建模板。版本和路径按项目调整，示例值不是通用性能结论。

```dockerfile
# syntax=docker/dockerfile:1.7

# BuildKit 在多架构构建时提供 BUILDPLATFORM/TARGETOS/TARGETARCH
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS build

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT_SHA=unknown

WORKDIR /src

# 先复制依赖描述文件，尽可能复用缓存层
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT_SHA}" \
    -o /out/order-api ./cmd/api

# 运行时镜像不包含编译器、源码和包管理器
FROM gcr.io/distroless/static-debian12:nonroot

ARG VERSION=dev
ARG COMMIT_SHA=unknown
LABEL org.opencontainers.image.title="order-api" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT_SHA}"

COPY --from=build /out/order-api /order-api

# distroless 的 nonroot 用户；应用若需要写文件，应使用显式挂载的临时卷
USER nonroot:nonroot
ENTRYPOINT ["/order-api"]
```

关键原则：

1. **多阶段构建**：编译环境和运行环境分离，减少镜像体积与攻击面；
2. **固定基础镜像版本**：生产不要使用未固定的 `latest`；更严格时固定 digest；
3. **非 root 运行**：配合容器和 Pod 的 `securityContext`；
4. **尽量只读**：不需要写入的根文件系统设为只读；
5. **可复现**：记录依赖锁文件、构建参数、commit SHA 和镜像 digest；
6. **不要把密钥烘焙进镜像**：镜像可能被缓存、复制、扫描和导出；
7. **为目标架构构建**：确认集群节点是 `amd64`、`arm64` 还是混合架构；
8. **不要依赖镜像内的 shell**：distroless 镜像排障应通过日志、ephemeral container 或临时 debug 镜像完成。

如果应用依赖 CGO、字体、时区、CA 证书或动态库，应选择合适的运行时基础镜像，并把这些运行时依赖纳入测试。

### 5.2 `.dockerignore`

```gitignore
.git
.github
.env
.env.*
*.pem
*.key
*.log
tmp/
coverage/
node_modules/
dist/
bin/
```

`.dockerignore` 同时影响构建速度、缓存命中率和敏感文件泄漏风险。它不是安全边界，真正的密钥保护仍应依赖权限、Secret Manager 和扫描策略。

### 5.3 本地构建、运行和验证

```bash
# 构建本地镜像
docker build --tag order-api:dev .

# 直接启动，验证端口、环境变量和健康检查
docker run --rm --name order-api \
  --publish 8080:8080 \
  --env APP_ENV=dev \
  order-api:dev

# 查看镜像元数据与架构
docker image inspect order-api:dev
docker buildx imagetools inspect order-api:dev

# 多架构构建并推送；生产应使用 commit SHA 标签
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag registry.example.com/team/order-api:${GIT_SHA} \
  --push .
```

生产镜像标识建议同时保留：

```text
order-api:1.8.0             # 人类可读的发布版本
order-api:git-<full-sha>    # CI 可追溯标签
order-api@sha256:<digest>   # 部署时真正锁定的不可变制品
```

`latest` 可以作为开发环境便利标签，但不应作为生产部署依据。标签可以被覆盖，digest 才是内容身份。

### 5.4 镜像质量门禁

推送前至少执行：

```bash
# 单元测试与编译
go test ./...
go vet ./...

# 镜像漏洞扫描（示例工具）
trivy image --exit-code 1 --severity HIGH,CRITICAL order-api:${GIT_SHA}

# 生成 SBOM（工具和参数按组织标准）
syft order-api:${GIT_SHA} -o spdx-json > sbom.spdx.json
```

企业进一步会：

- 对基础镜像、操作系统包和第三方依赖设置漏洞阈值；
- 生成 SBOM、provenance/attestation；
- 用 Cosign 等工具签名镜像；
- 在集群准入阶段验证签名和来源；
- 设置镜像保留、清理、回滚版本和跨区域复制策略。

---

## 六、阶段 4：本地用 Docker Compose 联调

Compose 适合把“应用依赖”一次性启动起来，例如数据库、Redis、消息队列和本地对象存储。

```yaml
# compose.yaml（仅示意，生产数据服务不要直接照搬）
services:
  api:
    build:
      context: .
    image: order-api:dev
    environment:
      APP_ENV: dev
      DATABASE_URL: postgres://app:app@postgres:5432/order?sslmode=disable
      REDIS_ADDR: redis:6379
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: order
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d order"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7

volumes:
  postgres-data:
```

```bash
docker compose config
docker compose up --build
docker compose ps
docker compose logs -f api
docker compose down
```

本地 Compose 和生产 K8s 的边界：

- Compose 的网络名通常是 service name；K8s 的服务发现是 `Service` DNS；
- Compose 的 volume 不能直接假设能迁移到云上的持久卷；
- Compose 用于开发体验和依赖联调，不等于生产高可用方案；
- 不要为了让本地 YAML 和生产 YAML 看起来一样，牺牲各自环境的正确性。

---

## 七、阶段 5：CI 流程——从 Pull Request 到镜像仓库

### 7.1 推荐的流水线阶段

```text
Pull Request
  ├─ 格式化、lint、静态检查
  ├─ 单元测试、契约测试、安全测试
  └─ 代码评审与合并门禁
         ↓
主分支提交
  ├─ 构建二进制/前端静态资源
  ├─ 构建多架构 Docker image
  ├─ 漏洞扫描 + SBOM + 签名
  ├─ 推送私有 Registry
  └─ 产出 image digest、测试报告、构建证明
         ↓
部署 Staging
  ├─ 部署同一 digest
  ├─ 迁移（如有）
  ├─ smoke/integration/e2e 测试
  └─ 发布门禁
```

### 7.2 CI 的最小职责

- 任何合并到主分支的代码都必须能追溯到 commit；
- 测试失败、扫描超过阈值或镜像构建失败时不得推送可发布制品；
- CI 使用 OIDC/短期凭证访问云，不在仓库中保存长期 `AWS_ACCESS_KEY_ID`；
- 生产部署使用已在 staging 验证过的同一个 digest，而不是重新构建；
- 每次制品记录：源代码 commit、构建器、基础镜像、依赖锁文件、扫描结果和签名。

一个与 CI 平台无关的伪配置如下：

```yaml
steps:
  - name: test
    run: |
      go test ./...
      go vet ./...

  - name: build-and-push
    run: |
      docker buildx build \
        --platform linux/amd64,linux/arm64 \
        --tag "$REGISTRY/order-api:$GIT_SHA" \
        --push .

  - name: scan-and-attest
    run: |
      trivy image --exit-code 1 --severity HIGH,CRITICAL "$REGISTRY/order-api:$GIT_SHA"
      syft "$REGISTRY/order-api:$GIT_SHA" -o spdx-json > sbom.json
      cosign sign "$REGISTRY/order-api@$IMAGE_DIGEST"

  - name: update-environment-repository
    run: |
      # 只更新 image digest，交由 GitOps controller 部署
      ./scripts/set-image-digest "$IMAGE_DIGEST" environments/staging
```

实际项目还应加入：缓存、并发控制、超时、依赖审计、许可证检查、迁移验证、制品保留和通知。CI 可以由 GitHub Actions、GitLab CI、Jenkins、Tekton 或云厂商流水线实现，原则比工具名称更重要。

### 7.3 镜像仓库设计

常见选择：

| 云/平台 | Registry |
| --- | --- |
| AWS | Amazon ECR |
| GCP | Artifact Registry |
| Azure | Azure Container Registry |
| 自建/混合云 | Harbor、GitLab Container Registry |

企业实践：

- 按团队/领域划分 repository，并通过 IAM/RBAC 限制 push/pull；
- 节点只读拉取，CI 才有 push 权限；
- 私有仓库、跨区域复制和生命周期清理；
- 生产集群配置 `imagePullSecrets` 或云原生节点身份；
- 禁止匿名 pull 私有生产镜像；
- 保存最近若干个可回滚版本，不能只保留最新镜像。

AWS ECR 登录示例（凭证应来自 OIDC 或受控本地 profile）：

```bash
aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
```

---

## 八、阶段 6：先用 IaC 建好云基础设施

### 8.1 云资源的推荐创建顺序

```text
1. 云账号/项目、账单、组织策略、IAM 角色
2. IaC state backend 与锁（例如 S3 + DynamoDB，或云厂商等价能力）
3. VPC/VNet：CIDR、子网、路由、NAT、VPC Endpoint
4. 安全边界：Security Group/Firewall、私有 DNS、审计日志
5. Registry、KMS、Secret Manager、对象存储
6. 托管数据库、缓存、消息队列（跨 AZ、备份、参数组）
7. Kubernetes 控制面与节点池
8. 集群插件：CNI、CoreDNS、CSI、Ingress/LB、DNS、证书、监控
9. Namespace、RBAC、Quota、NetworkPolicy、准入策略
10. 应用与发布流水线
```

用 Terraform/OpenTofu 管理时：

- state 放在远端加密后端，并启用锁；
- 不把 state、计划文件和敏感输出随意上传；
- module、变量和环境目录分层；
- 生产变更要经过 plan、review、审批和审计；
- 资源命名、标签、成本中心、负责人和数据等级统一规范；
- 先创建共享基础设施，再创建环境资源；
- 销毁生产资源必须有额外保护和人工确认。

### 8.2 网络拓扑（以 AWS 为例）

```text
                    Internet
                       │
                Route 53 + ACM
                       │
                 CloudFront/WAF
                       │
                 Public ALB/NLB
                       │
       ┌───────────────┴────────────────┐
       │ VPC（至少 2 个 Availability Zone）│
       │                                 │
       │  Private subnet                 │
       │  ├── EKS worker nodes           │
       │  ├── Pod 网络                    │
       │  └── NAT/VPC Endpoint 出网       │
       │                                 │
       │  Isolated/private data subnet   │
       │  ├── RDS                         │
       │  ├── ElastiCache                 │
       │  └── MQ                          │
       └─────────────────────────────────┘
```

生产默认建议：

- 节点和数据库放私有子网；
- 只让负载均衡器暴露公网；
- 数据库不开放公网地址；
- 用最小化 Security Group/Firewall 规则和 NetworkPolicy；
- 规划 Pod CIDR、VPC CIDR、Service CIDR，避免与办公网、VPN、其他集群冲突；
- 明确 NAT 成本、跨 AZ 流量成本和 VPC Endpoint 的取舍；
- DNS、证书、WAF 和入口由平台统一管理，不让每个服务各自造轮子。

### 8.3 AWS 服务与其他云的概念映射

| 能力 | AWS | GCP | Azure |
| --- | --- | --- | --- |
| 托管 Kubernetes | EKS | GKE | AKS |
| 虚拟机节点 | EC2 | Compute Engine | Virtual Machines |
| 镜像仓库 | ECR | Artifact Registry | ACR |
| 负载均衡 | ALB/NLB | Cloud Load Balancing | Application Gateway/Load Balancer |
| 托管关系库 | RDS/Aurora | Cloud SQL/AlloyDB | Azure Database |
| 对象存储 | S3 | Cloud Storage | Blob Storage |
| 密钥 | Secrets Manager/KMS | Secret Manager/KMS | Key Vault |
| DNS/证书 | Route 53/ACM | Cloud DNS/Certificate Manager | Azure DNS/Managed Certificates |

Kubernetes 清单尽量只表达应用与平台契约；云厂商差异放到 `StorageClass`、Ingress/Gateway 注解、Workload Identity 和 IaC 模块中。

---

## 九、阶段 7：创建 Kubernetes 集群与平台基线

### 9.1 托管集群和自建集群

企业通常优先选择 EKS/GKE/AKS 等托管控制面，把精力放在应用平台和治理上。托管控制面并不等于“无需运维”，仍要负责：

- 节点池、升级、容量和可用区；
- CNI、DNS、CSI、Ingress、监控等插件；
- IAM/RBAC、网络策略、准入策略；
- 版本兼容性和弃用 API；
- 备份、灾备、审计和成本。

自建 control plane 适合有明确合规、离线或基础设施能力的团队，但需要自行维护 etcd、高可用、升级和证书生命周期。

### 9.2 节点池规划

不要只创建一个“万能节点池”。可以按工作负载分层：

| 节点池 | 用途 | 常见策略 |
| --- | --- | --- |
| general/on-demand | 核心 API、平台组件 | 跨 AZ、稳定容量 |
| memory/compute optimized | 特殊资源型服务 | node label + affinity |
| spot/preemptible | 可中断批处理、异步任务 | toleration、可重试 |
| gpu | AI 训练/推理 | taint、GPU device plugin |
| system | CoreDNS、监控、Ingress | 为系统组件预留资源 |

节点要预留 OS、`kubelet`、容器运行时、CNI、日志和监控的资源。调度依据应看 `Allocatable`，不能把 `Capacity` 全部当作业务容量。

### 9.3 集群基础插件

按组织标准选择并固定版本，常见能力包括：

- **CNI**：Pod 网络和 NetworkPolicy；
- **CoreDNS**：集群服务发现；
- **kube-proxy 或等价数据面**：Service 转发；
- **CSI driver**：EBS/EFS、Persistent Disk、Azure Disk 等存储；
- **Cloud Load Balancer Controller**：把 Service/Ingress 对接云 LB；
- **Metrics Server**：HPA 基础指标；
- **Prometheus/Grafana/OpenTelemetry**：指标、日志和链路；
- **External DNS / cert-manager**：DNS 记录和证书自动化；
- **External Secrets/Secrets Store CSI**：对接 Secret Manager；
- **Cluster Autoscaler/Karpenter**：节点自动扩容；
- **Policy engine**：Kyverno、OPA Gatekeeper 等准入治理。

插件本身也是生产软件，需要镜像扫描、版本升级、资源限制、变更窗口和回滚方案。

### 9.4 平台基线

新环境创建后先做：

```bash
kubectl get nodes -o wide
kubectl get pods -A
kubectl get storageclass
kubectl get ingressclass
kubectl get crd
```

然后统一配置：

- Namespace 与 owner/team 标签；
- RBAC 和云身份映射（AWS IRSA、GCP Workload Identity、Azure Workload Identity）；
- `ResourceQuota`、`LimitRange` 和默认资源；
- Pod Security Admission（至少 `baseline`，生产敏感命名空间逐步 `restricted`）；
- 默认拒绝的 NetworkPolicy；
- 审计日志、成本标签和环境标签；
- 节点升级、驱逐、PodDisruptionBudget 和容量预留策略。

---

## 十、阶段 8：编写 Kubernetes 部署清单

以下示例展示一个无状态 `order-api` 服务的最小生产骨架。资源数值、域名、镜像 digest、探针路径和入口类都要按项目验证，**不能机械复制**。

### 10.1 Namespace、ServiceAccount 与 ConfigMap

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: order-prod
  labels:
    environment: prod
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: order-api
  namespace: order-prod
  annotations:
    # AWS EKS 示例；GKE/AKS 使用对应 Workload Identity 注解
    eks.amazonaws.com/role-arn: arn:aws:iam::<account>:role/order-api-prod
automountServiceAccountToken: false
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-api-config
  namespace: order-prod
data:
  APP_ENV: prod
  HTTP_PORT: "8080"
  LOG_FORMAT: json
  LOG_LEVEL: info
```

如果应用不调用云 API，可以去掉 IAM 注解并保持 `automountServiceAccountToken: false`。需要访问 S3、SQS 等服务时，应授予工作负载身份最小权限，而不是把云访问密钥写进 Secret 或镜像。

### 10.2 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: order-prod
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/part-of: order-platform
    app.kubernetes.io/managed-by: gitops
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 600
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-api
        app.kubernetes.io/part-of: order-platform
    spec:
      serviceAccountName: order-api
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: order-api
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: order-api
      containers:
        - name: order-api
          # 生产发布锁定 digest；不要只写 latest 或可变 tag
          image: <account>.dkr.ecr.<region>.amazonaws.com/order-api@sha256:<digest>
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          envFrom:
            - configMapRef:
                name: order-api-config
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: order-api-secrets
                  key: database-url
            - name: REDIS_ADDR
              valueFrom:
                secretKeyRef:
                  name: order-api-secrets
                  key: redis-addr
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 512Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          startupProbe:
            httpGet:
              path: /health/startup
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health/live
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir:
            medium: Memory
            sizeLimit: 64Mi
```

关键点：

- `requests` 是调度依据，`limits` 是运行上限；内存超过 limit 可能 `OOMKilled`，CPU 超限通常被 throttling；
- `readinessProbe` 失败会让 Pod 暂停接收流量，`livenessProbe` 失败才会触发重启；
- `startupProbe` 保护启动较慢的服务；
- `maxUnavailable: 0` 适合希望发布期间保持容量的 API，但会增加临时资源需求；
- `topologySpreadConstraints` 让副本尽量分散到节点/可用区；开发环境节点少时可以改为 `ScheduleAnyway`；
- `readOnlyRootFilesystem` 要求应用不要往根目录写文件；确需临时写入时挂载 `emptyDir`；
- 优雅退出依赖应用处理 `SIGTERM`，不是只依赖探针或 `sleep`；
- `imagePullPolicy`、资源值和副本数应通过环境 overlay 管理。

### 10.3 Service 与 Ingress

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: order-prod
  labels:
    app.kubernetes.io/name: order-api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-api
  namespace: order-prod
  annotations:
    # 若使用 AWS Load Balancer Controller，可改为 alb 并配置相应 annotations
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: api-example-com-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: order-api
                port:
                  name: http
```

生产上可以用 Kubernetes Ingress，也可以采用 Gateway API。入口控制器负责把声明转换成云负载均衡器或集群内代理；需要明确 TLS 在 CDN、LB、Ingress 哪一层终止，以及到 Pod 是否继续使用 mTLS。

### 10.4 HPA 与 PDB

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-api
  namespace: order-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-api
  minReplicas: 3
  maxReplicas: 20
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: order-api
  namespace: order-prod
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
```

- **HPA**扩缩 Pod；**Cluster Autoscaler/Karpenter**扩缩 Node；二者需要一起规划；
- CPU/内存并不总是最好的业务指标，队列长度、并发数、请求延迟或吞吐量可能更适合；
- HPA 依赖 metrics-server 或自定义指标适配器；
- PDB 保护自愿驱逐（节点升级、维护）时的最低可用副本，不能防止节点突然断电；
- `minAvailable`、副本数和跨 AZ 策略必须结合容量和成本压测。

### 10.5 NetworkPolicy（默认拒绝再按需放行）

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: order-api-default-deny
  namespace: order-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: order-api-allow
  namespace: order-prod
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: order-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

这只是示例。真实环境还要放行到数据库、缓存、消息队列、云 API endpoint 等必要目的地，并确认所用 CNI 真正支持 NetworkPolicy。

### 10.6 Secret 的生产处理方式

开发环境可以用临时 Secret 验证清单：

```bash
kubectl -n order-prod create secret generic order-api-secrets \
  --from-literal=database-url='postgres://...' \
  --from-literal=redis-addr='redis.internal:6379'
```

但这条命令的参数会进入 shell history，在生产不推荐。生产应采用：

```text
云 Secret Manager / Vault
          ↓（External Secrets / CSI / Workload Identity）
Kubernetes Secret 或只读挂载文件
          ↓
Pod 通过 secretKeyRef / volume 使用
```

密钥轮换后要确认应用能否热加载；如果只能启动时读取，就需要受控滚动重启，并避免所有副本同时重启。

---

## 十一、阶段 9：部署工具与配置管理

### 11.1 原生 YAML、Kustomize 和 Helm

| 方式 | 优点 | 风险/适用边界 |
| --- | --- | --- |
| 原生 YAML | 直观、依赖少 | 多环境重复、参数替换容易失控 |
| Kustomize | 原生集成、overlay 清晰 | 复杂模板逻辑不如 Helm 灵活 |
| Helm | 参数化、依赖和版本管理成熟 | 模板过度复杂时难读、渲染结果需审查 |
| GitOps controller | 持续对账、审计、自动回滚/同步 | 需要理解权限、漂移和控制器故障 |

常用 Kustomize 结构：

```text
deploy/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   └── service.yaml
└── overlays/
    ├── dev/kustomization.yaml
    ├── staging/kustomization.yaml
    └── prod/kustomization.yaml
```

`base` 放通用配置，`overlay` 只修改环境差异，例如 namespace、replicas、资源、域名、镜像 digest 和副本分布。无论采用哪种工具，发布前都要检查最终渲染结果：

```bash
kubectl kustomize deploy/overlays/staging > /tmp/order-api-staging.yaml
kubectl diff -f /tmp/order-api-staging.yaml
```

### 11.2 推荐 GitOps 模型

```text
应用仓库
  └── CI 构建并推送 image@digest
                    ↓
环境配置仓库（Helm values/Kustomize overlay）
  └── PR 修改 image digest
                    ↓
Argo CD / Flux 观察 Git
  └── 对集群执行同步并持续纠偏
                    ↓
Kubernetes API Server
```

GitOps 的核心不是“自动点一下部署”，而是：

- Git 是期望状态和变更审计源；
- 集群状态与 Git 不一致时可以被发现和纠正；
- 生产权限集中在 controller/发布系统，而不是给每个开发者长期 cluster-admin；
- 回滚是恢复环境仓库的上一提交或上一 digest；
- 应急手工变更必须记录，并尽快回写 Git，避免漂移。

### 11.3 直接 CD 与 GitOps 的选择

- 小团队、环境少：CI 直接执行 `helm upgrade` 或 `kubectl apply` 可以先跑通；
- 多团队、多集群、需要审计和持续纠偏：优先 GitOps；
- 无论选择哪种方式，都不要把生产 kubeconfig 和高权限 token 放在开发者电脑或普通 CI 日志中。

---

## 十二、阶段 10：发布策略——滚动、蓝绿、金丝雀与回滚

### 12.1 滚动发布（默认起点）

Deployment 会逐步创建新 ReplicaSet、等待新 Pod Ready，再缩减旧 ReplicaSet。发布前：

```bash
kubectl -n order-prod diff -k deploy/overlays/prod
kubectl -n order-prod apply -k deploy/overlays/prod
kubectl -n order-prod rollout status deployment/order-api --timeout=10m
kubectl -n order-prod get pods -l app.kubernetes.io/name=order-api -o wide
```

发布后至少检查：

- `Available/Ready` 副本是否达到预期；
- Service endpoints 是否存在；
- 入口返回码、P50/P95/P99 延迟、错误率；
- CPU、内存、重启数、OOM 和下游依赖；
- 关键业务指标，如下单成功率、支付回调成功率、消息堆积。

### 12.2 蓝绿发布

同时维护 `blue` 和 `green` 两套版本，通过 Service selector、Ingress 或云 LB 切换流量。优点是切换和回退快，代价是短时间需要双倍容量，并要处理数据库兼容性。

### 12.3 金丝雀发布

先给新版本少量流量或少量用户，观察技术和业务指标，再逐步放量。可以用 Ingress/LB 权重、Argo Rollouts、服务网格或业务路由实现。金丝雀的门禁不能只看 Pod Ready，还应看：

- 5xx、超时和延迟分位数；
- 关键接口成功率；
- 订单/支付等业务转化；
- 下游错误和队列堆积；
- 资源异常和日志错误率。

### 12.4 回滚

```bash
# 查看历史
kubectl -n order-prod rollout history deployment/order-api

# 回滚到上一版本
kubectl -n order-prod rollout undo deployment/order-api

# 回滚到指定 revision
kubectl -n order-prod rollout undo deployment/order-api --to-revision=<revision>

# 查看回滚结果
kubectl -n order-prod rollout status deployment/order-api --timeout=10m
```

> **回滚陷阱**：应用可以回滚，不代表数据库 schema 可以回滚。优先采用向后兼容的 expand/contract migration；必要时使用“前滚修复”而不是盲目恢复旧二进制。

### 12.5 发布前后的数据库迁移顺序

```text
1. 评估锁表、耗时、容量、回滚/前滚方案
2. 在 staging 使用生产规模近似数据演练
3. 执行向后兼容的 expand migration
4. 确认旧版本和新版本都能工作
5. 发布应用
6. 观察指标与业务结果
7. 完成回填后再 contract migration
```

迁移任务必须有超时、互斥锁、审计输出和失败告警；不要让每个副本争抢执行同一迁移。

---

## 十三、阶段 11：自动扩缩容与调度

### 13.1 Pod 扩容和 Node 扩容是两层系统

```text
流量/队列上升
      ↓
HPA 或 KEDA 增加 Pod
      ↓
若现有节点放不下，Pod Pending
      ↓
Cluster Autoscaler / Karpenter 增加节点
      ↓
Node Ready 后 Scheduler 重新调度
```

- HPA：改变 Deployment/StatefulSet 的副本数；
- KEDA：可按 MQ 队列、事件等外部指标扩缩；
- Cluster Autoscaler/Karpenter：改变节点数量或节点类型；
- VPA：调整 requests/limits，生产使用前要理解其驱逐和与 HPA 的冲突。

### 13.2 requests/limits 的容量规划

```text
节点可调度总量 ≈ Node Allocatable
业务所需容量 ≈ Σ(每个 Pod 的 requests × 副本数)
所需节点数 ≈ 业务容量 ÷ 单节点可用容量 + 故障/升级余量
```

不要只看实时 CPU 使用率：调度器主要看 `requests`。`requests` 写得过小会导致超卖和争抢，写得过大则导致 Pending 和成本浪费。应结合压测、历史 P95/P99、CPU throttling、内存峰值和 OOM 反复校准。

### 13.3 调度约束

- `nodeSelector`：简单的节点标签选择；
- `nodeAffinity`：更灵活的硬/软约束；
- `taints/tolerations`：专用节点隔离；
- `topologySpreadConstraints`：跨节点/可用区分散副本；
- `podAntiAffinity`：避免同类副本集中；
- `PriorityClass`：资源紧张时区分重要性。

`replicas: 3` 只表示期望有三个副本，不自动保证它们在三台节点或三个可用区。高可用必须显式设计分布约束和容量余量。

---

## 十四、阶段 12：可观测性、SLO 与日常运维

### 14.1 三类信号

| 信号 | 采集内容 | 用途 |
| --- | --- | --- |
| Metrics | QPS、错误率、延迟、CPU、内存、重启、队列 | 告警、容量和 HPA |
| Logs | 结构化应用日志、审计日志、容器事件 | 排障、审计、合规 |
| Traces | 请求跨服务、数据库和 MQ 的 trace | 定位慢调用和依赖瓶颈 |

建议从 SLO 反推告警：例如可用性、错误预算、P95 延迟、消息处理延迟，而不是对每个 CPU 波动都发告警。

### 14.2 常用排障命令

```bash
# 工作负载总览
kubectl -n order-prod get deploy,rs,pod,svc,ingress
kubectl -n order-prod get pods -o wide

# 事件按时间排序
kubectl -n order-prod get events --sort-by=.lastTimestamp

# Pod 详情、调度失败和探针错误
kubectl -n order-prod describe pod <pod-name>

# 当前与上一次容器日志
kubectl -n order-prod logs <pod-name> -c order-api --tail=200
kubectl -n order-prod logs <pod-name> -c order-api --previous --tail=200

# 资源使用与 HPA
kubectl top pods -n order-prod
kubectl top nodes
kubectl -n order-prod get hpa
kubectl -n order-prod describe hpa order-api

# Service 是否有可用后端
kubectl -n order-prod get endpointslice -l kubernetes.io/service-name=order-api

# 发布状态和镜像
kubectl -n order-prod rollout status deployment/order-api
kubectl -n order-prod rollout history deployment/order-api
kubectl -n order-prod get deployment order-api -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

### 14.3 故障速查表

| 现象 | 常见原因 | 排查顺序 |
| --- | --- | --- |
| `Pending` | requests 过大、节点不足、taint/affinity、Quota | `describe pod` → Events → `describe node` → 检查扩容器 |
| `ImagePullBackOff` | 镜像名/digest 错、仓库权限、节点无出网 | `describe pod` → Registry → imagePull 身份/网络 |
| `CrashLoopBackOff` | 启动命令、配置、依赖、程序 panic | `logs --previous` → Events → 本地同镜像复现 |
| `OOMKilled` | 内存 limit 太小、泄漏、流量突增 | `describe pod` → 指标 → heap/profile → 调整代码/容量 |
| Readiness 失败 | 端点错误、启动慢、下游策略过严 | `describe` → 从 Pod 内 curl → 检查 Service endpoints |
| 502/503/504 | selector/port 不匹配、无 Ready 后端、LB/Ingress 超时 | Ingress → Service → EndpointSlice → Pod |
| DNS 失败 | CoreDNS、NetworkPolicy、域名或 VPC DNS | Pod 内 `nslookup` → CoreDNS logs → 网络策略 |
| 发布卡住 | 新 Pod 不 Ready、容量不足、PDB/配额 | `rollout status` → Events → HPA/Node → 回滚 |
| Pod 反复重启 | liveness 过严、依赖雪崩、节点压力 | 区分应用退出、探针杀死、节点驱逐 |

不要只执行 `kubectl delete pod` 让问题暂时消失。先保存事件、日志、版本和指标，再判断是应用、配置、镜像、权限、网络还是节点问题。

---

## 十五、阶段 13：安全、合规与供应链

### 15.1 身份和权限

- 云账号、CI、集群控制面、节点和工作负载使用不同身份；
- CI 通过 OIDC 获取短期云凭证；
- 开发者默认只读或命名空间级权限，禁止日常使用 `cluster-admin`；
- AWS 使用 IRSA，GKE/AKS 使用对应 Workload Identity；
- ServiceAccount token 不需要时关闭自动挂载；
- 数据库、对象存储、队列按服务拆分最小权限和资源策略；
- 生产权限有审批、过期时间、审计和 break-glass 流程。

### 15.2 镜像与运行时

- 使用可信基础镜像和锁定版本；
- CI 做依赖、OS 包和镜像扫描；
- 生成 SBOM 和 provenance；
- 对镜像签名，并在准入阶段验证来源；
- 非 root、禁止 privilege escalation、drop Linux capabilities、默认 seccomp；
- 能只读根文件系统就只读；
- 禁止在生产容器中使用调试 shell、编译器和不必要的包；
- 定期重建基础镜像，即使业务代码没有改动。

### 15.3 网络与数据

- 公网只暴露 CDN/WAF/LB，节点和数据层放私网；
- Security Group/Firewall 与 NetworkPolicy 两层都做最小授权；
- 服务间敏感通信使用 TLS/mTLS；
- 数据库加密、密钥轮换、备份和恢复演练；
- 生产日志脱敏，禁止输出密码、token、完整身份证/银行卡等敏感数据；
- 开启云审计、Kubernetes audit 和关键操作告警。

---

## 十六、阶段 14：备份、灾备与容量

高可用不等于灾备，Pod 自动重建也不等于数据可恢复。至少定义：

- **RPO**：最多能接受丢失多久的数据；
- **RTO**：故障后多久恢复服务；
- 单 AZ、单区域、跨区域故障的处理策略；
- 数据库 PITR、快照、备份保留期和加密；
- 对象存储版本化、生命周期和跨区域复制；
- 队列消息的保留、重放和死信；
- Kubernetes 清单、Helm chart、Terraform 模块和配置仓库的备份；
- 恢复演练记录，而不是只保存“备份成功”日志。

生产发布前应知道：

```text
如果一个节点消失，服务能否继续？
如果一个 AZ 消失，服务能否继续？
如果镜像仓库短暂不可用，已有 Pod 能否运行和扩容？
如果数据库误删，能否在目标 RTO 内恢复？
如果新版本有 bug，是否能在业务指标报警后快速回滚？
```

---

## 十七、完整实战流程：从新功能到生产

下面把前面的内容串成一条团队可执行的 SOP。

### Step 1：开发与本地验证

```bash
git checkout -b feature/order-api
go test ./...
docker compose up --build
docker compose ps
curl -fsS http://localhost:8080/health/ready
```

开发者确认：接口、依赖、迁移、日志和健康检查都能在本地工作；不把生产密钥复制到本地仓库。

### Step 2：Pull Request 门禁

代码平台触发 lint、单元测试、集成测试、SAST、依赖扫描和评审。PR 不直接改生产集群，不能绕过必需检查。

### Step 3：构建并推送不可变镜像

```bash
export IMAGE=<account>.dkr.ecr.<region>.amazonaws.com/order-api
export TAG=git-$(git rev-parse HEAD)

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$IMAGE:$TAG" \
  --push .

# 在 CI 中取得 digest，并把 digest 写入发布配置
# $IMAGE@sha256:<digest>
```

扫描、SBOM、签名和构建证明全部通过后，才把 digest 标记为可发布。

### Step 4：准备/变更云基础设施

如果是首次部署或基础设施变更：

```bash
terraform fmt -check
terraform validate
terraform plan -var-file=envs/staging.tfvars
# 通过 review/审批后才 apply
terraform apply -var-file=envs/staging.tfvars
```

真实命令可能是 OpenTofu、Pulumi、CloudFormation 或云厂商平台，但原则都是先 plan、审查影响，再变更。

### Step 5：部署到 Staging

```bash
kubectl config current-context
kubectl -n order-staging diff -k deploy/overlays/staging
kubectl -n order-staging apply -k deploy/overlays/staging
kubectl -n order-staging rollout status deployment/order-api --timeout=10m
```

或者由 Argo CD/Flux 监听环境仓库自动同步。应用和迁移的顺序必须在流水线中显式定义。

### Step 6：验证 Staging

```bash
kubectl -n order-staging get pods -o wide
kubectl -n order-staging get svc,ingress
kubectl -n order-staging get endpointslice -l kubernetes.io/service-name=order-api
curl -fsS https://staging-api.example.com/health/ready
```

执行 smoke、契约、集成、e2e、压测或回归测试，并检查指标、日志、链路和业务数据。

### Step 7：晋级同一个制品到 Production

不要重新构建。把 staging 已验证的 `image@sha256:<digest>` 通过审批晋级到生产 overlay：

```bash
# 伪命令：实际由环境仓库 PR 或发布系统执行
./scripts/promote-image \
  --from staging \
  --to prod \
  --image "$IMAGE@sha256:<verified-digest>"
```

生产发布门禁通常包括：变更单、审批、值班人、容量检查、数据库兼容性、备份状态和回滚命令。

### Step 8：渐进发布与业务验收

- 先滚动更新或金丝雀少量副本；
- 观察一段稳定窗口；
- 对比新旧版本错误率、延迟、资源和业务成功率；
- 通过自动门禁后继续放量；
- 发布完成后保留旧 ReplicaSet 和镜像版本，直到超过回滚窗口。

### Step 9：发布后收尾

- 把实际版本、digest、变更号和结果写入发布记录；
- 关闭临时调试权限；
- 更新运行手册、SLO、仪表盘和告警；
- 复盘异常和成本；
- 定期清理过期镜像、旧 namespace、无主资源和临时权限。

---

## 十八、企业环境的职责分工

| 角色 | 主要职责 |
| --- | --- |
| 开发团队 | 应用代码、Dockerfile、健康检查、资源基线、服务级 dashboard/runbook |
| 平台/DevOps | 集群、网络、CI/CD、镜像仓库、集群插件、权限和公共能力 |
| SRE | SLO、容量、可靠性、演练、事故响应、发布策略和复盘 |
| 安全/合规 | IAM、供应链、镜像策略、审计、漏洞和数据保护要求 |
| DBA/数据平台 | 托管数据库、迁移、备份、恢复、容量和数据权限 |
| 业务/产品 | 验收指标、灰度范围、变更窗口和业务回滚决策 |

小团队可以由同一个人兼任多个角色，但职责和审批边界仍应写清楚，不能靠“大家都知道”。

---

## 十九、生产上线检查清单

### 应用与镜像

- [ ] 应用不依赖本地持久状态，能处理 `SIGTERM`；
- [ ] `startup/readiness/liveness` 语义正确，且在压测中验证过；
- [ ] 日志写 stdout/stderr，含版本和 trace/request id；
- [ ] Dockerfile 多阶段构建、非 root、无不必要工具；
- [ ] `.dockerignore` 不会把密钥和无关大文件送入构建上下文；
- [ ] 镜像使用 commit SHA/digest，已扫描、生成 SBOM 并签名；
- [ ] 已验证 `amd64/arm64` 与节点架构兼容。

### 云基础设施

- [ ] 生产使用独立账号/项目或至少独立权限与网络；
- [ ] VPC、子网、路由、NAT/VPC Endpoint、DNS 和防火墙经过评审；
- [ ] 节点和数据库默认私网，公网只暴露必要入口；
- [ ] RDS/Cloud SQL、Redis、MQ、对象存储的备份、加密和恢复已验证；
- [ ] Registry、KMS、Secret Manager、审计日志和成本标签已配置；
- [ ] IaC state 远端加密并锁定，变更有 plan 和审批。

### Kubernetes

- [ ] 集群版本、节点池、可用区、容量和升级策略明确；
- [ ] CNI、CSI、CoreDNS、Ingress/LB、Metrics、监控和 Secret 集成健康；
- [ ] Namespace、RBAC、Quota、LimitRange、Pod Security、NetworkPolicy 已配置；
- [ ] Deployment 有 requests/limits、滚动策略、副本、探针和优雅退出；
- [ ] 关键副本跨节点/可用区，PDB 与容量规划匹配；
- [ ] HPA 与节点自动扩容联动，且有业务指标/告警；
- [ ] 数据库不因 Pod 重启丢失，StatefulSet 使用前经过专项评审。

### 发布与运维

- [ ] staging 已验证同一镜像 digest；
- [ ] 数据库 migration 可审计、幂等、向后兼容并演练过；
- [ ] 有滚动/蓝绿/金丝雀策略、发布门禁和明确回滚命令；
- [ ] SLO、指标、日志、trace、告警、值班和 runbook 已就绪；
- [ ] RPO/RTO、备份恢复和多 AZ/多区域方案明确；
- [ ] 发布后有人观察稳定窗口，结果写入变更记录。

---

## 二十、最容易混淆的概念

| 误解 | 正确理解 |
| --- | --- |
| Docker 就是 Kubernetes | Docker 负责容器构建/运行，K8s 负责集群编排 |
| Pod 就是一台机器 | Pod 是调度单元，运行在 Node 上 |
| `replicas: 3` 就是高可用 | 还要跨节点/AZ、配置 PDB、探针和容量余量 |
| HPA 会自动增加服务器 | HPA 扩 Pod，节点要由 Cluster Autoscaler/Karpenter 等扩容 |
| `Secret` 的 base64 就是加密 | base64 不是加密；要用 Secret Manager/KMS/RBAC |
| 镜像 tag 固定了版本 | 可变 tag 仍可能被覆盖，生产锁定 digest |
| Pod 重启会恢复数据库 | 重启只恢复进程，不会自动恢复数据、备份或一致性 |
| liveness 检查数据库越严格越好 | 可能把下游故障放大成全量重启，应区分 readiness 和降级 |
| 上了 K8s 就是云原生 | 云原生还包括自动化、弹性、声明式、可观测和治理 |
| 托管 K8s 等于不用运维 | 节点、插件、权限、成本、升级和灾备仍需负责 |

---

## 二十一、推荐的学习与落地顺序

如果是从零搭建企业级流程，不建议一开始就同时引入所有工具，可以分层验收：

```text
第 1 步：Dockerfile + docker build/run
  ↓
第 2 步：Compose 启动应用与本地依赖
  ↓
第 3 步：私有 Registry + CI 自动构建/扫描/推送
  ↓
第 4 步：本地 kind/minikube 或共享测试集群部署 Deployment/Service
  ↓
第 5 步：托管 K8s + 云 LB + 私有网络
  ↓
第 6 步：Config/Secret、探针、资源、HPA、PDB、NetworkPolicy
  ↓
第 7 步：IaC 管理云资源，Helm/Kustomize 管理应用配置
  ↓
第 8 步：GitOps、金丝雀、签名准入、SLO 与灾备演练
```

每一步都要有可观察的验收标准：能构建、能运行、能发布、能发现故障、能回滚、能恢复数据，而不是只看命令是否返回 0。

---

## 二十二、官方资料与进一步阅读

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- [Kubernetes Workloads](https://kubernetes.io/docs/concepts/workloads/)
- [Kubernetes Services, Load Balancing, and Networking](https://kubernetes.io/docs/concepts/services-networking/)
- [Kubernetes Configuration](https://kubernetes.io/docs/concepts/configuration/)
- [Kubernetes Security](https://kubernetes.io/docs/concepts/security/)
- [Kubernetes Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Amazon EKS User Guide](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html)
- [Amazon ECR User Guide](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html)
- [Terraform documentation](https://developer.hashicorp.com/terraform/docs)
- [Argo CD documentation](https://argo-cd.readthedocs.io/)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [SLSA framework](https://slsa.dev/)
- [Sigstore Cosign](https://docs.sigstore.dev/cosign/)

---

## 最后总结

企业使用 Docker、Kubernetes 和云服务的本质，是把一次“登录服务器部署程序”的动作，升级为一条可重复的工程系统：

```text
代码可测试
  → 镜像可复现
  → 制品可追溯
  → 基础设施可声明
  → 集群状态可对账
  → 发布可渐进
  → 故障可观测
  → 版本可回滚
  → 数据可恢复
```

如果只记住一条实践：**构建一次、扫描一次、签名一次，使用同一个不可变 digest 从开发逐级晋级到生产；基础设施和部署配置全部进入 Git，并让自动化系统负责验证、发布、观测和回滚。**

---

#Docker #Kubernetes #云原生 #EKS #容器化 #CI/CD #GitOps #Terraform #可观测性 #DevOps
