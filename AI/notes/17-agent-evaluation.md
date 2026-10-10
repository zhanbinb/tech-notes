# Agent 评估实战：LLM-as-Judge / LangSmith / Regression

> 📚 配套笔记：[agentic-rag-full-pipeline.md](./agentic-rag-full-pipeline.md)（Agentic RAG）
> 🗓️ 时间：今天（基于 `langchain-agent-demo/41_agent_evaluation` + `43_langsmith_evaluation`）
> 🎯 主题：如何科学评估 Agent 质量（从 Demo 到生产）

> 💡 **本笔记覆盖**：
> 1. Agent 评估的基本概念（**为什么需要评估**）
> 2. 评估维度（Tool 调用、RAG 检索、最终回答）
> 3. **LLM-as-Judge**（用 LLM 当裁判）
> 4. **LangSmith Evaluation**（数据集 + 自动评估）
> 5. **Regression 测试**（防止回归）
> 6. 评估在 CI/CD 中的集成

---

## 🎯 核心问题

> Agent 做出来了，怎么知道它好不好？
> 改了 Prompt / 换了模型 / 加了 Tool，效果变好还是变坏？

**没有评估的 Agent 开发 = 盲人摸象**。

---

## 1️⃣ 为什么需要评估？

### 评估 vs 单元测试

| 维度 | 传统单元测试 | Agent 评估 |
|------|------------|-----------|
| **输入确定性** | 固定输入 → 固定输出 | LLM 输出**不确定** |
| **判定标准** | `assertEqual(a, b)` | **语义等价** / 评分 |
| **测试规模** | 小样本 | **数据集（10-100 个 case）** |
| **执行成本** | 毫秒 | 秒到分钟（LLM 调用）|

### 评估的目标（4 个）

| 目标 | 描述 |
|------|------|
| **质量保证** | Prompt/模型改动后，效果不能变差 |
| **回归测试** | 防止已修好的问题再次出现 |
| **优化方向** | 知道该改 Prompt 还是改 Tool |
| **CI/CD 集成** | 自动跑评估，卡住劣化版本 |

---

## 2️⃣ Agent 评估的 3 个维度

```
Agent 执行链路
    ↓
[1] Tool 选择对不对（Trajectory）
    ↓
[2] Tool 参数对不对（Trajectory）
    ↓
[3] 最终回答对不对（Outcome）
```

### 维度 1：Trajectory Eval（轨迹评估）

**评估执行过程**，例如：
- Tool 调用对不对？（应该调 query_order，却调了 query_payment）
- 调用顺序对不对？
- 参数对不对？

```python
# 简单 Trajectory Eval
expected_tools = ["query_order", "query_payment"]
actual_tools = [tc["name"] for tc in trace.tool_calls]
accuracy = len(set(expected_tools) & set(actual_tools)) / len(expected_tools)
```

### 维度 2：Outcome Eval（结果评估）

**评估最终答案**，例如：
- 答案对不对？
- 答案相关吗？
- 答案完整吗？

```python
# 简单 Outcome Eval（关键词匹配）
expected_keywords = ["已发货", "3999", "微信支付"]
score = sum(1 for kw in expected_keywords if kw in answer) / len(expected_keywords)
```

### 维度 3：Safety Eval（安全评估）

**评估安全边界**，例如：
- Prompt Injection 防住了吗？
- 越权访问拦截了吗？
- 敏感数据泄漏吗？

---

## 3️⃣ LLM-as-Judge（Demo 41-03）⭐

### 核心思想

> 用一个 LLM 评估另一个 LLM 的输出质量。

### 实现骨架

