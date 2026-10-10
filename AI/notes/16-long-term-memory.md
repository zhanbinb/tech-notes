# Long-term Memory 实战：跨 Session 用户记忆

> 📚 配套笔记：[memory.md](./memory.md)（Go 版 Memory 实现）/ [langgraph-production-extensions.md](./langgraph-production-extensions.md)（Checkpointer）
> 🗓️ 时间：今天（基于 `langchain-agent-demo/40_long_term_memory`）
> 🎯 主题：跨 Session 持久化的用户记忆（Long-term Memory）

> 💡 **本笔记覆盖**：
> 1. Long-term Memory vs Context vs Checkpointer 的**三层区分**
> 2. Memory 结构化建模（Pydantic schema）
> 3. Memory Extraction（LLM 自动抽取）
> 4. Memory Update & Retrieval（更新与检索）

---

## 🎯 核心问题

> 用户第一次告诉 Agent：「我叫张三，我是 Go 后端开发」
> 下次对话 Agent 能不能记住？

之前学的**两类持久化**：
- **Context**（短期对话历史）：只在当前 Session 有效
- **Checkpointer**（LangGraph Workflow 状态）：Workflow 结束可清理

**Long-term Memory** = **跨 Session 的用户事实**，是第三种，**面试高频考点**。

---

## 1️⃣ 三层数据区分（面试必背）

| 维度 | Context / messages | Checkpointer | **Long-term Memory** |
|------|-------------------|--------------|---------------------|
| **存什么** | 当前对话历史 | Workflow 执行状态 | 用户长期事实 |
| **生命周期** | 一次 Session | 一次 Workflow | **跨 Session 长期** |
| **谁读写** | 每次 LLM 调用都读 | LangGraph 框架自动 | **业务代码主动** |
| **典型内容** | 用户最近 5 句话 | "执行到第 3 步" | "用户是 Go 后端" |
| **存储** | messages 数组 | PostgresSaver | **DB / Redis / Vector DB** |

**一句话区分**：
> **Context** 管"这次"；**Checkpointer** 管"这个 Workflow"；**Long-term Memory** 管"这个用户"。

---

## 2️⃣ Memory 结构化建模（Demo 40-02，888 行）

### 关键：用 Pydantic 定义 Memory Schema

```python
from pydantic import BaseModel

class UserMemory(BaseModel):
    name: str | None = None
    job: str | None = None
    learning_focus: str | None = None
    preference: str | None = None
```

**为什么用 Pydantic 而不是 dict？**

| dict | Pydantic |
|------|----------|
| `{"name": "张三", "age": 30}`（自由结构）| 强类型字段 |
| 无法校验 | 自动类型检查 |
| 易出 bug | 代码补全 + IDE 提示 |
| 难扩展 | 新增字段只需改 Schema |

**经验**：**Long-term Memory 必须有明确 Schema**，否则很快变成混乱的 KV。

---

## 3️⃣ Memory Extraction（LLM 自动抽取）

### 核心：从对话中抽取值得长期保存的信息

```python
EXTRACTION_PROMPT = """
你是一个长期记忆提取器。

请从用户消息中提取适合长期保存的信息。

只保存真正具有长期价值的信息，例如：
- 用户姓名、职业
- 用户长期学习方向
- 用户长期偏好

不要保存：
- 临时问题、一次性任务
- 当前正在讨论的具体代码
- 无长期价值的信息

需要提取的字段：
- name（用户姓名）
- job（用户职业）
- learning_focus（长期学习方向）
- preference（长期偏好）

如果某个字段无法确定，就使用 null。

要求：
1. 只输出 JSON
2. 不要输出解释、Markdown
3. 不要使用 ```json
4. 不要输出 <think>

