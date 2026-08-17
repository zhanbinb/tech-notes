# Step 2.5: air 单文件统一管理 (modd.conf 风格)

> 日期：2026-08-05  
> 目的：把 air 配置从"per-service 多文件"改成"单文件 + 脚本"管理  
> 状态：⏸️ 设计中, 待实施

## 背景

当前状态:
- air.usercenter.toml (1 个, 只管 usercenter)
- 其他 4 个服务 (travel/payment/order/mqueue) 用 nohup 启动, 没有 air

问题:
- 多个 air 配置文件 (将来会有 air.usercenter.toml, air.travel.toml, ...)
- 启动/停止服务要敲多行命令
- 不像原 modd.conf 那样"一文件管所有"

## 目标

像 modd.conf 一样:
- **1 个 air 配置文件** (`.air.toml` 或 `air.toml`)
- **1 个启动命令** (`air`)
- **管理 5 个服务** (usercenter + travel + payment + order + mqueue)

## 设计方案

### 文件结构

```
go-zero-looklook-new/
├── .air.toml                  # 单 air 配置 (类似 modd.conf)
├── scripts/
│   ├── dev-up.sh             # 启动 9 个 binary (5 个服务 × rpc + api + mq)
│   ├── dev-down.sh           # 停所有服务
│   └── dev-status.sh         # 看服务状态
└── (旧 air.usercenter.toml 删除, 整合到 .air.toml)
```

### .air.toml (单文件)

```toml
root = "."
tmp_dir = "tmp"

[build]
  # 监控所有 .go 和 .yaml, 改任何文件都触发 build
  pre = []
  cmd = "./scripts/dev-build.sh"            # build 9 个 binary
  full_bin = "./scripts/dev-up.sh"          # 启 9 个 binary
  delay = 1000
  stop_on_error = true
  include_ext = ["go", "yaml", "yml"]
  exclude_dir = [
    "data", "tmp", "vendor", "deploy",
    "node_modules", ".git", "notes", "scripts",
  ]
  log = "build-errors.log"

[log]
  time = true
  color = true

[misc]
  clean_on_exit = true
```

### scripts/dev-build.sh (build 9 个 binary)

```bash
#!/bin/bash
set -e

build() {
  local name=$1
  local pkg=$2
  echo "[dev-build] building $name..."
  go build -o ./tmp/$name ./$pkg
}

build usercenter-rpc   app/usercenter/cmd/rpc
build usercenter-api   app/usercenter/cmd/api
build travel-rpc       app/travel/cmd/rpc
build travel-api       app/travel/cmd/api
build payment-rpc      app/payment/cmd/rpc
build payment-api      app/payment/cmd/api
build order-rpc        app/order/cmd/rpc
build order-api        app/order/cmd/api
build order-mq         app/order/cmd/mq
build mqueue-scheduler app/mqueue/cmd/scheduler
build mqueue-job       app/mqueue/cmd/job

echo "[dev-build] done"
```

### scripts/dev-up.sh (启 9 个 binary)

