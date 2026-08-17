# ADR-0001 前端技术栈选型

- 状态: 已接受
- 日期: 2026-08-12
- 决定人: 用户 + Codex

## 背景

go-zero-looklook 原版前端用的就是 Vue 3 + Vite + TS + Element Plus + Pinia 组合，
与 go-zero 后端生态契合度高，AI 生成代码质量优秀。

## 决定

完全沿用原版栈，详见 AGENTS.md §2。

## 备选

- React + Next.js: SSR 强，但与后端团队习惯（Vue）不一致
- Nuxt 3: SSR + Vue，但要重写 Axios 部分
- Ant Design: 视觉与企业级后台更契合，但与原品牌色冲突

## 后果

- 所有 prompt 示例默认 Vue 3，跨框架复制需手动翻译
- 招聘与代码审查对 Vue 经验有要求