用户消息：
{user_message}
"""

# LLM 抽取 → Pydantic 校验 → 保存
result = model.invoke(EXTRACTION_PROMPT.format(user_message=user_msg))
memory = UserMemory(**json.loads(result.content))
```

### 抽取 Prompt 的 5 个设计要点（来自 Demo）

| 要点 | 为什么 |
|------|--------|
| **明确"保存什么"** | LLM 知道边界，不会乱存 |
| **明确"不保存什么"** | 防止临时问题被误存 |
| **字段列表固定** | 输出结构稳定，方便解析 |
| **null 处理** | LLM 知道"不确定时不要瞎编" |
| **严格 JSON 输出** | 避免 Markdown 包裹、思考标签 |

---

## 4️⃣ Memory Update & Retrieval（Demo 40-03）

### 核心挑战

Memory 是**动态累积**的：
- 用户说"我叫张三" → 保存 `name=张三`
- 用户改名"我叫李四" → **更新** `name=李四`（不是叠加两条）
- 用户问"我叫什么" → **检索** 出正确值

### Update 策略（3 种）

| 策略 | 实现 | 适用 |
|------|------|------|
| **覆盖更新** | 新值直接覆盖旧值 | 简单，但丢失历史 |
| **追加历史** | 保留所有历史版本 | 需要审计 |
| **合并更新** | LLM 判断冲突，智能合并 | 复杂场景 |

**Demo 40-03 用覆盖更新**（最简单）。

### Retrieval 策略

| 策略 | 实现 | 适用 |
|------|------|------|
| **全部注入** | 把所有 Memory 塞进 System Prompt | 字段少 |
| **按需检索** | 根据用户问题检索相关字段 | 字段多 |
| **RAG 风格** | 向量化检索 | Memory 很大 |

**Demo 用全部注入**（UserMemory 字段固定且少）。

---

## 5️⃣ 完整 Memory 生命周期

```
┌─────────────────────────────────────────────────────┐
│ 用户对话                                            │
│   "我叫张三，是 Go 后端，最近想学 Agent"           │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ [1] Memory Extraction                                │
│   LLM 抽取 → UserMemory(name=张三, job=Go后端, ...)│
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ [2] Memory Update                                    │
│   用户已存在？合并 / 覆盖 / 追加                   │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ [3] Memory Store                                     │
│   保存到 DB（按 user_id 隔离）                      │
└────────────────────┬────────────────────────────────┘
                     │
                     │  下次 Session
                     ▼
┌─────────────────────────────────────────────────────┐
│ [4] Memory Retrieval                                 │
│   根据 user_id 读取 → 注入 System Prompt            │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│ [5] LLM 调用                                         │
│   看到「用户是 Go 后端」，生成个性化回答             │
└─────────────────────────────────────────────────────┘
```

---

## 6️⃣ 关键设计（来自 Demo）

### 1. Memory 必须按 user_id 隔离

```python
# ❌ 错误：所有用户共享一个 Memory
memory_store = UserMemory(...)   # 全局单例

# ✅ 正确：按用户隔离
memory_store = {
    "user_001": UserMemory(name="张三", ...),
    "user_002": UserMemory(name="李四", ...),
}
```

### 2. LLM 抽取结果要 Pydantic 校验

```python
# ❌ 错误：直接信任 LLM 输出
memory_data = json.loads(llm_response)
store.save(memory_data)

# ✅ 正确：Pydantic 校验 + 默认值
try:
    memory = UserMemory(**json.loads(llm_response))
    store.save(memory)
except ValidationError as e:
    log.warn(f"Memory extraction failed: {e}")
```

### 3. Memory 和 Context 不要混用

| 场景 | 用 Memory | 用 Context |
|------|----------|-----------|
| 用户长期偏好 | ✅ | ❌ |
| 当前订单详情 | ❌ | ✅ |
| 用户职业 | ✅ | ❌ |
| 用户刚说的诉求 | ❌ | ✅ |

### 4. Memory Extraction 必须有"不保存"规则

**没有"不保存"规则** → LLM 会把所有信息都存进去 → Memory 膨胀 → 检索噪声大。

---

## 7️⃣ 跟之前 Memory 笔记的关系

| 笔记 | 内容 | 关系 |
|------|------|------|
| [memory.md](./memory.md) | Go 版 Memory（Hybrid Search + Query Rewrite）| **底层检索**技术 |
| **本笔记** | **Long-term Memory**（跨 Session 用户事实）| **应用层概念** |
| [langgraph-production-extensions.md](./langgraph-production-extensions.md) | Checkpointer（Workflow 状态）| **不同生命周期** |

**建议阅读顺序**：
1. memory.md（理解 Memory 检索技术）
2. 本笔记（理解 Long-term Memory 的应用场景）
3. langgraph-production-extensions.md（对比 Checkpointer）

---

## 8️⃣ 面试回答模板

### 30 秒版

> Agent 中有三类持久化数据：
> 1. **Context**（messages）管当前对话；
> 2. **Checkpointer** 管 Workflow 执行状态（LangGraph）；
> 3. **Long-term Memory** 管跨 Session 的用户事实（如姓名、职业、偏好）。
> 
> Long-term Memory 通常用 **Pydantic Schema** 定义结构，**LLM 抽取 + Pydantic 校验**保存，按 **user_id 隔离**存储。

### 5 分钟版

按 5 个步骤讲（Extraction → Update → Store → Retrieval → Use），展示代码。

---

## ✅ 自检

- [ ] 1. Long-term Memory / Context / Checkpointer 的本质区别是什么？
- [ ] 2. 为什么 Long-term Memory 要用 Pydantic Schema 而不是 dict？
- [ ] 3. Memory Extraction Prompt 的 5 个设计要点是什么？
- [ ] 4. Memory Update 的 3 种策略分别适合什么场景？
- [ ] 5. Memory 为什么必须按 user_id 隔离？
- [ ] 6. Memory 和 Context 各自适用什么数据？

---

## 📂 相关代码

- `langchain-agent-demo/40_long_term_memory/01_basic/main.py` - Memory 基础
- `langchain-agent-demo/40_long_term_memory/02_extraction/main.py` - Pydantic + LLM 抽取
- `langchain-agent-demo/40_long_term_memory/03_update_retrieval/main.py` - 更新与检索

---

## 🔗 相关笔记

- [Memory 完整体系](./memory.md) - Go 版 Memory + Hybrid Search
- [LangGraph 生产扩展](./langgraph-production-extensions.md) - Checkpointer 对比
- [Agent 架构总览](./agent-architecture.md) - Memory 在整体架构中的位置
