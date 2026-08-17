# step-19: ch 11 日志收集 (filebeat + go-stash + ES + Kibana 完整跑通)

## §0 文档目标

把 looklook 项目的日志收集完整跑通:

1. **filebeat** 抓 go-zero 业务日志 (host 上 `tmp/logs/*.log`)
2. **Kafka** 做缓冲 (topic: `looklook-log`)
3. **go-stash** 从 kafka 消费, 过滤, 写 ES (索引: `looklook-YYYY-MM-DD`)
4. **Kibana** 可视化 (data view: `looklook-*`)

承接 step-17 (ch 13 监控) + step-18 (ch 12 追踪), 是 **ch 11/12/13 三件套**的第三章.

---

## §1 起点 - 项目现状

### 1.1 中间件状态 (2026-08-11)

| 组件 | 状态 | 备注 |
|---|---|---|
| Elasticsearch | Up (ch 12 起的) | ES 8.x, 跟 Kibana 一起 |
| Kibana | Up | 8.x, ES 官方可视化层 |
| filebeat | Up 4 days | 原本只抓 docker 容器日志 |
| go-stash | Up (跟 ch 12 一起修的) | kevwan/go-stash, go-zero 团队开发 |
| kafka | Up 4 days | 缓冲层 |
| kafka-ui | Up | 可视化 topic |

### 1.2 业务日志现状 (11 个服务)

```
$ ls -la tmp/logs/
-rw-r--r-- 113030 Aug 11 14:01 payment-api.log    # 11.3MB
-rw-r--r--  11285 Aug 11 14:01 order-api.log
-rw-r--r--  10090 Aug 11 14:01 usercenter-api.log
... (11 个文件)
```

go-zero 服务跑在 **host** 上, 业务日志写到 host 的 `tmp/logs/*.log`.

### 1.3 实际摸底 (重要发现)

> 摸底发现: ES 里的 `looklook-2026-08-11` 索引是 **docker 容器日志**, 不是我们的业务日志!

**证据:**

- 文档路径是 `/var/lib/docker/containers/.../4c8ec93bd-json.log` (docker 容器)
- 数据示例: `data.log: "Head http://elasticsearch:9200: context deadline"` ← 这是 go-stash 容器访问 ES 失败的日志

**根因:** filebeat 原本只配 `paths /var/lib/docker/containers/*/*-json.log` (docker 容器), 但我们的业务服务跑在 host 上, filebeat 在容器内**看不到** host 的 `tmp/logs/*.log`.

---

## §2 Step 1 - 修 filebeat (让它能抓 host 业务日志)

### 2.1 修改 docker-compose-env.yml (加挂载)

```yaml
  filebeat:
    ...
    volumes:
      - ./deploy/filebeat/conf/filebeat.yml:/usr/share/filebeat/filebeat.yml
      - /var/lib/docker/containers:/var/lib/docker/containers
+     - ./tmp/logs:/var/log/looklook:ro   # ★ ch 11 业务日志: host tmp/logs/*.log 挂到容器
    networks:
      - looklook_net
```

把 host 的 `tmp/logs/` 挂到容器内的 `/var/log/looklook/` (只读).

### 2.2 修改 filebeat.yml (加 input)

```yaml
filebeat.inputs:
  # ★ 新增: 抓 host 业务日志
  - type: log
    enabled: true
    paths:
      - /var/log/looklook/*.log        # host tmp/logs 挂载后的路径
    fields:
      log_type: looklook_business
    fields_under_root: true
  # 保留: 抓 docker 容器日志
  - type: log
    enabled: true
    paths:
      - /var/lib/docker/containers/*/*-json.log
    fields:
      log_type: docker_container
    fields_under_root: true

filebeat.config:
  modules:
    path: ${path.config}/modules.d/*.yml
    reload.enabled: false

processors:
  - add_cloud_metadata: ~
  - add_docker_metadata: ~

output.kafka:
  enabled: true
  hosts: ["kafka:9092"]
  topic: "looklook-log"
  ...
```

两个 input 都加 `fields_under_root: true`, 这样 `log_type` 字段出现在 document 顶层 (Kibana 查起来方便).

### 2.3 重建 filebeat 容器 (让挂载生效)

```bash
docker compose -f docker-compose-env.yml up -d filebeat
```

> ⚠️ `docker restart` 不行! 端口映射/挂载是**创建容器时定**的, 必须重建.

---

## §3 Step 2 - 验证数据流 (filebeat → kafka → go-stash → ES)

### 3.1 完整数据流 (已跑通)

