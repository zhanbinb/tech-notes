# AGENTS.md — go-zero-looklook-fe AI 工作准则

> 本文件为所有 AI 助手（Codex、Cursor、Copilot…）在本项目工作时必须遵守的"宪法"。
> 修改前请先在 docs/adr/ 新增一条 ADR。

---

## 1. 项目身份

- **项目**: go-zero-looklook 前端
- **后端仓库**: https://github.com/zhanbinb/go-zero-looklook-new（本地镜像在 `../go-zero-looklook-new`）
- **产品定位**: 类似小红书的生活方式分享社区（旅游/民宿/出行/营销）
- **业务模块（后端已确定）**:
  - usercenter（用户/认证）
  - travel（游记/目的地）
  - homestay（民宿）
  - order（订单）
  - payment（支付）
  - mqueue（消息/异步任务，前端一般不直接消费）

---

## 2. 技术栈（不可擅自更换）

| 类别     | 选型                                                    | 备注                    |
| -------- | ------------------------------------------------------- | ----------------------- |
| 语言     | TypeScript ^5.4                                         | `strict: true`          |
| 框架     | Vue 3.4+ (Composition API + <script setup>)             | 不写 Options API        |
| 构建     | Vite 5                                                  | dev server 默认 5173    |
| 路由     | vue-router 4                                            | 文件路由 + 权限守卫     |
| 状态     | Pinia 2 + pinia-plugin-persistedstate                   |                         |
| UI 库    | Element Plus 2.x (auto-import on)                       | 营销页另用纯 CSS        |
| HTTP     | Axios + 自研 request 封装                               | 拦截器统一处理 code/msg |
| Mock     | MSW (Mock Service Worker)                               | 开发期替代真实 API      |
| 表单     | vee-validate + zod                                      | schema 复用后端 proto   |
| 代码风格 | ESLint v9 flat config + Prettier + Stylelint            |                         |
| 测试     | Vitest（单元） + Playwright（E2E）                      |                         |
| 包管理   | pnpm                                                    |                         |
| 提交规范 | Conventional Commits + commitlint + husky + lint-staged |                         |

任何想换技术栈的请求 → 先开 ADR。

---

## 3. 目录约定

```
src/
  api/                  # 由 OpenAPI 自动生成，不要手写
    client.ts           # axios 实例
    modules/            # 各业务模块的方法
  api-contracts/        # 生成的 OpenAPI/Proto 文件（只读）
  assets/               # 图片、字体
  components/
    common/             # 跨业务通用组件（EmptyState、ErrorBoundary...）
    business/           # 业务组件（按业务模块分子目录）
  composables/          # useXxx
  directives/           # v-permission 等
  layouts/              # DefaultLayout / AdminLayout / BlankLayout
  mocks/                # MSW handlers
  pages/
    <module>/           # 每个后端模块对应一个前端 module
  router/
    routes.ts
    guards.ts
  stores/               # Pinia
  styles/
    tokens.css          # 设计 token（颜色/字号/间距）
    element-overrides.scss
  utils/
    auth.ts
    request.ts
    permission.ts
  App.vue
  main.ts
```

---

## 4. AI 行为准则（最重要）

### 必须

1. 先读 AGENTS.md + docs/ROADMAP.md + 当前阶段 ADR 再动手
2. 新文件必须遵守 §3 目录约定
3. 类型优先：所有 API 返回值必须是 TS 类型，禁止 any
4. 生成 UI 前先确认设计：颜色 -> tokens.css，间距 -> 4/8/16/24
5. 每个组件生成时同步生成 .spec.ts 单元测试
6. 写完代码立即跑 typecheck + lint + test，全绿才算完成
7. 任何"看起来不对劲"的事：先问用户，别猜

### 禁止

1. 装未在 §2 表里的依赖（除非先开 ADR）
2. 直接 git push / git reset --hard / rm -rf 任何文件
3. 创建 .js 副本（项目是纯 TS）
4. 在 <template> 写复杂逻辑，超过 3 行抽到 <script setup>
5. 用 localStorage 直接存敏感信息
6. 跑 dev server 后挂 5 分钟不动

---

## 5. 提交流程

Conventional Commits：`feat(module): 新增游记列表页`

阶段 6 起每个 PR 都要截图 / GIF。

---

## 6. 与 Codex 协作的标准节奏

| 步骤 | 用户动作                       | Codex 动作                         |
| ---- | ------------------------------ | ---------------------------------- |
| 1    | 开新会话，粘贴本文件 + ROADMAP | 复读并复述理解                     |
| 2    | "现在做阶段 X.Y"               | 给出本子阶段产物清单               |
| 3    | （无）                         | 执行 + 验证（typecheck/lint/test） |
| 4    | 验收                           | commit / 提 PR                     |

---

## 7. 出错处理

任何 step 报错 -> Codex 先尝试自行定位 3 次，仍失败 -> 立刻停下来，把错误原文贴回用户，不要试图"绕过"。
