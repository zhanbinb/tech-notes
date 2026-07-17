# 第三梯队：存储与消息队列

> 阶段 3 高并发实战的核心组件。这类项目看源码重点学习**并发模型与 IO 模式**。

## MinIO ⭐⭐⭐⭐

- 仓库：https://github.com/minio/minio
- 定位：兼容 AWS S3 协议的分布式对象存储
- 纯 Go 实现，代码质量非常高

**核心学习点**：
- **`io.Reader` / `io.Writer` 流式处理大文件**——不把整个文件加载到内存
- **`sync.Pool` 对象复用**——减少 GC 压力，minio 内部大量使用
- **纠删码（Erasure Coding）**——分布式存储的数据冗余方案
- **高性能网络 IO**——零拷贝、sendfile 等系统调用的 Go 封装

**适合学习场景**：
- 文件上传下载服务的并发设计
- 对象存储 SDK 怎么写（看 `minio-go` 客户端）

## go-nsq ⭐⭐⭐⭐

- 仓库：https://github.com/nsqio/go-nsq
- 定位：NSQ 消息队列的 Go 客户端 + 协议实现
- 真实生产级 MQ，每天处理数亿消息

**核心学习点**：
- **纯 Go 的网络协议设计**：基于 TCP 的简洁协议 `magic-byte + cmd + size + body`
- **Producer / Consumer / Lookupd 三件套**：NSQ 的服务发现模型
- **消息投递语义**：至少一次（at-least-once），由消费者去重
- **channel 与 topic 的多播模型**：一个 topic 多 channel，消费者组负载均衡

**适合学习场景**：
- 自己设计一个简单的消息队列协议
- 异步任务队列的工程实现

## Kafka（Java，但 Go 客户端值得学）

- 仓库：https://github.com/segmentio/kafka-go（推荐）或 [confluent-kafka-go](https://github.com/confluentinc/confluent-kafka-go)
- 国内中大厂事实标准消息队列

**Go 客户端学习点**：
- **消费者组（Consumer Group）** 协议
- **分区（Partition）** 与顺序保证
- **Exactly-Once 语义**：Kafka 0.11+ 的事务机制
- **Go 端常见坑**：自动提交 offset 丢消息 / 手动提交阻塞

## RocketMQ（Apache）

- 仓库：https://github.com/apache/rocketmq（Java）
- Go 客户端：https://github.com/apache/rocketmq-client-go
- 阿里系电商场景的事实标准

**与 Kafka 的差异**：
- 事务消息原生支持更好
- 延迟消息（定时投递）内置
- 顺序消息实现更简单（队列级有序）

## 选型建议

| 场景 | 推荐 | 理由 |
| --- | --- | --- |
| 日志/埋点/事件流 | **Kafka** | 吞吐高、生态成熟 |
| 订单/支付事务消息 | **RocketMQ** | 事务消息原生支持 |
| 简单异步任务、轻量 MQ | **NSQ** | 部署简单、纯 Go |
| 文件/图片存储 | **MinIO** | S3 兼容、自托管 |

## 实战建议

阶段 3 选其中一个消息队列深耕：
1. 用 Docker Compose 起一个单节点
2. 写 Producer + Consumer Go 程序
3. 故意制造网络分区/宕机，观察消息是否丢失/重复
4. 总结出"什么场景用什么投递语义"
