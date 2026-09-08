# Redis 面试复习指南（数据类型 · 底层结构 · 持久化 · 高可用 · 缓存 · 事务 Lua · 内存）

> 来源：[go-interview-guide/code/05-redis](https://github.com/zhanbinb/go-interview-guide) 整理，覆盖 7 大主题 + 10 大面试题组。
> 风格：每节"必问核心 → 重点掌握 → 选学"三段式，便于面试速记。
> 配套速查：[INTERVIEW-QA.md](https://github.com/zhanbinb/go-interview-guide/blob/main/code/05-redis/INTERVIEW-QA.md)（10 大题组 39 主问 + 35 补充 + 10 加分 = 84 个 Q&A + 49 个金句）

## TL;DR

- **数据类型**：String/SDS、List/quicklist、Hash/listpack+dict、Set/intset+dict、ZSet/listpack+skiplist+dict + 3 特殊（Bitmap/HyperLogLog/GEO）。
- **底层结构**：SDS（O(1) 长度+二进制安全+空间预分配）、dict（hashtable+**渐进式 rehash**+SipHash 抗哈希洪水）、quicklist（双向链表+listpack 节点）、skiplist（**比红黑树实现简单+范围查询友好**）、listpack（替代 ziplist 消除级联更新）、intset（整数范围升级不可逆）。
- **持久化**：RDB（快照，可能丢分钟级数据）vs AOF（追加日志，最多丢 1s）；**Redis 4.0+ 混合持久化 = RDB 头 + AOF 增量**，生产推荐。
- **高可用**：主从（一写多读+RDB 全量+repl_backlog 增量）+ Sentinel（监控+选主+通知，3 节点过半）+ Cluster（CRC16+16384 slot 预分片 + MOVED/ASK 重定向）。
- **缓存三大问题**：穿透（**空值缓存/布隆过滤器**）、击穿（**互斥锁/逻辑过期**）、雪崩（**过期加随机+多级缓存+高可用**）。
- **分布式锁**：`SET key val NX PX 30000` + UUID + Lua 原子解锁 + Redisson **看门狗**续期。
- **一致性**：Cache Aside + 延迟双删 + **Canal 订阅 binlog**（工业级）。
- **内存**：过期删除 = 惰性+定期（不靠定时器）；8 种淘汰策略，**生产用 `allkeys-lru` 或 `allkeys-lfu`**。
- **为什么快**：内存 + 单线程（避免锁竞争）+ IO 多路复用（epoll）+ 高效数据结构；6.0+ IO 多线程但执行还是单线程。

---

## 1. 数据类型（5 大基础 + 3 大特殊）

### 1.1 五大基础（必背）

| 类型 | 底层（Redis 7.x）| 复杂度 | 典型场景 |
|------|------------------|--------|----------|
| **String** | SDS（int/embstr/raw 三编码）| O(1) | 缓存、计数器、分布式锁、Session |
| **List** | quicklist（双向链表+listpack 节点）| 头尾 O(1)，中间 O(N) | 消息队列、栈、最新列表 |
| **Hash** | listpack 小 / dict 大 | O(1) | 对象存储、用户资料、购物车 |
| **Set** | intset 全整数小 / dict 大 | O(1) | 去重、共同好友、抽奖 |
| **ZSet** | listpack 小 / skiplist+dict 大 | O(log N) | 排行榜、延迟队列、滑动限流 |

> **口诀**：字符串、列表、哈希、集合、有序集合；Hash 存对象、Set 去重、ZSet 排顺序。

### 1.2 三大特殊（加分）

| 类型 | 底层 | 命令 | 场景 |
|------|------|------|------|
| **Bitmap** | String（位操作）| `SETBIT/GETBIT/BITCOUNT/BITOP` | 用户签到、日活、布隆过滤器 |
| **HyperLogLog** | 概率数据结构 | `PFADD/PFCOUNT/PFMERGE` | UV 估算（误差 < 1%，12KB 定长）|
| **GEO** | zset（GeoHash 编码）| `GEOADD/GEODIST/GEOSEARCH` | 附近的人、骑手距离 |

### 1.3 String 三种编码（44 字节边界）

```bash
SET s1 1234           # int（整数）
SET s2 "hello"        # embstr（≤ 44 字节，header+buf 一次 malloc）
SET s3 "long..(>44)"  # raw（> 44 字节，header 和 buf 两次 malloc）
OBJECT ENCODING key   # 验证
```

> 44 字节 = `64 - 16(header) - 3(buf 头) - 1(\0)`

### 1.4 选型速查

```
要存字符串/计数器/锁     → String
要存对象（多个字段）      → Hash（字段变化多）或 String+JSON（字段稳定）
要存列表/队列             → List
要去重/共同好友/抽奖       → Set
要排行榜/按分数排序       → ZSet
```


---

## 2. 底层数据结构（超高频 ⭐⭐⭐）

### 2.1 SDS（Simple Dynamic String）— String 底层

**为什么不直接用 C 字符串**：

| 问题 | 后果 |
|------|------|
| O(N) 取长度 | `STRLEN` 要遍历到 `\0` |
| 二进制不安全 | `\0` 被当成结束符 |
| 缓冲区溢出 | `strcat` 不检查空间 |

**结构**（5 种 header：`sdshdr5/8/16/32/64` 按 len 大小动态选，省内存）：

```c
struct sdshdr {
    uint8_t  len;       // 已使用长度 → O(1) 取长度
    uint8_t  alloc;     // 总分配
    uint8_t  flags;     // 类型标识
    char     buf[];     // 柔性数组 → 一次 malloc
};
```

**空间策略**：
- **预分配**：< 1MB 分配 2×len；≥ 1MB 分配 len+1MB
- **惰性释放**：缩短不立刻 realloc，留给下次用

### 2.2 dict（hashtable）— Hash / Set 底层

```
dict
├── ht[2]            // 双 hashtable（渐进式 rehash）
│   ├── ht[0]        // 正在用的表（table/size/sizemask/used）
│   └── ht[1]        // rehash 目标表
├── rehashidx        // 进度（-1 = 没在 rehash）
```

- **冲突**：链地址法（每桶链表）
- **哈希函数**：SipHash-1-2（4.0+，抗哈希洪水攻击，替代 MurmurHash2）
- **渐进式 rehash**（核心）：
  - 触发：`used/size >= 1`（无 BGSAVE）或 `>= 5`（强制）
  - 步骤：分配 ht[1] → 每次增/删/查把 ht[0] 一桶搬到 ht[1] → 完事后释放 ht[0]
  - 期间**查操作要查两个表**

> **金句**：渐进式 rehash 用**分摊思想**把大字典的搬迁拆到 N 次操作里，避免单次卡顿。

### 2.3 quicklist — List 底层

- 演进：`linkedlist`（3.0-，节点多 malloc）→ `quicklist = linkedlist of ziplist/listpack`（3.2+）→ quicklist 节点用 listpack（7.0+）
- 本质：**双向链表 + 紧凑 listpack 节点**（折中：连续内存省空间 + 改局部不动整体）
- 参数：`list-max-listpack-size=-2`（8KB/节点）· `list-compress-depth=0`

### 2.4 listpack — 替代 ziplist

- ziplist 缺陷：每 entry 存 `prevrawlen`，某 entry 长度变化触发**级联更新**（O(N) 连锁）
- listpack：去掉 prevrawlen，用 `numele` + 自己的 backlen 定位前一个 → **彻底消除级联更新**

### 2.5 intset — 小 Set 底层

```c
typedef struct intset {
    uint32_t encoding;  // INTSET_ENC_INT16/32/64
    uint32_t length;
    int8_t  contents[]; // 有序、连续
} intset;
```

- 升级：`int16 → int32 → int64`（**不可逆**）；加非整数或超 `set-max-intset-entries=512` 升级为 hashtable

### 2.6 skiplist — ZSet 排序部分

- 多层有序链表，每节点 level 数**随机**（概率 1/2^N 晋升）→ 平均 O(log N)
- **跳表 vs 红黑树**（**面试必问**）：

| 维度 | 跳表 | 红黑树 |
|------|------|--------|
| 实现 | 简单（指针）| 复杂（左旋/右旋/变色）|
| 范围查询 | O(log N) 找起点后**顺序遍历** | O(log N) + 中序遍历（要回溯）|
| 并发 | **局部锁** | 全局锁 |
| 退化 | 概率 1/2^N（可接受）| 不会退化 |
| 内存 | 略多（多级指针）| 略少 |

- ZSet 同时用 **skiplist + dict**：skiplist 按 score 排序 O(log N)，dict key→score 映射 O(1)

> **金句**：antirez 选跳表是因为**实现简单 + 范围查询友好 + 局部锁**。

### 2.7 编码转换总表

| 外部类型 | 小 | 大 | 阈值参数 |
|---------|---|---|---------|
| String（整数）| int | — | — |
| String（≤44 字节）| embstr | raw | — |
| Hash | listpack | dict | `hash-max-listpack-entries=128` / `-value=64` |
| Set | intset | dict | `set-max-intset-entries=512` |
| ZSet | listpack | skiplist+dict | `zset-max-listpack-entries=128` / `-value=64` |
| List | listpack | listpack | **永不升级** |

**验证**：`OBJECT ENCODING key`


---

## 3. 持久化（必问 ⭐⭐⭐）

### 3.1 RDB vs AOF 对比

| 维度 | RDB（快照）| AOF（追加日志）|
|------|-----------|-----------------|
| 原理 | fork 子进程 dump 内存到 rdb | 每条写命令追加到 aof |
| 文件 | 小（压缩二进制）| 大（命令）|
| 恢复 | **快**（直接加载）| **慢**（重放命令）|
| 数据安全 | 丢快照后数据 | 默认 `everysec` **最多丢 1s** |
| 性能 | fork 时阻塞（大内存 10ms+）| 写时 append，rewrite 时阻塞 |
| 触发 | `save m n` / `BGSAVE` / `SHUTDOWN` | always fsync / everysec / no |

### 3.2 AOF 三种策略

| 策略 | 配置 | 丢失 | 性能 |
|------|------|------|------|
| `always` | `appendfsync always` | **0** | 最差 |
| `everysec`（默认）| `appendfsync everysec` | **最多 1s** | 折中（推荐）|
| `no` | `appendfsync no` | 看 OS | 最好 |

### 3.3 混合持久化（Redis 4.0+，生产推荐）

- AOF 文件 = **RDB 格式的全量数据** + **AOF 格式的增量命令**
- 恢复：先加载 RDB 头（快），再重放 AOF 增量（数据全）

### 3.4 AOF rewrite

- fork 子进程扫描内存生成新 AOF（只写最终状态，不写中间命令）
- 期间新命令同时写 old AOF + rewrite buffer
- 子进程完成 → 把 buffer 追加到新 AOF → 原子替换
- **不阻塞主进程**（COW 机制）

> **金句**：**RDB 一定会丢数据**（最多 m 分钟 n 写）；**AOF everysec 最多丢 1s**；**混合持久化是工业级最佳实践**。

---

## 4. 高可用（主从 + Sentinel + Cluster）⭐⭐

### 4.1 主从复制

- **一写多读**：Master 写，多 Replica 读
- 流程：
  1. Replica 发 `PSYNC` → Master
  2. Master **fork** 子进程生成 **RDB** → 发给 Replica
  3. Replica 加载 RDB
  4. 期间新写 → **repl_backlog**（环形缓冲区）
  5. Master 把新写命令**增量同步**给 Replica
- = **全量 + 增量**结合的部分重同步

### 4.2 Sentinel（哨兵）

- 本质：特殊 Redis 进程（`redis-sentinel`），**不存数据**
- 三大职责：**监控 + 通知 + 自动故障转移**
- 故障转移流程：每 1s PING → 5 次失败 SDOWN → 集群过半数 ODOWN → 按优先级选 Replica → `SLAVEOF NO ONE` 提升 → pub/sub 通知客户端
- **最小集群：3 个 Sentinel 节点**

### 4.3 Cluster

- 解决：**单实例内存 + QPS 上限**（Sentinel 只解决 HA，不解决水平扩展）
- **预分片**：16384 个 slot 分散到 N 个 master
- **去中心化**：节点间 Gossip 协议
- 每个 master 多 replica，自动故障转移

**为什么是 16384（2¹⁴）**：
- 心跳包 2KB（每节点带 16384 bit slot 位图）
- 官方测试：16384 足够支撑 1000 master
- 对比 65535 心跳 8KB 太重

**Key 怎么找节点**：
1. `slot = CRC16(key) % 16384`
2. 自己管 → 直接执行
3. **MOVED**（已迁完）→ 客户端永久重定向
4. **ASK**（迁移中）→ 客户端临时转发
5. Smart client 缓存 slot→node 映射

> **金句**：**Sentinel = 垂直扩展 + HA；Cluster = 水平扩展 + HA**。

### 4.4 脑裂与复制风暴

- **脑裂**：Sentinel 选新 master 时老 master 还接受写 → 用 `min-replicas-to-write 1` 兜底
- **复制风暴**：master 同时给 N 个 replica 发 RDB → IO 打满 → 用**级联复制**（master → 中间 replica → 其他）

---

## 5. 缓存设计（三大问题 + 一致性 + 分布式锁）⭐⭐⭐

### 5.1 三大问题（超高频）

| 问题 | 现象 | 本质 | 解法 |
|------|------|------|------|
| **穿透** | 查**不存在**的数据，每次都打 DB | 绕过缓存 | **空值缓存** / **布隆过滤器** / 参数校验 |
| **击穿** | **单热点 key 过期瞬间**被打爆 | 单 key + 高并发 | **互斥锁** / **逻辑过期** / 永不过期+异步更新 |
| **雪崩** | **大量 key 同时过期或 Redis 挂** | 多 key + 高并发 | **过期时间加随机** / 多级缓存 / 熔断降级 / Redis 高可用 |

> **金句**：穿透→布隆+空值；击穿→互斥/逻辑过期；雪崩→过期加随机+高可用。

### 5.2 布隆过滤器 vs 空值缓存

- **误判敏感**（支付）→ 空值缓存
- **量大且允许小误判** → 布隆过滤器
- 生产多组合：布隆挡大部分 + 空值兜底

### 5.3 逻辑过期（不阻塞读）

- value 是 JSON `{data: ..., expire_time: ...}`，**不带 TTL**
- 读时发现 expire_time 过期 → 返回旧值 + 异步线程重建
- 写时用互斥锁防并发重建

### 5.4 Redis ↔ MySQL 一致性

- **强一致不可能**（CAP），只能**最终一致**
- **Cache Aside**（最常用）：更新 DB 后**删缓存**（不更新，避免并发写覆盖问题）
- 兜底三层：**重试 + 延迟双删 + binlog 订阅**
  - **Canal 订阅 MySQL binlog** → 异步同步到 Redis（**工业级最可靠**）

> **金句**：**最终一致 = DB 主写 + binlog 同步 + Redis 兜底**——把"真相"锁在 DB，把"展示"放缓存。

### 5.5 分布式锁（最高频）

**最小可用**：
```bash
SET lock_key "uuid" NX PX 30000
```

**为什么 SETNX + EXPIRE 两条不够**：原子性问题，加完锁后崩在 EXPIRE 前 → **死锁**。

**为什么 Value 要 UUID**：防误删（A 加锁 → 过期 → B 加锁 → A 醒过来 DEL → 删了 B 的锁）。

**为什么需要 Lua 原子化**（解锁）：
```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
```

**锁续期（看门狗）**：
- 业务没完 → 后台线程定时 `PEXPIRE` 续命
- 工业级实现：**Redisson**（`lockWatchdogTimeout=30s`，每 10s 续到 30s）

> **金句**：**SET NX PX + UUID + Lua + 看门狗**——四件套缺一不可。


---

## 6. 事务 + Lua + Pipeline

### 6.1 事务（MULTI/EXEC）vs MySQL 事务

| 维度 | Redis MULTI/EXEC | MySQL BEGIN/COMMIT |
|------|------------------|-------------------|
| 原子性 | 排队执行，**不支持回滚** | 完整 ACID，支持 ROLLBACK |
| 隔离性 | 串行执行（单线程天然隔离）| 多种隔离级别 |
| 持久性 | 看持久化配置 | 完整 WAL |
| 本质 | 批量执行**语法糖** | 完整事务机制 |

### 6.2 Lua 脚本

- **Redis 内置的"事务"**：单线程执行整段脚本，**天然原子**
- 分布式锁的"**原子解锁**"必须用 Lua（GET+DEL 不能分两条）
- 缺点：脚本要传到服务器，不省 RTT

### 6.3 Pipeline

- 客户端把 N 个命令**打包一次性发到服务器**，**减少 RTT**
- **不保证原子**：中途某个失败，其他照常执行
- 批量写用 Pipeline，复杂原子用 Lua

> **金句**：**Pipeline 省 RTT 不原子，Lua 原子但不省 RTT**。

### 6.4 Stream（5.0+）

- 只追加的日志型数据结构（类似 Kafka topic）
- 命令：`XADD/XREAD/XGROUP/XACK`（消费者组）
- vs Kafka：吞吐量小（几千~几万 vs 百万级）、内存受限
- 适用：轻量级消息流

---

## 7. 内存管理（过期删除 + 8 种淘汰 + LRU/LFU）⭐⭐

### 7.1 Key 过期怎么删（三种策略组合）

1. **定时删除**（主动）：每个 key 起定时器到期删 → **CPU 不友好**（雪崩）
2. **惰性删除**（被动）：**访问时**才检查过期 → **内存不友好**（过期未访 key 永远占着）
3. **定期删除**（折中）：每 100ms serverCron **抽 20 个 key**，过期比例 > 25% 立刻再抽

> **金句**：Redis 用**惰性 + 定期**两种组合——**不靠定时器**，因为定时器太重。

### 7.2 8 种淘汰策略（`maxmemory-policy`）

| 策略 | 行为 | 场景 |
|------|------|------|
| `noeviction`（默认）| 不淘汰，写返 OOM | 不能丢 |
| **`allkeys-lru`** ⭐ | 所有 key LRU | **通用缓存**（推荐）|
| **`allkeys-lfu`** ⭐ | 所有 key LFU | **热点明显**（4.0+）|
| `allkeys-random` | 随机 | 兜底 |
| `volatile-lru/lfu/random` | 设过期 key 里 | 保留永久 key |
| `volatile-ttl` | TTL 最短的先淘汰 | 优先清快过期的 |

### 7.3 LRU vs LFU

**LRU（近似）**：
- 24 位时间戳字段，淘汰时**抽一批**对比
- 缺点：冷数据被偶然访问就"洗白"

**LFU（4.0+）**：
- 16 位访问频率 counter + 8 位衰减时间
- 衰减：`counter -= (now - last_decay) / lfu_decay_time`
- 优点：**真正抗偶然访问**（高频 key 不易被一次访问就保护）

> **金句**：**Redis LRU 是近似 LRU**（不是真链表），LFU 加衰减机制抗偶然访问。

### 7.4 内存监控命令

```bash
MEMORY USAGE key            # 单 key 字节数
INFO memory                 # used_memory_human / mem_fragmentation_ratio
INFO stats                  # keyspace_hits / keyspace_misses
SCAN 0 COUNT 100            # 渐进遍历（生产用，不用 KEYS *）
redis-cli --bigkeys         # 大 key 扫描（生产慎用，会阻塞）
redis-cli --hotkeys         # 热 key（4.0+ LFU 统计）
SLOWLOG GET 10              # 慢命令
CLIENT LIST                 # 客户端连接
```

### 7.5 性能下降排查（5 大原因）

| 现象 | 原因 | 解法 |
|------|------|------|
| QPS 上不去/延迟高 | 慢命令（KEYS*/HGETALL 大/FLUSHDB）| 改 SCAN / Lua 批量 / 拆大 key |
| 内存持续涨 | 大 key（>10KB String / >5000 字段 Hash）| bigkeys 查 + 拆分 |
| 单 key 慢 | 热 key 单点 | 客户端本地缓存 + 多 key 分散 + 多 replica |
| CPU 高 | 频繁 keys* / fork 阻塞 / 大量过期 | 改 SCAN / 关持久化 / lazy+async |
| 连接数暴涨 | 客户端连接泄漏 | 连接池 / CLIENT KILL |

> **金句**：**大 key + 热 key + 慢命令 + 内存使用率**是四大监控指标。

### 7.6 大 key 怎么删

- ❌ 直接 `DEL bigkey` → **同步阻塞主线程数秒**
- ✅ `UNLINK key`（4.0+）→ **异步删除**
- ✅ 大 List：`LPOP` 一批 + `SLEEP` + 循环
- ✅ 大 Hash：`HSCAN` + `HDEL` 一批 + 循环

---

## 8. 10 大面试题组速记（Q&A + 金句）

> 完整 Q&A 见 [INTERVIEW-QA.md](https://github.com/zhanbinb/go-interview-guide/blob/main/code/05-redis/INTERVIEW-QA.md)（39 主问 + 35 补充 + 10 加分 = 84 题 + 49 金句）。本节是面试前 30 分钟速记版。

| # | 题组 | 主问 | 核心答案 | ⭐ 金句 |
|---|------|------|----------|---------|
| 1 | 🔥 性能 | 为什么快？ | 内存+单线程+IO多路复用+数据结构 | "内存+单线程+epoll+数据结构" |
| 2 | ⭐ 数据类型 | 五种底层？ | SDS/quicklist/listpack+dict/intset+dict/listpack+skiplist+dict | "Hash 存对象、Set 去重、ZSet 排顺序" |
| 3 | ⭐ 持久化 | RDB vs AOF？ | 混合持久化是工业级最佳实践 | "RDB 必丢数据，AOF everysec 最多丢 1s" |
| 4 | ⭐ 过期+淘汰 | Key 过期怎么删？ | 惰性+定期，不靠定时器 | "生产用 allkeys-lru 或 allkeys-lfu" |
| 5 | 🔥 三大问题 | 穿透/击穿/雪崩？ | 布隆/互斥/过期加随机 | "穿透查不到、击穿热点过期、雪崩大量过期或宕机" |
| 6 | ⭐ 一致性 | Redis vs MySQL？ | Cache Aside + 延迟双删 + binlog 订阅 | "DB 主写 + binlog 同步 + Redis 兜底" |
| 7 | 🔥 分布式锁 | 怎么实现？ | SET NX PX + UUID + Lua + 看门狗 | "四件套缺一不可" |
| 8 | ⭐ 主从+哨兵 | Master 挂了？ | Sentinel 过半 ODOWN → 选 Replica 提升 | "Sentinel = 监控+选主+通知" |
| 9 | ⭐ Cluster | 为什么 16384？ | 2¹⁴，心跳 2KB 够支撑 1000 master | "CRC16 + 16384 预分片，MOVED 永久重定向" |
| 10 | 💡 调优 | 性能下降？ | 大 key+热 key+慢命令+内存 | "先用 INFO 找现象，SLOWLOG 找慢命令" |

### 答题技巧

- ✅ 先说"是什么"→再"为什么"→最后"怎么用"
- ✅ 用**对比例**（"vs 红黑树" / "vs 链表"）→ 显深度
- ✅ 结尾用**金句**→ 给面试官留记忆点
- ✅ 提**版本号**（4.0+/6.0+/7.0+）→ 显专业
- ✅ 知道**取舍**（"集群下锁的坑" / "RDB 必丢数据"）→ 显成熟
- ❌ 避免纯背定义

### 必背 Top 10（金句版）

1. Redis 为什么快 → **内存 + 单线程 + IO 多路复用 + 高效数据结构**
2. ZSet 为什么用跳表 → **实现简单 + 范围查询 O(log N) + 局部锁**
3. 缓存三大问题 → **穿透布隆/空值 · 击穿互斥/逻辑过期 · 雪崩过期加随机/高可用**
4. 分布式锁四件套 → **SET NX PX + UUID + Lua + 看门狗**
5. Redis 高可用 → **主从 + Sentinel + Cluster（16384 槽位）**
6. 持久化推荐 → **RDB + AOF 混合持久化（Redis 4.0+）**
7. 过期删除 → **惰性 + 定期，不靠定时器**
8. 淘汰策略 → **生产用 allkeys-lru 或 allkeys-lfu**
9. 一致性 → **Cache Aside + binlog 订阅最终一致**
10. 性能监控 → **大 key + 热 key + 慢命令 + 内存使用率**


---

## 9. 常见坑 / 注意事项

### 9.1 String 编码
- int 编码被 `APPEND` 写字符串后会变成 raw（**降级到 raw 不可逆**）
- 浮点数不算 int（直接是 embstr）

### 9.2 Hash 字段数
- < 128 字段 → listpack（连续内存省空间）
- ≥ 128 字段 → dict（O(1) 查但耗内存）
- **缩容后一般不降级回 listpack**（dict → listpack 不会自动发生）

### 9.3 intset 升级
- int16 → int32 → int64 **不可逆**
- 加非整数或超 512 → 升级 hashtable，**永不降级**

### 9.4 List 中间操作
- `LINDEX list 1000` 是 **O(N)**，会遍历 quicklist
- List 永远用 listpack 节点（quicklist 不升级）

### 9.5 ZSet 范围
- `ZRANGE`/`ZRANGEBYSCORE` 是 **O(log N + M)**（找起点 + 顺序遍历 M 个）

### 9.6 RDB / AOF 选型
- 想备份 + 启动快 → RDB
- 想数据安全 → AOF everysec
- **生产推荐混合**（4.0+）

### 9.7 fork 阻塞
- 大内存（10GB+）fork 几十 ms → 优化：`repl-backlog-size` 减少频率 / 升 7.0+ 多线程 AOF rewrite

### 9.8 分布式锁
- ❌ SETNX + EXPIRE 两条命令（**原子性 bug**）
- ❌ 不带 UUID 直接 DEL（误删别人）
- ❌ 不用 Lua 解锁（非原子）
- ❌ 不续期（业务慢于锁 TTL）
- ✅ Redisson 看门狗

### 9.9 脑裂
- 老 master 还在接受写 → 用 `min-replicas-to-write 1` 兜底

### 9.10 Cluster 多 key 操作
- `MGET/MSET` 跨 slot 报错 → 用 **Hash Tag**（`user:{1001}.name` 强制绑同 slot）

### 9.11 生产禁忌
- ❌ `KEYS *`（O(N) 阻塞）
- ❌ `MONITOR`（生产禁用）
- ❌ `FLUSHDB` / `FLUSHALL` 不带 `ASYNC`（同步阻塞）
- ❌ 启用 swap（必须 `vm.swappiness=1`）
- ❌ 用 Redis 当 MySQL（大数据 + 事务）
- ❌ 用 Redis 当 Kafka（高吞吐消息流）

### 9.12 客户端优化
- ✅ **连接池**（go-redis 默认 10 × GOMAXPROCS）
- ✅ **Pipeline** 批量
- ✅ **Lua** 原子
- ✅ **超时 + 退避重试 + 熔断**（重试不熔断会把 Redis 打死）

---

## 10. 关联笔记 & 参考资料

### 配套笔记
- 同章节详细 README（每个有 demo.sh + demo.go）：
  - [01-datatype](https://github.com/zhanbinb/go-interview-guide/blob/main/code/05-redis/01-datatype/README.md)
  - [02-datastructure](https://github.com/zhanbinb/go-interview-guide/blob/main/code/05-redis/02-datastructure/README.md)
  - 03-persistence · 04-high-availability · 05-cache-design · 06-transaction-lua · 07-memory
- 速查（面试前 30 分钟必看）：[INTERVIEW-QA.md](https://github.com/zhanbinb/go-interview-guide/blob/main/code/05-redis/INTERVIEW-QA.md)

### 同仓库对比
- [MySQL 面试复习指南](../mysql/notes/01-mysql-interview-study-guide.md) — 数据库底层对比
- [Etcd 运维、排错与企业级实践](../etcd/notes/01-etcd-ops-and-enterprise-patterns.md) — 分布式 KV / 一致性对比

### 外部推荐
- Redis 官方文档：<https://redis.io/documentation>
- Redis 源码：<https://github.com/redis/redis>
- antirez（Redis 作者）博客：<http://antirez.com>
- 《Redis 设计与实现》— 黄健宏（基于 Redis 3.0，底层原理经典）
- 《Redis 深度历险：核心原理与应用实践》— 钱文品（贴近实战）

### 关键数字 / 默认值（速查）
- String embstr 边界：**44 字节**（`64 - 16 - 3 - 1`）
- Hash listpack 阈值：**128 entries / 64 value bytes**
- Set intset 阈值：**512 entries**
- ZSet listpack 阈值：**128 entries / 64 value bytes**
- List 节点大小：**8KB**（`list-max-listpack-size=-2`）
- 慢命令阈值：**10ms**（`slowlog-log-slower-than 10000`）
- 内存碎片率告警：**> 1.5**
- Cluster slot 数：**16384**（2¹⁴）
- AOF everysec 丢失：**最多 1 秒**
- RDB `save 60 100` 丢失：**最多 60 秒 × 100 写**

---

#Redis #缓存 #分布式锁 #高可用 #面试 #Go后端 #SDS #skiplist #RDB #AOF #Cluster #Sentinel
