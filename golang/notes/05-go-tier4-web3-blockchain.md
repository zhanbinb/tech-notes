# 第四梯队：Web3 区块链

> Go 在 Web3 领域是绝对主力语言（go-ethereum 占以太坊节点 70%+）。
> 如果目标是 Web3 后端（链交互、节点服务、DeFi 后端），这一梯队的优先级**最高**。

## go-ethereum（Geth） ⭐⭐⭐⭐⭐

- 仓库：https://github.com/ethereum/go-ethereum
- Star：45k+
- 地位：以太坊官方 Go 实现，最广泛使用的以太坊客户端

**重点阅读目录**：
```
ethclient/        # RPC 客户端（最常用，外部程序调链的入口）
eth/              # RPC API 实现
rpc/              # JSON-RPC 协议层
core/             # 区块链核心：区块、交易、状态机
core/types/       # 交易 / 收据 / 日志的数据结构
core/txpool/      # 交易池（Mempool）实现
accounts/         # 账户与签名
internal/ethapi/  # RPC handler 实现
```

**核心学习点**：
- **JSON-RPC 协议实现**：每个 namespace（eth/ net/ web3/ debug）的方法注册
- **`ethclient` 客户端封装**：`BlockByNumber / FilterLogs / TransactionReceipt`
- **Event/Log 过滤机制**：Bloom filter + topic 匹配
- **交易生命周期**：签名 → 提交到 txpool → 打包进区块 → 状态变更
- **EVM 执行**：`core/vm/` 下的 EVM 字节码解释器

**实战建议**：
1. 写一个 indexer，订阅合约 Event 并入库（类似 [go_block_scanner](https://github.com/zhanbinb/go_block_scanner) 风格）
2. 看 `ethclient.Client.FilterLogs` 怎么实现"从某个区块开始抓取所有 Transfer 事件"
3. 读 `core/types/receipt.go` 理解 receipt 与 log 的关系

## Chainlink ⭐⭐⭐⭐⭐

- 仓库：https://github.com/smartcontractkit/chainlink
- 定位：去中心化预言机（Oracle）网络，DeFi 基础设施
- 技术栈：Go + Solidity + Postgres + Kafka

**核心学习点**：
- **Job / Pipeline / Task** 三层抽象：链下任务的编排模型
- **OCR（Off-Chain Reporting）**：链下聚合签名，链上验证
- **多链适配**：EVM / Solana / Cosmos 各链的 relayer 怎么抽象
- **Worker 调度**：任务队列 + 节点间共识

**适合学习场景**：
- DeFi 协议后端（价格预言机、随机数、跨链）
- 复杂的链下任务调度（不只调一次链，而是一连串任务）

## Cosmos SDK ⭐⭐⭐⭐

- 仓库：https://github.com/cosmos/cosmos-sdk
- 定位：Cosmos 生态的应用链开发框架
- 技术栈：Go + ABCI + Tendermint 共识

**核心学习点**：
- **ABCI（Application Blockchain Interface）**：应用层与共识层的解耦
- **Module 模式**：每个功能（bank / staking / gov）是一个 module
- **状态机**：每个交易是确定性状态转移函数
- **多链架构**：Zone / Hub / IBC 跨链通信

**适合学习场景**：
- 想做应用链 / 联盟链 / 隐私链
- 准备 Web3 高级岗位面试（架构思维）

## 其他值得了解

- **[Optimism](https://github.com/ethereum-optimism/optimism)**：OP Stack，L2 解决方案
- **[Bitcoin Core](https://github.com/bitcoin/bitcoin)**（C++）：UTXO 模型参考
- **[Solana](https://github.com/solana-labs/solana)**（Rust）：性能链代表
- **[Foundry](https://github.com/foundry-rs/foundry)**（Rust）：Solidity 开发工具链

## 学习顺序（针对 Web3 后端）

1. **先会用**：用 `ethclient` 调链（读区块、读事件、发交易）
2. **读源码**：`core/types` 和 `ethclient` 是 80% 工作的入口
3. **跑节点**：本地起一个 geth dev mode，看 RPC 调用
4. **做项目**：写一个 Event indexer（订阅 ERC20 Transfer 事件并入库）
5. **进阶**：读 Chainlink 的 Pipeline 实现，理解 DeFi 后端套路

## 与传统后端的能力对照

| 传统后端能力 | Web3 对应能力 |
| --- | --- |
| 数据库 | 链上状态（State） |
| 消息队列 | Event Log |
| 微服务 | 合约调用（cross-contract call） |
| 分布式事务 | 链上原子性 |
| 缓存 | Mempool 监听 |
