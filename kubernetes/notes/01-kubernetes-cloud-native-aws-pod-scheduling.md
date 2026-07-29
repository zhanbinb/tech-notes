# Kubernetes、云原生与 AWS：从容器部署到 Pod 调度

> Docker 解决应用的容器化与运行，Kubernetes 解决多节点上的容器编排；在 AWS EKS 中，Pod 通常由 Kubernetes 调度到 EC2 工作节点上运行。

## 核心结论

- **Docker** 负责构建和运行容器；**Kubernetes（K8s）**负责在集群中调度、扩缩容、恢复和发布容器应用。
- **云原生（Cloud Native）**是一套架构理念和技术体系，K8s 是其中的重要技术，但二者不等价。
- **AWS EC2** 提供虚拟机计算资源；**EKS** 是 AWS 托管的 Kubernetes；EKS 的工作节点通常是 EC2，也可以使用 Fargate。
- Pod 不等于虚拟机。Pod 运行在 Node 上，一个 Node 通常可以运行多个 Pod。
- 部署 Pod 时必须重点关注 `requests`、`limits`、副本分布、健康检查和节点类型。

## 一、Docker 为什么不能完全替代 Kubernetes

单机或小型项目可以直接使用 Docker Compose：

```yaml
services:
  web:
    image: example/web:v1
    ports:
      - "8080:8080"
  redis:
    image: redis:7
```

当系统进入多机、多实例、高可用场景后，还需要解决：

- 容器或服务器故障后的自动恢复；
- 多台服务器之间的自动调度；
- 服务发现与负载均衡；
- 自动扩缩容；
- 滚动发布与回滚；
- 配置、密钥、存储和权限的集中管理；
- 多副本跨节点、跨可用区分布。

K8s 的核心价值是持续协调“期望状态”和“实际状态”。例如声明 `replicas: 3` 后，K8s 会尽量维持 3 个 Pod 实例运行。

### 什么时候 Docker Compose 就够了

- 单台或少量服务器；
- 服务数量少、流量稳定；
- 可以接受人工维护和短暂停机；
- 团队没有 K8s 运维经验。

不要为了“云原生”强行引入 K8s。只有人工管理容器的成本超过维护 K8s 的成本时，K8s 才真正有价值。

## 二、Kubernetes、云原生与 AWS 的关系

三者处于不同层次：

```text
云原生：架构理念与技术体系
├── 容器、微服务、CI/CD、GitOps
├── 弹性、自愈、可观测性、声明式管理
└── Kubernetes：容器编排平台之一

AWS：云服务提供商
├── EC2：虚拟机
├── EKS：托管 Kubernetes
├── ECS：AWS 原生容器编排
├── Fargate：无服务器容器计算
└── Lambda：无服务器函数
```

仅把传统应用手工部署到 EC2，通常只是 **Cloud Hosted**；如果应用充分使用自动化交付、弹性、自愈、托管服务和可观测性，才更符合 **Cloud Native**。

不用 K8s 也可以实现云原生，例如：

```text
API Gateway → Lambda → DynamoDB → SQS/EventBridge
```

反过来，仅把单体应用打包后放进 K8s，也不代表它已经云原生。

## 三、Pod 最终运行在哪里

K8s 把提供 CPU、内存、网络并运行 Pod 的机器称为 **Node**。Node 可以是：

- AWS EC2 等云虚拟机；
- 物理服务器；
- 本地虚拟机；
- AWS Fargate 等托管计算环境。

在 EKS 中常见的层级是：

```text
AWS EKS 集群
├── Kubernetes 控制面：AWS 管理
└── 工作节点
    ├── EC2 Node 1
    │   ├── Pod A
    │   └── Pod B
    └── EC2 Node 2
        ├── Pod C
        └── Pod D
```

注意：

- 一个 Pod 同一时刻只运行在一个 Node 上；
- 一个 Node 可以运行多个 Pod；
- 同一 Pod 内的容器共享网络命名空间，并运行在同一个 Node；
- Node 故障后，原 Pod 不会“迁移”，控制器会在其他可用 Node 上创建替代 Pod。

## 四、Pod 部署时最关键的资源配置

生产环境应显式配置资源请求和上限：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order-service
          image: example/order-service:v1
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
```

### `requests`：调度依据

```yaml
requests:
  cpu: "500m"
  memory: "512Mi"
