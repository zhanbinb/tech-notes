# Tech Notes 博客：自动部署工作流

> 完整记录 tech-notes → VitePress → GitHub Pages 的全自动化流程。
> 包括文件结构、构建步骤、新增分类的方法、各种坑的修法。

## TL;DR

```
写笔记 → git push → GitHub Actions 自动 build → GitHub Pages 上线
```

新加一个分类（比如 `python/`、`kubernetes/`）只需要创建 `<新>/notes/` 写笔记然后 push——**完全不用改 workflow / config**。

## 架构

```
tech-notes 仓库（main 分支）
│
├── <category>/notes/*.md           ← 你写笔记的源
│
├── scripts/
│   └── build-sidebar.mjs           ← 自动化核心
│
├── docs/.vitepress/
│   ├── config.mjs                  ← VitePress 配置（基本不动）
│   └── sidebar.generated.mjs       ← 自动生成（gitignore）
│
└── .github/workflows/
    └── deploy.yml                  ← GitHub Actions CI

触发流程：
push → Checkout → 跑 build-sidebar.mjs → VitePress build → 部署到 GitHub Pages
```

## 各文件角色

| 文件 | 作用 | 需要改吗 |
| --- | --- | --- |
| `<category>/notes/*.md` | 你写的笔记（唯一事实源） | 写笔记就改 |
| `scripts/build-sidebar.mjs` | 扫描 + 生成 sidebar + 拷贝 | 加新分类时改 `CATEGORY_TITLES` |
| `docs/.vitepress/config.mjs` | VitePress 站点配置 | 几乎不动 |
| `docs/.vitepress/sidebar.generated.mjs` | 自动生成（脚本产物） | 永远别手改 |
| `docs/<category>` → `../<category>/notes` | 软链（本地一致性） | 加新分类时建一个 |
| `.github/workflows/deploy.yml` | CI 编排 | 几乎不动 |
| `.gitignore` | 排除 build 产物 | 加新分类不用改 |

## 构建流程（每次 push 跑 3 步）

### Step 1 · Checkout + Install

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm install          # working-directory: docs
```

### Step 2 · 准备：扫描 + 生成 sidebar + 拷贝 notes

```yaml
- run: node scripts/build-sidebar.mjs
```

`build-sidebar.mjs` 一口气做三件事：

1. **扫描**仓库根下每个 `<category>/notes/` 目录
2. **生成** `docs/.vitepress/sidebar.generated.mjs`：
   - 每个 .md 的 H1 作为显示标题
   - 顶级 `<category>/notes/*.md` → 一级 sidebar 项
   - 子目录 `<category>/notes/<sub>/*.md` → 子分组
3. **拷贝** `<category>/notes/` → `docs/<category>/`（覆盖 symlink 避免 VitePress 路径解析混乱）

### Step 3 · Build + 部署

```yaml
- run: npm run docs:build
- uses: actions/upload-pages-artifact@v3
  with: { path: docs/.vitepress/dist }
- uses: actions/deploy-pages@v4
```

## 加新分类的步骤（以新增 `python` 为例）

```bash
# 1. 创建目录结构
mkdir -p python/notes
cat > python/README.md <<'EOF'
# Python

Python 笔记收录地。

> 学习过程中逐步沉淀，每条知识点单独一个 Markdown 文件，放在 [`notes/`](notes/) 下。

## 笔记目录

（待添加）
EOF

# 2. 写第一篇笔记
cat > python/notes/01-python-basics.md <<'EOF'
# 01 · Python 基础语法速览

（内容）
EOF

# 3. 建软链（让 docs/python 跟其他分类保持一致）
ln -s ../python/notes docs/python

# 4. （可选）优化显示名：编辑 scripts/build-sidebar.mjs
#    加 'python': 'Python' 到 CATEGORY_TITLES
#    不加也能用，脚本会 fallback 到目录名

# 5. 更新 INDEX.md（顶层浏览入口）

# 6. push（save-to-tech-notes skill 自动做）
git add python/ docs/python scripts/build-sidebar.mjs INDEX.md
git commit -m "docs(python): add new category"
git push
```

### 自动化边界

| 环节 | 自动化？ |
| --- | --- |
| 触发 build | ✅ 自动 |
| 部署到 Pages | ✅ 自动 |
| 发现新分类 | ✅ 自动 |
| 生成 sidebar | ✅ 自动 |
| 拷贝 notes 到 docs/ | ✅ 自动 |
| VitePress build | ✅ 自动 |
| 顶层 `INDEX.md` 登记 | ❌ 手动 |
| `CATEGORY_TITLES` 显示名优化 | ❌ 手动（可选） |

## VitePress 关键配置

```js
// docs/.vitepress/config.mjs 核心配置
export default defineConfig({
  lang: 'zh-CN',
  base: '/tech-notes/',         // 部署在子路径必须设
  cleanUrls: true,
  ignoreDeadLinks: true,       // 笔记里的 ./xxx.md 链接不校验
  themeConfig: {
    sidebar: { ...generatedSidebar },
    search: { provider: 'local', ... },
    // ...其他主题配置
  }
})
```

## 踩过的坑（必看）

| 坑 | 症状 | 修法 |
| --- | --- | --- |
| 没设 `base` | CSS/JS 全 404，页面裸 HTML | `base: '/<repo>/'` |
| symlink 在 Actions 上 | VitePress 路径解析乱，报 "vue/server-renderer" 错 | build 前 `cp -r` 覆盖 |
| `cache-dependency-path` 指向不存在的 lockfile | setup-node 失败 | 先不启用 cache，或提交 lockfile |
| 笔记里 `./xxx.md` 链接 | 36 个死链，build 失败 | `ignoreDeadLinks: true` |
| 跨目录相对路径 | VitePress URL 体系里对不上 | 当前选择不修，链接在博客里 404 |

## 本地预览

```bash
cd docs
npm install
npm run docs:dev    # http://localhost:5173（热更新）
```

## 部署地址

```
https://zhanbinb.github.io/tech-notes/
```

## 优化 TODO

- [ ] commit `package-lock.json` 启用 `cache: npm`（每次 build 省 ~30s）
- [ ] 想换主题？试试 `hope` / `mint` 等 VitePress 主题
- [ ] 加 RSS / sitemap / 评论
- [ ] 想根 URL（`zhanbinb.github.io/`）？把仓库改名为 `zhanbinb.github.io`

## 相关链接

- VitePress：https://vitepress.dev/
- GitHub Pages 文档：https://docs.github.com/en/pages
- GitHub Actions 文档：https://docs.github.com/en/actions

---
#VitePress #GitHub-Pages #CI-CD #blog #自动化