```
┌─────────────────────┐
│ 11 个 go-zero 服务   │ 跑在 host 上
│ 业务日志 → tmp/logs/*.log
└──────────┬──────────┘
           │ bind mount ./tmp/logs:/var/log/looklook:ro
           ▼
┌─────────────────────┐
│ filebeat 容器         │ 读 /var/log/looklook/*.log
│ topic: looklook-log  │
└──────────┬──────────┘
           │ output.kafka
           ▼
┌─────────────────────┐
│ Kafka                │ broker: kafka:9092
│ topic: looklook-log  │ 缓冲
└──────────┬──────────┘
           │ consumer group: pro
           ▼
┌─────────────────────┐
│ go-stash             │ 16 consumers 并发
│ Filters:             │
│   - drop k8s_container_name contains "-rpc" AND level=info
│   - remove_field (清理冗余字段: beat/source/topic 等)
│   - transfer message → data
│ Output:              │
│   ES 索引: looklook-{{yyyy-MM-dd}}
└──────────┬──────────┘
           │ _bulk API
           ▼
┌─────────────────────┐
│ Elasticsearch        │ 8.x
│ 索引: looklook-YYYY-MM-DD
│ 已有 7 天历史数据     │
└──────────┬──────────┘
           │ _search API
           ▼
┌─────────────────────┐
│ Kibana               │ :5601
│ data view: looklook-*│
└─────────────────────┘
```

### 3.2 验证

```bash
# 触发 10 笔业务
for i in $(seq 1 10); do
  curl -X POST http://127.0.0.1:1004/usercenter/v1/user/detail \
    -H "Content-Type: application/json" -d '{}' > /dev/null
  curl -X POST http://127.0.0.1:1003/travel/v1/homestay/homestayList \
    -H "Content-Type: application/json" -d '{"page":1,"pageSize":5}' > /dev/null
done
sleep 15   # 等 filebeat (5s) + kafka + go-stash (~2s) + ES refresh

# 看 ES 文档数
curl 'http://127.0.0.1:9200/looklook-2026-08-11/_count'
# {"count": 12147, ...}   ← 比之前 12126 增加了 21 条
```

---

## §4 Kibana data view 配置详解 (★★★)

### 4.1 为什么需要 data view

Kibana 不知道查哪个 ES 索引, 需要手动指定 pattern. **类似于 Grafana 的"数据源"概念**.

### 4.2 配置步骤 (GUI 方式)

1. 打开 `http://127.0.0.1:5601`
2. 左侧 ☰ → **Stack Management** → **Data Views**
3. 点 **Create data view** (右上角)
4. 填写:
   - **Index pattern**: `looklook-*` (通配符匹配所有日期索引)
   - **Timestamp field**: `@timestamp` (filebeat 自带, ISO 8601 格式)
5. 点 **Create data view**
6. 左侧 → **Discover** → 顶部选刚建的 `looklook-*`
7. 看到所有日志 (按时间倒序)

### 4.3 配置步骤 (API 方式 - 可用于 CI/CD)

```bash
curl -X POST -u elastic:elastic 'http://127.0.0.1:5601/api/data_views' \
  -H 'Content-Type: application/json' \
  -d '{
    "data_view": {
      "name": "looklook-*",
      "title": "looklook-*",
      "timeFieldName": "@timestamp"
    }
  }'
```

### 4.4 data view 字段含义

| 字段 | 含义 |
|---|---|
| name | data view 显示名 (可读) |
| title | ES 索引 pattern (`looklook-*` 通配) |
| timeFieldName | 时间字段 (用于时间范围过滤) |

---

## §5 关键概念 (★ 跟 ch 12/13 对比)

### 5.1 filebeat vs Prometheus vs jaeger 三件套对比

| 维度 | ch 11 日志 (filebeat) | ch 13 监控 (Prometheus) | ch 12 追踪 (jaeger) |
|---|---|---|---|
| 数据 | 业务日志 (text/JSON) | 指标 (numeric time series) | trace (span 树) |
| 采集 | filebeat (tail -F) | Prometheus scrape | OTLP push |
| 缓冲 | Kafka | 无 (直连) | 无 (直连 OTLP) |
| 过滤/转换 | go-stash (Lua-like) | 无 (服务端 query) | jaeger 自身 |
| 存储 | Elasticsearch | Prometheus TSDB | Elasticsearch / Cassandra |
| 可视化 | Kibana (Discover/Dashboard) | Grafana (stat/graph) | jaeger UI (timeline) |
| 协议 | 文本行 / JSON | Prometheus exposition | OTLP/HTTP |

