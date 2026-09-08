# Redis

Redis 笔记收录地。

> 在和 AI 一起学习的过程中逐步沉淀，每条知识点单独一个 Markdown 文件，放在 [`notes/`](notes/) 下。
> 重点场景：Go 后端面试准备 + 缓存设计 + 分布式锁 + 性能调优。

## 笔记目录

### 面试复习
- [01 · Redis 面试复习指南（数据类型 · 底层结构 · 持久化 · 高可用 · 缓存 · 事务 Lua · 内存）](notes/01-redis-interview-study-guide.md)
  - 7 大主题一站式：5+3 数据类型 + 应用场景 / SDS-dict-quicklist-skiplist-listpack / RDB-AOF-混合 / 主从-Sentinel-Cluster / 三大问题-分布式锁-一致性 / 事务-Lua-Pipeline / 过期策略-8 种淘汰-LRU·LFU
  - 配套：10 大面试题组速记（Q&A + 49 个必背金句 + 终极 Checklist）

## 写作约定

- 笔记命名：`NN-<topic>.md`，`NN` 为两位数序号。
- 一条笔记对应一个具体知识点，主题尽量独立、颗粒度适中。
- 笔记主体中文；关键字、类型名、API、命令保留英文。
