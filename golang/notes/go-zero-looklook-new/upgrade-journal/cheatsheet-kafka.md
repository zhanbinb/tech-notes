# Kafka 常用命令速查

> 跟着 Step 1 一起用，对应 go-zero-looklook 里的 kafka 容器（apache/kafka:3.9.0）

## 1. 查询 topic 列表

```bash
# 进容器
docker exec -it kafka /bin/sh

# 列所有 topic
kafka-topics.sh --list --bootstrap-server localhost:9094
```

应该看到（Step 1 跑完后）：
```
looklook-log
payment-update-paystatus-topic
```

## 2. 查 topic 详细信息

```bash
kafka-topics.sh --describe --bootstrap-server localhost:9094 --topic looklook-log
```

输出：
```
Topic: looklook-log   TopicId: ...   PartitionCount: 1   ReplicationFactor: 1
   Topic: looklook-log   Partition: 0   Leader: 1   Replicas: 1   Isr: 1
```

## 3. 查 topic 消息数（消费滞后）

```bash
kafka-run-class.sh kafka.tools.GetOffsetShell \
  --bootstrap-server localhost:9094 \
  --topic looklook-log
```

输出：`looklook-log:0:42` → 42 条消息

## 4. 查 consumer group

```bash
kafka-consumer-groups.sh --list --bootstrap-server localhost:9094
kafka-consumer-groups.sh --describe --bootstrap-server localhost:9094 --all-groups
```

## 5. 不进容器，宿主机直接查

如果 `kafka` 容器有暴露 `9094` 端口到宿主机（默认没有，看 docker-compose-env.yml），可以直接在 Mac 上用：

```bash
# 一次性查（需要本机装 kafka 客户端或 kafkacat/kcat）
brew install kcat
kcat -L -b localhost:9094
```

go-zero-looklook 的 docker-compose-env.yml 里 kafka 没暴露端口到宿主，所以**必须进容器查**。

## 6. 实时消费某 topic 看内容

```bash
docker exec -it kafka /bin/sh
kafka-console-consumer.sh --bootstrap-server localhost:9094 \
  --topic looklook-log --from-beginning --max-messages 5
```

## 7. 生产测试消息

```bash
docker exec -it kafka /bin/sh
echo '{"test":"hello"}' | kafka-console-producer.sh \
  --bootstrap-server localhost:9094 --topic looklook-log
```
