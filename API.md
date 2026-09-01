# Node.js Docker 版开发与接口文档

当前版本：`1.2.0`

## 1. 技术架构

- Node.js 22 原生 `http` 服务
- Docker Compose 部署
- `playwright-core` 调用 Alpine Chromium
- Node.js 原生 `fetch` 请求店铺上游
- 静态前端位于 `public/`
- 服务端逻辑位于 `src/`

核心数据流：

```text
浏览器 → Node.js API → 店铺上游 API
                    → Chromium 支付页面
```

浏览器不会直接请求店铺上游。后端将上游响应转换为字段白名单 DTO，并使用随机不透明 ID 托管支付、验证码和订单查询会话。前端的本地手机号只是订单搜索条件，不是服务端授权凭证；历史订单必须通过验证码生成的查询授权访问。

## 2. 目录和模块

| 路径 | 作用 |
|---|---|
| `src/server.js` | HTTP 服务、静态文件、JSON 请求和统一错误处理 |
| `src/config.js` | 环境变量及店铺链接解析 |
| `src/api.js` | API action、DTO、服务端临时会话 |
| `src/upstream.js` | 上游请求、Cookie、缓存和支付地址安全校验 |
| `src/payment-browser.js` | Chromium 跳转跟踪及二维码截图 |
| `public/index.html` | 页面结构和弹窗 |
| `public/assets/js/app.js` | 页面状态、API 调用、支付轮询和订单展示 |
| `public/assets/css/style.css` | 页面样式 |
| `test/server.test.js` | Node.js 自动测试 |

## 3. 环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `SHOP_URL` | 无 | 必填，`http(s)://域名/shop/店铺标识` |
| `PORT` | `3000` | Node.js 监听端口；Compose 容器内固定为 3000 |
| `VERIFY_SSL` | `true` | 是否验证上游 HTTPS 证书 |
| `CACHE_TTL` | `60` | 店铺基础数据缓存秒数 |
| `CONNECT_TIMEOUT` | `10000` | 上游连接超时毫秒数 |
| `REQUEST_TIMEOUT` | `25000` | 上游及浏览器请求超时毫秒数 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | `/usr/bin/chromium` | Chromium 可执行文件 |

容器使用只读根文件系统，`HOME`、Chromium 配置和缓存应位于 `/tmp`。Compose 为 `/tmp` 和 `/dev/shm` 分别提供 256MB 空间。

## 4. 通用接口约定

接口支持两种兼容路径：

```text
/api/{action}
/api/index.php?action={action}
```

除验证码图片外，响应均为 JSON：

```json
{
  "code": 1,
  "msg": "success",
  "data": {}
}
```

- GET 参数通过查询字符串传递。
- POST 使用 `Content-Type: application/json`。
- 请求体上限为 1MB。
- 上游响应不会整体透传，所有公开接口使用字段白名单。
- 4xx 可返回具体输入错误；5xx 对前端统一显示“服务暂时不可用，请稍后重试”，详细错误仅写入容器日志。

## 5. 接口总览

| action | 方法 | 用途 |
|---|---|---|
| `health` | GET | 健康检查 |
| `shop` | GET | 店铺名称、公告和客服信息 |
| `categories` | GET | 商品分类 |
| `goods` | POST | 商品列表和搜索 |
| `channels` | POST | 支付渠道 |
| `price` | POST | 计算商品价格 |
| `contact-check` | POST | 校验手机号 |
| `order` | POST | 创建订单和支付会话 |
| `payment-page` | POST | 后端获取最终支付二维码 |
| `query` | POST | 查询支付状态 |
| `captcha-start` | POST | 创建验证码会话 |
| `captcha-image` | GET | 服务端代理验证码图片 |
| `captcha-check` | POST | 校验验证码并创建查询授权 |
| `orders` | POST | 查询订单列表 |
| `order-info` | POST | 查询订单详情及卡密 |

## 6. 公开数据接口

### 6.1 健康检查

```http
GET /api/health
```

```json
{
  "code": 1,
  "msg": "success",
  "data": { "ok": true }
}
```

响应不包含店铺 URL、Node.js 版本或服务器环境。

### 6.2 店铺信息

```http
GET /api/shop
```

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "name": "店铺名称",
    "notice": "店铺公告",
    "contact_qq": "QQ号",
    "contact_mobile": "手机号或微信号",
    "contact_wechat": "https://客服链接"
  }
}
```

`contact_wechat` 仅接受 HTTP/HTTPS URL。

### 6.3 分类

```http
GET /api/categories
```

分类 DTO：

```json
{
  "id": 1,
  "name": "分类名称",
  "goods_count": 10
}
```

### 6.4 商品

```http
POST /api/goods
Content-Type: application/json