```

表示调度器需要找到至少还能承载 0.5 核 CPU、512 MiB 内存的节点。

```text
1000m CPU = 1 核
500m CPU  = 0.5 核
```

调度器依据的是各 Pod 的 `requests` 总量与 Node 的 `Allocatable`，而不是简单依据当时的实时 CPU 使用率。

### `limits`：运行上限

```yaml
limits:
  cpu: "1"
  memory: "1Gi"
```

- CPU 超过 limit：通常被限速（throttling）；
- 内存超过 limit：可能被终止，状态显示 `OOMKilled`。

不设置资源请求会让调度器难以合理放置 Pod，也容易造成节点过度分配和资源争抢。配置值应根据压测和监控中的平均值、P95/P99、峰值、CPU throttling 和 OOM 情况逐步调整。

## 五、Node / EC2 配置也必须考虑

Pod 的资源最终来自 Node。选择 EC2 规格时，需要考虑：

- CPU、内存；
- 最大 Pod 数和可用 IP；
- 网络和磁盘性能；
- GPU 等特殊硬件；
- On-Demand、Spot 的成本与中断风险；
- 可用区分布。

EC2 的全部资源不能都分给业务 Pod，因为还要运行操作系统、`kubelet`、容器运行时、网络插件、监控和日志组件。因此调度时应看 `Allocatable`，而不只是 `Capacity`。

常用命令：

```bash
kubectl get nodes
kubectl describe node <node-name>
kubectl top nodes
kubectl get pods -o wide
kubectl top pods -n <namespace>
kubectl describe pod <pod-name>
```

如果资源不足，Pod 会处于 `Pending`，事件中可能出现：

```text
0/3 nodes are available: 3 Insufficient cpu
```

## 六、指定 Pod 运行在特定节点

可以通过标签和 `nodeSelector` 让工作负载选择节点类型：

```yaml
spec:
  nodeSelector:
    workload: gpu
```

对于 GPU 等专用、昂贵的节点，通常结合 taint/toleration，防止普通 Pod 被调度进去：

```yaml
spec:
  nodeSelector:
    workload: gpu
  tolerations:
    - key: dedicated
      operator: Equal
      value: gpu
      effect: NoSchedule
```

常见 EKS Node Group 可以按工作负载划分：

- 通用型节点：Web/API；
- 内存型节点：Java、大缓存应用；
- GPU 节点：AI 训练或推理；
- Spot 节点：可中断批处理任务；
- On-Demand 节点：核心服务。

## 七、多副本不一定自动跨节点

`replicas: 3` 只保证期望有 3 个副本，不绝对保证分布在 3 台机器上。为了避免单节点故障影响全部副本，可配置拓扑分布约束：

```yaml
spec:
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app: order-service
```

按节点分散使用：

```yaml
topologyKey: kubernetes.io/hostname
```

按 AWS 可用区分散使用：

```yaml
topologyKey: topology.kubernetes.io/zone
```

## 八、Pod 扩容与 Node 扩容不是一回事

```text
业务流量上升
  ↓
HPA 增加 Pod 副本
  ↓
现有 Node 资源不足，Pod Pending
  ↓
Cluster Autoscaler / Karpenter 创建 EC2
  ↓
新节点加入集群，Scheduler 调度 Pod
```

- **HPA**：增加或减少 Pod；
- **Cluster Autoscaler / Karpenter**：增加或减少 Node/EC2。

只有 HPA 而没有节点扩容能力时，新增 Pod 可能因集群容量不足一直处于 `Pending`。

## 九、生产部署检查清单

- [ ] 为容器设置合理的 `requests` 和 `limits`；
- [ ] 配置 `readinessProbe` 和 `livenessProbe`；
- [ ] 根据吞吐量和可用性设置副本数；
- [ ] 让关键副本跨 Node、跨可用区分布；
- [ ] 为 GPU、Spot 等节点配置 selector、affinity 或 taint/toleration；
- [ ] 监控 CPU、内存、OOM、throttling 和 Pending Pod；
- [ ] 明确 HPA 与节点自动扩容的配合方式；
- [ ] 数据库等有状态组件优先评估 RDS 等托管服务，而非默认全部部署进 K8s；
- [ ] 评估 K8s 的复杂度是否真的适合当前系统规模。

## 选择建议

| 场景 | 更适合的方案 |
| --- | --- |
| 单机、小型应用 | EC2 + Docker Compose |
| 容器化但不需要 Kubernetes 生态 | ECS / Fargate |
| 已有 K8s 经验、微服务多、需要标准生态 | EKS |
| 简单 Web 服务且不想管理基础设施 | App Runner |
| 事件驱动、短任务、流量波动大 | Lambda |

---
#Kubernetes #云原生 #Docker #AWS #容器编排
