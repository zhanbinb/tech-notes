# 生产架构：FastAPI 服务化 / 流式 / 异步 / 可靠性 / 配置

> 📚 配套笔记：[langgraph-production-extensions.md](./12-langgraph-production-extensions.md)（HITL / FastAPI 定位）/ [agent-observability.md](./18-agent-observability.md)（日志与 Trace）
> 🗓️ 时间：今天（对应阶段 **45** · 基于 ChatGPT 分享 [6ad806d9](https://chatgpt.com/share/6ad806d9-b2d4-83ec-9e7b-808276d282d8) + `langchain-agent-demo/45_production_architecture`）
> 🎯 主题：把"能跑的 Demo"变成"能上线的服务"

> 💡 **本笔记覆盖**：
> 1. FastAPI 服务化（HTTP 边界 / 身份 / Request-ID）
> 2. 流式响应（SSE + 首字延迟）
> 3. 异步任务（长任务 202 + 轮询）
> 4. 可靠性（超时 / 重试 / 可重试错误分类）
> 5. 配置管理（Settings 集中校验）

---

## 🎯 核心问题

> Agent Demo 是一个脚本：`python main.py` 跑完就退出。
> 真实企业里，Agent 必须是**一个 HTTP 服务**：
> 能被前端调用、能并发、能超时、能重试、能查日志、能配置。

**这一步不是"学新 AI 概念"，而是把你的后端经验接到 Agent 上。**

---

## 1️⃣ 四个子 Demo 总览

| # | Demo | 行数 | 解决什么 |
|---|------|------|---------|
| 45.1 | `01_fastapi_service` | 287 | Agent 变成 HTTP 服务 + 流式 |
| 45.2 | `02_async_tasks` | 321 | 长任务不阻塞 HTTP |
| 45.3 | `03_reliability` | 286 | 超时 + 重试 + 错误分类 |
| 45.4 | `04_config_management` | 267 | 配置集中 + 启动即校验 |

**合计 1161 行**。这 4 个能力在阶段 46 的综合项目里会被整合。

---

## 2️⃣ FastAPI 服务化（45.1）

### 最小服务形态

```python
app = FastAPI(title="Agent Service")

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    x_user_id: str = Header(default=None),
):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="缺少用户身份")
    ...
```

### 3 个必须有的 HTTP 边界

| 要素 | 作用 | Demo 实现 |
|------|------|----------|
| **身份** | 决定 Agent 能查谁的数据 | `x_user_id` Header（教学简化）|
| **Request-ID** | 串联日志 / Trace | `x-request-id` Header，缺省自动生成 uuid |
| **输入校验** | 挡掉明显非法请求 | Pydantic `min_length/max_length` |

> ⚠️ **教学 vs 生产**：Demo 用 Header 模拟身份；**生产必须用 JWT / Session 校验过的身份**，不能相信客户端传来的 `user_id`。

### 请求链路

```
客户端 → FastAPI（校验 / 身份 / Request-ID）→ Agent → 工具 → LLM
                                          ↓
                                        响应 + X-Request-ID
```

---

## 3️⃣ 流式响应（SSE）

### 为什么需要流式

```
非流式：用户盯着空白页 8 秒 → 一次性出全部答案
流式：  用户 1 秒后看到第一个字 → 逐字出现
```

**改善"首字延迟"，但不缩短总耗时。**

### SSE 实现骨架

```python
@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async def event_generator() -> AsyncIterator[str]:
        try:
            async for chunk, _ in agent.astream(inputs, stream_mode="messages"):
                if chunk.type != "AIMessageChunk":
                    continue
                text = extract_text(chunk.content)
                if not text:
                    continue
                payload = json.dumps({"content": text}, ensure_ascii=False)
                yield f"data: {payload}\n\n"      # SSE 格式：data: + 空行

            yield 'data: {"done": true}\n\n'
        except Exception:
            # 响应已开始，HTTP 状态码改不了了 → 用 SSE error 事件通知
            yield f'event: error\ndata: {{"error": "...", "done": true}}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

### 3 个关键坑

1. **`X-Accel-Buffering: no`** — 否则 Nginx 等反向代理会缓冲，前端收不到逐字效果
2. **响应开始后不能改 HTTP 状态码** — 错误只能通过 SSE 事件下发
3. **`data:` 必须以空行结束** — SSE 协议要求

### 输出速度该由谁控制？（来自 ChatGPT）

| 方案 | 实现 | 评价 |
|------|------|------|
| **A 跟随模型速度** ✅ 推荐 | 模型产生即发送 | 首字快、总耗时短 |
| B 后端 sleep 节流 | 每个 chunk 前 sleep 50ms | **人为拉长总耗时，不推荐** |
| C 前端节流 | 后端尽快发，前端按字符逐步显示 | 打字机效果的最佳位置 |

> **结论**：节奏控制放在**前端**，后端只负责尽快发。而且 SSE 只是把数据交给 HTTP 流，**不保证一次 yield = 一个网络包**。

### 两个延迟指标（面试常问）

| 指标 | 定义 | 由谁决定 |
|------|------|---------|
| **TTFT**（首字延迟）| 发出请求 → 看到第一个输出 | 模型服务、网络、Prompt 长度 |
| **总耗时** | 请求开始 → 最终完成 | 检索、工具、轮次、生成长度 |

---

## 4️⃣ 异步任务（45.2）

### 什么时候需要

```
用户问题："帮我生成一份 10 万页知识库的分析报告"
   ↓
同步 HTTP → 挂住 3 分钟 → 网关 504 超时 ❌
   ↓
异步任务 → 立刻返回 task_id → 前端轮询 ✅
```

### 202 + 轮询 模式

```python
@app.post("/tasks", status_code=status.HTTP_202_ACCEPTED)
async def create_task(request: TaskCreateRequest, x_user_id: str = Header(...)):
    task_id = str(uuid4())
    TASKS[task_id] = {
        "task_id": task_id,
        "user_id": x_user_id,
        "status": "pending",
        "result": None, "error": None,
        "created_at": ..., "updated_at": ...,
    }
    asyncio.create_task(execute_agent_task(...))   # 不等待完成
    return {"task_id": task_id, "status": "pending"}

@app.get("/tasks/{task_id}")
async def get_task(task_id: str, x_user_id: str = Header(...)):
    task = TASKS.get(task_id) or raise 404
    if task["user_id"] != x_user_id:
        raise HTTPException(status_code=403, detail="无权查看该任务")  # ★ 越权防护
    return task
```

### 任务状态机

```
pending → running → succeeded
                  ↘ failed
```

**每个状态转换都要更新 `updated_at` 并写日志**。

### 关键设计

| 点 | 为什么 |
|----|--------|
| 返回 **202** 而非 200 | 语义正确：已接受，未完成 |
| **`user_id` 隔离** | 别人不能查你的任务结果（403）|
| **状态存内存** | 教学版；生产要 Redis / DB（否则重启丢失）|
| 失败也要写 `error` | 不能只存成功路径 |

---

## 5️⃣ 可靠性：超时 + 重试（45.3）

### 核心问题

Agent 调用 LLM 可能超时/限流/抖动 → 直接失败给用户体验差。
**但盲目重试会放大问题**（把"慢"变成"更慢"）。

### 三段式：超时 → 判断可重试 → 指数退避

```python
def is_retryable_error(exc: Exception) -> bool:
    """只有"临时性"错误才重试。"""
    # 可重试：连接超时、网络抖动、429 限流、5xx
    # 不可重试：401 认证失败、400 参数错误、权限不足
    ...

async def invoke_agent_with_retry(...):
    for attempt in range(MAX_RETRIES + 1):
        try:
            return await asyncio.wait_for(agent.ainvoke(...), timeout=AGENT_TIMEOUT_SECONDS)
        except Exception as exc:
            retryable = is_retryable_error(exc)
            is_last_attempt = attempt == MAX_RETRIES
            logger.warning("attempt=%d retryable=%s error_type=%s", attempt, retryable, type(exc).__name__)
            if not retryable or is_last_attempt:
                raise
            await asyncio.sleep(backoff)   # 指数退避
```

### 重试决策表

| 错误 | 可重试？ | 原因 |
|------|---------|------|
| 超时 / 连接失败 | ✅ | 临时网络问题 |
| 429 Rate Limit | ✅ | 等一会就恢复 |
| 5xx 服务端错误 | ✅ | 对方可能在重启 |
| **401 认证失败** | ❌ | 重试也没用 |
| **400 参数错误** | ❌ | 请求本身有问题 |
| **权限不足** | ❌ | 业务拒绝，不是故障 |

> **重试 + 幂等必须配对**（参考 [agent-tool-security-and-reliability.md](./14-agent-tool-security-and-reliability.md) 的 Idempotency）。

---

## 6️⃣ 配置管理（45.4）

### 核心原则：**启动时校验，不要运行时炸**

```python
load_dotenv(PROJECT_ROOT / ".env")

class Settings:
    api_key: str
    base_url: str
    model: str
    timeout_seconds: float
    max_retries: int
    max_concurrent_requests: int

def load_settings() -> Settings:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("缺少 OPENAI_API_KEY，请检查项目根目录下的 .env")   # ★ 启动即失败
    ...
```

### 为什么把超时/并发写进配置？

```
AGENT_TIMEOUT_SECONDS=30
AGENT_MAX_RETRIES=0
AGENT_MAX_CONCURRENT_REQUESTS=3
```

**调参不需要改代码、不需要重启编译** — 这正是你后端熟悉的 12-Factor App 原则。

---

## 7️⃣ 关键洞察

1. **这一步没有新 AI 概念**，全是后端老本行（HTTP、超时、重试、配置、后台任务）→ 你最有优势的一步。

2. **四个能力是分层的**：
   ```
   配置（启动即校验）
      ↓
   服务（HTTP + 身份 + Request-ID）
      ↓
   执行（同步 or 异步任务）
      ↓
   可靠（超时 + 可重试判断 + 退避）
   ```

3. **流式 ≠ 更快**：只改 TTFT，不改总耗时。

4. **异步任务的权限**：轮询接口也必须校验 `user_id` 归属（Demo 里 403 就是这个）。

5. **重试不是越多越好**：判断"可重试"比"重试次数"更重要。

---

## ✅ 自检

- [ ] 1. Agent 服务化的 3 个 HTTP 边界是什么？
- [ ] 2. SSE 为什么要 `X-Accel-Buffering: no`？为什么响应开始后不能改状态码？
- [ ] 3. 输出节流应该放后端还是前端？为什么？
- [ ] 4. TTFT 和总耗时分别由什么决定？
- [ ] 5. 什么错误该重试、什么不该？为什么 401 不能重试？
- [ ] 6. 异步任务接口为什么返回 202？轮询接口为什么也要校验身份？

---

## 📂 相关代码

- `45_production_architecture/01_fastapi_service/main.py`（287 行）
- `45_production_architecture/02_async_tasks/main.py`（321 行）
- `45_production_architecture/03_reliability/main.py`（286 行）
- `45_production_architecture/04_config_management/`（267 行）

---

## 🔗 相关笔记

- [LangGraph 生产扩展](./12-langgraph-production-extensions.md) - FastAPI 定位 + HITL 恢复 API
- [Agent 可观测性](./18-agent-observability.md) - 日志与 Trace
- [Agent 工具安全 + 可靠性](./14-agent-tool-security-and-reliability.md) - Idempotency（与重试配对）
- [企业知识库 Agent 综合项目](./21-enterprise-agent-project.md) - 这 4 个能力的整合落地
