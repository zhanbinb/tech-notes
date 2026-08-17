# Tech Notes

> 个人技术学习笔记沉淀仓库，覆盖 Go 后端 / Web3 / 云原生 / DevOps / AI 工具链 等领域。
> 
> 写作源（Markdown）即本仓库各分类下的 `notes/` 文件，由 [VitePress](https://vitepress.dev/) 渲染发布到 GitHub Pages —— 即 **本博客**。
> 
> 📦 **源仓库**：[github.com/zhanbinb/tech-notes](https://github.com/zhanbinb/tech-notes)（⭐ 加星 / Fork 方便回访）

## 🎯 当前学习重点

- **Go 后端 → Web3 后端**：长期目标，准备 P6/P7 级简历项目
- **Clean Architecture 实战**：从 [go-clean-arch](golang/notes/go-clean-arch/) 项目逐层拆解
- **go-zero 全栈**：[go-zero-looklook-new](golang/notes/go-zero-looklook-new/README.md)（后端）+ [go-zero-looklook-fe](golang/notes/go-zero-looklook-fe/README.md)（前端）一站打通
- **Codex 工具链**：把 AI 工具真正用成日常生产力

## 📚 笔记导航

| 分类 | 入口 | 笔记数 |
| --- | --- | --- |
| Codex 工具链 | [Codex Skill 创建：通过 Plugin 分发](/codex/01-codex-skill-creation-via-plugin) | 2 篇 |
| Docker 容器化 | [01 · Docker vs Docker Compose 区别](/docker/01-docker-vs-compose) | 3 篇 |
| etcd | [Etcd 运维、排错与企业级实践](/etcd/01-etcd-ops-and-enterprise-patterns) | 1 篇 |
| GitHub | [Tech Notes 博客：自动部署工作流](/github/01-tech-notes-blog-auto-deploy) | 1 篇 |
| Go 后端学习路线 | [Go 后端学习路线图（融合版 · 2026-07）](/golang/01-go-backend-roadmap) | 6 篇主线 + 76 篇 go-clean-arch 项目拆解 |
| Kubernetes | [Kubernetes、云原生与 AWS：从容器部署到 Pod 调度](/kubernetes/01-kubernetes-cloud-native-aws-pod-scheduling) | 2 篇 |
| 工具与排查 | [Chrome 页面图标缺失：系统代理进程崩溃导致 TLS 失败](/tools/01-chrome-icons-missing-system-proxy-dead) | 1 篇 |

## ⚙️ 自动部署（写完 push 即更新博客）

- `git push` → `main` → 触发 [`.github/workflows/deploy.yml`](https://github.com/zhanbinb/tech-notes/blob/main/.github/workflows/deploy.yml)
- 工作流跑 `scripts/build-sidebar.mjs` 自动扫描 `notes/`，生成 VitePress sidebar + 拷贝到 `docs/`
- 再跑 `vitepress build`，产物上传到 GitHub Pages
- **约 1 分钟内本博客自动更新**

## ✍️ 写作约定

- 笔记命名：`NN-<topic>.md`，两位数序号便于排序
- 一条笔记对应一个具体知识点，颗粒度适中
- 主体中文；关键字、类型名、API、命令保留英文
- 项目实战归档例外：单项目笔记达到 20+ 篇时用独立子目录收纳（如 `go-zero-looklook-new/`）

---

> 💡 **左下角**可以展开/折叠分类 · 顶部搜索框支持全文 fuzzy 搜索（快捷键 `K`）
