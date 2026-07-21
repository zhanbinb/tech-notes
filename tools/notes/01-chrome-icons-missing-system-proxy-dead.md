# Chrome 页面图标缺失：系统代理进程崩溃导致 TLS 失败

> 症状：Chrome 打开 Google Meet 等页面后图标变成方块 / 文字乱码（`vide通话`、`help` 互相重叠等），Firefox 打开同页面却完全正常。

## TL;DR

- **表现**：DevTools Network 里字体请求是 `(failed) net::ERR_FAILED` / `net::ERR_CONN...`，**不是** `blocked:cookie` / `blocked:extension`。
- **真相**：macOS 系统代理配置 (`127.0.0.1:7897`, ClashX) 还残留，但 ClashX 进程已退出 → 所有走代理的连接被内核 RST。
- **为什么 Firefox 没事**：Firefox 在 macOS 上不一定继承系统代理，或者代理规则里对它有特殊处理。
- **修法**：重启 ClashX 即可。

## 关键诊断流程

按顺序执行，每步 10 秒内能定位到下一层：

### 1. 看字体请求的失败类型（区分"应用层拦截" vs "网络层失败"）

Chrome DevTools → Network → 过滤 `font` → 刷新：

| Status | 含义 | 方向 |
|---|---|---|
| `(blocked:cookie)` / `(blocked:third-party)` | 第三方 Cookie 策略拦截 | 浏览器设置 |
| `(blocked:extension)` | 扩展拦截 | 扩展/uBO 等 |
| `(failed) net::ERR_FAILED` | 底层网络/SSL 失败 | **往下走 2** |
| `(failed) net::ERR_NAME_NOT_RESOLVED` | DNS 问题 | 改 DNS |

本笔记对应第三种。

### 2. 用 curl 验证是「网络不通」还是「TLS 握手失败」

```bash
curl -I https://fonts.gstatic.com/
```

- `HTTP/2 200` → 网络完全 OK，是 Chrome 内部问题
- `SSL_ERROR_SYSCALL`（LibreSSL 报错）→ **TCP 通了但 TLS 握手被 RST**，是中间设备拦的，继续往下
- 超时 / `Couldn't connect` → 真网络层问题，查代理/VPN/防火墙

### 3. 排除 MDM

```bash
profiles list -verbose
```

无输出 = 没有企业管控描述文件，可排除。

### 4. 关键：看系统代理配置

```bash
scutil --proxy
```

关注 `HTTPSProxy` / `HTTPSPort`。如果是非空值（比如 `127.0.0.1:7897`），但同时：

```bash
lsof -iTCP:7897 -sTCP:LISTEN
```

无输出 → **代理进程没在监听，但系统代理配置还在** = 元凶。

### 5. 验证代理进程状态

```bash
ps aux | grep -iE "(clash|surge|quantumult|shadowrocket)" | grep -v grep
```

无输出 = 代理工具彻底没启动；有输出但 `lsof` 听不到 = 代理进程卡死/子进程崩了，需要完全退出重启。

## 关键命令速查

```bash
# 排查 30 秒速查链
curl -I https://fonts.gstatic.com/                                    # 看 TLS 错
lsof -iTCP:7897 -sTCP:LISTEN                                          # 代理是否在监听
ps aux | grep -iE "clash" | grep -v grep                              # 代理进程
scutil --proxy                                                        # 系统代理配置
networksetup -setsecurewebproxystate Wi-Fi off                        # 临时关代理
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --ignore-certificate-errors --user-data-dir=/tmp/chrome-test        # 绕过证书验证（验证用）
```

临时关闭系统代理（紧急看页面用）：

```bash
networksetup -setwebproxystate Wi-Fi off
networksetup -setsecurewebproxystate Wi-Fi off
networksetup -setsocksfirewallproxystate Wi-Fi off
```

恢复（把 `7897` 换成你实际的代理端口）：

```bash
networksetup -setwebproxy Wi-Fi 127.0.0.1 7897
networksetup -setsecurewebproxy Wi-Fi 127.0.0.1 7897
networksetup -setsocksfirewallproxy Wi-Fi 127.0.0.1 7897
```

## 常见坑

- ❌ **看到 `ERR_FAILED` 直接去查 Cookie 设置** → 浪费时间，那只会显示 `blocked:cookie`。
- ❌ **重启 Chrome / 清缓存** → 没用，根因是系统级代理配置，不是 Chrome 状态。
- ❌ **关 Wi-Fi 重连** → 没用，代理配置是 macOS 层面的，不会因为换网就重置。
- ❌ **只信 `scutil --proxy` 不信 `lsof`** → `scutil` 只反映「期望配置」，「实际在不在跑」必须 `lsof` 确认。两者不一致 = 元凶。
- ⚠️ **ClashX 退出了但菜单栏图标看着还在** → 有时候是僵尸状态，右键 → Quit ClashX 彻底退再重开。
- ⚠️ **代理工具开着但 7897 端口被其他进程占用了** → `lsof` 看到的是别的东西。这种情况少见但遇到过，杀掉占用进程或换个端口。

## 根本原因解释

`scutil --proxy` 把 `127.0.0.1:7897` 写进了 macOS 的网络偏好设置，**所有走 macOS 网络栈的进程都会自动用这个代理**。这跟「手动在 Chrome 里配代理」是不同层——Chrome 配的是应用层，scutil 是系统层，更底层、覆盖面更广。

当 ClashX 退出后：

```
系统代理配置: 127.0.0.1:7897  ← 还在
实际监听:    （无）          ← 没了
Chrome 发出的 TCP → 内核: 转发到 127.0.0.1:7897 → 端口没人接 → RST
```

而 Firefox 因为以下任一原因躲过：

1. Firefox 自带代理设置（`network.proxy.type`）覆盖了系统代理
2. Firefox 在某些版本下不读 macOS 的 system proxy
3. 用户给 Firefox 配过 `no_proxies_on` 例外

## 长期建议

- ClashX 设置里开「**开机自启**」
- 不要手动 `kill ClashX`，要走菜单栏 "Quit ClashX"（会顺带清理系统代理配置）
- 如果用 TUN 模式代替系统代理，能避免这类「代理配置残留但进程不在」的问题
- 写个 `~/bin/proxy-check.sh`，登录时跑一次，`lsof -iTCP:7897` 失败就提醒重启

```bash
#!/bin/zsh
# proxy-check.sh
lsof -iTCP:7897 -sTCP:LISTEN > /dev/null || \
  osascript -e 'display notification "ClashX 没在监听 7897，请检查" with title "Proxy Check"'
```

## 相关链接

- [Chrome DevTools Network 参考](https://developer.chrome.com/docs/devtools/network/)
- [macOS networksetup 手册](https://ss64.com/mac/networksetup.html)
- [scutil 手册](https://ss64.com/mac/scutil.html)
- [ClashX 官方仓库](https://github.com/yichengchen/clashX)

---
#chrome #macos #troubleshooting #network #clashx #tls #system-proxy
