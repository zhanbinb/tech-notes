# INDEX · 知识点索引

跨语言检索入口。新增笔记时请同步在此登记，方便后续查找。

## 按语言浏览

- [AI](AI/README.md)
- [Codex](codex/README.md)
- [Go (golang)](golang/README.md)
- [Docker](docker/README.md)
- [Solidity](solidity/README.md)
- [Python](python/README.md)
- [Tools](tools/README.md)

### AI · 当前笔记
_暂无条目_

### Codex · 当前笔记
- [01 · Codex Skill 创建：通过 Plugin 分发](codex/notes/01-codex-skill-creation-via-plugin.md)
- [02 · Codex 个人插件：完整开发与安装流程](codex/notes/02-codex-personal-plugin-install-flow.md)

### Go · 当前笔记
- [01 · Go 后端学习路线图（融合版）](golang/notes/01-go-backend-roadmap.md)
- [02 · 第一梯队：企业级框架](golang/notes/02-go-tier1-enterprise-frameworks.md)
- [03 · 第二梯队：云原生基础设施](golang/notes/03-go-tier2-cloudnative-infra.md)
- [04 · 第三梯队：存储与消息队列](golang/notes/04-go-tier3-storage-and-mq.md)
- [05 · 第四梯队：Web3 区块链](golang/notes/05-go-tier4-web3-blockchain.md)
- [06 · 第五梯队：业务系统模板](golang/notes/06-go-tier5-business-systems.md)
- [go-clean-arch · Clean Architecture 项目拆解](golang/notes/go-clean-arch/)
  - [01 · Echo vs Gin](golang/notes/go-clean-arch/01-echo-vs-gin.md)
  - [02 · main.go 拆解 · Clean Architecture 入口视角](golang/notes/go-clean-arch/02-main-go-clean-arch.md)

### Docker · 当前笔记
- [01 · Docker vs Docker Compose 区别](docker/notes/01-docker-vs-compose.md)
- [02 · Dockerfile vs compose.yaml 区别](docker/notes/02-dockerfile-vs-compose-yaml.md)
- [03 · go-clean-arch 本地跑通实战（含踩坑）](docker/notes/03-go-clean-arch-local-run.md)

### Tools · 当前笔记
- [01 · Chrome 页面图标缺失：系统代理进程崩溃导致 TLS 失败](tools/notes/01-chrome-icons-missing-system-proxy-dead.md)

## 按主题浏览

### Codex 工具链
- [Codex Skill 创建：通过 Plugin 分发](codex/notes/01-codex-skill-creation-via-plugin.md)
- [Codex 个人插件完整开发与安装流程](codex/notes/02-codex-personal-plugin-install-flow.md)

### Go 后端学习路线
- [路线图 · 8 阶段学习路径（融合版）](golang/notes/01-go-backend-roadmap.md)
- [企业级项目分级 · 第一~第五梯队](golang/notes/02-go-tier1-enterprise-frameworks.md) · [03](golang/notes/03-go-tier2-cloudnative-infra.md) · [04](golang/notes/04-go-tier3-storage-and-mq.md) · [05](golang/notes/05-go-tier4-web3-blockchain.md) · [06](golang/notes/06-go-tier5-business-systems.md)
- [main.go 拆解 · Clean Architecture 入口视角](golang/notes/go-clean-arch/02-main-go-clean-arch.md) · 配套实战：[docker/03 go-clean-arch 跑通](./docker/notes/03-go-clean-arch-local-run.md)

### Docker 容器化
- [Docker vs Docker Compose 区别](docker/notes/01-docker-vs-compose.md)
- [Dockerfile vs compose.yaml 区别](docker/notes/02-dockerfile-vs-compose-yaml.md)
- [go-clean-arch 本地跑通实战](docker/notes/03-go-clean-arch-local-run.md)

### 工具与排查
- [Chrome 页面图标缺失：系统代理进程崩溃导致 TLS 失败](tools/notes/01-chrome-icons-missing-system-proxy-dead.md)

### 路线图阶段对应
| 阶段 | 主题 | 重点项目 | 笔记 |
| --- | --- | --- | --- |
| 0 | Go 基础速通 | — | [01](./golang/notes/01-go-backend-roadmap.md) |
| 1 | 工程规范 | go-clean-arch | [01](./golang/notes/01-go-backend-roadmap.md) · [06](./golang/notes/06-go-tier5-business-systems.md) |
| 2 | 企业后台 | Gitea | [01](./golang/notes/01-go-backend-roadmap.md) · [06](./golang/notes/06-go-tier5-business-systems.md) |
| 3 | 微服务 | go-zero | [01](./golang/notes/01-go-backend-roadmap.md) · [02](./golang/notes/02-go-tier1-enterprise-frameworks.md) |
| 4 | 高并发 + IO | MinIO + Prometheus | [01](./golang/notes/01-go-backend-roadmap.md) · [03](./golang/notes/03-go-tier2-cloudnative-infra.md) · [04](./golang/notes/04-go-tier3-storage-and-mq.md) |
| 5 | 分布式 | etcd + K8s | [01](./golang/notes/01-go-backend-roadmap.md) · [03](./golang/notes/03-go-tier2-cloudnative-infra.md) |
| 6 | Web3 | go-ethereum + Chainlink | [01](./golang/notes/01-go-backend-roadmap.md) · [05](./golang/notes/05-go-tier4-web3-blockchain.md) |
| 7 | 大项目 + 云原生 | Docker + Harbor + Operator | [01](./golang/notes/01-go-backend-roadmap.md) · [03](./golang/notes/03-go-tier2-cloudnative-infra.md) · [docker/notes](./docker/) |

