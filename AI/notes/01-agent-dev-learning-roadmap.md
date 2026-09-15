# Agent 开发工程师学习路线：从 ReAct 到完整 Runtime（Go 实现 · 9 步）

> 用 Go 从零搭一个完整的 Agent 系统。覆盖 LLM API、Function Calling、Agent Loop、Context Management、Workflow、Memory（含 Hybrid Search + Query Rewrite）、RAG、Embedding、MCP 工具协议、Router 能力路由 9 大主题，约 4000 行代码 + 4000 行笔记。

## 为什么这条路线值得参考

市面上的 Agent 教程多以 LangChain / LangGraph 等框架为主，容易陷入「调 API」而不知「为什么这样设计」。这条路线**先手写、后学框架**：

- 手写阶段吃透底层机制（每一步对应一个文件、一个清晰职责）
- 学框架时能看清「框架帮我解决了什么、藏了什么」
- 面试时能讲清架构、也能讲清权衡，而不是只背框架 API

## 12 步路线（9 步已完成）

| # | 主题 | 状态 | 关键产出 |
|---|------|------|---------|
| 1 | LLM API | ✅ | OpenAI 兼容协议 + 多 Provider 切换 |
| 2 | Tool Calling | ✅ | `tools/tool.go` 接口 + JSON Schema |
| 3 | Tool Result | ✅ | `tool_call.id` 回传 |
| 4 | Tool Registry | ✅ | `tools/registry.go` |
| 5 | Agent Loop（ReAct） | ✅ | `agent/agent.go` for 循环 |
| 6 | Context Management | ✅ | `memory/context.go`（消息历史 + 摘要压缩）|
| 7 | Agent 编排 | ✅ | `workflow/` 三种模式：Fixed / Conditional / Agentic |
| 8 | Memory + RAG + Embedding | ✅ | Hybrid Search + Query Rewrite + Vector Search |
| 9 | MCP + Router | ✅ | `mcp/` 模块 + `agent/router.go` 能力路由 |
| 10 | Multi-Agent | ⬜ | — |
| 11 | Evaluation | ⬜ | — |
| 12 | Agent 工程化 | ⬜ | — |

## 完整 Agent Runtime 架构

```
                    User Query
                         │
                         ▼
                 ┌───────────────┐
                 │    Router     │ ← LLM 决定 use_memory / use_rag / use_tool
                 └───────┬───────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐      ┌─────────┐      ┌─────────┐
   │ Memory  │      │   RAG   │      │  Tools  │
   │ (用户)  │      │ (知识)  │      │ (外部)  │
   └─────────┘      └─────────┘      └─────────┘
        │                │                │
   Hybrid Search    Vector Search    本地 + MCP
   Query Rewrite    Cosine Similarity  ConvertTools
```

**3 大上下文支柱 + Router**：

| 组件 | 回答的问题 | 典型实现 |
|------|----------|---------|
| **Router** | 「这次需要哪些能力」| LLM + 动态 Capabilities 配置 |
| **Memory** | 「用户是谁」| key-value + 向量双存储 |
| **RAG** | 「知识是什么」| 文档 Embedding + 向量库 |
| **Tools** | 「外部能做什么」| Function Calling + **MCP** |

## 9 大模块映射

| 模块 | 关键文件 | 行数 | 学到的核心概念 |
|------|---------|------|--------------|
| `config/` | `config.go` | 47 | Provider 抽象（DeepSeek / OpenAI / 自定义） |
| `llm/` | `client.go` + `output.go` | 45 | OpenAI 客户端 + Output Parser（CleanThinking） |
| `tools/` | `tool.go` + `registry.go` + `order.go` | 157 | Tool / Registry / Schema 三层抽象 |
| `agent/` | `agent.go` + `schema.go` | 474 | ReAct 循环 + Tool Schema 拼装 |
| `agent/` | `memory.go` + `query_rewrite.go` + `router.go` | 882 | Memory 集成 + Query Rewrite + Router |
| `memory/` | `context.go` | 212 | ContextManager（消息历史 + 摘要） |
| `memory/` | `memory.go` + `extractor.go` | 730 | Hybrid Search（Keyword 10/5/2 + Vector 0.5/0.5）+ Extraction |
| `embedding/` | `embedding.go` | 142 | Embedder 接口 + CosineSimilarity + FakeEmbedder |
| `rag/` | `knowledge.go` + `retriever.go` + `rag.go` | 265 | KnowledgeBase + Retriever + RAG Ask |
| `mcp/` | `server/` + `client/` + `protocol/` + `transport/` | 423 | MCP Server + Client + Tool Schema 转换 |
| `workflow/` | `order.go` | 239 | Sequential / Conditional / Agentic 三种模式 |