```python
JUDGE_PROMPT = """
你是 Agent 回答质量评估员。

请根据以下维度给回答打分（1-5 分）：

1. 准确性（是否事实正确）
2. 相关性（是否回答了问题）
3. 完整性（是否信息完整）
4. 简洁性（是否过于冗长）

输出 JSON：
{
    "accuracy": 4,
    "relevance": 5,
    "completeness": 3,
    "conciseness": 4,
    "overall": 4.0,
    "reason": "回答准确，但缺少支付方式信息"
}

用户问题：
{question}

Agent 回答：
{answer}

参考答案（可选）：
{expected}
"""

judge_result = judge_model.invoke(JUDGE_PROMPT.format(...))
scores = json.loads(judge_result.content)
```

### LLM-as-Judge 的 4 个关键设计（来自 Demo）

| 设计 | 说明 |
|------|------|
| **明确评分维度** | 准确 / 相关 / 完整 / 简洁 |
| **量表清晰** | 1-5 分 |
| **要求 JSON 输出** | 机器可解析 |
| **要求给出 reason** | 便于人工复查 / 回归分析 |

### LLM-as-Judge 的优缺点

| 优点 | 缺点 |
|------|------|
| 能评语义（非精确匹配）| 不稳定（同一输入可能打分不同）|
| 可扩展（加维度改 Prompt）| 成本高（每次评估都调 LLM）|
| 适合开放式回答 | 需要校准（避免过于宽松/严格）|

**经验**：
- **小样本**（< 50 case）用 LLM-as-Judge
- **大样本**（> 50 case）用规则 + LLM 组合
- **关键决策**用人工复核

---

## 4️⃣ LangSmith Evaluation（Demo 43）

### 核心概念：Dataset + Example

```python
from langsmith import Client
from langsmith.schemas import Example

client = Client()

# 1. 创建 Dataset
DATASET_NAME = "agent-learning-order-eval-v1"

EVALUATION_EXAMPLES = [
    {
        "inputs": {"question": "请帮我查询订单10001现在是什么状态？"},
        "outputs": {"answer": "订单10001当前状态是已发货。"},
        "metadata": {"category": "order_status"},
    },
    # ... 更多 case
]

# 2. 上传 Dataset
dataset = client.create_dataset(DATASET_NAME)
for example in EVALUATION_EXAMPLES:
    client.create_example(
        inputs=example["inputs"],
        outputs=example["outputs"],
        dataset_id=dataset.id,
    )
```

### 核心概念：Run + Feedback

```python
# 3. 跑 Agent 并记录 Run
def predict(inputs):
    result = agent.invoke({"messages": [{"role": "user", "content": inputs["question"]}]})
    return {"answer": result["messages"][-1].content}

# 4. 自动评估
client.run_on_dataset(
    dataset_name=DATASET_NAME,
    llm_or_chain_factory=predict,
    evaluation=[evaluator],  # 评估函数
    project_name="my-agent-eval",
)
```

### LangSmith 评估的优势

| 功能 | 价值 |
|------|------|
| **Dataset 版本化** | 评估集随 Agent 演进管理 |
| **Run 自动记录** | Trace + 指标自动收集 |
| **可视化对比** | 不同版本效果对比图 |
| **Feedback 记录** | 人工标注 / LLM 评分 |
| **回归检测** | 自动发现劣化 |

---

## 5️⃣ Regression 测试（Demo 43-03）⭐

### 核心问题

改了 Prompt / 换了模型 → 怎么防止老的 case 变差？

### Regression 流程

```
[版本 A]
   ↓
跑全部 Dataset → 记录 baseline 分数
   ↓
[修改 Prompt / 换模型 / 加 Tool]
   ↓
跑全部 Dataset → 记录 new 分数
   ↓
对比：
- 某些 case 变差？→ 警告
- 整体变差？→ 阻断 CI
- 无回归？→ 合并代码
```

### 代码骨架

```python
# 1. 跑 baseline
baseline_results = run_evaluation(dataset, model="v1")

# 2. 跑 new version
new_results = run_evaluation(dataset, model="v2")

# 3. 对比
regression_cases = []
for case_id in baseline_results:
    if new_results[case_id] < baseline_results[case_id] - THRESHOLD:
        regression_cases.append(case_id)

if regression_cases:
    raise AssertionError(f"Regression detected: {regression_cases}")
```

