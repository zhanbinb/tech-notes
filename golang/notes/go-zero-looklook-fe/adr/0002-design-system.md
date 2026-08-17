# ADR-0002 视觉设计系统（杂志感高级版）

- 状态: 已接受
- 日期: 2026-08-12
- 替代: ADR-0001 默认"小红书红 + 苹方"风格被本决策覆盖

## 背景

原 looklook 默认方案沿用小红书的橙红 + 苹方，但用户要求"杂志感高级版"。
核心气质：**像 Kinfolk / Monocle / 周末旅人**这类生活美学杂志，
而不是电商型信息流。

## 决定

### 配色 token（CSS variable 命名规范）

| 角色         | token              | 值        | 用途               |
| ------------ | ------------------ | --------- | ------------------ |
| Brand 主色   | `--brand-ink`      | `#3D2E1F` | 标题、主按钮、强调 |
| Brand 辅色   | `--brand-olive`    | `#6B7F4C` | 自然/户外类标签    |
| Accent       | `--brand-amber`    | `#D4A574` | 优惠、提示、点缀   |
| Surface 底   | `--surface-paper`  | `#FAF7F2` | 页面背景           |
| Surface 卡   | `--surface-card`   | `#FFFFFF` | 卡片背景           |
| Surface 二级 | `--surface-canvas` | `#F0EBE3` | 输入框/区块底      |
| 文字 主      | `--text-primary`   | `#2A2A2A` | 正文               |
| 文字 次      | `--text-secondary` | `#6B6358` | 描述/时间          |
| 文字 弱      | `--text-tertiary`  | `#A39A8E` | 占位/未读          |
| 描边         | `--border-soft`    | `#E8E1D4` | 卡片描边           |
| 描边         | `--border-strong`  | `#3D2E1F` | 强调描边           |
| 状态-成功    | `--status-success` | `#5C7556` |                    |
| 状态-警告    | `--status-warning` | `#B5842A` |                    |
| 状态-错误    | `--status-danger`  | `#A8453B` |                    |

### 字体

```css
--font-serif: 'Fraunces', 'Noto Serif SC', 'Songti SC', serif; /* 标题、杂志感 */
--font-sans: 'Inter', 'Noto Sans SC', 'PingFang SC', sans-serif; /* 正文 */
--font-mono: 'JetBrains Mono', monospace;
```

字号体系（**桌面优先**，移动对应缩减）：

| token          | 值      | 用途                  |
| -------------- | ------- | --------------------- |
| `--fs-display` | 64 / 72 | 巨幅标题（首屏 hero） |
| `--fs-h1`      | 40 / 48 | 文章/民宿名           |
| `--fs-h2`      | 28 / 32 | 区段标题              |
| `--fs-h3`      | 20 / 24 | 卡片标题              |
| `--fs-body`    | 16 / 18 | 正文                  |
| `--fs-caption` | 13 / 14 | 注释/标签             |

### 间距（4px 基础）

`--space-1=4 / 2=8 / 3=12 / 4=16 / 5=20 / 6=24 / 8=32 / 10=40 / 12=48 / 16=64`

### 阴影（克制，仅 2 级）

- `--shadow-sm`: `0 1px 2px rgba(61,46,31,.06)`
- `--shadow-md`: `0 8px 24px rgba(61,46,31,.08)`

### 圆角

`--radius-sm=4 / md=8 / lg=12 / pill=9999`，**全站禁用 0 圆角**（避免尖锐感）

## 落地

- 阶段 4 时由 Element Plus 主题覆盖 + 全局 `tokens.css` 双绑定
- 营销页/首屏 hero **不用 Element Plus 组件**，纯 CSS 表达杂志气质
- 后台/表单/表格 **用 Element Plus**，但传入 CSS variable 覆盖色板

## 字体加载

- Google Fonts CDN 加载 Fraunces / Inter / Noto SC
- 子集化处理（woff2 + unicode-range），避免中文全量包炸首屏
- **预连接** `https://fonts.googleapis.com` + `https://fonts.gstatic.com`
