# 设计原型（HTML + PNG）

> 阶段 3 设计稿的两种形态，**HTML 用于浏览器交互预览，PNG 用于 PR / 文档嵌入**。

## 文件清单（v2 = 当前基准，2026-08-12）

| 文件                            | 类型          | 用途                                        |
| ------------------------------- | ------------- | ------------------------------------------- |
| `looklook-home.html`            | HTML          | 首页 `/` 完整交互预览                       |
| `looklook-homestay-detail.html` | HTML          | 民宿详情 `/homestay/:id` 完整交互预览       |
| `looklook-booking.html`         | HTML          | 下单页 `/homestay/:id/booking` 完整交互预览 |
| `v2-home.png`                   | 1440×1800 PNG | 首页截图（PR / 文档用）                     |
| `v2-homestay-detail.png`        | 1440×1800 PNG | 详情截图                                    |
| `v2-booking.png`                | 1440×1800 PNG | 下单截图                                    |

## 浏览器打开

```
open /Users/yangpeipei/Develop/web3/study/codex_project/frontend-project/go-zero-looklook-fe/docs/prototypes/looklook-home.html
```

## 设计准则（依据 ADR-0002 + tokens v2）

- 主色 `#3D2E1F` 深棕褐
- 字体：`Fraunces` 衬线标题 + `Inter` / `Noto Sans SC` 正文
- 正文 17px（中文+衬线舒适线），h1 clamp(36,52)，h2 clamp(30,40)
- 间距 4/8/16/24/32/48/64/80
- 圆角 4/8/12/pill，无 0 圆角
- 阴影只 2 级（sm / md）

## 与代码的关系

- HTML 原型是**视觉规范**，不是真实代码
- 落地代码应在 `src/pages/{homepage,homestay/Detail,homestay/Booking}/`
- tokens 来自 `../design/tokens.css`（已升级到 v2）

## 版本演进

| 版本 | 关键改进                           | commit         |
| ---- | ---------------------------------- | -------------- |
| v1   | 初版（字号偏小）                   | `4259f49` 之前 |
| v2   | body 17px, h2 +20%, 段落 1.95 行高 | `c4d690d`      |

后续若设计大改，保留 v2 作为参考，新版用 v3-* 命名。