```bash
#!/bin/bash
set -e

cleanup() {
  for pid in $ALL_PIDS; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null
  done
}
trap cleanup EXIT INT TERM

mkdir -p tmp/logs
ALL_PIDS=""

start() {
  local name=$1
  local bin=$2
  local cfg=$3
  ./tmp/$bin -f $cfg > tmp/logs/$name.log 2>&1 &
  local pid=$!
  ALL_PIDS="$ALL_PIDS $pid"
  echo "[dev-up] $name PID: $pid"
}

start usercenter-rpc   usercenter-rpc   app/usercenter/cmd/rpc/etc/usercenter.yaml
start usercenter-api   usercenter-api   app/usercenter/cmd/api/etc/usercenter.yaml
start travel-rpc       travel-rpc       app/travel/cmd/rpc/etc/travel.yaml
start travel-api       travel-api       app/travel/cmd/api/etc/travel.yaml
start payment-rpc      payment-rpc      app/payment/cmd/rpc/etc/payment.yaml
start payment-api      payment-api      app/payment/cmd/api/etc/payment.yaml
start order-rpc        order-rpc        app/order/cmd/rpc/etc/order.yaml
start order-api        order-api        app/order/cmd/api/etc/order.yaml
start order-mq         order-mq         app/order/cmd/mq/etc/order.yaml
start mqueue-scheduler mqueue-scheduler app/mqueue/cmd/scheduler/etc/mqueue.yaml
start mqueue-job       mqueue-job       app/mqueue/cmd/job/etc/mqueue.yaml

# 等任一进程死
total=$(echo $ALL_PIDS | wc -w | tr -d ' ')
while true; do
  alive=0
  for pid in $ALL_PIDS; do
    kill -0 "$pid" 2>/dev/null && alive=$((alive+1))
  done
  [ $alive -lt $total ] && break
  sleep 1
done
```

### scripts/dev-down.sh (停所有)

```bash
#!/bin/bash
pkill -f "./tmp/usercenter" 2>/dev/null
pkill -f "./tmp/travel" 2>/dev/null
pkill -f "./tmp/payment" 2>/dev/null
pkill -f "./tmp/order" 2>/dev/null
pkill -f "./tmp/mqueue" 2>/dev/null
echo "[dev-down] all stopped"
```

### scripts/dev-status.sh (看状态)

```bash
#!/bin/bash
echo "=== 9 个服务 LISTEN 状态 ==="
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E "1001|1002|1003|1004|2001|2002|2003|2004" | awk '{print $1, $9, $10}' | sort
```

## 跟 modd.conf 对比

| 维度 | modd.conf | 我们的 .air.toml |
|---|---|---|
| 文件数 | 1 个 .conf | 1 个 .toml + 3 个 .sh (build/up/down) |
| 监控范围 | 11 个 block, 每个 block 管一个服务 | 1 个 block, 管所有服务 |
| 改代码触发 | 只 build + 重启对应服务 | build + 重启所有 9 个 binary |
| 启动方式 | `modd` | `air` |
| 启动一个服务 | 自动 | 自动 (所有 9 个) |
| 单独停一个 | 杀对应进程 | `pkill -f travel` |

## 关键差异: "单服务 vs 全服务 rebuild"

**modd 优势**:
- 改 `app/usercenter/cmd/rpc/internal/logic/loginLogic.go` → 只重启 usercenter
- 改 `app/travel/...` → 只重启 travel
- 节省时间 (5 个服务不同时重启)

**我们的方案**:
- 改任何 .go 文件 → air 触发 build
- build-all.sh 把 9 个 binary 都重 build (可能 30-60 秒)
- 全部重启 (短时间服务不可用)

**取舍**:
- ✅ 简单 (1 文件, 1 命令)
- ❌ 慢 (改一个文件要等 30-60 秒)
- 适合: 项目整体改动 / 不频繁改代码
- 不适合: 频繁改某一个服务

## 未来优化 (可选)

如果将来需要 "per-service rebuild", 有两个方向:
1. **5 个 air 并发跑** (hacky):
   ```bash
   air -c .air/usercenter.toml & air -c .air/travel.toml & ...
   ```
2. **自定义 shell 脚本做 modd**:
   - 监控文件变化
   - 判断哪个服务
   - 只 build + 重启那个服务
   - 比 modd 复杂

**当前不做**, 等真的觉得慢了再优化.

## 实施步骤

1. ⏸️ 写 scripts/dev-build.sh, dev-up.sh, dev-down.sh, dev-status.sh
2. ⏸️ 写 .air.toml (合并 usercenter 配置)
3. ⏸️ 删 air.usercenter.toml (整合)
4. ⏸️ 测试: `air` 一键启 9 个服务
5. ⏸️ 改文件 → 自动 build + 重启
6. ⏸️ 笔记 step-2.5 升级完成版
