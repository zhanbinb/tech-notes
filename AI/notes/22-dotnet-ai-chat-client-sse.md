# .NET AI 实战：Microsoft.Extensions.AI 接入大模型 · SSE 流式 · 多轮对话 · ChatOptions

> OrderManagement 阶段 37（对话 30~32 归拢）：.NET AI 全套 —— 技术栈选型 → `IChatClient` 接入 MiMo → 强类型配置 → SSE 流式 → System Prompt → 会话记忆 → 生成参数控制。AI 相关知识归拢于此。

## 核心要点

- **技术栈区分**：**Microsoft.Extensions.AI = 统一抽象层**（`IChatClient`/`IEmbeddingGenerator`/`IImageGenerator`，换模型只改 DI）；VectorData（向量存储）、AI.Evaluation（评估）、Microsoft Agent Framework（Agent 编排）、Semantic Kernel（降为了解）
- 版本结论：`Microsoft.Extensions.AI 11.0.1` 支持 net10.0，**无需升级 .NET**
- **生命周期**：`IChatClient` Singleton（SDK 线程安全 + 复用连接）/ `InMemoryConversationStore` Singleton（跨请求共享历史）/ `AIChatService` Transient
- **多轮对话原理**：模型**不记忆 HTTP 请求** → 后端存 `List<ChatMessage>`（System/User/Assistant）**整体重发**；Assistant 消息也要存；同会话 **`SemaphoreSlim(1,1)` 串行** + `finally Release()`；滑窗保留 System + 最近 10 轮（`RemoveRange(1,2)`）；失败 catch 里 `RemoveAt` 回滚未完成消息
- **SSE 流式**：`IAsyncEnumerable<string>` + `yield return` + `[EnumeratorCancellation]`；Controller 设 `text/event-stream`、`data: xxx\n\n`、**`FlushAsync` 立即冲刷**；`curl -N` 测试
- **中文乱码根因**：`JsonSerializer.Serialize` 默认转义非 ASCII（`\u4F9D...`）→ 直接输出 UTF-8 文本
- **ChatOptions 三参数**：`Temperature`（0 稳定 / **0.3 技术问答** / 高多样，≠准确率）、`MaxOutputTokens`（只限**输出** Token，输入历史也花钱）、`TopP`（核采样 0.9，别与 Temperature 同调）；**ChatMessage 发什么 / System Prompt 定规则 / ChatOptions 控怎么生成**；参数配置化分环境
- **配置**：强类型 `AISettings` + `Bind + Validate(Url) + ValidateOnStart()`；Key 走 user-secrets/环境变量不进 Git

## 关键示例 / 命令

```bash
dotnet add package Microsoft.Extensions.AI.OpenAI --version 11.0.1
dotnet user-secrets set "AI:ApiKey" "..."          # AI:ApiKey / AI:BaseUrl / AI:Model
```

```csharp
// 注册（Singleton + 换模型只改这里）
builder.Services.AddSingleton<IChatClient>(_ => new OpenAI.Chat.ChatClient(
    model: aiSettings.Model,
    credential: new System.ClientModel.ApiKeyCredential(aiSettings.ApiKey),
    options: new OpenAIClientOptions { Endpoint = new Uri(aiSettings.BaseUrl) }).AsIChatClient());

// 非流式多轮
await conversation.Lock.WaitAsync(ct);
try {
    var resp = await _chatClient.GetResponseAsync(conversation.Messages, options, ct);
} finally { conversation.Lock.Release(); }

// SSE 流式
Response.ContentType = "text/event-stream";
await foreach (var chunk in _chatService.ChatStreamAsync(q, ct)) {
    var data = chunk.Replace("\r\n", "\n").Replace("\n", "\ndata: ");
    await Response.WriteAsync($"data: {data}\n\n", ct);
    await Response.Body.FlushAsync(ct);
}
```

```csharp
// .env 时序陷阱：Load 之后必须再挂一次环境变量源
DotNetEnv.Env.Load(Path.Combine(builder.Environment.ContentRootPath, ".env"));
builder.Configuration.AddEnvironmentVariables();
```

## 常见坑

1. **启动期 `?? throw` 校验 AI 配置** → Testing 环境没有该配置，Host 起不来、集成测试全挂（本项目当前 6 个测试失败根因）—— 可选依赖应**懒校验**或测试工厂注入占位
2. `.env` 加载晚于 `CreateBuilder` → 配置读不到，要再 `AddEnvironmentVariables()`
3. SSE 忘 `FlushAsync` → 数据全在缓冲里，看起来像「没反应」
4. 流式只发单条 User 消息 → 没有历史/System Prompt，多轮能力缺失
5. MiMo **Token Plan 端点禁止自建后端**（须按量付费 Key `api.xiaomimimo.com/v1`）
6. 历史无限增长 → Token 费用/延迟飙升，必须滑窗/摘要/压缩

## 下一节

AI 调用的**可靠性与可观测性**：超时、重试、日志、异常、Token 用量与成本控制 → 之后 Function Calling / Embedding / RAG。

## 相关链接

- 项目代码：`OrderManagement/src/OrderManagement.Api/{Services/AI,Controllers/AIController.cs,Settings/AISettings.cs}`
- 项目笔记：`OrderManagement/docs/18-dotnet-ai实战.md`
- Microsoft.Extensions.AI：https://learn.microsoft.com/ai/extensions/

---
#dotnet #ai #microsoft-extensions-ai #sse #llm