**总代码量**：约 3500 行（不含 SDK + 测试）

## 关键设计模式（面试高频）

### 1. Provider 抽象（多模型切换）

```go
type Preset struct {
    APIKey  string  // 环境变量名
    BaseURL string  // OpenAI 兼容端点
    Model   string
}

presets := map[string]Preset{
    "deepseek": {"DEEPSEEK_API_KEY", "https://api.deepseek.com", "deepseek-chat"},
    "openai":   {"OPENAI_API_KEY", "https://api.openai.com", "gpt-4o"},
}
// 切换模型只需改 provider 变量
```

**价值**：DeepSeek / OpenAI / 自建服务都用同一套代码调用，因为都兼容 OpenAI 协议。

### 2. Tool / Schema / Registry 三层分离

```go
// 1. Tool 定义（业务实现）
type Tool struct {
    Name, Description string
    Handler func(args string) (string, error)
}

// 2. Registry 管理（程序用）
type Registry struct { tools map[string]Tool }

// 3. Schema 声明（给 LLM 看）
type ChatCompletionToolParam struct {
    Function FunctionDefinitionParam  // name + description + JSON Schema
}
```

**价值**：Tool Schema 和 Registry 解耦，新增 Tool 时两处独立维护。

### 3. Memory 写入防护（关键易踩坑）

```go
// ❌ 把 user + assistant 都给 LLM 提取 → 污染
userPrompt := userMsg + assistantAnswer

// ✅ 只把 user 给 LLM
userPrompt := userMsg
```

**价值**：避免 LLM 把自己的「幻觉回答」当成事实保存。

### 4. Hybrid Search Score Fusion

```go
// Keyword Score 归一化（除以 maxKeywordScore）
// Vector Score 天然 [0, 1]
hybridScore = 0.5 * keywordScore + 0.5 * vectorScore
```

**关键词打分规则**：

| 匹配类型 | 分数 |
|---------|------|
| Key 完全匹配（`query="user_profession"`, `key="user_profession"`）| **+10** |
| Key 部分包含 | +5 |
| Value 包含 | +2 |

**价值**：精确 key 匹配 + 语义相似，两种互补。

### 5. Query Rewrite（检索前置优化）

```go
// ❌ 直接拿原 query 检索
results := memory.Search("你还记得我的职业吗？")  // 召回低

// ✅ 先 LLM 改写
queries := llm.Rewrite("你还记得我的职业吗？")
// queries = ["user_profession", "职业", "工作"]
results := memory.Search(queries...)
```

### 6. Router 能力路由（成本优化的关键）

```go
// Router 只调一次，决策贯穿整个 Agent Loop
decision := router.Decide(ctx, query, capabilities)
// decision: { use_memory, use_rag, use_tool }

if decision.UseMemory { /* 查 Memory */ }
if decision.UseRAG    { /* 检索 RAG */ }
if decision.UseTool   { /* 给 LLM Tool Schema */ }
```

**收益**：闲聊类问题（70%+ 流量）完全跳过 Memory/RAG/Tool，省 50%+ Token 和延迟。

### 7. MCP Tool → LLM Tool 转换

```go
// MCP Tool 协议格式
type MCPTool struct {
    Name, Description string
    InputSchema any  // JSON Schema 对象
}

// 转换为 LLM Function Calling 格式
func ConvertTools(mcpTools []*mcp.Tool) []openai.ChatCompletionToolParam
```

**价值**：Agent 不关心 Tool 来自本地 Registry 还是远程 MCP Server，统一抽象。

