# Nginx 公网反代部署（/ 前端、/api + /socket.io 后端）

## 1. 目标

- **用户访问 `/`**：看到前端页面（静态文件）
- **用户访问 `/api/*`**：转发到后端 Flask
- **浏览器连接 `/socket.io/*`**：转发到后端 Flask-SocketIO（WebSocket/长轮询）

## 2. 构建

在仓库根目录：

```bash
npm i
npm release
```

构建产物在：`/release`

## 3. 启动后端

### 3.1 最简单（测试用）

- `python -m backend.app`

### 3.2 生产建议（Linux）

Socket.IO + eventlet：

- `pip install -r backend/requirements.txt`
- `gunicorn -k eventlet -w 1 -b 127.0.0.1:5000 backend.wsgi:app`

说明：
- `-w 1` 是常见起步方式（Socket.IO 需要 sticky session/共享状态时更敏感；后续引入 Redis 后再扩展）

## 4. Nginx 配置

仓库内已提供示例：`deploy/nginx.drawful.conf`

关键点：
- `location /`：`try_files ... /index.html` 支持前端路由
- `location /api/`：反代后端
- `location /socket.io/`：开启 `Upgrade` 头，支持 WebSocket

## 5. Cloudflare / 反向代理真实 IP

后端已启用 `ProxyFix`（由环境变量 `TRUST_PROXY_HEADERS=1` 控制），并且代码里也支持读取：
- `CF-Connecting-IP`
- `X-Real-IP`
- `X-Forwarded-For`


**仅在 明确经过你信任的反代（Nginx/CF）时开启** `TRUST_PROXY_HEADERS=1`


