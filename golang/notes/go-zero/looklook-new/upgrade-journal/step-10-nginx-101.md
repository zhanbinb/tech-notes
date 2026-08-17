# Step 10: nginx 入门 — 从 hello world 到我们项目的 4-location 反代

> 日期：2026-08-07  
> 用途：把 nginx 基础概念 + 渐进式例子讲清, 给 ch 02 调研铺路  
> 配合 [step-09 ch 02 网关调研](step-09-gateway-survey.md) 食用  
> 全是 "在 macOS host 上跑 nginx" 视角

---

## 0. nginx 是个啥 (1 段话)

nginx 是一个 HTTP 服务器 + 反向代理 + 负载均衡器。
用 C 写, 单进程能扛 1 万并发连接。

学习 nginx 的关键是理解:
1. **配置文件怎么组织**
2. **请求怎么在里面路由**

---

## 1. 进程模型 (Master + Worker)

```
        nginx master process         ← 读 conf, 管 worker, 处理 reload 信号
        ├── worker #1 (主接收连接)    ← 处理 client 请求
        ├── worker #2                 ← 处理 client 请求
        └── worker #N                 ← 处理 client 请求
```

- **master**: 启动 + 配 worker, 不直接处理请求
- **worker**: 接收 client 连, 处理请求, 监听 80/443
- 启动方式: `nginx`  (后台), `nginx -s reload`  (热改 conf)

> **关键概念**: 改 conf 后**用 reload 不用 restart** - master 会优雅地重启 worker, 旧请求完成, 新请求走新 conf, **不丢请求**.

---

## 2. 配置文件层级结构 (4 层)

nginx conf 是树状结构, 像俄罗斯套娃:

```
main             ← 全局配置 (用户, 进程数, 日志路径等)
├── events       ← 网络 IO 模型 (worker_connections 等)
├── http         ← HTTP 层 (所有 server 共享)
│   ├── server  ← 一个虚拟主机
│   │   ├── location /       ← URL 路径规则
│   │   └── location /api
│   └── server  ← 第二个虚拟主机
└── mail          ← 邮件代理层 (我们不用)
```

**读 conf 的关键**: 你看到 `{` 就开始一层, 看到 `}` 就退出当前层. 只要一层一层看, nginx conf 其实很简单.

---

## 3. 第一个例子: hello world (静态文件)

### 3.1 准备

```bash
mkdir -p /tmp/nginx-101
cd /tmp/nginx-101

# 写个测试页面
mkdir -p html
cat > html/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head><title>nginx 101</title></head>
<body><h1>Hello nginx!</h1></body>
</html>
EOF
```

### 3.2 配置 `nginx.conf`

```nginx
# /tmp/nginx-101/nginx.conf
worker_processes 1;       # 启 1 个 worker (足够本机 demo)

events {
    worker_connections 1024;
}

http {
    # server = 一个虚拟主机 (一个 domain 或一个 port)
    server {
        listen 8089;       # 监听 8089 (避开 80/443 的 root 权限要求)
        # server_name localhost;  # 域名, demo 可省

        # 当请求 "/"  →  serve html/index.html
        location / {
            root /tmp/nginx-101/html;
            index index.html;
        }
    }
}
```

### 3.3 启动 + 测试

```bash
nginx -p /tmp/nginx-101 -c nginx.conf
# -p = prefix (nginx 工作目录)
# -c = conf 文件

# 浏览器或 curl 测试
curl http://127.0.0.1:8089/
# 预期: 输出 <!DOCTYPE html>... Hello nginx! 内容

# 看 access log
ls /tmp/nginx-101/logs/ 2>&1  # 没有的话 nginx 默认 /var/log/nginx
tail -f /tmp/nginx-101/logs/access.log  # 可能不存在
```

### 3.4 停止

```bash
nginx -p /tmp/nginx-101 -c nginx.conf -s stop
# -s stop = graceful shutdown (worker 完成当前请求再退)
```

---

## 4. 第二个例子: 多个 server (虚拟主机)

学习 nginx 时经常误解 - "虚拟主机 = 不同域名". 其实 nginx 的 server 块是按 `listen` 区分的, 同一个 nginx 上可以有多个 server, 监听不同端口或不同域名.

### 4.1 配置

```nginx
worker_processes 1;
events { worker_connections 1024; }

http {
    # 一个虚拟主机: 8089
    server {
        listen 8089;
        location / { return 200 "from server A\n"; }
    }

    # 另一个虚拟主机: 8090
    server {
        listen 8090;
        location / { return 200 "from server B\n"; }
    }
}
```

### 4.2 测试