### 5.2 ELK vs EFK vs 我们的 looklook 选型

| 方案 | 组成 | 适合 | 缺点 |
|---|---|---|---|
| ELK | Elasticsearch + Logstash + Kibana | 大规模 | Logstash 资源重 (Java) |
| EFK | Elasticsearch + Fluentd + Kibana | K8s 友好 | Fluentd 配置复杂 |
| looklook (本文) | Elasticsearch + filebeat + go-stash + Kibana | go 生态、轻量 | go-stash 学习曲线 |
| 现代 (LGTM) | Loki + Vector + Grafana | 云原生 | 不在本文范围 |

**kevwan/go-stash 优势:**

- Go 实现 (跟 go-zero 同语言)
- 比 logstash 资源占用少 90%
- 配置文件 YAML 友好
- 跟 Kafka 集成简单

### 5.3 Kafka 在 ch 11 的作用

`filebeat → kafka → go-stash`

**为什么用 kafka 做缓冲?**

- **削峰**: 业务流量高峰时 filebeat 直连 ES 会压垮 ES, kafka 缓冲
- **解耦**: filebeat 和 go-stash 独立扩缩容
- **重试**: go-stash 挂了重启后能从 kafka offset 恢复
- **代价**: 多一个组件 (kafka 集群本身要维护)

### 5.4 go-stash 核心配置解读

```yaml
Clusters:
  - Input:
      Kafka:
        Brokers: ["kafka:9092"]
        Topics: ["looklook-log"]
        Group: pro
        Consumers: 16    # 16 个并发消费者
    Filters:
      - Action: drop
        Conditions:
          - Key: k8s_container_name
            Value: "-rpc"
            Type: contains
          - Key: level
            Value: info
            Type: match
            Op: and
      - Action: remove_field    # 清理冗余字段
        Fields: [@version, beat, docker_container, ...]
      - Action: transfer        # message → data
        Field: message
        Target: data
    Output:
      ElasticSearch:
        Hosts: ["http://elasticsearch:9200"]
        Index: "looklook-{{yyyy-MM-dd}}"   # 按天分割索引
```

| 字段 | 含义 |
|---|---|
| Brokers | Kafka 集群地址 |
| Topics | 消费的 topic 列表 |
| Group | consumer group (offset 管理) |
| Consumers | 并发消费者数 |
| Filters | 数据处理管道 (可链式) |
| Action: drop | 丢弃符合条件的 (这里: 业务 rpc 服务的 info 日志) |
| Action: remove_field | 清理字段 (减少 ES 存储) |
| Action: transfer | 字段重命名 (message → data) |
| Index | ES 索引名, `{{yyyy-MM-dd}}` 是日期占位符 |

---

## §6 filebeat 配置详解 (★★★)

### 6.1 关键字段含义

