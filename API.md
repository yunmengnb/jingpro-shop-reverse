# Node.js Docker 版接口文档

当前版本：`1.2.0`

## 通用约定

接口同时支持两种路径：

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

- `code = 1`：成功
- `code = 0`：失败
- GET 参数通过查询字符串传递
- POST 请求头使用 `Content-Type: application/json`
- 上游业务响应通常会按原结构透传

## 接口列表

| action | 方法 | 用途 |
|---|---|---|
| `health` | GET | 健康检查和版本信息 |
| `shop` | GET | 店铺名称、公告和客服信息 |
| `categories` | GET | 商品分类 |
| `goods` | POST | 商品列表和搜索 |
| `channels` | POST | 支付渠道 |
| `price` | POST | 计算商品价格 |
| `contact-check` | POST | 校验联系方式 |
| `order` | POST | 创建订单 |
| `payment-resolve` | POST | 解析支付页面或二维码 |
| `query` | POST | 查询支付状态 |
| `captcha-start` | POST | 创建验证码会话 |
| `captcha-image` | GET | 获取验证码图片 |
| `captcha-check` | POST | 校验验证码 |
| `orders` | POST | 查询订单列表 |
| `order-info` | POST | 查询订单详情及卡密 |

## 健康检查

```http
GET /api/health
```

成功响应：

```json
{
  "code": 1,
  "msg": "ok",
  "data": {
    "program": "鲸pro店铺反代程序",
    "version": "1.2.0",
    "environment": {
      "ok": true,
      "node_version": "v22.x.x",
      "shop_url": "已配置的店铺链接"
    }
  }
}
```

## 店铺信息

```http
GET /api/shop
```

页面使用的关键数据字段：

| 字段 | 用途 |
|---|---|
| `name` | 浏览器标题 |
| `description`、`notice` 或 `announcement` | 店铺公告 |
| `contact_qq` | QQ号 |
| `contact_mobile` | 手机号/微信号 |
| `contact_wechat` | 在线企微客服 URL |

## 分类列表

```http
GET /api/categories
```

服务端自动传递店铺标识和卡密商品类型。

## 商品列表

```http
POST /api/goods
Content-Type: application/json

{
  "category_id": -1,
  "keywords": "搜索词"
}
```

- `category_id`：分类 ID，`-1` 表示全部
- `keywords`：可选，最长读取 50 个字符

## 支付渠道

```http
POST /api/channels
Content-Type: application/json

{
  "goods_key": "商品标识"
}
```

## 商品价格

```http
POST /api/price
Content-Type: application/json

{
  "goods_key": "商品标识",
  "channel_id": 1,
  "quantity": 1
}
```

数量会限制在 `1-100`。

## 联系方式校验

```http
POST /api/contact-check
Content-Type: application/json

{
  "contact": "手机号"
}
```

## 创建订单

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

订单创建成功时，`data.session_token` 用于后续支付解析和订单查询。该值属于临时会话信息，不应公开。

## 解析支付信息

```http
POST /api/payment-resolve
Content-Type: application/json

{
  "payurl": "创建订单返回的支付入口",
  "session_token": "订单会话"
}
```

`payurl` 必须是当前上游域名下 `/shopApi/Pay/payment` 路径的 HTTPS 地址。解析出的最终支付跳转不限制域名，但仍要求 HTTPS。

## 查询支付状态

```http
POST /api/query
Content-Type: application/json

{
  "trade_no": "订单号",
  "session_token": "订单会话"
}
```

也可以使用 `order_no` 代替 `trade_no`。

## 创建验证码会话

```http
POST /api/captcha-start
```

成功后保存返回的 `session_token`、验证码图片地址和校验地址。

## 验证码图片

```http
GET /api/captcha-image?url={图片地址}&session_token={验证码会话}
```

此接口直接返回图片二进制，不返回 JSON。图片 URL 必须指向当前上游 `/shopApi/common/captchaImg.html`。

## 校验验证码

```http
POST /api/captcha-check
Content-Type: application/json

{
  "code": "验证码",
  "ip": "验证码接口返回的IP",
  "check_url": "验证码校验地址",
  "session_token": "验证码会话"
}
```

## 查询订单列表

```http
POST /api/orders
Content-Type: application/json

{
  "keywords": "手机号或订单号",
  "ticket": "验证码校验成功后的票据",
  "session_token": "验证码会话"
}
```

`trade_no`、`order_no` 或 `contact` 也可代替 `keywords`。

## 查询订单详情

```http
POST /api/order-info
Content-Type: application/json

{
  "trade_no": "订单号",
  "query_password": "查询密码，可为空",
  "session_token": "订单会话或验证码会话"
}
```

订单已支付且上游允许时，响应数据包含卡密信息。

## HTTP 状态码

| 状态码 | 说明 |
|---|---|
| `200` | 请求已处理，业务结果查看 JSON `code` |
| `400` | JSON 或输入参数无效 |
| `404` | 接口或页面不存在 |
| `413` | 请求内容超过限制 |
| `502` | 上游请求、支付解析或网络失败 |

## 安全注意事项

- 不要在日志、网页或公开接口中泄露 `session_token`。
- 接口应通过 HTTPS 对外提供。
- 不建议允许第三方站点跨域调用。
- `SHOP_URL` 只能配置已授权店铺。
