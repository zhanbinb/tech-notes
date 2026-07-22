import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Tech Notes',
  description: '技术学习笔记沉淀 · Go / Web3 / Cloud Native',
  lang: 'zh-CN',
  lastUpdated: true,
  cleanUrls: true,

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

    sidebar: {
      '/golang/': [
        {
          text: 'Go 后端学习路线',
          collapsed: false,
          items: [
            { text: '01 · 学习路线图（融合版）', link: '/golang/01-go-backend-roadmap' },
            { text: '02 · 第一梯队：企业级框架', link: '/golang/02-go-tier1-enterprise-frameworks' },
            { text: '03 · 第二梯队：云原生基础设施', link: '/golang/03-go-tier2-cloudnative-infra' },
            { text: '04 · 第三梯队：存储与消息队列', link: '/golang/04-go-tier3-storage-and-mq' },
            { text: '05 · 第四梯队：Web3 区块链', link: '/golang/05-go-tier4-web3-blockchain' },
            { text: '06 · 第五梯队：业务系统模板', link: '/golang/06-go-tier5-business-systems' }
          ]
        },
        {
          text: 'go-clean-arch 项目拆解',
          collapsed: false,
          items: [
            { text: '01 · Echo vs Gin', link: '/golang/go-clean-arch/01-echo-vs-gin' },
            { text: '02 · main.go 拆解', link: '/golang/go-clean-arch/02-main-go-clean-arch' },
            { text: '03 · Rest Delivery Layer', link: '/golang/go-clean-arch/03-rest-delivery-layer' },
            { text: '04 · Repository MySQL Layer', link: '/golang/go-clean-arch/04-repository-mysql-layer' },
            { text: '05 · 原生 SQL vs ORM', link: '/golang/go-clean-arch/05-native-sql-vs-orm' },
            { text: '06 · cmd entries · wire 与 bearer', link: '/golang/go-clean-arch/06-cmd-entries-wire-and-bearer' },
            { text: '07 · Register / 调用链 / DI', link: '/golang/go-clean-arch/07-register-call-chain-and-di' },
            { text: '08 · 三层 Article 为何不冗余', link: '/golang/go-clean-arch/08-three-layer-article-why-not-redundant' }
          ]
        }
      ],
      '/codex/': [
        {
          text: 'Codex 工具链',
          collapsed: false,
          items: [
            { text: '01 · Codex Skill 创建', link: '/codex/01-codex-skill-creation-via-plugin' },
            { text: '02 · Codex 插件完整开发与安装', link: '/codex/02-codex-personal-plugin-install-flow' }
          ]
        }
      ],
      '/docker/': [
        {
          text: 'Docker 容器化',
          collapsed: false,
          items: [
            { text: '01 · Docker vs Docker Compose', link: '/docker/01-docker-vs-compose' },
            { text: '02 · Dockerfile vs compose.yaml', link: '/docker/02-dockerfile-vs-compose-yaml' },
            { text: '03 · go-clean-arch 本地跑通实战', link: '/docker/03-go-clean-arch-local-run' }
          ]
        }
      ],
      '/tools/': [
        {
          text: '工具与排查',
          collapsed: false,
          items: [
            { text: '01 · Chrome 页面图标缺失', link: '/tools/01-chrome-icons-missing-system-proxy-dead' }
          ]
        }
      ]
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