{
  "category_id": -1,
  "keywords": "搜索词"
}
```

商品 DTO：

```json
{
  "goods_key": "商品标识",
  "name": "商品名称",
  "price": 1.5,
  "description": "商品说明",
  "image": "图片地址"
}
```

### 6.5 支付渠道

```http
POST /api/channels
Content-Type: application/json

{
  "goods_key": "商品标识"
}
```

渠道 DTO：

```json
{
  "id": 1,
  "name": "支付宝"
}
```

### 6.6 价格

```http
POST /api/price
Content-Type: application/json

{
  "goods_key": "商品标识",
  "channel_id": 1,
  "quantity": 1
}
```

```json
{
  "code": 1,
  "msg": "success",
  "data": { "amount": 1.5 }
}
```

数量限制为 `1-100`。

### 6.7 联系方式校验

```http
POST /api/contact-check
Content-Type: application/json

{
  "contact": "手机号"
}
```

```json
{
  "code": 1,
  "msg": "success",
  "data": { "valid": true }
}
```

接口不回显手机号。

## 7. 支付接口

### 7.1 创建订单

```http
POST /api/order
Content-Type: application/json

{
  "goods_key": "商品标识",
  "channel_id": 1,
  "quantity": 1,
  "contact": "手机号"
}
```

成功响应：

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "order_no": "TR...",
    "payment_id": "随机不透明ID",
    "payment_pending": true
  }
}
```

初始支付 URL 和上游 `PHPSESSID` 保存在服务端 `paymentSessions`，有效期 24 小时，不返回浏览器。

### 7.2 获取支付二维码

```http
POST /api/payment-page
Content-Type: application/json

{
  "payment_id": "随机不透明ID"
}
```

成功响应：

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "qr_code": "data:image/png;base64,..."
  }
}
```

后端处理流程：

1. 读取支付会话和初始支付 URL。
2. 创建隔离 Chromium context 并注入上游会话 Cookie。
3. 从页面导航开始每 250ms 检测二维码。
4. 支持普通图片、Base64 图片、Canvas、SVG、CSS 背景图及 Frame。
5. 带 `qr`、`code`、`支付`、`alipay`、`wechat` 等特征的方形元素优先。
6. 普通方形图片仅在页面 URL 稳定 750ms 后采用，避免误截 Logo。
7. 最长检测约 12 秒，发现二维码后立即返回。
8. Chromium 进程复用，每笔订单使用独立 context，完成后关闭 context。

字体和音视频资源会被阻止，以缩短加载时间。每次主框架导航均通过支付 URL 安全检查。

### 7.3 查询支付状态

```http
POST /api/query
Content-Type: application/json

{
  "trade_no": "TR...",
  "payment_id": "随机不透明ID"
}
```

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "paid": true,
    "status": 1
  }
}
```

订单号必须与 `payment_id` 对应。前端打开支付弹窗后立即查询，未支付时每 3 秒继续查询；成功后停止轮询并打开订单详情。

## 8. 验证码和历史订单

### 8.1 创建验证码会话

```http
POST /api/captcha-start
```

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "captcha_id": "随机不透明ID"
  }
}
```

验证码上游会话、图片 URL、校验 URL 和 IP 均保存在服务端，有效期 10 分钟。

### 8.2 获取验证码图片

```http
GET /api/captcha-image?captcha_id={随机不透明ID}
```

接口返回图片二进制。后端使用服务端保存的 URL 和 Cookie 请求上游，浏览器不会获得上游验证码地址或会话。

### 8.3 校验验证码

```http
POST /api/captcha-check
Content-Type: application/json

{
  "code": "验证码",
  "captcha_id": "随机不透明ID"
}
```

成功响应：

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "authorization_id": "随机不透明ID"
  }
}
```

验证码成功后删除 `captcha_id`，服务端保存上游会话和 ticket，并生成有效期 10 分钟的 `authorization_id`。

### 8.4 查询订单列表

```http
POST /api/orders
Content-Type: application/json

{
  "keywords": "手机号或订单号",
  "authorization_id": "随机不透明ID"
}
```

订单概要 DTO：

```json
{
  "trade_no": "TR...",
  "goods_name": "商品名称",
  "create_time": "创建时间",
  "amount": 1.5,
  "status": 1,
  "status_text": "已付款",
  "paid": true,
  "has_cards": true
}
```

