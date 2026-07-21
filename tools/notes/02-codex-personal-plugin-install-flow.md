# Codex 个人插件：完整开发与安装流程

> 把"只存在于 cache 的个人 skill"恢复成"完整 source → marketplace → installed"的标准流程。
> 记录时间：2026-07-20，踩了一连串坑，按这个 SOP 下次照做即可。

## TL;DR

```bash
# 1. 用 plugin-creator 脚手架生成源（marketplace 自动注册）
python3 ~/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py <plugin-name> \
  --with-skills --with-marketplace --path ~/plugins

# 2. 从旧 cache 复制自定义内容（plugin.json + SKILL.md + scripts/）

# 3. bump version，让 Codex 知道要重装
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py ~/plugins/<plugin-name>

# 4. 显式装一次
codex plugin add <plugin-name>@personal

# 5. 清掉 config.toml 里残留的旧 marketplace 引用
```

## 完整流程（按顺序）

### Step 0：诊断现状

```bash
ls ~/.codex/plugins/cache/*/<plugin-name>/        # 看 cache 里有什么
codex plugin marketplace list                     # Codex 识别了哪些 marketplace
codex plugin list                                 # plugin 状态（在 marketplace / 已装 / 启用）
grep -A 2 "<plugin-name>" ~/.codex/config.toml    # 实际配置
```

如果只能看到 `~/.codex/plugins/cache/...`、而 `~/plugins/` 和 `~/.agents/plugins/marketplace.json` 都没有 → **source 丢了，要走下面的恢复流程**。

### Step 1：用 plugin-creator 重建源

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py <plugin-name> \
  --with-skills --with-marketplace --path ~/plugins
```

生成后：

```
~/plugins/<plugin-name>/
└── .codex-plugin/
    └── plugin.json       ← version 1.0.0，interface 是脚手架默认
~/.agents/plugins/
└── marketplace.json      ← 含 personal marketplace 入口
```

> `--with-skills` 只创建空 `skills/` 目录，不会生成 SKILL.md——内容要自己填（或从 cache 复制）。

### Step 2：把 cache 里的自定义内容覆盖回去

```bash
# plugin.json（带详细 interface 元数据，cache 里那份才是用户定制的）
cp ~/.codex/plugins/cache/<old>/<plugin-name>/<ver>/.codex-plugin/plugin.json \
   ~/plugins/<plugin-name>/.codex-plugin/plugin.json

# skill 文件
mkdir -p ~/plugins/<plugin-name>/skills/<plugin-name>/scripts
cp ~/.codex/plugins/cache/<old>/<plugin-name>/<ver>/skills/<plugin-name>/SKILL.md \
   ~/plugins/<plugin-name>/skills/<plugin-name>/SKILL.md
