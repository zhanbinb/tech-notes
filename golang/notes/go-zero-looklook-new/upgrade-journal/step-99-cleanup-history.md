# 清理 git 历史：删除 92M 二进制

> 日期：2026-08-05  
> 目的：从 git 历史里彻底删掉误提交的 92M 二进制  
> 状态：✅ 完成，.git 从 89M → 48M（清理 41M）

## 背景

之前 commit `b160ce6` 误把 air build 出来的 `./tmp/usercenter-rpc`（92M 二进制）追踪到 git 里。虽然后续 `v3.3` 取消追踪，但 92M 还在 git 历史里没释放。

## 清理步骤

### 1. 用 `git filter-branch` 重写历史

```bash
git filter-branch -f --index-filter   'git rm --cached --ignore-unmatch tmp/usercenter-rpc 2>/dev/null'   --prune-empty --tag-name-filter cat -- --all
```

**关键点**：
- `--index-filter`：只改 index，不动 working tree
- `--prune-empty`：删掉变空 commit
- `--tag-name-filter cat`：tag 名称保留
- `-- --all`：所有 ref

**filter-branch 警告**：会重写所有 commit SHA
```
WARNING: git-filter-branch has a glut of gotchas generating mangled history
  rewrites. Hit Ctrl-C before proceeding to abort, then use an
  alternative filtering tool such as 'git filter-repo' instead.
```

### 2. 删 `refs/original/` 备份 ref

filter-branch 默认**保留 `refs/original/` 目录**作为原始 refs 的备份，**这个 ref 还指向 92M 历史**！

```bash
git update-ref -d refs/original/refs/remotes/origin/main
find .git/refs/original -type f -delete
```

**教训**：用 `git filter-branch` 后，**必须手动删 `refs/original/`**，否则清理不彻底。

### 3. 彻底回收空间

```bash
git reflog expire --expire=now --all
git reflog expire --expire-unreachable=now --all
git gc --prune=now --aggressive
```

**两个 expire 必须都跑**：
- `--expire=now`：清 reflog
- `--expire-unreachable=now`：清不可达 commit（filter-branch 改的旧 commit 变成 unreachable）

### 4. force push 到 origin

```bash
git push --force-with-lease origin main
```

**必须 force push**（commit SHA 都变了，普通 push 会被拒绝）。
用 `--force-with-lease` 比 `--force` 安全（如果别人有未推送的 commit 会拒绝）。

## 结果

| 指标 | 清理前 | 清理后 |
|---|---|---|
| `.git` 大小 | 89M | **48M** |
| `tmp/usercenter-rpc` 引用 | 存在 | ✅ 不存在 |
| `4cd49786` 对象（92M 二进制）| 存在 | ✅ 不存在 |
| ref 数量 | 2（含 `refs/original`）| 1（干净）|
| origin 远端 | 92M | ✅ 同步清理（force push）|

## 工具对比

| 工具 | 是否需要装 | 速度 | 推荐度 |
|---|---|---|---|
| `git filter-repo` | ❌ 要 pip3 install / brew install | 快 | ⭐⭐⭐⭐⭐（**首选**）|
| `git filter-branch` | ✅ git 自带 | 慢 | ⭐⭐⭐（本次用）|
| `bfg-repo-cleaner` | ❌ 要下载 jar | 最快 | ⭐⭐⭐⭐ |

**为什么没装 filter-repo**：沙箱网络受限装不了，pip/brew 都失败。filter-branch 是 fallback。

## 坑 12：filter-branch 不删 refs/original

- 我第一次跑完 filter-branch 后，看 .git 还在 97M（**反而变大**了！）
- 原因：filter-branch 把 `refs/original/` 留下当 backup
- 这 ref 还指向 92M 历史的旧 commit
- 教训：filter-branch 后**必须 `git update-ref -d refs/original/...`**

## 坑 13：filter-branch 不更新 packed-refs

- 第一次 `git for-each-ref` 还看到旧的 `ea69c559...`
- 这是 packed-refs 里的缓存
- 必须 `git update-ref -d` 强制删

## 教训

1. **大文件进 git 是灾难**——92M 一个文件 clone 整个 repo 的人都要重新下
2. **`.gitignore` 必须前置**——核心防御是 `.gitignore` 而不是事后清理
3. **`git filter-branch` 有 gotchas**——比 `filter-repo` 慢且易错
4. **`refs/original/` 是隐藏陷阱**——filter-branch 后必须手动删
5. **`git gc --prune=now --aggressive`** 不够，必须先 `reflog expire`
