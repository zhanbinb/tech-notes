# MySQL 面试复习指南（架构 · 索引 · 事务 · 锁 · 日志 · 复制）

> 来源：[go-interview-guide/code/04-mysql](https://github.com/zhanbinb/go-interview-guide) 整理，覆盖架构、索引、事务、锁、日志、主从复制、MySQL vs SQL Server 七个高频主题。
> 风格：每节"必问核心 → 重点掌握 → 选学"三段式，便于面试速记。
> 对应原文：[mao888/golang-guide - mysql/](https://github.com/mao888/golang-guide/tree/main/mysql)

## TL;DR

- **一条 SQL 怎么跑**：连接器 → 分析器 → 优化器 → 执行器 → 存储引擎；UPDATE 比 SELECT 多了 undo/redo/binlog 三个日志。
- **索引**：InnoDB 默认 B+Tree，聚簇索引=数据本身，二级索引叶子存主键（必回表）；最左前缀、覆盖索引、ICP 是高频考点。
- **事务**：默认 RR（不是 RC！），通过 **Next-Key Lock** 防幻读；ACID 中 A=undo、D=redo、I=锁+MVCC、C=AID 共同保证。
- **锁**：行锁基于索引（无索引会锁全表！），Next-Key Lock = 记录锁 + 间隙锁；死锁自动检测，回滚成本小的事务。
- **日志**：redo（物理，crash-safe）+ undo（回滚+MVCC）+ binlog（逻辑，主从复制）；两阶段提交保证两者原子性。
- **复制**：binlog → relay log → 重放；生产用 **ROW 格式** + **半同步复制**（5.7+）+ **GTID**（8.0 默认）。
- **vs SQL Server**：默认隔离 RC vs RR、自增 IDENTITY vs AUTO_INCREMENT、TOP vs LIMIT、utf8mb4 必加、InnoDB `COUNT(*)` 不缓存。

---

## 1. 基础架构：一条 SQL 的执行流程

### 6 大组件（按执行顺序）

| 组件 | 作用 | 关键点 |
|------|------|--------|
| 连接器 | 管理连接 + 鉴权 | 权限快照缓存在内存，要重连才生效 |
| 查询缓存 | 缓存 SELECT 结果 | **8.0 已删**（命中率低、维护成本高）|
| 分析器 | 词法 + 语法 + 语义 | `SELECT * FRMO t` 报 syntax error |
| 优化器 | 生成最优执行计划 | 选索引、JOIN 顺序；8.0+ 加 hash join |
| 执行器 | 执行计划 + 调存储引擎 | 调 `engine.query()` |
| 存储引擎 | 真正存/取数据 | InnoDB / MyISAM / Memory，**可插拔** |

### SELECT vs UPDATE 流程差异

| 操作 | 关键差异 |
|------|----------|
| **SELECT** | 走**快照读**（MVCC），不阻塞；8.0 无查询缓存步骤 |
| **UPDATE** | 走**当前读**；写 **undo log** → 改 Buffer Pool → 写 **redo log（prepare）** → 写 **binlog** → 写 **redo log（commit）** |

### Buffer Pool

- MySQL 内存数据缓存，**默认 128MB**，生产建议设为机器内存的 60-70%
- 写入先写内存（Buffer Pool），再异步刷盘
- 命中率 > 99% 才正常（`SHOW ENGINE INNODB STATUS\G`）

### 关键 SQL

```sql
-- 长连接超时（默认 8 小时）
SHOW VARIABLES LIKE 'wait_timeout';

-- Buffer Pool 大小
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
```

---

## 2. 存储引擎：InnoDB vs MyISAM

| 维度 | InnoDB | MyISAM |
|------|--------|--------|
| 事务 | ✅ 支持 | ❌ 不支持 |
| 行锁 | ✅ 支持 | ❌ 只表锁 |
| MVCC | ✅ 支持 | ❌ |
| 外键 | ✅ 支持 | ❌ |
| 崩溃恢复 | ✅ redo log | ❌ 容易丢数据 |
| `COUNT(*)` | ❌ 不缓存（每次扫表）| ✅ 缓存行数 |
| 索引类型 | 聚簇索引（数据=索引）| 非聚簇（数据+索引分离）|

**生产默认 InnoDB**。**SQL Server 只有一种引擎**（类似 InnoDB 的特性，但不可插拔）。

---

## 3. 索引：B+Tree + 联合 + 覆盖 + EXPLAIN 🔥必问

### B+Tree 结构

```
                [50]
              /     \
        [20, 30]   [70, 80]              ← 非叶子：只存键
        /  |  \    /  |  \
      1  20 30  50 70 80  100            ← 叶子：数据或主键指针
      ↓  ↓  ↓   ↓  ↓  ↓   ↓
     ── 叶子节点用链表相连（范围扫快）──
```

**vs B 树**：B+Tree 数据全在叶子 → 树更矮、范围扫更快。

### 聚簇 vs 非聚簇（核心区分！）

| 类型 | MySQL InnoDB | SQL Server |
|------|--------------|-------------|
| 聚簇索引 | ✅ 表数据按主键聚簇存储 | ✅ 聚簇键是物理顺序 |
| 二级索引叶子 | **主键值**（不是指针）| **RID**（行号）|
| 数量 | **只有 1 个**（一般=主键）| 可多个 |

**关键结论**：
- MySQL **必须有主键**（无显式主键会用隐藏 ROW_ID）
- 主键越长 → 二级索引越大（因为叶子存的是主键值）
- **主键改不了**（不像 SQL Server 聚簇索引键可改）

### 联合索引（最左前缀原则）

```sql
CREATE INDEX idx_user ON t_user (name, age, city);

WHERE name = 'Alice'                            -- ✅ 用 name
WHERE name = 'Alice' AND age = 25               -- ✅ 用 name, age
WHERE name = 'Alice' AND age = 25 AND city = 'BJ' -- ✅ 全部
WHERE age = 25                                  -- ❌ 跳过 name
WHERE name = 'Alice' AND city = 'BJ'            -- ⚠️ 只用 name（age 断了）
```

**口诀**：从最左开始，不能跳过中间列。

### 覆盖索引（避免回表）

```sql
-- 索引: (name, age)
SELECT name, age FROM t_user WHERE name = 'Alice';  -- ✅ 覆盖
SELECT *     FROM t_user WHERE name = 'Alice';      -- ❌ 需回表
```

### 索引下推（ICP，5.6+）

```sql
-- 索引: (name, age)
-- 无 ICP：回表 10 行 → 内存过滤 age
-- 有 ICP：索引层就过滤 age（只回表 2 行）
SELECT * FROM t_user WHERE name = 'Alice' AND age > 20;
```

**确认生效**：`EXPLAIN` 的 Extra 列出现 `Using index condition`。

### EXPLAIN 必看字段

| 字段 | 关键值 |
|------|--------|
| `type` | system > const > eq_ref > ref > range > index > **ALL**（ALL=全表扫）|
| `key` | 实际用到的索引；NULL = 没走索引 |
| `rows` | 预估扫描行数，越少越好 |
| `Extra` | `Using index`（覆盖）> `Using index condition`（ICP）> `Using filesort`（差）> `Using temporary`（差）|

### 索引失效 10 大场景

```sql
-- 1. 不满足最左前缀
WHERE age = 25

-- 2. 范围查询导致后续列失效
WHERE name = 'Alice' AND age > 20  -- age 之后都失效

-- 3. 对索引列做函数/运算
WHERE DATE(create_time) = '2026-01-01'  -- 应改为 create_time >= '2026-01-01' AND < '2026-01-02'

-- 4. 隐式类型转换
WHERE id = '123'  -- id 是 INT，'123' 自动转数字，正常
WHERE name = 123  -- name 是 VARCHAR，自动转字符串，索引失效

-- 5. 隐式字符集转换（两表字符集不同，join 时）

-- 6. LIKE 以 % 开头
WHERE name LIKE '%Alice'  -- ❌ 失效
WHERE name LIKE 'Alice%'  -- ✅ 走索引

-- 7. OR 前后有非索引列
WHERE name = 'Alice' OR age = 25  -- age 无索引 → 全表扫

-- 8. NOT、!=、<> 可能失效（看统计信息）

-- 9. IS NULL / IS NOT NULL（看基数）

-- 10. IN 太多值（>30% → 全表扫）
```

### 索引设计原则

1. 不为频繁更新的列建索引（维护成本高）
2. 联合索引优于单列索引（覆盖更多查询）
3. 长字符串用前缀索引：`ALTER TABLE t ADD INDEX idx(col(10))`
4. **基数（区分度）低的列不建索引**（如性别、状态）
5. 推荐**自增主键 BIGINT**（顺序写，减少页分裂；UUID 随机写性能差）
6. 小表不建索引（全表扫更快）

### 高级：函数索引（8.0+）

```sql
-- 对 LOWER(email) 建索引
CREATE INDEX idx_email_lower ON t_user ((LOWER(email)));
SELECT * FROM t_user WHERE LOWER(email) = 'alice@example.com';  -- 现在走索引
```

---

## 4. 事务：ACID + 4 隔离级别 + MVCC 🔥必问

### ACID 实现

| 特性 | 含义 | MySQL 实现 |
|------|------|------------|
| **A**tomicity 原子性 | 全部成功或全部失败 | **undo log**（回滚用）|
| **C**onsistency 一致性 | 数据从一个一致状态到另一个 | AID 三者共同保证（**C 是目的**）|
| **I**solation 隔离性 | 并发事务互不干扰 | **锁 + MVCC** |
| **D**urability 持久性 | 提交后永久保存 | **redo log** |

### 4 个隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | MySQL 默认 | SQL Server 默认 |
|---------|-----|----------|------|-----------|----------------|
| READ UNCOMMITTED | ✅ | ✅ | ✅ | 支持 | 支持 |
| READ COMMITTED (RC) | ❌ | ✅ | ✅ | 支持 | **✅ 默认** |
| REPEATABLE READ (RR) | ❌ | ❌ | ✅（InnoDB 用 Next-Key Lock 防住）| **✅ MySQL 默认** | 支持 |
| SERIALIZABLE | ❌ | ❌ | ❌ | 支持 | 支持 |

**核心差异**：MySQL InnoDB 默认 **RR**，SQL Server 默认 **RC**；MySQL 在 RR 级别通过 **Next-Key Lock** 解决幻读。

### 三大问题

| 问题 | 含义 | 举例 |
|------|------|------|
| **脏读** | 读到别的事务**未提交**的数据 | A 改 → B 读 → A 回滚 → B 读到错的 |
| **不可重复读** | 同一行**两次读**结果不同 | A 读 → B 改 → A 再读（同一行变了）|
| **幻读** | 同一范围**两次读**行数不同 | A 读范围 → B 插入新行 → A 再读（多了一行）|

**关键区分**：不可重复读 = **单行**变了；幻读 = **范围**行数变了。

### MVCC 多版本并发控制

每行数据有 2 个隐藏列：
- `DB_TRX_ID`：最近修改的事务 ID
- `DB_ROLL_PTR`：回滚指针（指向 undo log）

**快照读（普通 SELECT）**：读事务开始时的快照版本，不阻塞。
**当前读（INSERT/UPDATE/DELETE/SELECT FOR UPDATE）**：读最新已提交版本，通过行锁保证。

### Next-Key Lock（防幻读的核心！）

```sql
-- 假设有 id: 1, 5, 10, 15
SELECT * FROM t WHERE id BETWEEN 5 AND 10 FOR UPDATE;
-- InnoDB 实际锁住：
--   记录锁: id=5, id=10
--   间隙锁: (-∞, 5), (5, 10), (10, 15)
-- → 其他事务不能在 1-5、5-10、10-15 范围插入
```

**Next-Key Lock = 记录锁 + 间隙锁**（前开后闭）。

### 事务常用 SQL

```sql
START TRANSACTION;   -- 或 BEGIN
-- 业务操作
COMMIT;              -- 或 ROLLBACK

-- 查看隔离级别
SELECT @@global.transaction_isolation;
SELECT @@session.transaction_isolation;
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

### 大事务的坑

- 锁太多行 → 并发度低
- undo log 太大 → 回滚慢
- 主从延迟大（binlog 等事务完成）
- 连接占用时间长

**解决**：拆小事务 + `SELECT ... FOR UPDATE LIMIT n` + 异步处理大任务。

---

## 5. 锁：行锁 + 意向锁 + Next-Key Lock + 死锁 🔥必问

### 按粒度分

| 锁类型 | 粒度 | 性能 | 场景 |
|--------|------|------|------|
| 全局锁 | 整个 MySQL | 极差 | 备份（`FLUSH TABLES WITH READ LOCK`）|
| 表级锁 | 整张表 | 差 | MyISAM、METADATA LOCK |
| 行级锁 | 单行 | 好 | **InnoDB 默认**（基于索引！）|

### 共享锁 vs 排他锁

- `SELECT ... LOCK IN SHARE MODE` → 加 S 锁
- `SELECT ... FOR UPDATE` → 加 X 锁
- `UPDATE / DELETE / INSERT` → 自动加 X 锁

### 意向锁（Intent Lock）

**问题**：事务 A 加行 X 锁，事务 B 想加表 X 锁（`ALTER TABLE`），需要扫所有行判断冲突 → 慢。

**解决**：加行 X 锁时**自动给表加 IX 锁**；事务 B 看表有没有 IX 锁决定是否等待。

| 锁类型 | 含义 | 兼容性 |
|--------|------|--------|
| IS (意向共享) | 事务打算在某些行加 S 锁 | 与 IX/X 冲突 |
| IX (意向排他) | 事务打算在某些行加 X 锁 | 与 S/X/IS/IX 都冲突 |

### 行锁算法

| 算法 | 锁定范围 | 解决什么 |
|------|----------|----------|
| **记录锁 Record Lock** | 单个索引记录 | 单行更新冲突 |
| **间隙锁 Gap Lock** | 索引记录之间的间隙 | 阻止插入（防幻读）|
| **Next-Key Lock** | 记录 + 间隙（前开后闭）| RR 级别防幻读 |

### 死锁排查

```sql
-- 查看最近一次死锁
SHOW ENGINE INNODB STATUS\G
-- 找 LATEST DETECTED DEADLOCK 段

-- 锁等待关系
SELECT
    r.trx_id AS waiting_trx,
    r.trx_mysql_thread_id AS waiting_thread,
    b.trx_id AS blocking_trx,
    b.trx_mysql_thread_id AS blocking_thread
FROM information_schema.INNODB_LOCK_WAITS w
JOIN information_schema.INNODB_TRX r ON w.requesting_trx_id = r.trx_id
JOIN information_schema.INNODB_TRX b ON w.blocking_trx_id = b.trx_id;
```

**预防死锁**：固定访问顺序 + 加合适索引 + 小事务 + `innodb_lock_wait_timeout` 超时。

### 乐观锁 vs 悲观锁

| 类型 | 实现 | 场景 |
|------|------|------|
| **悲观锁** | `SELECT FOR UPDATE` | 写多读少、冲突多 |
| **乐观锁** | version 列 + CAS | 读多写少、冲突少 |

```sql
-- 乐观锁实现
ALTER TABLE t ADD COLUMN version INT NOT NULL DEFAULT 0;
UPDATE t SET name = 'new', version = version + 1
WHERE id = 1 AND version = 0;
-- 如果影响行数 = 0，版本冲突，重试
```

### 8.0 新增：SKIP LOCKED / NOWAIT

```sql
-- 跳过已锁定行（队列场景：worker 抢任务）
SELECT * FROM t_task WHERE status = 'pending'
  ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED;

-- 不等锁直接报错
SELECT * FROM t WHERE id = 1 FOR UPDATE NOWAIT;
```

---

## 6. 日志：binlog + redo log + undo log + 两阶段提交 🔥必问

### 三种核心日志对比

| 日志 | 层级 | 内容 | 作用 | 写入 |
|------|------|------|------|------|
| **redo log** | InnoDB | 物理日志（页修改）| **crash-safe / 持久性 D** | 循环写 |
| **binlog** | Server | 逻辑日志（SQL/行）| **主从复制 / 数据恢复** | 追加写 |
| **undo log** | InnoDB | 逻辑日志（反向操作）| **回滚 + MVCC** | 追加写 |

**记忆口诀**：
- **redo** = 重新做 = 恢复数据（crash-safe）
- **undo** = 反着做 = 回滚或 MVCC
- **binlog** = bin = 二进制 = 给从库用的

### redo log（重做日志）

**核心机制：WAL（Write-Ahead Logging）** —— 事务提交前先写 redo log，再写数据。

**为什么 redo log 比直接刷数据快**：顺序写（O(1)）vs 随机写（要找数据页）。

**循环写**：`write pos` 追上 `check point` 时必须停下刷盘。

### binlog（二进制日志）

**三种格式**：

| 格式 | 含义 | 生产 |
|------|------|------|
| **STATEMENT** | 记录 SQL | ❌（`now()` 主从不一致）|
| **ROW** | 记录每行变化 | ✅ **8.0 默认**（准确）|
| **MIXED** | 混合 | ⚠️ |

**关键参数**：

```sql
SHOW VARIABLES LIKE 'binlog_format';
SHOW VARIABLES LIKE 'sync_binlog';   -- 0=OS 刷盘，1=每次 fsync（最安全，推荐）
SHOW MASTER STATUS;                    -- 当前 binlog 位置
```

### undo log（回滚日志）

- 事务开始时记录要修改的数据的**原始值**
- ROLLBACK 时把数据改回原值
- MVCC 快照读通过 `DB_ROLL_PTR` 找历史版本
- 事务提交后**不立即删除**（MVCC 还要用），由 purge 线程异步清理

### 两阶段提交（必问难点！）

**问题**：redo log 和 binlog 是**两个独立写**，如何保证原子性？

```
START TRANSACTION
  ↓
写 undo log
  ↓
更新 Buffer Pool
  ↓
写 redo log（**prepare**）  ← 第 1 写
  ↓
写 binlog
  ↓
写 redo log（**commit**）  ← 第 2 写
  ↓
COMMIT
```

**崩溃恢复规则**：
- redo log 是 **commit** 状态 → 提交
- redo log 是 **prepare** + **binlog 完整** → 提交
- redo log 是 **prepare** + **binlog 不完整** → 回滚

### 事务提交后数据真的写盘了吗？

**不一定！** 事务提交 = redo log 已刷盘（持久性 D 满足），但**数据页可能还在 Buffer Pool**；数据库崩溃后重启会从 redo log 自动恢复。

---

## 7. 主从复制：binlog + 读写分离 🔥必问

### 复制原理（3 步，必背）

```
Master 端:                          Slave 端:

  客户端写 SQL
  ↓
  Master 执行事务
  ↓
  写 binlog
  ↓
  dump thread 推 binlog  ──────→  Slave IO Thread
                                    │  把 binlog 写入 relay log
                                    ↓
                                  Slave SQL Thread
                                    │  重放 relay log
                                    ↓
                                  Slave 数据跟 Master 一致
```

**关键词**：**binlog + relay log + 重放**。

### 3 种复制方式

| 方式 | 数据一致性 | 性能 | 场景 |
|------|----------|------|------|
| **异步复制**（默认）| ❌ 可能丢数据 | ✅ 最快 | 性能优先 |
| **半同步复制**（5.7+）| ✅ 至少 1 个 slave 收到 | ⚠️ 略慢 | **生产推荐** |
| **同步复制** | ✅ 全部 slave 收到 | ❌ 最慢 | 金融级别 |

### 异步复制的问题

```
Master 写完 binlog → 立即返回客户端"成功"
但 Master 此时挂了 → binlog 没推给 Slave → 数据丢失 ❌
```

**半同步修复**：Master 等至少 1 个 Slave 收到 binlog 才返回。

### 主从延迟原因 & 解决

**原因**：Slave 单线程重放（默认 `slave_parallel_workers=0`）+ 大事务 / DDL。

**查询延迟**：`SHOW SLAVE STATUS\G` 看 `Seconds_Behind_Master`。

**7 个解决方案**：
1. **大事务拆小事务**（最重要）
2. **多线程复制**：`SET GLOBAL slave_parallel_workers = 8`（5.6+）
3. 半同步复制
4. 强制走主库（核心业务查询）
5. 延迟从库（报表读不敏感）
6. 缓存（Redis 热点）
7. 业务拆分（不同业务用不同主从）

### GTID 复制（5.6+，8.0 默认）

**GTID = Global Transaction Identifier**：`server_uuid:transaction_id`

**好处**：
- 主从切换不需要找 binlog 位点
- 主从状态一致性自动检测
- 配置简单（不用 `master_log_file + master_log_pos`）

```ini
# my.cnf
gtid_mode = ON
enforce_gtid_consistency = ON
```

### 高可用架构

| 架构 | 特点 | 适用 |
|------|------|------|
| **一主多从** | 简单、读扩展 | 读多写少 |
| **MHA + 一主多从** | 30 秒自动切换 | **生产推荐** |
| **MGR（Group Replication）** | 多主、强一致 | 5.7+，金融 |
| **级联复制** | 减轻 Master 压力 | 数据仓库 |

### 主从切换

- **手动**：`STOP SLAVE; RESET MASTER;` + 改应用连接串
- **自动（MHA / Orchestrator / ProxySQL）**：检测 Master 挂 → 选最新 Slave 提升 → 切换应用 → 10-30 秒完成

### 延迟从库（防误操作）

```sql
CHANGE MASTER TO MASTER_DELAY = 3600;  -- 延迟 1 小时
-- 场景：`DELETE WHERE 1=1` 误操作后，1 小时内可从延迟从库恢复
```

---

## 8. MySQL vs SQL Server 对比（迁移必看）

### 隔离级别

| 维度 | SQL Server | MySQL |
|------|-----------|-------|
| 默认隔离 | **RC** | **RR** |
| 快照读 | 需要 SNAPSHOT 隔离（额外开销）| RR 级别默认就有（MVCC）|
| 幻读解决 | SERIALIZABLE 或 SNAPSHOT | RR 级别 + Next-Key Lock |
| 锁粒度（行）| RID | 主键 / 索引项 |
| 嵌套事务 | SAVE TRANSACTION | SAVEPOINT |
| 分布式事务 | MSDTC | XA / Seata |

### 数据类型 & 函数

| 场景 | SQL Server | MySQL |
|------|-----------|-------|
| 自增 | `IDENTITY(1,1)` | `AUTO_INCREMENT` |
| 取刚插入的 ID | `SCOPE_IDENTITY()` | `LAST_INSERT_ID()` |
| 顶部 N 行 | `SELECT TOP 10` | `SELECT ... LIMIT 10` |
| 跳过 | `OFFSET 20 ROWS FETCH NEXT 10` | `LIMIT 10 OFFSET 20` |
| NULL 处理 | `ISNULL(col, 0)` | `IFNULL(col, 0)` |
| 当前时间 | `GETDATE()` | `NOW()` / `CURRENT_TIMESTAMP` |
| 日期加减 | `DATEADD(DAY, 1, col)` | `DATE_ADD(col, INTERVAL 1 DAY)` |
| 日期差 | `DATEDIFF(DAY, a, b)` | `DATEDIFF(a, b)`（**参数顺序相反**）|
| 大文本 | `VARCHAR(MAX)` | `TEXT / LONGTEXT` |
| Unicode | `NVARCHAR(n)` | `VARCHAR(n)` + `utf8mb4` |
| 临时表 | `#temp` | `CREATE TEMPORARY TABLE` |
| JSON | `NVARCHAR(MAX)` + `JSON_VALUE` | 原生 `JSON` 类型 + `col->>'$.key'` |
| 字符串拼接 | `+` | `CONCAT()` |
| 布尔 | `BIT` | `TINYINT(1)` / `BOOLEAN` |

### 字符集（高频坑！）

- SQL Server 默认 nvarchar（UCS-2）
- MySQL 5.7+ / 8.0 推荐 **utf8mb4**（老 utf8 是 3 字节，**不能存 emoji**）
- **建库必加**：

```sql
CREATE DATABASE mydb DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE t CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 自增溢出

| DB | INT 上限 | 解决方案 |
|----|---------|----------|
| SQL Server `INT` | 2,147,483,647（21 亿）| 改 `BIGINT` |
| MySQL `INT UNSIGNED` | 4,294,967,295（42 亿）| 改 `BIGINT UNSIGNED` |
| MySQL `INT`（有符号）| 同 SQL Server 21 亿 | 改 `BIGINT` |

### 大表 `COUNT(*)` 性能

| DB | 行为 |
|----|------|
| SQL Server | 全表扫描（可加索引优化）|
| **MySQL InnoDB** | **不缓存行数**，每次都全表扫 |
| MySQL MyISAM | 缓存行数（但不支持事务）|

**MySQL 优化**：
- 维护计数表：`UPDATE count_t SET cnt = (SELECT COUNT(*) FROM big_t)`
- 或用 `information_schema.tables.TABLE_ROWS`（不准确，仅参考）

### 深分页问题

```sql
-- ❌ 错误：OFFSET 越大越慢（OFFSET 100万 扫描 100万+20 行）
SELECT * FROM t ORDER BY id LIMIT 10 OFFSET 1000000;

-- ✅ 正确：游标分页（用上次查询的最大 ID）
SELECT * FROM t WHERE id > 1000000 ORDER BY id LIMIT 10;
```

### 字符串比较

| 行为 | SQL Server | MySQL |
|------|-----------|-------|
| 默认排序规则 | `SQL_Latin1_General_CP1_CI_AS` | `utf8mb4_0900_ai_ci`（8.0 默认）|
| 尾部空格 | 不匹配 `'abc '` | **不忽略尾部空格**（可能漏匹配）|

### MySQL 迁移实践建议

1. **建库必加**：`CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
2. **主键推荐自增** `INT UNSIGNED` 或 `BIGINT`（避免 UUID 随机写）
3. **深分页必须用游标**（不能 OFFSET 100万）
4. **大表 `COUNT(*)` 用计数表**（不能直接 COUNT）
5. **避免 `SELECT *`**（特别是含 TEXT 字段）
6. **时间用 `DATETIME`**（不要 `TIMESTAMP`：4 字节，2038 年问题；且受时区影响）

---

## 🎯 面试最常被问的核心问题

1. **一条 SQL 怎么执行？SELECT 和 UPDATE 流程区别？**
   → 连接器 → 分析器 → 优化器 → 执行器 → 存储引擎；SELECT 走快照读，UPDATE 走当前读 + 写 undo/redo/binlog 三个日志。

2. **MySQL 默认隔离级别？和 SQL Server 区别？**
   → MySQL RR，SQL Server RC；MySQL 在 RR 级别用 Next-Key Lock 防幻读。

3. **B+Tree 和 B 树区别？为什么用 B+Tree？**
   → 数据全在叶子节点（树更矮），叶子用链表连接（范围扫快）。

4. **聚簇 vs 非聚簇索引？**
   → 聚簇索引的叶子就是数据行（数据按索引顺序存储）；非聚簇叶子存主键（MySQL）或 RID（SQL Server）。

5. **最左前缀原则 / 覆盖索引 / 索引下推？**
   → 联合索引从最左列开始、不能跳列；覆盖索引避免回表；ICP 在索引层就过滤 WHERE 条件。

6. **什么是 MVCC？快照读 vs 当前读？**
   → 每行有 `DB_TRX_ID` + `DB_ROLL_PTR`；普通 SELECT 是快照读（不阻塞），FOR UPDATE/UPDATE/DELETE 是当前读（加锁）。

7. **ACID 怎么实现？**
   → A 原子性 = undo log；C 一致性 = AID 共同保证；I 隔离性 = 锁 + MVCC；D 持久性 = redo log。

8. **redo log 和 binlog 区别？两阶段提交？**
   → redo 是 InnoDB 物理日志（循环写、crash-safe），binlog 是 Server 逻辑日志（追加写、主从复制）；两阶段（prepare + commit）保证两者原子性。

9. **MySQL 主从复制原理？3 种复制方式？**
   → binlog → relay log → 重放；异步（可能丢）、半同步（推荐）、同步（最慢）。

10. **MySQL vs SQL Server 最大差异？**
    → 默认隔离 RC vs RR；自增 IDENTITY vs AUTO_INCREMENT；MySQL 存储引擎可插拔，SQL Server 只有一种。

---

## 常见坑（生产经验）

- **行锁是基于索引的**：无索引的 WHERE 会锁全表（即使只查 1 行）
- **大事务 + FOR UPDATE 容易锁全表**：用 `WHERE id > ? AND id < ?` 限制范围，或 `SKIP LOCKED`
- **MDL 锁坑**：长事务 + 频繁查询会让所有 `ALTER TABLE` 排队 → DDL 放低峰期
- **`SELECT *` 包含 TEXT/BLOB 可能截断**：明确列名
- **深分页 OFFSET 不能用**：`OFFSET 100万` 扫描 100万+20 行
- **utf8 不是真 utf8**：必须用 `utf8mb4` 才能存 emoji
- **TIMESTAMP 2038 年问题**：用 DATETIME 存业务时间
- **JSON 类型查询慢**：大 JSON 性能一般，考虑用 VARCHAR + 函数索引
- **InnoDB 不缓存行数**：`COUNT(*)` 每次全表扫，大表用计数表
- **半同步复制配置要两端都装插件**：Master 装 `rpl_semi_sync_master`，Slave 装 `rpl_semi_sync_slave`

---

## 相关链接

- [go-interview-guide 仓库](https://github.com/zhanbinb/go-interview-guide)
- [mao888/golang-guide - mysql 原文](https://github.com/mao888/golang-guide/tree/main/mysql)
- [MySQL 8.0 官方文档 - InnoDB](https://dev.mysql.com/doc/refman/8.0/en/innodb-storage-engine.html)
- [MySQL 8.0 官方文档 - 复制](https://dev.mysql.com/doc/refman/8.0/en/replication.html)
- [MySQL 8.0 官方文档 - EXPLAIN](https://dev.mysql.com/doc/refman/8.0/en/explain.html)
- [MySQL 死锁排查实战](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks.html)

---

#MySQL #面试 #InnoDB #索引 #事务 #锁 #主从复制
