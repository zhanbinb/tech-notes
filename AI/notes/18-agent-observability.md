# Agent 可观测性实战：LangSmith Tracing

> 📚 配套笔记：[agent-evaluation.md](./agent-evaluation.md)（评估）/ [multi-agent-architecture.md](./multi-agent-architecture.md)（Trace ID）
> 🗓️ 时间：今天（基于 `langchain-agent-demo/42_agent_observability`）
> 🎯 主题：让 Agent 看得见、调得动、监控得住

> 💡 **本笔记覆盖**：
> 1. 可观测性的 3 大支柱（Logs / Metrics / Traces）
> 2. **LangSmith Tracing**（自动记录 Agent 执行）
> 3. **Trace 结构**（Span / Run / 事件链）
> 4. 可观测性与 Trace ID 的关系
> 5. 生产级监控指标

---

## 🎯 核心问题

> Agent 出问题了，怎么 debug？
> - 为什么这个回答错了？
> - 调了哪些 Tool？
> - LLM 看到了什么 Prompt？
> - 花了多少 Token？
> - 哪个步骤最慢？

**没有可观测性的 Agent = 黑盒**。

---

## 1️⃣ 可观测性 3 大支柱（业界通用）

| 支柱 | 内容 | Agent 场景 |
|------|------|-----------|
| **Logs** | 详细事件记录 | LLM Prompt / Tool 调用 / 错误 |
| **Metrics** | 量化指标 | Token 成本 / 延迟 / 成功率 |
| **Traces** | 调用链 | Agent Loop 全链路（哪个 Tool → 哪个 LLM）|

**对比**：
- **Logs**：「Agent 调用了 query_order，返回了 XXX」
- **Metrics**：「本月 Token 消耗 1M，平均延迟 2s」
- **Traces**：「这次请求 → Supervisor → Order Agent → Tool → LLM → 返回」

---

## 2️⃣ LangSmith Tracing（Demo 42-02）⭐

### 核心：零代码自动记录

```python
# .env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_xxxx
LANGSMITH_PROJECT=my-agent-project
```

**LangChain / LangGraph 会自动记录**：
- LLM Prompt / Response
- Tool 调用（name / args / result）
- 每个 Node 的执行
- Token 用量 / 延迟

**不需要额外写代码**（Demo 42-02 验证）。

### LangSmith UI 提供什么

| 功能 | 用途 |
|------|------|
| **Trace 可视化** | 看每一步的输入输出 |
| **Timeline** | 看每个 Span 的耗时 |
| **Token 分析** | 哪个调用最贵 |
| **错误追踪** | 异常堆栈 |
| **对比分析** | 不同版本效果对比 |

---

## 3️⃣ Trace 结构（核心概念）

### Span / Run 层次

```
[Root Run] 整个 Agent 调用
├── [Span 1] LLM 调用（Router）
├── [Span 2] Tool 调用（query_order）
│   └── [Span 2.1] 子 LLM 调用（Tool 内部）
├── [Span 3] Tool 调用（query_payment）
└── [Span 4] LLM 调用（Final Answer）
```

**每个 Span**：
- `name`：哪个函数 / Tool
- `input`：输入参数
- `output`：返回结果
- `start_time` / `end_time`：耗时
- `metadata`：额外信息（trace_id、user_id）
- `error`：异常信息

### Agent Loop 的完整 Trace 示例

```
Root Run: "帮我查询订单10001"
├── LLM (gpt-4o)                 ← 1.8s, 350 tokens
│   ├── Prompt: "你是一个订单客服..."
│   └── Tool Calls: ["query_order"]
├── Tool: query_order             ← 0.05s
│   ├── Args: {"order_id": "10001"}
│   └── Result: "已发货，3999元"
└── LLM (gpt-4o)                  ← 1.2s, 280 tokens
    └── Answer: "订单10001已发货，金额3999元"
```

---

## 4️⃣ 可观测性 vs Trace ID（关系）

| 维度 | Trace ID | 可观测性 |
|------|----------|----------|
| **本质** | 关联标识符 | 记录 + 分析系统 |
| **作用** | 把多个日志串起来 | 让这些日志**看得见** |
| **存储** | Header / Log 字段 | LangSmith / Jaeger |
| **实现** | `X-Trace-ID` Header | OpenTelemetry + LangSmith |

**两者互补**：
- **Trace ID** = 用什么 ID 串联日志
- **可观测性** = 用什么工具看这些日志

> 之前 [multi-agent-architecture.md](./multi-agent-architecture.md) 讲了 Trace ID 透传（HTTP Header）。
> 这一章讲**怎么把这些 Trace 数据可视化、分析**。

---

## 5️⃣ Agent 可观测性关键指标

### 延迟指标

| 指标 | 含义 | 优化方向 |
|------|------|---------|
| **P50 延迟** | 50% 请求的延迟 | 优化关键路径 |
| **P95 延迟** | 95% 请求的延迟 | 优化长尾（缓存、并发）|
| **首次响应时间** | 用户等待感 | 流式输出 |

### 成本指标