```bash
curl http://127.0.0.1:8089/   # from server A
curl http://127.0.0.1:8090/   # from server B

# 也可以基于 server_name (域名)
server {
    listen 80;
    server_name api.example.com;
    location / { ... }
}
server {
    listen 80;
    server_name web.example.com;
    location / { ... }
}
# curl -H 'Host: api.example.com' http://...
```

> **点透**: 多个 `server` 块可以共存. 这个 nginx.conf 写法对应 "同 nginx 跑多个站点/服务".

---

## 5. 第三个例子: 反向代理 (重点!)

**反向代理** = nginx 接收 client 请求, 转给后端应用服务器, 把响应回给 client.

### 5.1 一个完整的反代 conf

```nginx
worker_processes 1;
events { worker_connections 1024; }

http {
    # 可以多个 server 共用, 加 upstream 块定义后端
    upstream my_backend {
        server 127.0.0.1:9001;  # 后端 #1
        # server 127.0.0.1:9002;  # 后端 #2 (加 load balancing)
    }

    server {
        listen 8089;

        # /api/* 转给 upstream
        location /api {
            proxy_pass http://my_backend;
            # 把 client 信息带过去 (默认 nginx 不会带)
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # 所有其他路径
        location / {
            root /tmp/nginx-101/html;
        }
    }
}
```

### 5.2 启动 1 个伪后端测试

```bash
# 起个 python http server on :9001, 当 mock 后端
cd /tmp/nginx-101 && python3 -m http.server 9001 &
# curl http://127.0.0.1:9001 → mock 后端响应

# 启 nginx
nginx -p /tmp/nginx-101 -c nginx.conf

# 现在 curl :8089/api 等同于 curl :9001
curl http://127.0.0.1:8089/api/
# nginx 接收 → 看 /api 匹配 → proxy_pass http://my_backend → 转到 :9001 → 拿响应 → 回给 client
```

### 5.3 关键指令解释

| 指令 | 作用 |
|------|------|
| `proxy_pass URL` | **核心**: 把请求转给 URL |
| `proxy_set_header Host $http_host` | 把 client 的 Host 头传给后端 |
| `proxy_set_header X-Real-IP $remote_addr` | 让后端知道 client 的真实 IP (不是 nginx) |
| `proxy_set_header X-Forwarded-For` | 多个 proxy 链时的 IP 累加 |

> 重要: `proxy_pass` 末尾是否带 `/` 决定路径是否被裁剪. 这是个常见坑, 见 §7.

---

## 6. 第四个例子: 我们项目的 4-location 反代 (终态)

直接看我们 `deploy/nginx/conf.d/looklook-gateway.conf` 完整结构:

```nginx
server {
    listen 8081;
    access_log /var/log/nginx/looklook.com_access.log;
    error_log  /var/log/nginx/looklook.com_error.log;

    # location 块: URL 路径正则匹配
    # ~ = 正则匹配

    # 路径 /order/*  →  转给 :1001 (order-api)
    location ~ /order/ {
        proxy_pass http://looklook:1001;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header REMOTE-HOST $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location ~ /payment/   { proxy_pass http://looklook:1002; ... }
    location ~ /travel/    { proxy_pass http://looklook:1003; ... }
    location ~ /usercenter/ { proxy_pass http://looklook:1004; ... }
}
```

**关键设计**:
- 4 个 location 用 `~` 开头 = 正则匹配
- 匹配 `/order/` 前缀的请求 → 转给 `:1001` (order-api)
- 4 个 location 之间互不影响 (一个请求只能匹配一个 location, 第一个匹配的赢)

> 这是个**简化版**的 "**path-based routing**". HTTP 请求的 path 决定了它去哪个服务.

---

## 7. 常见坑位 (踩坑预警)

### 7.1 proxy_pass 末尾 `/` 的细节

```nginx
location /api/ {
    proxy_pass http://backend;        # 没 /: 路径不裁剪
    proxy_pass http://backend/;       # 有 /: 路径裁剪到 /
}

# curl http://server/api/users
# proxy_pass http://backend;     → backend 收到 /api/users
# proxy_pass http://backend/;    → backend 收到 /users (裁剪 /api/)
```

**项目里的影响**:
```nginx
location ~ /order/ {
    proxy_pass http://looklook:1001;    # 没 /: 转过去还是 /order/...
}
# 请求: POST /order/v1/homestayOrder/create
# 后端收到的: POST /order/v1/homestayOrder/create   (路径保持)
```
但 go-zero 的路由匹配是从 path 第一个 `/` 算起, `/order/v1/...` 走 service order 的 v1 组, **没问题**.