| 字段 | 含义 | 我们的值 |
|---|---|---|
| filebeat.inputs | 输入源列表 (可多个) | 2 个 (业务 + docker) |
| type: log | 读取文本日志 (其他 type: docker, container, k8s) | log |
| paths | 文件路径 (支持 glob) | /var/log/looklook/*.log |
| fields | 自定义字段 (写入文档) | log_type: looklook_business |
| fields_under_root | fields 是否在文档根 (否则嵌套 fields.xxx) | true (根) |
| output.kafka | 输出到 Kafka | enabled: true |
| topic | Kafka topic | looklook-log |
| compression: gzip | 传输压缩 | gzip (减少网络流量) |
| max_message_bytes | 单条消息最大字节 | 1000000 (1MB) |
| required_acks: 1 | Kafka ACK 级别 | 1 (leader ack, 平衡性能和可靠性) |

### 6.2 为什么用 fields_under_root: true

默认情况下, fields 嵌套:

```json
{"fields": {"log_type": "looklook_business"}, ...}
```

设了 `fields_under_root: true` 后:

```json
{"log_type": "looklook_business", ...}   ← 顶层
```

Kibana 查询和可视化更方便 (`log_type: looklook_business` 而不是 `fields.log_type`).

### 6.3 我们没用 filebeat 高级特性 (ch 12 之后可加)

- **modules**: filebeat 内置模块 (nginx/mysql/redis 等) - 我们没用
- **ILM** (Index Lifecycle Management): 自动滚动删除老日志 - 7 天后就满了
- **multiline**: 合并多行日志 (Java stack trace) - 我们 go-zero 单行 JSON
- **processors.add_fields**: 动态加字段 (按文件名解析 service) - 我们用静态

---

## §7 Kibana 使用详解 (★★★)

### 7.1 主要 4 大模块

```
Kibana 8.x 主导航
├─ Discover   ← 日志搜索 (90% 日常用)
├─ Dashboard  ← 可视化 (图/表)
├─ Lens       ← 拖拽式可视化
├─ Maps       ← 地理数据
└─ Stack Management
   ├─ Data Views   ← 入口配置
   └─ Index Patterns
```

### 7.2 Discover 基础操作

- 顶部时间选择器: Last 15 minutes / Last 24 hours / 自定义
- 搜索框: KQL (Kibana Query Language) 或 Lucene
- 左侧: 字段列表 (按字母/类型)
- 中间: 日志列表 (按时间倒序)
- 右侧: 文档详情 (展开看 tags)

### 7.3 KQL 常用查询

```kql
# 找特定服务日志
log_type: "looklook_business"

# 找错误日志
level: "error"

# 找特定接口
message: "/usercenter/v1/user/login"

# 组合查询
log_type: "looklook_business" AND level: "error"

# 范围查询
http.status_code >= 400

# 通配符
message: *timeout*
```

### 7.4 字段类型说明

- **keyword**: 不分词, 用于精确匹配 (level, log_type, message)
- **text**: 分词, 用于全文搜索 (默认)
- **long/date/boolean**: 数值/时间/布尔

### 7.5 常见 3 步排查流程

1. **筛选时间范围**: 选 1h / 15min / 自定义
2. **KQL 过滤**: 比如 `level: "error" AND log_type: "looklook_business"`
3. **展开看 tags**: 点击日志行左侧箭头, 看完整字段

---

## §8 总结

### 8.1 5 步走成果

| 步骤 | 内容 | 状态 |
|---|---|---|
| 摸底 | ES 里有数据但不是业务日志 | ✅ 找到根因 |
| 修 filebeat | 加 host bind mount + 新 input | ✅ v3.37 |
| 重启 filebeat | docker compose up -d filebeat | ✅ |
| 验证 | 触发 10 笔 → ES 索引增加 21 条 | ✅ |
| Kibana 配 data view | looklook-* 能查所有日志 | ✅ |

### 8.2 关键收获

- filebeat **看不到 host 文件** (容器内): 必须 bind mount tmp/logs 到容器内路径
- filebeat 抓 docker 容器日志是另一种模式 (ch 12 间接用)
- kafka 在 filebeat 和 go-stash 之间做缓冲: **削峰 + 解耦 + 重试**
- go-stash 替代 logstash: 资源占用少 90% (Go vs Java)
- Kibana 是 ES 的可视化层: 没有 Kibana 就只能查 ES API, 看不到 dashboard

### 8.3 排查清单

- [ ] ES 索引是否每天有? (`_cat/indices?v`)
- [ ] filebeat 抓了哪些文件? (`monitoring.metrics.harvester.open_files`)
- [ ] kafka topic 有数据? (`kafka-topics --describe` 或 kafka-ui)
- [ ] go-stash 持续跑? (`qps: x/s, drops: y`)
- [ ] Kibana data view 配好? (`looklook-*` @timestamp)
- [ ] 业务日志能搜到? (KQL: `log_type: "looklook_business"`)

---

## §9 相关文件路径

| 路径 | 说明 |
|---|---|
| docker-compose-env.yml | ← filebeat 挂载 |
| deploy/filebeat/conf/filebeat.yml | ← 2 个 input (业务 + docker) |
| deploy/go-stash/etc/config.yaml | ← go-stash 完整配置 (kafka + filters + ES) |
| tmp/logs/*.log | ← 11 个 go-zero 服务日志输出位置 |

- ES 索引: `looklook-YYYY-MM-DD` (按天切)
- Kibana: `http://127.0.0.1:5601`

---

## §10 相关阅读

- [step-17 ch 13 监控](step-17-ch13-monitoring.md) - 上一章: Prometheus + Grafana
- [step-18 ch 12 追踪](step-18-ch12-tracing.md) - 上一章: Jaeger + OTLP
- 原始教程 [ch 11-日志收集](../chinese/11-日志收集.md) (filebeat 7.x 旧版, 我们升到 8.12 适配)

---

创建于 2026-08-11, ch 11 日志收集完整跑通 (filebeat 抓 host 业务日志 + Kibana data view looklook-* 看所有日志), v3.37 代码 + v3.38 文档已 ship.
