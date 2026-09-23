# AI

AI 相关笔记收录地（提示词、工具用法、模型原理、Agent 实践等）。

> 在学习的过程中逐步沉淀，每条知识点单独一个 Markdown 文件，放在 [`notes/`](notes/) 下。

## 笔记目录

按学习路径排序，每篇笔记对应一个 Agent 开发核心概念。

### 总览（先读这两篇）
- [01 · Agent 开发工程师学习路线：从 ReAct 到完整 Runtime（Go 实现 · 9 步）](notes/01-agent-dev-learning-roadmap.md) — 12 步路线 + 面试自检 + 学习程度评估
- [02 · Agent 架构总览：Router + 3 大支柱 + Harness 视角](notes/02-agent-architecture-overview.md) — 全景图，建议作为入口阅读

### 核心组件详解（按学习顺序）
- [03 · Context Management：消息历史 + 摘要压缩](notes/03-agent-context-management.md)
- [04 · Agent 编排模式：Fixed / Conditional / Agentic](notes/04-agent-orchestration-patterns.md)
- [05 · Memory 完整体系：Extraction + Hybrid Search + Retrieval](notes/05-agent-memory-system.md)
- [06 · Query Rewrite：自然语言到检索关键词](notes/06-agent-query-rewrite.md)
- [07 · Embedding & 向量检索：数学基础 + Fake Embedder](notes/07-embedding-and-vector-search.md)
- [08 · RAG 完整链路：KnowledgeBase + Retriever + Ask](notes/08-rag-pipeline.md)
- [09 · Router 能力路由：按需启用 Memory/RAG/Tools](notes/09-router-capability-routing.md)
- [10 · MCP 详解：协议 + Server + Client + Tool Schema 转换](notes/10-mcp-model-context-protocol.md)
- [11 · LangChain + LangGraph 学习笔记：15 个 Demo 完整覆盖](notes/11-langchain-langgraph.md)
- [12 · LangGraph 生产扩展：HITL / Checkpointer / FastAPI 落地](notes/12-langgraph-production-extensions.md)
- [13 · Agentic RAG 完整链路：真实 Embedding + Metadata Filter + Reranker + 持久化](notes/13-agentic-rag-full-pipeline.md)
- [14 · Agent 工具安全 + 可靠性：Permission / HITL / Idempotency / Multi-Agent](notes/14-agent-tool-security-and-reliability.md)

## 写作约定

- 笔记命名：`NN-<topic>.md`，`NN` 为两位数序号。
- 一条笔记对应一个具体知识点，主题尽量独立、颗粒度适中。
- 笔记主体中文；关键字、类型名、API 保留英文。
