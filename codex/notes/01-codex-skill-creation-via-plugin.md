# Codex Skill 创建：通过 Plugin 分发

> 在 Codex 中创建自定义 skill 必须通过 plugin 体系，不能直接把 `SKILL.md` 放到某个目录就生效。2026-07-17 与 Codex 协作创建 `save-to-tech-notes` skill 时的踩坑记录。

## 核心要点

- **Skill 必须挂在 Plugin 下**：Codex 的 skill 发现机制只认 plugin 内的 `skills/<skill-name>/SKILL.md`
- **不能直接放 `~/.codex/skills/`**：放在这里 Codex 不会自动识别（除非同时配合正确的 marketplace）
- **官方脚手架用 `plugin-creator`**：脚本 `python3 ~/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py <name> --path <dir> --with-skills`
- **marketplace 是注册机制**：plugin 写好后，要让 Codex 看到必须通过 `codex plugin marketplace add` + `codex plugin add`
- **本地执行 ≠ 自动识别**：放对路径但没装 plugin，Codex 不会自动调用，需要手动执行 skill 工作流

## 关键示例 / 命令

### Plugin 标准结构

```
save-to-tech-notes/
├── .codex-plugin/
│   └── plugin.json          ← 必需，plugin manifest
└── skills/save-to-tech-notes/
    ├── SKILL.md             ← 必需，skill 入口
    └── scripts/
        ├── next-number.sh
        └── publish.sh
```

### 最小 plugin.json

```json
{
  "name": "save-to-tech-notes",
  "version": "1.0.0",
  "description": "把 Codex 对话总结成知识点并归档到 tech-notes 仓库",
  "skills": "./skills/",
  "interface": {
    "displayName": "Save to Tech Notes",
    "category": "Productivity"
  }
}
```

### 用官方脚手架生成

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py \
  save-to-tech-notes \
  --path ~/plugins \
  --with-skills --with-scripts \
  --category "Productivity"
```

### 安装到 Codex（可选）

```bash
codex plugin marketplace add /path/to/marketplace
codex plugin add save-to-tech-notes@<marketplace-name>
```

## 常见坑

- **踩坑 1**：把 `SKILL.md` 直接放到 `~/.codex/skills/<name>/` 以为就装好了 — 实际 Codex 不会自动识别，必须通过 plugin + marketplace
- **踩坑 2**：在 sandbox 里跑 `codex plugin marketplace add` 会失败 — 因为 Codex CLI 要写 `~/.codex/config.toml`，而 sandbox 通常对此目录只读
- **踩坑 3**：plugin.json 缺 `"skills": "./skills/"` 字段 — 脚手架会默认加上，手写时容易漏
- **踩坑 4**：marketplace.json 的 `"authentication"` 字段不是 `"NONE"` — 必须是 `"ON_INSTALL"` 或 `"ON_USE"`
- **踩坑 5**：plugin 名含大写或下划线 — Codex 规范要求 `lowercase-hyphen`，脚手架会自动 normalize

## 验证是否生效

- `codex plugin list` — 应该看到 `save-to-tech-notes@<marketplace>  installed, enabled`
- 在 Codex 里说"把对话归档"等触发词，看 Codex 是否按 SKILL.md 工作流执行
- 不生效时：检查 `~/.codex/config.toml` 里有没有 `[marketplaces.xxx]` 和 `[plugins."save-to-tech-notes@xxx"]` 两段

## 相关链接

- 源码：`/Users/yangpeipei/Documents/Codex/2026-07-16/ni/plugins/save-to-tech-notes/`
- Marketplace：`/Users/yangpeipei/Documents/Codex/2026-07-16/ni/marketplace/`
- 官方插件脚手架：`~/.codex/skills/.system/plugin-creator/`
- tech-notes 仓库：`/Users/yangpeipei/Documents/zbb/project/tech-notes/`

---
#Codex #Skill #Plugin #MCP #工作流
