# go-zero-looklook-fe 开发路线图（11 阶段）

每个阶段结束时**必须 git commit**，阶段间可自由回滚。

---

## 阶段 0 - 项目脚手架 + AI 协作准则 [完成]

- 产物: `AGENTS.md` / `docs/ROADMAP.md` / `docs/adr/0001-*.md` / `.gitignore` / `README.md`
- 验收: 任何 AI 读 AGENTS.md 后能立刻开工

## 阶段 0.5 - 业务调研 + PRD [完成]

- 产物: `docs/PRD.md`（含用户画像 / 用户旅程 / 决策记录）
- 验收: §4 关键问题已逐条确认

## 阶段 0.6 - 设计 token 锁定 [完成]

- 产物: `docs/adr/0002-design-system.md` + `docs/design/tokens.css` + `docs/design/screens-roadmap.md`
- 验收: 配色 / 字体 / 间距 / 圆角全部 CSS variable 化

## 阶段 1 - 后端代码上下文采集 + 业务对齐 [完成]

- 产物: `docs/api/inventory.md`（19 路由）+ `docs/api/services-architecture.md` + 修订 PRD §2 §3 + 修订 screens-roadmap
- 关键发现: 后端是**纯民宿短租**项目，无内容/营销/IM/ADMIN，已清理 PRD 伪需求
- 当前阶段入口: 阶段 2 - API 契约生成

## 阶段 2 - API 契约生成 [完成]

- 产物:
  - docs/api/openapi.yaml (OpenAPI 3.1, 713 行 / 19 路由 / 30 schema)
  - docs/api/typescript-types.ts (TS 类型种子)
  - docs/api/client-seed.ts (axios 拦截器: 注 JWT + 解壳 + 错误码映射 + 401 跳转)
  - docs/api/modules-seed/{usercenter,travel,order,payment}.ts (4 业务模块)
  - docs/api/modules-seed/index.ts
- 阶段 4 时整体复制到 src/api/
- 当前阶段入口: 阶段 3 - UI/UX 设计稿

## 阶段 3 - UI/UX 设计稿

- 用 visualize skill 在对话内出关键页 wireframe
- 输出到 docs/design/*.md（含 mermaid + 设计 token）
- 用户确认后冻结设计

## 阶段 4 - 工程脚手架 [完成]

- 产物: package.json (30 依赖) + tsconfig + vite.config.ts + index.html + ESLint v9 flat config + Prettier + Stylelint + Vitest + Playwright + Husky hooks + .editorconfig/.npmrc/.env.* + src/ 骨架: main.ts + App.vue + router + 2 layouts + 12 占位页 + src/styles/{tokens.css (从 docs/design/v2 落地), element-overrides.scss, global.scss} + src/api/{client.ts, types/, modules/ × 4} (从 docs/api/ 落地) + src/stores/{auth, app} + src/utils/{auth, date, format, permission} + tests/unit/sanity.spec.ts (管道占位测试)
- 验证: 用户本地 `pnpm install && pnpm typecheck && pnpm lint && pnpm test`
- 当前阶段入口: 阶段 5 - Mock 先行

## 阶段 5 - Mock 先行

- 启动 MSW
- 为阶段 2 生成的 API 写 handler + fixture
- 不依赖后端即可跑通全部页面

## 阶段 6 - 页面实现（prompt 驱动）

- 子阶段: 6.1 通用布局 / 6.2 鉴权 / 6.3 首页 / 6.4 旅游 / 6.5 民宿 / 6.6 订单 / 6.7 个人中心
- 每个子阶段: design -> component spec -> code -> test -> screenshot

## 阶段 7 - 联调 + 鉴权 + 错误处理

- 切换 axios baseURL 指向真实后端
- 配 JWT（前端从 usercenter/login 取，存 httpOnly cookie）
- 全局错误码映射

## 阶段 8 - 测试

- vitest 单元覆盖 > 70%
- playwright 写 5 个核心 E2E（登录/下单/支付/退款/分享）

## 阶段 9 - 性能 / 可访问性审计

- Lighthouse > 90
- axe-core a11y 零 critical
- bundle analyzer

## 阶段 10 - CI/CD

- GitHub Actions: lint + typecheck + test + build + e2e
- 自动发到 Vercel / 阿里云 OSS

---

## 推荐 Skill/插件清单

| 阶段 | 推荐 Codex Skill                             |
| ---- | -------------------------------------------- |
| 1-2  | openai-docs（需要时）                        |
| 3    | visualize 视觉化设计稿                       |
| 4    | skill-creator 创建自定义 vue3-scaffold skill |
| 6    | skill-installer 安装社区组件模板 skill       |
| 全程 | openai-docs 自助查资料                       |

---

## 时间预估（单人 + Codex 协助）

| 阶段 | 估时           |
| ---- | -------------- |
| 0    | 0.5h           |
| 0.5  | 1h（业务对齐） |
| 1    | 1h             |
| 2    | 2h             |
| 3    | 2h             |
| 4    | 1h             |
| 5    | 2h             |
| 6    | 12h（最大头）  |
| 7    | 2h             |
| 8    | 3h             |
| 9    | 1h             |
| 10   | 1h             |
| 合计 | ~28.5h         |
