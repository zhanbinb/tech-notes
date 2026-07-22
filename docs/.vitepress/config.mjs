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
    ['meta', { name: 'theme-color', content: '#3b82f6' }]
  ],

  themeConfig: {
    siteTitle: 'Tech Notes',

    nav: [
      { text: '首页', link: '/' },
      { text: 'Go 学习路线', link: '/golang/01-go-backend-roadmap' },
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
