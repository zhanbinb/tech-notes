# ADR-0004 联调阶段发现 + 决策

- 状态: 已接受
- 日期: 2026-08-12
- 范围: 阶段 7

## 重大发现

**后端真实响应壳 `code` 字段是 `200` (xerr.OK, uint32)，不是 0**

之前 openapi.yaml / mock fixtures / client.ts 全部写 `code: 0`。真实联调发现这是错误假设。

**影响范围**:

- `docs/api/openapi.yaml` — 18 处 `code: 0` 改成 `code: 200`
- `src/mocks/handlers.ts` — 18 处同上
- `src/api/client.ts` — 解壳逻辑 `body.code === 200 || body.code === 0` (兼容老 mock)

## 决策

### 1. 双码兼容

`client.ts` 解壳接受 `code === 200 || code === 0`：

- 真实后端用 200
- 老 mock / 未来测试可以继续用 0（如方便）
- 但**生成代码默认 200**（与后端对齐）

### 2. 错误码映射表强制对齐 pkg/xerr

在 `src/api/client.ts` 集中维护 BUSINESS_MSG：

- 200 SUCCESS
- 100001-100006 全局错误（与后端 errCode.go 一一对应）
- 业务模块预留 2xxxx 用户 / 3xxxx 民宿 / 4xxxx 订单 / 5xxxx 支付

### 3. 联调模式默认关闭

`VITE_USE_MOCK=true` 是默认值（开发体验好）；用户通过 `.env.development.local` 切到 `false` 后重启 dev server。

新文件 `.env.development.local.example` 提供模板。

### 4. dev 期日志

client.ts 在 dev 期打印 `[req]` 和 `[api-biz-err]` 调试日志，prod 构建会自动 tree-shake。

## 未做（明确推迟）

- ❌ 后端 CORS：当前通过 vite proxy 同源规避，无需前端配 CORS
- ❌ httpOnly cookie：go-zero 默认 Bearer header，localStorage 持久化已够用
- ❌ Refresh Token：后端无此 API，不做

## 不影响前端的事

后端 `pkg/xerr/errCode.go` 只列了 6 个全局错误码，业务错误（如 wxMiniAuth 失败）由 logic 层用 `xerr.NewErrMsg("wechat mini auth fail")` 自定义字符串消息，前端只需 `body.msg` 原样展示，无需映射。
