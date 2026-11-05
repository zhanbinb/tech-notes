# DSH 原生插件开发：Save to Tech Notes 从 Codex 迁移实战

> 把个人 Codex 插件 Save to Tech Notes 迁移为 DSH 原生 bundle 的完整过程，附当前版本 DSH 插件开发官方规范速查。
> 2026-11-05 实测，所有结论均对照 app.asar 内置官方文档与已安装包源码验证。

## 核心要点

- **DSH 插件 = bundle**：一个 `package.json` 带 `dsh.bundle.patch` 的包就是插件；纯配置型 bundle（configuration-only bundle）**不需要** `index.js`、构建工具和依赖——manifest 只要 `name`、`version`、`dsh.bundle.patch` 三项。
- **技能三件套**：`@deepseek-ai/dsh-skill`（注册表 `ctx.skills`）+ `@deepseek-ai/dsh-skill-filesystem`（本地目录 provider）+ `@deepseek-ai/dsh-tool-skill`（模型侧 `skill` 工具与用户 `/name` 调用）。三者由 base/ preset 行挂载，插件只需**追加自己的 provider 行**复用它们。
- **隔离 provider 写法**：`customSkillDirs: [<插件内 skills 绝对路径>]` + `includeDefaultRoots: false` + 独一无二的 `providerName`，即可"只扫插件自带技能"，不碰项目根与 `~/.dsh` 默认目录。
- **同名技能取胜规则**（源码 `compareIndexedCandidates`）：同 layer 内按 rank **升序优先、先见者胜**，落败者记 warn。rank：project 100 < project-agents 200 < runtime 250 < custom 300 < user-dsh 400 < user-agents 500 < bundled 600。→ 插件内技能（custom 300）天然盖过 `~/.dsh/skills` 散装副本（user-dsh 400）。
- **两条安装通道**：代理侧 `plugin_manager` 的 `install_bundle`（只有 Creator preset 启用）；用户侧 **Web 侧边栏 Plugins → Add plugin → 本地绝对路径 → Install → Enable now**。`standard` preset 中 `tool-plugin-manager` 被硬编码 `disabled: true`，不要假设会话里代理能装插件。
- **安装即持久化**：装完写入 profile 的 `package.json`（`dependencies` 用 `link:` + `dsh.profile.bundles` 追加）与 `pnpm-lock.yaml`，重启后继续生效；链接安装意味着**插件目录不能移动/删除**。

## 关键示例 / 命令

### bundle 目录结构（本次迁移产物）

```
save-to-tech-notes/
├── package.json          # @local/save-to-tech-notes，声明 dsh.bundle.patch、locale/icon 导出
├── cordis.patch.yml      # insert 一个隔离的 skill-filesystem provider 行
├── locale/{en,zh}.json   # 插件页 meta.title / meta.description
├── icon.svg              # 图标（≤256KiB，包内路径）
├── README.md
└── skills/save-to-tech-notes/
    ├── SKILL.md          # 与原版逐段一致，仅 publish.sh 路径改为插件内
    └── scripts/{publish.sh,next-number.sh}   # 与 Codex 原版字节级一致
```

### cordis.patch.yml（核心就这几行）

```yaml
- insert:
    - id: save-to-tech-notes-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: save-to-tech-notes
        includeDefaultRoots: false
        customSkillDirs:
          - /abs/path/to/save-to-tech-notes/skills
```

### 安装（Web GUI，30 秒）

Plugins → Add plugin → 粘贴 bundle 绝对路径 → Install → **Enable now**。
装完核对 profile：`~/.dsh/profiles/desktop/package.json` 应出现 `link:` 依赖与 `dsh.profile.bundles` 条目。

### 调用方式

- 自然语言：「把当前对话保存为笔记」
- 用户显式：`/save-to-tech-notes`
- 模型侧：会话技能目录出现 `save-to-tech-notes`，由 `skill` 工具加载

## 常见坑

- **preset 行是嵌套的**：preset 定义（如 `standard`）把工具行放在 `preset-standard` 的 `config.plugins` 里；`standard` 既无 `tool-plugin-manager` 也无 `tool-cordis`（`cordis` preset 才有）。会话工具集由 preset 决定，profile patch 不一定会覆盖到嵌套行。
- **`registerProvider` 不刷新注册表缓存**：目录缓存只在 provider 自身 `invalidate()`、运行时注册/销毁时失效（`invalidateCache` → revision+1）。HMR 新挂载的 provider 不会自动让已缓存的会话目录换源——看到旧 Base directory 先怀疑缓存陈旧，重启（或改一次技能文件触发 watcher）再验。
- **`next-number.sh` 原版固有 bug**：`set -o pipefail` 下目录为空或只有子目录时 `grep` 无匹配 exit 1，脚本提前退出（Codex 原版同样如此）。实际 SKILL.md 流程由模型手工数最大 `NN`，不调用该脚本，故无用户可见影响。
- **路径硬编码三处**：两个脚本的 `REPO=`、SKILL.md 第 6 行仓库路径、第 141 行 `publish.sh` 绝对路径；分支 `origin main` 也硬编码。迁移时保持原样即可，改位置需三处同步。
- **Codex 专属机制不要照搬**：`.codex-plugin/plugin.json`、marketplace.json、`+codex.<时间戳>` cachebuster、"改完必须重启 Codex 才生效"——这些在 DSH 全部不适用（DSH 对应物是 bundle patch + `install_bundle` + HMR）。
- **`dsh --profile desktop --dump-config` 不可用**：desktop profile 由 Electron 应用独占管理，CLI 报 `managed exclusively by the Electron application`；查 composed config 要改为读 asar 内的 shipped patch。

## 相关链接

- 官方开发技能（内置，非会话目录）：`dsh-agent-preset/skills/cordis-plugin-development/`（`SKILL.md` + `references/host-plugin.md` + `references/mcp-bundle.md` + `templates/*`）
- Patch 方言：`dsh-agent-preset/skills/cordis-composition-reference/SKILL.md`（insert / 按 id 覆盖（config 整体替换）/ group / disabled / isolate / `!!js`）
- 包文档：`@deepseek-ai/dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`、`dsh-plugin-manager` 各自 README（在安装包 `dsh/node_modules/@deepseek-ai/` 下）
- 本次插件源码：`~/Documents/Codex/2026-11-05/save-to-tech-notes/outputs/save-to-tech-notes/`
- Codex 原版流程：[01 · Codex Skill 创建：通过 Plugin 分发](../codex/notes/01-codex-skill-creation-via-plugin.md) / [02 · Codex 个人插件：完整开发与安装流程](../codex/notes/02-codex-personal-plugin-install-flow.md)

---
#DSH #插件开发 #Codex迁移 #Skill #Cordis