订单列表不返回卡密内容。

### 8.5 查询订单详情

新创建订单使用支付授权：

```http
POST /api/order-info
Content-Type: application/json

{
  "trade_no": "TR...",
  "query_password": "",
  "payment_id": "随机不透明ID"
}
```

历史订单使用验证码授权：

```json
{
  "trade_no": "TR...",
  "query_password": "",
  "authorization_id": "随机不透明ID"
}
```

后端请求上游时增加 `dump: 1` 获取已发放卡密。响应只返回规范化字段：

```json
{
  "code": 1,
  "msg": "success",
  "data": {
    "trade_no": "TR...",
    "goods_name": "商品名称",
    "create_time": "创建时间",
    "amount": 1.5,
    "status": 1,
    "status_text": "已付款",
    "paid": true,
    "has_cards": true,
    "cards": ["卡密内容"],
    "instructions": "订单或商品使用说明"
  }
}
```

卡密解析兼容字符串、数组、JSON 字符串、账号/密码对象以及常见卡密字段。`instructions` 从订单或商品的常见说明字段中提取，前端会去除 HTML 标签后在订单详情底部显示；字段为空时显示“暂无使用说明”。前端在已付款但卡密为空时每 3 秒自动刷新，最多 40 次。

## 9. 服务端会话

| Map | 前端 ID | 保存内容 | 有效期 |
|---|---|---|---|
| `paymentSessions` | `payment_id` | 订单号、上游 Cookie、初始支付 URL | 24 小时 |
| `captchaSessions` | `captcha_id` | 上游 Cookie、验证码 URL、IP | 10 分钟 |
| `orderAuthorizations` | `authorization_id` | 上游 Cookie、验证码 ticket | 10 分钟 |

ID 使用：

```js
crypto.randomBytes(24).toString('base64url')
```

当前 Map 保存在单个 Node.js 进程内存中。容器重启、服务升级或多实例无共享存储时，已有临时 ID 会失效。当前 Compose 仅运行一个实例。

前端对会话失效的处理：

- 支付进行中继续使用 `payment_id` 获取二维码和轮询支付状态。
- `payment_id` 失效时清除浏览器保存的旧 ID，并切换到当前手机号的验证码查询流程。
- “我的订单”列表中的历史订单统一使用 `authorization_id` 获取详情，不依赖旧 `payment_id`。
- `authorization_id` 失效时重新发起图形验证码，不直接使用手机号绕过授权。

## 10. 安全设计

- 上游 API 仅由 Node.js 后端访问。
- 店铺 Token、上游 Cookie、初始支付 URL、验证码 URL 和 ticket 不返回前端。
- 公开 DTO 使用字段白名单，不透传上游原始响应；订单使用说明也仅返回规范化字段。
- 支付 URL 仅允许 HTTP/HTTPS，并执行 SSRF 地址检查。
- Chromium 主框架每次导航都重新校验目标地址。
- 验证码 URL 必须与店铺上游同源且匹配固定路径。
- 静态文件防止目录穿越。
- JSON 响应设置 `no-store` 和 `nosniff`。
- 容器启用只读根文件系统和 `no-new-privileges`。
- 5xx 详细错误仅写入 Docker 日志。

浏览器实际展示的商品、订单、二维码和卡密无法对当前用户隐藏；安全目标是避免泄露上游地址、内部字段和服务端会话。

## 11. HTTP 状态码

| 状态码 | 说明 |
|---|---|
| `200` | 请求处理完成，业务结果查看 JSON `code` |
| `400` | JSON 或输入参数无效 |
| `404` | action 或页面不存在 |
| `413` | 请求体超过 1MB |
| `502` | 上游请求、浏览器处理或网络失败；前端显示通用错误 |

## 12. 开发和验证

安装依赖：

```bash
npm ci
```

语法检查和测试：

```bash
node --check src/server.js
node --check src/api.js
node --check src/payment-browser.js
node --check public/assets/js/app.js
npm test
```

Docker 本地构建：

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 shop
```

修改支付浏览器逻辑时，需要同时验证：

- Chromium 能在只读容器中启动。
- `HOME=/tmp`。
- `/tmp` 与 `/dev/shm` 空间充足。
- 支付页面二维码识别。
- 支付状态自动轮询。
- 付款后订单详情、卡密和使用说明获取。
- 容器重启后旧支付会话能自动回退到手机号验证码授权。
- “我的订单”中的详情请求不依赖历史 `payment_id`。
