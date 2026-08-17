# go-zero-looklook-fe · 前端项目归档

> 来源仓库：[zhanbinb/go-zero-looklook-fe](https://github.com/zhanbinb/go-zero-looklook-fe)（本地路径 `~/Develop/web3/study/codex_project/frontend-project/go-zero-looklook-fe`）
>
> 对应后端仓库：[go-zero-looklook-new](https://github.com/zhanbinb/go-zero-looklook-new) · [归档笔记](../go-zero-looklook-new/README.md)
>
> 业务基线：[Mikaelemmmm/go-zero-looklook](https://github.com/Mikaelemmmm/go-zero-looklook)（社区经典民宿短租 demo）

本目录是 **go-zero-looklook-fe 前端项目全部原始文档 / 设计资产 / API 契约的镜像归档**，与 Go 后端归档 [go-zero-looklook-new](../go-zero-looklook-new/README.md) 配对使用。

---

## 1. 核心结论 / TL;DR

- **栈**：Vue 3.4 + TypeScript 5.4 + Vite 5 + Element Plus 2 + Pinia 2 + Axios + MSW Mock + vee-validate + zod · 测试 Vitest + Playwright
- **业务定位**：民宿短租（Airbnb 调性），不是小红书 / 内容社区 —— 这是扫描后端 19 个 API 之后的**事实修正**
- **MVP 页面数**：12 页（严格 1:1 对应后端能力，**零编造**）
- **当前阶段**：阶段 4 工程脚手架完成（已完成 0 / 0.5 / 0.6 / 1 / 2 / 4）；阶段 5（Mock）/ 6（页面）/ 7（联调）/ 8-10（测试·审计·CI）待办
- **设计基线**：深棕褐 `#3D2E1F` 主色，杂志感高级版，免费字体（Noto Serif SC + Fraunces）
- **多形态**：H5 + 独立 Web（同一份 Vue 代码 + 路由适配），不做 SSR / 小程序

---

## 2. 项目状态（11 阶段路线图）

| # | 阶段 | 状态 | 主要产物 |
|---|---|---|---|
| 0 | 项目脚手架 + AI 协作准则 | ✅ | `AGENTS.md` / `docs/ROADMAP.md` / `docs/adr/0001-*` |
| 0.5 | 业务调研 + PRD | ✅ | `docs/PRD.md`（含 4 类用户画像 / 9 步游客下单主线）|
| 0.6 | 设计 token 锁定 | ✅ | `docs/adr/0002-design-system.md` + `docs/design/tokens.css` |
| 1 | 后端代码上下文采集 + 业务对齐 | ✅ | `docs/api/inventory.md`（19 路由）+ `services-architecture.md` |
| 2 | API 契约生成 | ✅ | `docs/api/openapi.yaml`（713 行）+ `typescript-types.ts` + `client-seed.ts` + `modules-seed/{4 模块}` |
| 3 | UI/UX 设计稿 | ⏳ | （用 visualize skill 在对话内出 wireframe，待用户确认冻结）|
| **4** | **工程脚手架** | **✅** | `package.json`（30 依赖）+ vite/eslint/prettier/stylelint/vitest/playwright + src/ 骨架 + MSW + Pinia + router + 2 layouts + 12 占位页 |
| 5 | Mock 先行 | ⏳ | 为阶段 2 API 写 MSW handler + fixture |
| 6 | 页面实现（子 6.1–6.7）| ⏳ | design → spec → code → test → screenshot |
| 7 | 联调 + 鉴权 + 错误处理 | ⏳ | 切 baseURL 指向真后端；JWT 注入；错误码映射 |
| 8 | 测试 | ⏳ | vitest 覆盖 > 70%；Playwright 5 个 E2E |
| 9 | 性能 / a11y 审计 | ⏳ | Lighthouse > 90；axe-core 零 critical |
| 10 | CI/CD | ⏳ | GitHub Actions + Vercel / 阿里云 OSS |

总估时约 **28.5h**（单人 + Codex 协作）。详见 [`ROADMAP.md`](./ROADMAP.md)。

---

## 3. 文档导览（本归档）

### 3.1 项目根级（4 个）

| 文件 | 用途 | 何时读 |
|---|---|---|
| [`AGENTS.md`](./AGENTS.md) | AI 工作宪法：身份 / 栈 / 目录 / 行为准则 / 提交流程 | **任何 AI 接本项目必读** |
| [`ROADMAP.md`](./ROADMAP.md) | 11 阶段路线图 + 估时 + 推荐 Skill | 看当前进度 |
| [`PRD.md`](./PRD.md) | 产品需求：用户画像 / 模块清单 / 两条主线 / 决策记录 | 阶段 6 实现前回顾产品意图 |
| [`dev-backend.md`](./dev-backend.md) | 切到真实后端的联调指南：启动 → 配 proxy → 错误码排查 | 阶段 7 联调时 |

### 3.2 [`adr/`](./adr) · 架构决策记录（7 个）

| ADR | 主题 | 关键结论 |
|---|---|---|
| [0001-tech-stack](./adr/0001-tech-stack.md) | 栈选型 | 沿用原版 Vue 生态；React/Nuxt/AntD 不考虑 |
| [0002-design-system](./adr/0002-design-system.md) | 设计系统 | 深棕褐 #3D2E1F + 杂志感 + 免费字体；4/8/16/24 间距 |
| [0003-product-decisions-q1-q3](./adr/0003-product-decisions-q1-q3.md) | 产品决策 Q1–Q3 | 民宿短租 / H5 微信支付 / 缺失 API 不做 |
| [0004-stage-7-integration-decisions](./adr/0004-stage-7-integration-decisions.md) | 阶段 7 联调决策 | nginx auth_request / JWT 前端职责 / 401 跳转 |
| [0005-real-backend-ports](./adr/0005-real-backend-ports.md) | 后端端口约定 | 1004 usercenter / 1003 travel / 1001 order / 1002 payment |
| [0006-fe-api-robustness](./adr/0006-fe-api-robustness.md) | API 健壮性 | 解壳 / 错误码映射 / 重试 / 幂等 |
| [0007-auth-and-boss-flow-fixes](./adr/0007-auth-and-boss-flow-fixes.md) | 鉴权 + 老板流程修复 | JWT 存 cookie · isFav 只读 · 订单取消无接口 |

### 3.3 [`design/`](./design) · 设计资产

| 文件 | 说明 |
|---|---|
| [tokens.css](./design/tokens.css) | CSS variables：颜色 / 字号 / 间距 / 圆角 / 阴影。**阶段 6 写 UI 之前看这个** |
| [screens-roadmap.md](./design/screens-roadmap.md) | 12 页屏幕清单 + mermaid 流程图 |

### 3.4 [`api/`](./api) · API 契约

| 文件 | 说明 |
|---|---|
| [inventory.md](./api/inventory.md) | 后端 19 路由清单（自动扫描于 2026-08-12）+ 鉴权流程图 + MVP 12 页 ↔ API 对应表 |
| [services-architecture.md](./api/services-architecture.md) | 4 服务 (1004/1003/1001/1002) 拓扑 + 错误码体系 + nginx `auth_request` 流程 |
| [openapi.yaml](./api/openapi.yaml) | OpenAPI 3.1 完整契约（19 路由 / 30 schema / 713 行）· 阶段 4 时复制到 src/api/ 落地 |

### 3.5 [`prototypes/`](./prototypes) · 原型 HTML

| 文件 | 用途 |
|---|---|
| [README.md](./prototypes/README.md) | 原型说明 + 浏览器打开方式 |
| [looklook-home.html](./prototypes/looklook-home.html) | 首页（Feed + 猜你喜欢 + 好房东）|
| [looklook-booking.html](./prototypes/looklook-booking.html) | 民宿详情 + 预订流程 |
| [looklook-homestay-detail.html](./prototypes/looklook-homestay-detail.html) | 民宿详情页（含房型 / 评价 / 房价）|

> 原型 PNG（v2-*.png）保留在前端仓库的 `docs/prototypes/`，本归档只镜像 HTML 文本。

---

## 4. 后端 ↔ 前端 关键映射

### 4.1 端口与 baseURL

```
usercenter :1004  /usercenter/v1/*   →  /user/register /user/login /user/detail /auth_check /wxMiniAuth
travel     :1003  /travel/v1/*       →  /homestay*  /homestayBussiness*  /homestayComment*
order      :1001  /order/v1/*        →  /homestayOrder/createHomestayOrder /userHomestayOrderList /userHomestayOrderDetail
payment    :1002  /payment/v1/*      →  /thirdPayment/thirdPaymentWxPay (+ 微信回调，前端不调用)
mqueue                  —           →  无 REST，前端无需对接
```

### 4.2 鉴权（4 行铁律）

1. `POST /usercenter/v1/user/login` → 拿到 `token`（JWT）
2. Pinia + `localStorage` 存 `looklook:auth`（**不存敏感信息**，遵守 AGENTS.md）
3. 每个请求加 `Authorization: Bearer <token>`
4. 401 → 清 token → 跳登录页

> 前端不需要自己解析 token，也不调 `auth_check`（都交给 nginx auth_request + 后端）。
> 详见 [`api/inventory.md` §3](./api/inventory.md) mermaid 流程图。

### 4.3 字段类型速查

| Go 类型 | TS 类型 | 备注 |
|---|---|---|
| `int64` | `number` | unix 时间戳**也用 int64**，前端需 `new Date(ts * 1000)` |
| `float64` | `number` | **单位是"分"**（金额 ×100）|
| `string` | `string` | |
| `bool` | `boolean` | |

订单价格示例：后端给 `HomestayPrice: 31004` → 前端展示 `380.00 元`。

---

## 5. MVP 12 页 ↔ API（最终版）

| 前端页面 | 后端 API |
|---|---|
| `/` 首页 | `guessList` + `goodBoss` + `homestayBussinessList` |
| `/homestay` 民宿列表 | `homestayList` |
| `/homestay/:id` 民宿详情 | `homestayDetail` + `commentList` |
| `/homestay/:id/booking` 下单 | `createHomestayOrder` |
| `/homestay/businesses` 房东列表 | `homestayBussinessList` |
| `/homestay/business/:id` 房东详情 | `homestayBussinessDetail` + `businessList` |
| `/order` 我的订单 | `userHomestayOrderList` |
| `/order/:sn` 订单详情 | `userHomestayOrderDetail` |
| `/pay/:sn` 收银台 | `thirdPaymentWxPay` + 微信支付 SDK |
| `/login` | `user/login` |
| `/register` | `user/register` |
| `/u/me` 个人中心 | `user/detail` |

---

## 6. 已确认不做（避免下次重复提需求）

| 能力 | 后端是否支持 | 前端处理 |
|---|---|---|
| 用户资料编辑 | ❌ 无 `user/update` | UI 不提供入口 |
| 评论发布 | ❌ 无 `comment/create` | 只读 |
| 收藏 toggle | ❌ `isFav` 返回但无接口 | 显示图标但不可点 |
| 订单取消 / 退款 | ❌ 仅有 tradeState 状态 | UI 隐藏入口 |
| 营销券 / 通知 / IM / admin | ❌ 无 | 不在 MVP 范围 |
| 小程序 | 暂不做 | 阶段 10 之后用 uni-app / Taro 复用 |
| SSR / PWA | 暂不做 | MVP 不引入 |

---

## 7. 与后端归档的关系

后端项目归档：[`../go-zero-looklook-new/README.md`](../go-zero-looklook-new/README.md)

| 主题 | 后端归档对应章节 | 前端归档对应章节 |
|---|---|---|
| 项目身份 / 业务基线 | 顶部 | 顶部 |
| 服务拓扑 / 端口 | Stage 5（11 binary）| [§4.1](./README.md) |
| 鉴权流程（mermaid）| 涉及 nginx auth_request | [§4.2](./README.md) |
| API 路由表 | `app/**/desc/*.api` 源 | [api/inventory.md](./api/inventory.md) 扫描版 |
| 错误码 | `pkg/xerr/errCode.go` | [api/services-architecture.md](./api/services-architecture.md) |

---

## 8. 写作与归档约定

- 本目录是**项目原始文档镜像**，不再单独写"项目笔记"——所有知识沉淀在 ADR / design / api 三个子目录里
- 若阶段 6/7/8 后续产出有用的设计模式 / 踩坑记录，按 `NN-<topic>.md` 形式追加到 `golang/notes/` 顶层，**不要放本子目录**
- 大文档（如 openapi.yaml 713 行）适合归档不适合散落，故保留在本目录

---

#frontend #vue3 #typescript #vite #element-plus #go-zero-looklook #民宿短租