## 面试自检清单（核心 12 问）

### 基础（Step 1-5）

- [ ] 1. Function Calling 和普通 Prompt 调用的本质区别是什么？
- [ ] 2. ReAct 模式的「Thought / Action / Observation」是哪三步？
- [ ] 3. Agent 为什么会陷入死循环？怎么防止？
- [ ] 4. 为什么 `tool_call.id` 必须回传？

### 中级（Step 6-9）

- [ ] 5. Token 成本和延迟在 Agent 里为什么会被放大？
- [ ] 6. context.Context 和 Agent 的「上下文」是什么关系？
- [ ] 7. Anthropic 提到的 5 种编排模式（Chaining / Routing / Parallelization / Orchestrator-Workers / Agent）各自适用什么场景？
- [ ] 8. 短期记忆（thread）和长期记忆（store）的实现方式有什么不同？
- [ ] 9. MCP 解决的核心问题是什么？跟你写的 toolRegistry 是同一层抽象吗？

### 高级（Step 10+）

- [ ] 10. 单 Agent 和多 Agent 协作（supervisor / swarm）各适合什么场景？
- [ ] 11. Trajectory Eval 和 Outcome Eval 的区别？
- [ ] 12. Agent 上线前最关键的 3 个工程化考虑是什么？

## 学习程度评估（自评）

| 维度 | 程度 | 说明 |
|------|------|------|
| **Agent 核心概念理解** | 75-80% | 能讲清架构、能复现主流模式 |
| **能动手写 Agent 代码** | 80-85% | 1 个完整的 Go Agent 系统 |
| **生产级工程能力** | 30-40% | 持久化 / 安全 / 监控 / 评估 还差 |
| **框架熟悉度** | 15-20% | 没碰过 LangChain / LangGraph |
| **Go 后端 Agent 岗面试通过率** | 60-70% | 概念能讲、项目能聊、框架是缺口 |

## 下一步推荐：先学 LangGraph 再学 Multi-Agent

| 姿势 | 方法 | 推荐度 |
|------|------|--------|
| ❌ 纯看文档 | 直接读 LangChain 文档 | 容易迷失 |
| ✅ **对照学习** | 把你的 Go Agent 模块映射到 LangGraph | **最适合** |
| ⚠️ 直接做项目 | 上手 LangChain 项目 | 容易走偏 |

**对照表**（推荐打印对照学习）：

| 你的 Go Agent | LangGraph |
|-------------|-----------|
| `Agent.Run` for 循环 | `StateGraph` + Node |
| `ContextManager` | `Checkpointer` |
| `Router.Decide` | `Conditional Edge` |
| `buildMemoryContext` | `ToolNode` + MemoryStore |
| Tool Registry | `@tool` decorator |
| 手动错误处理 | `RetryPolicy` |

## 常见坑（重点提醒）

1. **Memory Extraction 不能看 Assistant Answer** → 会把幻觉当事实保存
2. **Hybrid Score 必须归一化 Keyword** → 否则 Keyword 完全压制 Vector
3. **Router 输出必须是 boolean 字段** → 不能是自由文本
4. **Router 必须在 Agent Loop 外** → 每轮重新决策是浪费
5. **MCP Tool 必须转成 LLM Function 格式** → LLM 不认识 MCP 协议
6. **JSON 解析前必须清理 `<think>` 和 Markdown fence** → 推理模型输出污染
7. **Fake Embedding 不具备语义检索能力** → 生产必须换 OpenAI/BGE

## 相关资源

- 项目源码：`go-interview-guide/code/06-agent/go-agent-demo/`（3500 行 + 完整注释）
- 学习笔记：`go-interview-guide/docs/agent-learning/notes/`（9 篇 · 4000 行）
- LangGraph 官方文档：https://langchain-ai.github.io/langgraph/
- Anthropic《Building Effective Agents》：https://www.anthropic.com/research/building-effective-agents
- MCP 官方文档：https://modelcontextprotocol.io/

---
#Agent #LLM #ReAct #Memory #RAG #MCP #Go #Router #HybridSearch #FunctionCalling
