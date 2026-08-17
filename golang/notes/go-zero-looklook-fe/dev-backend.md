# 后端联调指南（开发期切到真实后端）

> 默认前端走 **MSW mock**（`VITE_USE_MOCK=true`），所有数据来自 `src/mocks/`。
> 这份文档说明如何切到真实后端联调。

---

## 0. 前置：后端服务跑起来

```bash
cd ../go-zero-looklook-new
docker compose up -d    # 启动 MySQL / Redis / Kafka / ES / Jaeger / Grafana / Prometheus
                        # (如果是首次，会下载 11 个中间件容器，5-10 min)

# 等中间件全部 healthy 后，启动 4 个微服务 (另开 4 个终端)
cd ../go-zero-looklook-new/app/usercenter/cmd/api && go run usercenter.go -f etc/usercenter-api.yaml
cd ../go-zero-looklook-new/app/travel/cmd/api      && go run travel.go      -f etc/travel-api.yaml
cd ../go-zero-looklook-new/app/order/cmd/api      && go run order.go       -f etc/order-api.yaml
cd ../go-zero-looklook-new/app/payment/cmd/api    && go run payment.go     -f etc/payment-api.yaml
```

确认 4 个端口都监听：

```bash
lsof -iTCP:1004-1002 -sTCP:LISTEN
# 预期:
# usercenter-api :1004
# travel-api     :1003
# order-api      :1001
# payment-api    :1002
```

---

## 1. 前端开启"联调模式"

```bash
# 在前端项目根目录
cp .env.development.local.example .env.development.local

# 编辑 .env.development.local，把 USE_MOCK 关掉:
# VITE_USE_MOCK=false

# 重启 dev server (HMR 不会重新读 .env)
pnpm dev
```

vite.config.ts 已自动配好 4 个 baseURL 代理：

```ts
proxy: useMock
  ? undefined
  : {
      '/usercenter': 'http://localhost:1004',
      '/travel': 'http://localhost:1003',
      '/order': 'http://localhost:1001',
      '/payment': 'http://localhost:1002',
    }
```

---

## 2. 你应该看到

- 浏览器 DevTools → Console：**[req] GET /travel/v1/homestay/guessList** 这类调试日志逐条出现
- 浏览器 DevTools → Network：**所有请求都打 `localhost:5173`**（前端端口），vite proxy 转发到后端 1003
- 页面**和 mock 模式下长得几乎一致**，但数据是真后端给的
- 登录页：用后端实际账号（不是 mock 的 demo）—— 默认后端启动会注入几个用户，看后端 init SQL/Seeds

---

## 3. 联调常见问题

| 现象                                | 排查                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| 报 `Network Error` / `ECONNREFUSED` | 后端 1004-1002 没启动，或 proxy 配错                     |
| 报 `code: 100002 参数错误`          | 看 Network → Payload，确认请求 body 字段名跟后端一致     |
| 报 `code: 100003 登录已过期`        | token 不对或被清空；检查 `localStorage['looklook:auth']` |
| 报 `code: 100005 数据库繁忙`        | 中间件没启 / 网络抖动；查 docker compose ps              |
| 报 `code: 100001 服务器开小差`      | 后端 panic；查后端 terminal log                          |
| 列表为空但 mock 不空                | mock seed 数据跟后端 DB 数据不一样（后端只有示例数据）   |

---

## 4. 把后端数据塞进来做端到端

```bash
# 一键导入一些 homestay 数据进 MySQL
mysql -h127.0.0.1 -uroot -prootpasswd looklook < ../go-zero-looklook-new/deploy/sql/seed-homestay.sql

# 重启前端 dev，刷新页面，应该看到这些数据
```

---

## 5. 切回 mock

注释或删除 `.env.development.local` 里 `VITE_USE_MOCK=false` 这一行，重启 dev 即可。

或在 `.env.development` 里直接改 `VITE_USE_MOCK=true`（入 git 的默认）。

---

## 6. 后端响应格式备忘

```ts
// 成功
{ code: 200, msg: 'SUCCESS', data: { ... } }
//    ↑ xerr.OK = 200 (uint32)

// 业务错误
{ code: 100003, msg: 'token失效，请重新登陆', data: null }
// http status = 400 或 401
```

完整错误码见 `../go-zero-looklook-new/pkg/xerr/errCode.go`。前端 `src/api/client.ts` 已对齐映射。
