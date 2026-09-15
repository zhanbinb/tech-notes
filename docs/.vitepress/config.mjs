import { defineConfig } from 'vitepress'
import { generatedSidebar } from './sidebar.generated.mjs'

export default defineConfig({
  title: 'Tech Notes',
  description: '技术学习笔记沉淀 · Go / Web3 / Cloud Native',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,
  // 部署在 github.io/<repo>/ 下，必须设 base，否则 CSS/JS 路径全是 404
  // 想要根路径 URL（zhanbinb.github.io/）则需要把仓库改名为 zhanbinb.github.io
  base: '/tech-notes/',
  ignoreDeadLinks: true,   // 笔记里的 ./xxx.md 链接保留原样，不让 build 因死链失败

  head: [
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
    // 压缩 heading 上下间距，让页面更紧凑
    ['style', {}, `
      :root {
        --vp-heading-margin-top: 12px !important;
        --vp-heading-margin-bottom: 8px !important;
      }
      h1 { margin-top: 0 !important; padding-bottom: 0.5rem !important; }
      h2 { margin-top: 1.5rem !important; padding-top: 0.5rem !important; }
      h3 { margin-top: 1rem !important; }
      p, blockquote, ul, ol { margin-top: 0.6rem !important; margin-bottom: 0.6rem !important; }
      hr { margin: 1rem 0 !important; }

      /* === 左侧导航栏压缩间距（深度覆盖） === */
      .VPSidebar { padding: 8px 4px !important; }
      .VPSidebarItem {
        padding: 2px 10px !important;
        margin: 0 !important;
        line-height: 1.35 !important;
        font-size: 13px !important;
      }
      .VPSidebarItem.level-1,
      .VPSidebarItem.level-2,
      .VPSidebarItem.level-3,
      .VPSidebarItem.level-0 {
        padding-top: 3px !important;
        padding-bottom: 3px !important;
      }
      /* 顶级分类标题加粗 */
      .VPSidebarItem.level-1 > .VPSidebarItem.level-1,
      .VPSidebarGroup > .VPSidebarItem {
        font-weight: 600 !important;
        padding-top: 6px !important;
        padding-bottom: 4px !important;
      }
      /* 子分组标题（如 go-clean-arch）*/
      .VPSidebarGroup .VPSidebarGroup .VPSidebarItem.level-1 {
        font-size: 12px !important;
        font-weight: 500 !important;
        color: var(--vp-c-text-2);
      }
      /* 侧边栏内 ul 之间间距 */
      .VPSidebar .group + .group,
      .VPSidebar ul + ul { margin-top: 0 !important; }

      /* === 右侧目录（TOC/Outline）压缩间距 === */
      .VPDocOutline,
      .VPOOutline { padding-top: 4px !important; }
      .VPDoc .outline-link,
      .vp-toc-link,
      a.outline-link {
        padding: 2px 0 2px 14px !important;
        margin: 0 !important;
        line-height: 1.4 !important;
        font-size: 13px !important;
      }
      .outline-link:hover { color: var(--vp-c-brand-1) !important; }
      /* TOC 缩进层级 */
      .VPDoc .outline-links { padding-left: 0 !important; }
    `]
  ],

  themeConfig: {
    siteTitle: 'Tech Notes',

    nav: [
      { text: '首页', link: '/' },
      { text: 'Go 学习路线', link: '/golang/01-go-backend-roadmap' },
      { text: 'Agent 学习路线', link: '/AI/01-agent-dev-learning-roadmap' },
      { text: 'GitHub', link: 'https://github.com/zhanbinb' }
    ],

    // sidebar 由 scripts/build-sidebar.mjs 自动生成（每次 build 前跑）
    // 这里可以加手写的特殊 sidebar 覆盖自动生成的
    sidebar: {
      ...generatedSidebar,
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhanbinb' }
    ],

    search: {
      provider: 'local',
      options: {
        miniSearch: {
          searchOptions: { fuzzy: 0.2, prefix: true }
        }
      }
    },

    outline: { level: [2, 3], label: '本页目录' },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    }
  }
})
