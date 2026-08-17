# 后端架构摘要（给前端开发参考）

## 部署端口（来自 docker-compose.yml）

| 服务           | 监听端口 | 协议 | 前端 baseURL     |
| -------------- | -------- | ---- | ---------------- |
| usercenter-api | 1004     | REST | `/usercenter/v1` |
| travel-api     | 1003     | REST | `/travel/v1`     |
| order-api      | 1001     | REST | `/order/v1`      |
| payment-api    | 1002     | REST | `/payment/v1`    |
| usercenter-rpc | 9000     | gRPC | （前端不用）     |
| travel-rpc     | 9001     | gRPC | （前端不用）     |
| order-rpc      | 9002     | gRPC | （前端不用）     |
| payment-rpc    | 9003     | gRPC | （前端不用）     |

> ⚠️ 所有 REST 路由都用 **POST**（go-zero 默认习惯），这是 go-zero 项目的一个反 REST 默认，
> 前端 Axios 必须配套用 POST，不要被路径骗去用 GET。

## 网关方案（nginx）

默认走 nginx 反代，前端**不需要**直连 1004-1002。
nginx 的 upstream 按服务名（usercenter/travel/order/payment）转发。

开发期前端代理（vite.config）示例：

```ts
server: {
  proxy: {
    '/usercenter': 'http://localhost:1004',
    '/travel':     'http://localhost:1003',
    '/order':      'http://localhost:1001',
    '/payment':    'http://localhost:1002',
  }
}
```

## 数据持久层

- MySQL 8 — 订单、用户、民宿主数据
- Redis — session、计数器、热点缓存
- Kafka — 异步消息（订单创建 → 微信支付 / 短信等）
- Elasticsearch — **民宿搜索可能用 ES**（待阶段 1 复核）
