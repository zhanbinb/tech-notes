# 第五梯队：业务系统模板

> 这些是"完整业务项目"，适合写进简历的实战经历、或者学习企业级后台架构。
> 规模从大到小排列，**先 clone 跑通，再挑一个模块深读**。

## 完整业务系统

### Gitea ⭐⭐⭐⭐⭐

- 仓库：https://github.com/go-gitea/gitea
- 定位：自托管 Git 服务（GitHub 的 Go 版本）
- 学习价值：完整的企业后台系统

**包含模块**：
- 用户体系（OAuth / LDAP / SAML）
- 仓库管理（权限、协作、Webhook）
- Issue / PR / Project 完整工作流
- CI/CD 集成
- 多语言 i18n

**适合学习**：企业后台的分层、权限模型、模块解耦

### Grafana ⭐⭐⭐⭐

- 仓库：https://github.com/grafana/grafana
- 定位：监控可视化平台
- 学习价值：Dashboard / Plugin 体系

**包含模块**：
- 数据源抽象（Prometheus / MySQL / ES 都能查）
- 插件系统（前端 + 后端双插件）
- Dashboard 配置的 JSON 序列化与版本管理
- 告警引擎

### Harbor ⭐⭐⭐⭐

- 仓库：https://github.com/goharbor/harbor
- 定位：企业级镜像仓库
- 学习价值：DevOps 后端典范

**包含模块**：
- RBAC 权限体系
- 镜像扫描（Trivy 集成）
- 复制策略（多 Harbor 实例同步）
- Task 异步任务队列

## 入门级 / 二战开发模板

### gin-vue-admin ⭐⭐⭐⭐

- 仓库：https://github.com/flipped-aurora/gin-vue-admin
- 定位：Gin + Vue 的前后端分离管理后台模板
- 中文文档全，**第一次做完整后端系统的最佳选择**

**技术栈**：Gin + GORM + MySQL + Redis + JWT + Casbin + Swagger

**包含模块**：
- 用户/角色/菜单/部门完整 RBAC
- 代码生成器（一键产出 CRUD）
- 操作日志、字典管理

**实战建议**：克隆后新增一个"商品管理"模块（CRUD + 分页 + 缓存），理解完整后端模板结构。

### ferry ⭐⭐⭐⭐

- 仓库：https://github.com/lanyulei/ferry
- 定位：工单/工作流系统
- 学习价值：企业 OA / 工单的真实简化版

**包含模块**：
- 工单流转、任务钩子
- 部门权限、模板配置
- 流程编排（可视化工单流程）

### mall-go ⭐⭐⭐⭐

- 仓库：https://github.com/gz-yami/mall-go
- 定位：完整电商后端
- 学习价值：商品 / 订单 / 支付 / 库存全流程

### KamaChat ⭐⭐⭐

- 仓库：https://github.com/X1r0z/KamaChat （不同实现，多个 fork）
- 定位：仿微信 IM
- 学习价值：长连接 + 微服务架构

**技术栈**：WebSocket + gRPC + MySQL + Redis + Kafka

## 架构模板（重点学习工程规范）

### go-backend-clean-architecture ⭐⭐⭐⭐⭐

- 仓库：https://github.com/bxcodec/go-clean-arch
- 定位：Clean Architecture 在 Go 中的最佳实践模板
- **强烈推荐阶段 2 必读**

**分层**：
```
Router → Controller → Usecase → Repository → DB
```

**学习要点**：
- 依赖倒置：Usecase 依赖 Repository interface，不依赖具体实现
- 替换数据源（MySQL → MongoDB）只需要换 Repository 实现
- 这是 Go 项目"不乱"的标准答案

### golang-realworld-example-app ⭐⭐⭐

- 仓库：https://github.com/gothinkster/golang-gin-realworld-example-app
- 定位：RealWorld 规范实现（类似 Medium 的全功能后端）
- 学习价值：标准 RESTful API + 用户鉴权 + 文章分页 + 标签系统

### grpc-realworld-example ⭐⭐⭐⭐

- 仓库：https://github.com/yrichika/grpc-realworld-example
- 定位：RealWorld 的 gRPC 实现
- 学习价值：体验 `grpc-gateway` 把 HTTP RESTful 翻译成内部 gRPC

## 选型矩阵

| 目的 | 推荐项目 | 时间投入 |
| --- | --- | --- |
| 学工程规范（阶段 2 必看） | go-backend-clean-architecture | 2–3 天 |
| 做简历级后台项目 | gin-vue-admin 二次开发 | 1–2 周 |
| 学完整业务系统 | Gitea / Grafana | 2–4 周 |
| 学微服务架构 | go-zero 电商（参考 [02](./02-go-tier1-enterprise-frameworks.md)） | 3–4 周 |
| 学 DevOps 后端 | Harbor | 1–2 周 |
| 学 IM / 长连接 | KamaChat | 2 周 |

## 学习建议

1. **不要从头读源码**——每个项目挑一个你最关心的模块深读
2. **能跑起来 + 加一个新功能** > 看 100 行代码
3. **写一篇"我从 X 项目学到了什么"**——输出倒逼输入
