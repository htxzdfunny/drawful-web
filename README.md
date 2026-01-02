# drawful-web

一个简单的实时多人你画我猜 Web 端：

- 前端：React + TypeScript + Vite + Tailwind
- 后端：Flask + Flask-SocketIO（实时通信）

支持房间制多人联机，画手绘画、其他玩家聊天/猜词、回合计时、计分、房主控制、回合中止投票，以及一个隐藏的后台用于管理房间。

## 功能概览

- **实时绘画同步**：Socket.IO 同步笔画/清屏
- **回合流程**：大厅 -> 选词 -> 进行中 -> 揭晓
- **服务端权威校验**：
  - 仅当前画手可发送绘画事件
  - 猜中加分去重（同一玩家同回合只计一次分）
  - 聊天/输入框禁止画手泄露答案；玩家包含答案会被当作“猜中”处理且不广播原文本
- **房间管理**：复制房间 ID / 复制邀请链接
- **新玩家引导**：通过链接进入房间时若未设置昵称/头像会提示设置（支持 QQ 号头像）
- **回合中止**：
  - 房主可直接终止回合
  - 玩家可投票终止（> 2/3 通过自动终止）
- **邪恶后台**：`/evil` 页面（需要 token）可查看房间并做覆盖操作

## 目录结构

- `frontend/`：前端（Vite）
- `backend/`：后端（Flask + Socket.IO）
- `deploy/`：Nginx 配置示例
- `DEPLOY_NGINX.md`：Nginx 反代部署说明

## 本地开发

### 1) 安装依赖

#### 后端

- 进入 `backend/` 安装 Python 依赖：

```bash
pip install -r backend/requirements.txt
```

#### 前端

```bash
pnpm --prefix frontend install
```


### 2) 启动开发环境

在仓库根目录：

- **普通模式**（前端仅本机访问）：

```bash
pnpm run dev
```

- **局域网模式**（前端对 LAN 暴露）：

```bash
pnpm run dev:lan
```

默认端口：

- 前端：`http://localhost:5173/`
- 后端：`http://localhost:5000/`
  - 健康检查：`/api/health`

## 环境变量（.env）

仓库根目录支持 `.env`（后端由 `python-dotenv` 加载；前端由 Vite 加载）。

建议创建根目录 `.env`：

```env
# 后端（Flask）
HOST=0.0.0.0
PORT=5000
FLASK_DEBUG=1
TRUST_PROXY_HEADERS=1

# 邪恶后台（后端校验用）
EVIL_TOKEN=your_secret_token

# 前端（Vite 环境变量必须以 VITE_ 开头）
VITE_EVIL_TOKEN=your_secret_token
```

说明：

- **后端读取**：`EVIL_TOKEN` 等由 `backend/app.py` 在启动时从根目录 `.env` 注入到 `os.environ`。
- **前端读取**：Vite 只会暴露 `VITE_` 前缀变量到浏览器（如 `import.meta.env.VITE_EVIL_TOKEN`）。

## 邪恶后台（/evil）

- 访问：`http://localhost:5173/evil`
- 后端必须设置 `EVIL_TOKEN`，前端页面会在请求时携带 `X-Evil-Token` 头。
- 推荐：在根目录 `.env` 同时设置 `EVIL_TOKEN` 与 `VITE_EVIL_TOKEN`，便于开发环境自动填充。

## 单独构建前端

在仓库根目录：

```bash
pnpm --prefix frontend run build
```

产物在：`frontend/dist/`。

## 完全构建打包生产环境

在仓库根目录：

```bash
pnpm release
```

产物在: `release/`

将 `release` 文件夹下的所有文件上传到服务器, 配合 `/DEPLOY_NGINX.MD`和`/deploy/nginx.drawful.conf` 食用即可