### 7.2 listen 多个 server 顺序

```nginx
server { listen 80 default_server; }  # 默认 catch-all
server { listen 80; server_name api.example.com; }
```

**没有 `default_server` 的 server 是非默认, 多个 listen 80 会有冲突**.

### 7.3 location 优先级

nginx location 匹配的**完整优先级**:

1. `=` 完全匹配 (最高)
2. `^~` 前缀匹配 (无正则)
3. `~` 或 `~*` 正则匹配
4. 普通前缀匹配 (最低)

```nginx
location = /exact          # 优先级 1
location ^~ /prefix        # 优先级 2
location ~ \.(gif|jpg)$    # 优先级 3
location /api              # 优先级 4
```

> 项目里我们 `~ /order/` 是正则匹配(优先级 3). 如果加个 `/order` 普通前缀, `/order/v1/...` 优先走 `~`.

### 7.4 reload vs start 区别

```bash
nginx -p /tmp/nginx-101 -c nginx.conf -s reload  # 热改
nginx -p /tmp/nginx-101 -c nginx.conf -s stop    # 停服
nginx -p /tmp/nginx-101 -c nginx.conf            # 启动
# 重启 = stop + start = 停服
```

**生产用 reload 不重启**.

### 7.5 conf 语法错

nginx conf 错的话 `nginx -t -c <conf>` 测试 (test), 不直接 start 才能看到错.

```bash
nginx -p /tmp/nginx-101 -c nginx.conf -t
# nginx: configuration file ... test is successful
```

---

## 8. 实操: 跑上面 4 个例子 (按顺序)

### Example 1 (5 分钟)
```bash
# 准备
mkdir -p /tmp/nginx-101/html
echo '<h1>Hello nginx!</h1>' > /tmp/nginx-101/html/index.html

# 写 nginx.conf (用上面 §3.2 的 conf)
cat > /tmp/nginx-101/nginx.conf << 'EOF'
worker_processes 1;
events { worker_connections 1024; }
http {
    server {
        listen 8089;
        location / {
            root /tmp/nginx-101/html;
            index index.html;
        }
    }
}
EOF

# 启
nginx -p /tmp/nginx-101 -c nginx.conf

# 测
curl -i http://127.0.0.1:8089/
# 预期: 200 OK + HTML body

# 停
nginx -p /tmp/nginx-101 -c nginx.conf -s stop
```

### Example 2 (10 分钟)
上面 conf 加第二个 server 块 (port 8090), 重 reload, 测两个端口.

### Example 3 (10 分钟)
写 upstream + 反代, python3 -m http.server 9001 当 mock 后端, 验证 `:8089/api` 等同于 `:9001`.

### Example 4 (5 分钟)
直接用我们的 `deploy/nginx/conf.d/looklook-gateway.conf` (docker conf), 把 `looklook` 改成 `127.0.0.1` 跑(要注意: 这个 conf 设计给 docker 的, log path 是 `/var/log/nginx`, host 上跑需要改, 第 5 个例子我们会做). 

---

## 9. 总结: nginx 速查表

| 用途 | 关键指令 |
|------|---------|
| 静态文件 | `root /path` `index index.html` |
| 反代 | `proxy_pass http://backend:port` |
| 转发 client info | `proxy_set_header Host $http_host` |
| listen port | `listen 8089;` |
| 日志 | `access_log /path; error_log /path;` |
| 启 | `nginx -p <prefix> -c <conf>` |
| 停 | `nginx -p <prefix> -c <conf> -s stop` |
| 重载 | `nginx -p <prefix> -c <conf> -s reload` |
| 测试 conf | `nginx -p <prefix> -c <conf> -t` |

---

## 10. 下一步: 回到 step-09 Phase 1

理解上面内容后, 你应该能在 host 上跑 nginx host 模式 + 看到 nginx 真的转发到 :1001-:1004.

之后我会写 (Phase 1 实际产出):
- `deploy/nginx/conf.d/looklook-host.conf` (host 模式)
- `scripts/dev-nginx-up.sh` / `down.sh` / `reload.sh`
- 你跑后能 curl `localhost:8088/usercenter/v1/user/login` 验证

---

## 11. 推荐下一站 (教学资源)

| 资源 | 说明 |
|------|------|
| [nginx 官方文档](https://nginx.org/en/docs/) | 权威, 老外风格 |
| [跟我学 nginx 配置](https://www.nginx.org.cn/docs/) | 中文 community wiki |
| `man nginx` / `man nginx.conf` | 本地手册 (mac brew 装的) |

---

*创建于 2026-08-07, nginx 入门 4 例子*