## 按标签浏览

- `#学习路线` — 阶段规划、节奏建议
- `#企业级框架` — go-zero / Kratos / Hertz
- `#云原生` — K8s / Docker / Prometheus / etcd
- `#存储` — MinIO
- `#消息队列` — go-nsq / Kafka / RocketMQ
- `#Web3` — go-ethereum / Chainlink / Cosmos SDK
- `#业务系统` — Gitea / Grafana / Harbor / gin-vue-admin / ferry / mall-go / KamaChat
- `#Codex 插件` — cachebuster / marketplace / plugin-creator / 沙盒 escalate
- `#架构模板` — Clean Architecture / RealWorld
- `#入口装配` — main.go 流水线、手工 DI、中间件注册
- `#Docker` — Docker / Docker Compose / Dockerfile / compose.yaml
- `#chrome` — Chrome 浏览器相关问题排查
- `#macos` — macOS 系统级问题
- `#troubleshooting` — 故障排查流程
- `#network` — 网络层问题（DNS / TLS / 代理 / 防火墙）
- `#tls` — SSL/TLS 握手问题
- `#system-proxy` — 系统代理配置与故障
- `#clashx` — ClashX 代理工具相关

## 最近更新

- **2026-07-20** · 重构分类：Codex 相关笔记从 AI/tools 合并到新 `codex/` 分类
  - `codex/notes/01-codex-skill-creation-via-plugin.md`（原 AI/notes/01）
  - `codex/notes/02-codex-personal-plugin-install-flow.md`（原 tools/notes/02）
  - 同主题笔记集中管理；AI/ 暂留空分类、tools/ 只剩 Chrome 排查

- **2026-07-20** · 增补 Tools 笔记：cachebuster 不会自动 reload + 完整更新 SOP
  - 笔记：`codex/notes/02-codex-personal-plugin-install-flow.md`（新增"坑 5"和"完整更新 SOP"两节）
  - 关键价值：把"改源 → cachebuster → 同步 cache → 重启 Codex"沉淀成标准 4 步流程

- **2026-07-20** · 新增 Tools 笔记：Codex 个人插件完整开发与安装流程
  - 笔记：`codex/notes/02-codex-personal-plugin-install-flow.md`
  - 关键价值：把"cache 残留 → 重建 source → marketplace 注册 → 显式 install → 清理残留"沉淀成可复用 SOP

- **2026-07-20** · 新增 Tools 分类：Chrome 页面图标缺失排查笔记
  - 笔记：`tools/notes/01-chrome-icons-missing-system-proxy-dead.md`
  - 关键价值：固化「DevTools ERR_FAILED → curl SSL_ERROR_SYSCALL → scutil/lsof 定位代理进程崩溃」的完整排查流程，避免下次再走弯路

- **2026-07-17** · Go 笔记结构重构：go-clean-arch 相关笔记归入子目录
  - `golang/notes/go-clean-arch/01-echo-vs-gin.md`（原 07）
  - `golang/notes/go-clean-arch/02-main-go-clean-arch.md`（原 08）
  - 为后续 go-clean-arch 项目的方法拆解笔记预留位置

- **2026-07-17** · 新增 Go 笔记：main.go 拆解 · Clean Architecture 入口视角
  - 笔记：`golang/notes/go-clean-arch/02-main-go-clean-arch.md`
  - 关键价值：把 go-clean-arch 入口文件拆成 9 阶段装配流水线，串起 init() / 空白导入 / defer / interface 隐式实现 四个 Go 核心点


- **2026-07-17** · 新增 AI 笔记：Codex Skill 创建（Plugin 分发机制）
  - 笔记：`codex/notes/01-codex-skill-creation-via-plugin.md`
  - 关键价值：澄清 Codex 的 skill 发现机制，避免下次再踩 "把 SKILL.md 放到 ~/.codex/skills/ 却不生效" 的坑

- **2026-07-17** · 新增 Docker 容器化笔记系列（3 篇）
  - 基础概念：[01 Docker vs Docker Compose](./docker/notes/01-docker-vs-compose.md) · [02 Dockerfile vs compose.yaml](./docker/notes/02-dockerfile-vs-compose-yaml.md)
  - 实战踩坑：[03 go-clean-arch 本地跑通](./docker/notes/03-go-clean-arch-local-run.md)
  - 关键价值：阶段 7 云原生前置 + 阶段 1 工程规范的容器化补充

- **2026-07-17** · Go 学习路线升级到融合版（8 阶段）
  - 路线图：`golang/notes/01-go-backend-roadmap.md`
  - 关键变化：增加阶段 0 补基础、强制"自己实现一遍"、Web3 权重 35%、阶段 4–5–7 去重
  - 五梯队项目清单保持稳定：`02` / `03` / `04` / `05` / `06`

- **2026-07-17** · 初始化 Go 学习路线系列（6 篇）
  - 路线图：`golang/notes/01-go-backend-roadmap.md`
  - 五大梯队项目清单：`02` / `03` / `04` / `05` / `06`
