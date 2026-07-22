# tech-notes

不同技术语言的知识点沉淀仓库。每条知识点对应一个 Markdown 文件，由本人在学习过程中总结。

## 目录结构

```
.
├── README.md
├── INDEX.md            ← 全量索引（新增笔记时同步登记）
├── .gitignore
├── AI/                 ← AI 相关
│   ├── README.md
│   └── notes/
├── golang/             ← Go
│   ├── README.md
│   └── notes/
├── docker/             ← Docker / 容器化
│   ├── README.md
│   └── notes/
├── solidity/           ← Solidity
└── python/             ← Python
```

## 写作约定

- 笔记命名：`NN-<topic>.md`，`NN` 为两位数序号，便于排序与增量追加。
- 一条笔记对应一个具体知识点，主题尽量独立、颗粒度适中。
- 笔记主体中文；关键字、类型名、API、命令保留英文。

## 如何新增一条笔记

1. 在目标语言目录的 `notes/` 下新建 `NN-topic.md`。
2. 在该语言目录的 `README.md` 中登记一条链接。
3. 同步在顶层 `INDEX.md` 中登记（按主题或按标签）。

> 当前笔记在学习的过程中逐步沉淀。
