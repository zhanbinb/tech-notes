# ADR-0007 登录 / 房东 / 详情 4 处接口契约不一致

- 状态: 已接受
- 日期: 2026-08-14
- 阶段: 阶段 7 联调收尾

## 背景

M3 联调阶段 4 个用户立即可见的 bug：

| #   | 现象                                       | 复现                      |
| --- | ------------------------------------------ | ------------------------- |
| 1   | 登录成功后点 "订单"/"我的" 自动跳回登录页  | 任何用户登录后            |
| 2   | 登录后右上角仍显示 "登录/注册"，不显示昵称 | 同上                      |
| 3   | 房东头像点进去是另一个人                   | 点首页 / 房东列表任一头像 |
| 4   | 退出后再登录失败                           | 缓存 token 失效后         |

## 根因 (3 处接口契约不一致)

### Bug A: `LoginRespData` 字段名错了

FE 假设:

```ts
interface LoginRespData {
  token
  userId
  nickname
  avatar
}
```

真实后端 (`app/usercenter/cmd/api/internal/types`):

```go
type LoginResp struct {
  AccessToken  string `json:"accessToken"`
  AccessExpire int64  `json:"accessExpire"`
  RefreshAfter int64  `json:"refreshAfter"`
}
```

→ `auth.login()` 拿到 `data.token === undefined`，`this.token = undefined`，
`isLoggedIn = false` → 路由守卫把订单/我的踢回登录页 (Bug #1)
→ `auth.user` 也没填 → 右上角显示 "登录/注册" (Bug #2)

### Bug B: `UserDetailRespData` 字段名错了

FE 假设:

```ts
interface UserDetailRespData {
  id
  mobile
  nickname
  avatar
  info
}
```

真实后端:

```go
type UserInfoResp struct {
  UserInfo User `json:"userInfo"`
}
```

→ `profile` 页 `userDetail.info` 永远 undefined → 简介不显示
→ `auth.fetchUser()` 拿 `u.id` 也是 undefined

### Bug C: `HomestayBusinessBoss.userId` 总是 0

`goodBossLogic.go` 用 `copier.Copy(&typesHomestayBusiness, user)` 把 usercenter.User 拷贝过来。
User 字段：`Id, Mobile, Nickname, Sex, Avatar, Info`。
`HomestayBusinessBoss` 字段：`Id, UserId, Nickname, Avatar, Info, Rank`。

`UserId` 字段在新数据里是 0 (零值)。逻辑注释里 `// compute star todo` 旁边也是 `// compute userId todo` 没写。

→ FE 写 `:to="/landlord/${b.userId}"` → 全部跳到 `/landlord/0`
→ 详情页 `list.find(x => x.userId === userId)` → 0 用户匹配第一条 → 永远是乌力吉 (Bug #3)

## 决定

### 1. 修正类型 (`src/api/types/index.ts`)

```ts
// 登录
interface LoginRespData {
  accessToken: string
  accessExpire: number
  refreshAfter: number
}

// 注册
interface RegisterRespData {
  accessToken: string
  accessExpire: number
  refreshAfter: number
}

// 用户详情
interface UserDetailRespData {
  userInfo: {
    id: number
    mobile: string
    nickname: string
    sex: number
    avatar: string
    info: string
  }
}
```

### 2. auth store 登录后拉详情 (`src/stores/auth.ts`)

后端登录不返用户信息。前端 login 后必须主动调 `usercenterApi.detail()` 填 store：

```ts
async login(mobile, password) {
  const data = await usercenterApi.login({ mobile, password })
  this.token = data.accessToken
  try { await this.fetchUser() } catch { /* token 失效守卫会处理 */ }
}

async fetchUser() {
  const u = await usercenterApi.detail()
  const info = u.userInfo  // 注意 unwrap
  this.user = { id: info.id, mobile: info.mobile, nickname: info.nickname, avatar: info.avatar, info: info.info }
}
```

`persist.pick` 改为只持久化 `token` (user 信息会失效)。

### 3. 路由守卫后台补 user (`src/router/guards.ts`)

页面刷新场景: 持久化 token 还在，但 user 没拉。`beforeEach` 时若 `isLoggedIn && !user` 后台静默 fetchUser，不阻塞路由。

### 4. Boss 头像链接 / 详情匹配：`b.userId` → `b.id`

- `homepage/Index.vue` 和 `landlord/List.vue` 里的 `:to` 改用 `b.id`
- `landlord/Detail.vue` 里的 `list.find(x => x.id === userId)` 改用 `b.id` 匹配

`b.id` 才是真正的 user.id (因为 goodBoss 逻辑里 `Id` 字段填的是 user.Id)。

### 5. 登录页 err code 10001 → 100001

后端用 `xerr.SERVER_COMMON_ERROR = 100001` 错误码，不是 10001。前端误用 10001 永远匹配不到。

### 6. 名下房源查法 (MVP placeholder)

房东详情页要展示 "X 的民宿"。schema 没有 `homestay_business.user_id` 返回到 FE，
当前实现的 `find(b => (b.title + b.info).includes(boss.nickname))` 仅作 placeholder。
详见 ADR 后续补一条 `/user/{id}/businesses` 端点。

## 备选

- **A. 改后端把 user 嵌入 login 响应**: 涉及 usercenter proto + 4 个微服务，量大 → 否决
- **B. 改后端把 list 的 `list` 字段永不返回 null**: 已通过 ADR 0006 前端兜底
- **C. 改后端 `homestay_business` 列表加 `userId` 字段**: 有道理，但需要联调后端，单独排期

## 后果

- ✅ Bug #1 / #2 / #3 修复
- ✅ token 持久化 + user 持久化分离，避免 stale data
- ⚠️ 房东详情页"名下房源"是 placeholder (用 boss 昵称匹配 business 标题/简介)，
  误匹配概率低 (因为中文昵称独特)，但不是 100% 正确，下个阶段补 `/user/{id}/businesses` 端点
- ⚠️ `LocalStorage` 中 `looklook:auth` 旧格式 `{token, user: {...}}` 会被 Pinia 兜底读取 user 时失败 (userInfo 字段变了)，下次刷新页面 user 为 null，守卫会触发一次 detail → 用户体验无缝

## 验证

- `pnpm typecheck && pnpm lint && pnpm test` 全绿
- 浏览器 4 个场景回归
