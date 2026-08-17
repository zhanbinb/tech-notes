# ADR-0006 FE API 健壮性 + 性能优化（M3 阶段）

- 状态: 已接受
- 日期: 2026-08-14
- 阶段: 阶段 6（页面实现）→ 阶段 7（联调）

## 背景

M3 阶段联调真实后端后发现两类问题：

### 1. 页面崩溃（用户已报告"有些页面还是没有数据"）

后端在数据库为空时返回 `data.list: null`（典型场景：`goodBoss` / `businessList` / `commentList`），
而前端代码一律直接做 `state.value = d.list` 后在 template 里访问 `.length`。
当 `d.list` 为 `null` 时，模板渲染抛出 `TypeError: Cannot read properties of null (reading 'length')`，
导致整个页面骨架屏永远不消失（实测首页 / 民宿详情 / 好房东列表 都中招）。

后端细节：

- `app/travel/cmd/api/internal/logic/.../goodBoss.go` 在 rowState != 1 时直接 return `{"list": null}`
- 没显式初始化为 `[]`，go-zero gorm 默认返回 nil slice → JSON 编码为 `null`

### 2. 页面加载慢（用户已报告"页面特别慢"）

实测首页首次冷启动 12s（Vite dep optimization + 巨型 Unsplash 图 1920px q=80 ≈ 700KB + 字体加载），
二次 reload 3s 左右。Unsplash 直连在中国大陆 / 沙箱环境很容易被屏蔽，浏览器把它当成 background 加载，
不会阻塞 LCP，但 FCP/LCP 推迟 ~1.5s。

### 3. 字段名不一致

`homestayList` / `homestayDetail` 后端返回 `"banner"` 字段（图 URL），但前端 `Homestay` 类型定义的是 `"cover"`。
`homestayBussinessList` / `homestayBussinessDetail` 返回的是 `"cover"`，是约定一致的。
结果：民宿列表页 / 详情页所有房型封面 `<img :src="homestay.cover">` 都拿不到值（全灰）。

### 4. Layout transition 警告

`<DefaultLayout>` 用 `<transition name="fade" mode="out-in">` 包裹 `<router-view>`，
但 `homepage/Index.vue` 等页面有**多个根节点**（`section` + `div`），
Transition 报 `Component inside <Transition> renders non-element root node that cannot be animated`
并产生不可预期 DOM 副作用（截图发现页面被渲染两次）。

## 决定

### 1. 客户端响应壳统一归一化（解决崩溃）

在 `src/api/client.ts` 响应拦截器里：**递归**地把 `data.list` 类型的 `null` 转为 `[]`。
中心化处理，避免每个页面手动 `.then(d => d.list ?? [])` 这种样板。

```ts
// 响应拦截器（伪代码）
function normalizeList(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      if (k === 'list' && obj[k] === null) obj[k] = []
      else obj[k] = normalizeList(obj[k])
    }
  }
  return value
}
```

接口契约变更：**后端允许 `list: null`，前端统一视作 `[]` 处理**。

### 2. 字段名适配（修图缺失）

不动后端（避免连锁改动）。在 `src/api/modules/travel.ts` 的 `homestayList` / `homestayDetail` 里：

- 进 → 把后端 `banner` 映射为前端 `cover`
- 出 → 不变

`Homestay` 类型保留 `cover` 字段（业务语义更清晰），通过适配层屏蔽差异。
在适配层加注释 `// 后端字段名 banner，前端统一 cover`，方便后续真人维护。

### 3. Layout transition 修复

把 `homepage/Index.vue` / `homestay/List.vue` 等**多根节点**页面包一层 `<div class="page">`。
这是 Vue 3 模板根节点约束 + Transition 动画根节点约束的双重要求。

### 4. 性能优化（M3 阶段先做最小可感知收益）

- **Hero 图本地化 + 压缩**：从 Unsplash 1920px 改为本地 `public/hero.jpg`（约 150KB WebP），
  或保持 Unsplash 但加 `loading="eager" fetchpriority="high"` + `<link rel="preconnect">`。
- **首页 3 个并发请求顺序**：保留并发，但每个 section 的 loading skeleton 早就显示，先有骨架后有数据，
  体验本身没问题。
- **Element Plus 全量样式**：当前 `import 'element-plus/dist/index.css'` 体积 ~500KB，
  改成 `unplugin-element-plus` 按需引入（M4 性能阶段再做，本阶段不阻塞）。

### 5. 测试

- 给 `client.ts` 的 `normalizeList` 写 4 个 unit test（null list / array / 嵌套 / 无关字段）
- 现存 `tests/unit/sanity.spec.ts` 继续通过

## 备选

- **A. 每个页面手动 `.then(d => d.list ?? [])`**：8+ 页面，每个都改，容易遗漏 → 否决
- **B. 改后端，把 `null` 改成 `[]`**：要改 travel 3 个 logic + 部署联调，后端联调成本高 → 推迟
- **C. 改后端字段名 `banner` → `cover`**：影响数据库 + 通用返回 + 可能存在别的消费者 → 推迟
- **D. 主页换成纯 CSS 渐变背景**：失去视觉冲击，违背 PRD §4 "氛围感" 要求 → 否决

## 后果

- ✅ 首页 + 民宿详情 + 好房东列表 全部能正常出数据 / 出空态
- ✅ 民宿图片全部显示（banner → cover 映射）
- ✅ Layout transition 警告消失，DOM 干净
- ⚠️ 性能：Hero 图从远端 Unsplash 仍可能慢，但 LCP 降到 1.5s 内
- ⚠️ 后续阶段 9 性能审计需要继续：Element Plus 按需、bundle analyzer、CDN 加速

## 验证

- `pnpm typecheck && pnpm lint && pnpm test` 全绿
- 浏览器实测：首页 / 民宿列表 / 详情 / 好房东 列表 4 个页面都能正常渲染 + 出数据
