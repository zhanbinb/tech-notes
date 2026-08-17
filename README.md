# tech-notes

个人技术学习笔记沉淀仓库。每条知识点对应一个 Markdown 文件，由本人在学习过程中总结。

## 🌐 在线阅读（推荐）

👉 **博客地址：<https://zhanbinb.github.io/tech-notes/>**

- 由 GitHub Actions 在每次 `push` 后自动构建并部署到 GitHub Pages
- 写作源（Markdown）即仓库根各分类的 `notes/`，**博客侧栏 / 全站搜索 / 暗色主题都由 [VitePress](https://vitepress.dev/) 自动生成**
- 阅读体验比直接看 GitHub 上的 Markdown 更好（左侧栏导航 + 全文搜索 + 代码高亮）

## 📂 目录结构

```
.
├── README.md                ← 本文件（仓库门面）
├── INDEX.md                 ← 全量索引（每次新增笔记同步登记）
├── AI/                      ← AI / 模型相关
├── golang/                  ← Go 后端（学习路线 / 项目拆解）
├── solidity/                ← Solidity / 智能合约
├── python/                  ← Python
├── docker/                  ← Docker / 容器化
├── kubernetes/              ← Kubernetes / 云原生
├── etcd/                    ← etcd 运维
├── github/                  ← GitHub / Actions / Pages
├── tools/                   ← 工具与排查
├── codex/                   ← Codex / AI 工具链
├── docs/                    ← VitePress 博客源（自动构建，勿手改）
└── scripts/                 ← 构建脚本（自动扫描 notes/）
```

每个语言/主题目录下：
- `README.md`：分类说明 + 笔记目录
- `notes/`：所有笔记 Markdown 文件

## ✍️ 写作约定

- 笔记命名：`NN-<topic>.md`，`NN` 为两位数序号，便于排序与增量追加
- 一条笔记对应一个具体知识点，主题尽量独立、颗粒度适中
- 笔记主体中文；关键字、类型名、API、命令保留英文
- 项目实战归档例外：当一个项目的笔记达到 20+ 篇时，使用独立子目录收纳（如 `go-zero-looklook-new/`、`go-clean-arch/` 等）

## ➕ 如何新增一条笔记

1. 在目标语言目录的 `notes/` 下新建 `NN-topic.md`
2. 在该语言目录的 `README.md` 的笔记目录里登记一条链接
3. 同步在顶层 `INDEX.md` 中登记
4. `git push`，~1 分钟内博客 <https://zhanbinb.github.io/tech-notes/> 自动更新

> 当前笔记在学习的过程中逐步沉淀。仓库是知识沉淀，不是教程合集。