| 指标 | 含义 | 优化方向 |
|------|------|---------|
| **Token 消耗** | LLM 输入 + 输出 | Prompt 优化、缓存 |
| **每请求成本** | Token × 单价 | 小模型预处理 + 大模型兜底 |
| **Tool 调用次数** | 优化 Tool 选择 | Router 优化 |

### 质量指标

| 指标 | 含义 | 来源 |
|------|------|------|
| **Tool 调用准确率** | 调用对不对 | Trajectory Eval |
| **回答正确率** | 结果对不对 | Outcome Eval |
| **用户满意度** | 用户体验 | 反馈 / 评估 |

---

## 6️⃣ 三种实现路径

### 路径 1：LangSmith（最简单）

```python
# 1. 设置环境变量
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...

# 2. 跑 Agent（自动记录）
agent.invoke({"messages": [{"role": "user", "content": "..."}]})
```

**优点**：零代码集成、UI 完善
**缺点**：付费、数据在 LangSmith 云端

### 路径 2：OpenTelemetry（企业标准）

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)

@tool
def query_order(order_id: str) -> dict:
    with tracer.start_as_current_span("query_order") as span:
        span.set_attribute("order_id", order_id)
        result = do_query(order_id)
        span.set_attribute("result", result)
        return result
```

**优点**：标准协议、与现有监控集成（Jaeger / Grafana / Datadog）
**缺点**：需要自建监控栈

### 路径 3：自建（灵活）

```python
import logging
import json

logger = logging.getLogger("agent")

def log_event(event_type, data):
    logger.info(json.dumps({
        "event": event_type,
        "data": data,
        "timestamp": time.time(),
        "trace_id": get_trace_id(),
    }))
```

**优点**：完全可控、零依赖
**缺点**：需要自己搭 UI、分析工具

---

## 7️⃣ 关键洞察

### 1. 可观测性是事后视角，不是开发时工具

**开发时**：Debug、打印日志
**生产时**：Trace、监控、告警

**两者不同**。

### 2. Trace ID 是"线索"，可观测性是"地图"

没有 Trace ID 的可观测性 = 拼图缺了关键连接
没有可观测性的 Trace ID = 一堆 ID 找不到地方看

### 3. LangSmith 零代码是杀手锏

只需要环境变量，不需要改代码。

**适合**：
- 快速上手
- 中小团队
- Demo / 原型

**不适合**：
- 严格数据隐私
- 大规模定制需求

### 4. 可观测性数据要可查询

不是"记下来就好"，要支持：
- 按 trace_id 查完整链路
- 按时间范围查
- 按 user_id 查
- 按错误类型查

### 5. 成本监控容易被忽略

Agent 的成本主要在 LLM Token。
**必须**监控：
- 每个 Agent 用了多少 Token
- 平均每次请求多少 Token
- Token 消耗趋势

---

## 8️⃣ 面试回答模板

### 30 秒版

> Agent 可观测性分 3 个支柱：**Logs / Metrics / Traces**。
> 
> LangSmith 通过环境变量配置（`LANGSMITH_TRACING=true`）即可自动记录 Agent 执行链路，包括 LLM 调用、Tool 调用、Token 用量、延迟等。
> 
> 多 Agent 分布式场景下，通过 **Trace ID**（HTTP Header 透传）串联整个调用链。

### 5 分钟版

按 3 大支柱 + LangSmith + Trace ID 串联展示。

---

## ✅ 自检

- [ ] 1. 可观测性 3 大支柱分别是什么？各包含什么？
- [ ] 2. LangSmith Tracing 怎么集成？需要写代码吗？
- [ ] 3. Trace 里的 Span 层次怎么理解？
- [ ] 4. Trace ID 和可观测性是什么关系？
- [ ] 5. Agent 可观测性的关键指标有哪些？
- [ ] 6. 三种可观测性实现路径（LangSmith / OTel / 自建）怎么选？

---

## 📂 相关代码

- `langchain-agent-demo/42_agent_observability/01_basic/main.py` - 可观测性基础
- `langchain-agent-demo/42_agent_observability/02_langsmith/main.py` - LangSmith 集成
- `langchain-agent-demo/42_agent_observability/03_agent_rag_tool/main.py` - Agent + RAG + Tool 全链路

---

## 🔗 相关笔记

- [Agent 评估](./agent-evaluation.md) - 离线评估（Dataset + Regression）
- [Multi-Agent 架构实战](./multi-agent-architecture.md) - Trace ID 透传
- [Agent Guardrails](./agent-guardrails.md) - 安全监控

---

## 💡 评估 vs 可观测性

| 维度 | 评估 | 可观测性 |
|------|------|----------|
| **时机** | **离线**（上线前跑 Dataset）| **在线**（运行时实时记录）|
| **目的** | 质量保证、回归检测 | 调试、监控、告警 |
| **频率** | 每次改动跑一次 | 持续收集 |
| **输出** | 分数、对比报告 | Trace、Metrics、日志 |

**两者互补**：
- 评估在**开发时**保障质量
- 可观测性在**运行时**发现问题