cp ~/.codex/plugins/cache/<old>/<plugin-name>/<ver>/skills/<plugin-name>/scripts/* \
   ~/plugins/<plugin-name>/skills/<plugin-name>/scripts/
chmod +x ~/plugins/<plugin-name>/skills/<plugin-name>/scripts/*.sh
```

> ⚠️ 这一步所有 cp/mkdir 都会被沙盒拦，需 escalate。

### Step 3：bump version 让 Codex 重装

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py ~/plugins/<plugin-name>
```

version 从 `1.0.0` → `1.0.0+codex.<UTC时间戳>`。Codex 看到 `+codex.<新时间戳>` 会判定"源比 cache 新"，触发重新加载。

### Step 4：显式安装一次

```bash
codex plugin add <plugin-name>@personal
```

成功输出：

```
Added plugin `<plugin-name>` from marketplace `personal`.
Installed plugin root: ~/.codex/plugins/cache/personal/<plugin-name>/<new-version>
```

> ⚠️ 写 cache 被沙盒拦，需 escalate。

### Step 5：清理 config.toml 残留

之前的 marketplace 名（比如 `ni-local`）可能还在 `~/.codex/config.toml` 里：

```toml
[plugins."<plugin-name>@ni-local"]    ← 旧条目，删
enabled = true

[plugins."<plugin-name>@personal"]    ← 新条目，留
enabled = true
```

清理：

```bash
rm -rf ~/.codex/plugins/cache/<old-marketplace>     # 旧 cache 目录
# 用 Python 删 config.toml 里的旧 [plugins."...@ni-local"] 段
```

## 关键踩坑

### 坑 1：`installation: AVAILABLE` ≠ "已安装"

```json
"policy": { "installation": "AVAILABLE" }
```

只是说"在 marketplace 里**可**装"。Codex 启动后看到 `not installed` 是正常状态——必须 `codex plugin add` 显式触发。

改成 `"installation": "INSTALLED_BY_DEFAULT"` 也**不会**自动装（当前 Codex 版本），只是 marketplace 列表里看着舒服点。

### 坑 2：`codex plugin marketplace add` 期望目录，不是文件

```bash
codex plugin marketplace add ~/.agents/plugins/marketplace.json
# Error: local marketplace source must be a directory, not a file
```

它要的是 marketplace **根目录**（包含 `.agents/plugins/marketplace.json` 的目录）。

不过脚手架默认路径会被 Codex 自动发现（推断 ROOT 为 `/Users/yangpeipei`），**通常不用 add**——直接 `codex plugin add PLUGIN@personal` 即可。

### 坑 3：cache 和 config.toml 不同步

老 cache 用 `@ni-local`，新装用 `@personal`，两条都写在 `config.toml` 里，Codex 不知道用哪个。手动清掉旧的。

### 坑 4：沙盒拦截

这些操作都被 sandbox 拦，必须 escalate：

- 写 `~/plugins/.../...`（plugin source）
- 写 `~/.codex/config.toml`（plugin config）
- 写 `~/.codex/plugins/cache/...`（`codex plugin add` 自动操作）
- 跑 `codex plugin add` / `codex plugin marketplace upgrade` 等 CLI

每次都得 `sandbox_permissions=require_escalated`。



### 坑 5：cachebuster 不会自动 reload

`update_plugin_cachebuster.py` 只 bump **source 端** plugin.json 的 version，但 **Codex UI 不会在当前会话内自动重读 cache**。

```bash
# 改 source
code ~/plugins/<name>/skills/<name>/SKILL.md

# bump source version
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py ~/plugins/<name>

# ❌ 这时 Codex UI 还显示旧内容（用的是会话开始时加载的 cache）
```

正确流程（必须 3 步）：

```bash
# 1. 改 source + cachebuster（同上）

# 2. 手动把 source 同步到 cache 的新 version 目录
NEW_VER=$(python3 -c "import json; print(json.load(open('$HOME/plugins/<name>/.codex-plugin/plugin.json'))['version'])")
cp -R ~/plugins/<name>/. ~/.codex/plugins/cache/<marketplace>/<name>/"$NEW_VER"/
rm -rf ~/.codex/plugins/cache/<marketplace>/<name>/<旧 version>

# 3. 重启 Codex（或者关掉插件面板再重开也行，但行为不确定）
```

不重启的话，UI 会一直显示旧内容。这跟"改完代码不用重启服务"的直觉完全不一样。

> 实际案例：2026-07-20 改完 `publish.sh` 加了 `git pull --rebase --autostash`，cachebuster 跑了、version 也 bump 了，但插件面板还显示旧的 `git add → commit → push`，最后才意识到必须重启 Codex。

## 完整更新 SOP（增量迭代场景）

适用于已经装好的本地插件，做小改动的完整流程：

```bash
# === 1. 改源文件 ===
code ~/plugins/<name>/skills/<name>/SKILL.md
# （或改 scripts/*.sh）

# === 2. cachebuster（让 source version 变更新）===
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py ~/plugins/<name>

# === 3. 手动同步 cache（关键！）===
SRC=~/plugins/<name>
CACHE_BASE=~/.codex/plugins/cache/<marketplace>/<name>
NEW_VER=$(python3 -c "import json; print(json.load(open('$SRC/.codex-plugin/plugin.json'))['version'])")
rm -rf "$CACHE_BASE"/*  # 清掉所有旧 version
cp -R "$SRC"/. "$CACHE_BASE/$NEW_VER"/

# === 4. 重启 Codex（让 UI 加载新 cache）===
# 完全退出再开；macOS 上 Cmd+Q → 重新打开
```

> 沙盒提示：第 2、3 步都需要 `sandbox_permissions=require_escalated`，因为 `~/plugins/...` 和 `~/.codex/plugins/cache/...` 都在沙盒外。

## 验证清单

## 验证清单

完成后跑一遍：

```bash
codex plugin list | grep <plugin-name>
# 期望：<plugin-name>@personal  installed, enabled  <new-version>

grep -A 2 "<plugin-name>" ~/.codex/config.toml
# 期望：只有 [@personal] 段，没有 [@ni-local] 等旧段

ls ~/.codex/plugins/cache/personal/<plugin-name>/
# 期望：只有 <new-version>/ 子目录，没有 <old-version>/ 残留
```

## 相关链接

- plugin-creator skill：`~/.codex/skills/.system/plugin-creator/SKILL.md`
- `cachebuster` 脚本：`~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py`
- 配套改动：save-to-tech-notes 的 `publish.sh` 也加了 "先 pull 再 commit"（避免 push non-fast-forward）

---
#Codex #插件开发 #marketplace #cachebuster #沙盒