### 关键设计

| 设计 | 说明 |
|------|------|
| **阈值容忍** | 不要求分数完全一致（LLM 不确定）|
| **case 级追踪** | 知道哪个 case 变差 |
| **CI 集成** | 自动跑评估，不靠手工 |
| **历史保留** | 不同版本的评估结果对比 |

---

## 6️⃣ 评估在 CI/CD 中的集成

```
代码改动 PR
   ↓
┌─────────────────────────────────────┐
│ [1] 单元测试（传统）                  │
│ [2] Agent 评估（Dataset）             │
│     - Trajectory Eval                │
│     - Outcome Eval                   │
│     - Safety Eval                    │
│ [3] Regression 检测                   │
└─────────────────────────────────────┘
   ↓
通过 → 合并 → 部署 → 线上监控（Observability）
```

**LangSmith 的 GitHub Action 集成**：
- 每次 PR 自动跑评估
- 在 PR 里显示评估报告
- 劣化则自动 block

---

## 7️⃣ 关键洞察

### 1. LLM 输出不确定 → 不能用传统 assertEquals

**评估必须容忍不确定性**（用阈值、用语义匹配）。

### 2. 评估不是"用一下就好"，而是"持续"的过程

每次 Prompt / 模型 / Tool 变化都要跑评估。

### 3. LLM-as-Judge 不是万能

**LLM-as-Judge 也要被评估**（用人工标注做校准）。

### 4. Dataset 是核心资产

**好的 Dataset 比代码更值钱**。需要：
- 覆盖各种场景
- 包含边界 case
- 定期更新（防止过时）

### 5. 评估维度要跟业务对齐

**不要只看准确率**：
- 客服 Agent：用户满意度
- 代码 Agent：测试通过率
- 数据分析 Agent：决策有用性

---

## 8️⃣ 面试回答模板

### 30 秒版

> Agent 评估分 3 个维度：**Trajectory（轨迹）** / **Outcome（结果）** / **Safety（安全）**。
> 
> 常用 **LLM-as-Judge** 评估语义质量，用 **LangSmith** 做数据集管理和自动化评估。
> 
> 上线前一定要做 **Regression 测试**，防止 Prompt / 模型改动导致劣化。

### 5 分钟版

按 3 个维度 + LangSmith + Regression 展示代码。

---

## ✅ 自检

- [ ] 1. 为什么传统单元测试不能直接用于 Agent？
- [ ] 2. Trajectory Eval 和 Outcome Eval 的区别？
- [ ] 3. LLM-as-Judge 的 4 个关键设计是什么？
- [ ] 4. LangSmith Dataset + Run + Feedback 的关系？
- [ ] 5. Regression 测试的核心思想？
- [ ] 6. 评估在 CI/CD 中怎么集成？

---

## 📂 相关代码

- `langchain-agent-demo/41_agent_evaluation/01_basic/main.py` - 评估基础
- `langchain-agent-demo/41_agent_evaluation/02_tool_rag/main.py` - Tool + RAG 评估
- `langchain-agent-demo/41_agent_evaluation/03_llm_judge/main.py` - LLM-as-Judge
- `langchain-agent-demo/43_langsmith_evaluation/01_basic/main.py` - LangSmith Dataset
- `langchain-agent-demo/43_langsmith_evaluation/02_rag/main.py` - RAG 评估
- `langchain-agent-demo/43_langsmith_evaluation/03_regression/main.py` - Regression 测试

---

## 🔗 相关笔记

- [Agent 可观测性](./agent-observability.md) - 评估的运行时监控（配对看）
- [Agent Guardrails](./agent-guardrails.md) - Safety Eval 的具体实现
- [Agentic RAG 完整链路](./agentic-rag-full-pipeline.md) - RAG 的评估维度
