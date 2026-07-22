# Go

Go 语言笔记收录地。

> 在和 AI 一起学习的过程中逐步沉淀，每条知识点单独一个 Markdown 文件，放在 [`notes/`](notes/) 下。

## 笔记目录

### 学习路线
- [01 · Go 后端学习路线图（综合规划）](notes/01-go-backend-roadmap.md)

### 企业级项目分级
- [02 · 第一梯队：企业级框架（go-zero / Kratos / Hertz）](notes/02-go-tier1-enterprise-frameworks.md)
- [03 · 第二梯队：云原生基础设施（K8s / Docker / Prometheus / etcd）](notes/03-go-tier2-cloudnative-infra.md)
- [04 · 第三梯队：存储与消息队列（MinIO / go-nsq / Kafka）](notes/04-go-tier3-storage-and-mq.md)
- [05 · 第四梯队：Web3 区块链（go-ethereum / Chainlink / Cosmos SDK）](notes/05-go-tier4-web3-blockchain.md)
- [06 · 第五梯队：业务系统模板（Gitea / Grafana / Harbor / gin-vue-admin 等）](notes/06-go-tier5-business-systems.md)
- [go-clean-arch · Clean Architecture 项目拆解](notes/go-clean-arch/)
  - [01 · Echo vs Gin](notes/go-clean-arch/01-echo-vs-gin.md)
  - [02 · main.go 拆解 · Clean Architecture 入口视角](notes/go-clean-arch/02-main-go-clean-arch.md)
  - [03 · Delivery 层拆解（internal/rest/article.go）](notes/go-clean-arch/03-rest-delivery-layer.md)
  - [04 · Repository 层拆解（internal/repository/mysql/article.go）](notes/go-clean-arch/04-repository-mysql-layer.md)
  - [05 · 原生 database/sql vs sqlx/gorm/sqlc 选型](notes/go-clean-arch/05-native-sql-vs-orm.md)
  - [06 · cmd 双入口、wire 组合根、Swagger 与 Bearer 协议实战](notes/go-clean-arch/06-cmd-entries-wire-and-bearer.md)
  - [07 · Register 五层调用链与 Go 依赖反转（含接收者与类型别名）](notes/go-clean-arch/07-register-call-chain-and-di.md)

## 写作约定

- 笔记命名：`NN-<topic>.md`，`NN` 为两位数序号。
- 一条笔记对应一个具体知识点，主题尽量独立、颗粒度适中。
- 笔记主体中文；关键字、类型名、API 保留英文。
