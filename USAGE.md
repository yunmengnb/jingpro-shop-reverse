# Node.js Docker 版使用说明

当前版本：`1.2.0`

## 1. 环境要求

- 64 位 Linux 服务器
- root 权限
- Docker Engine 和 Docker Compose 插件
- `curl`、`tar`
- 服务器能够访问店铺上游和支付渠道

## 2. 一键安装

以 root 用户执行：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/yunmengnb/jingpro-shop-reverse/main/install.sh)
```

安装程序会先显示使用协议与免责声明。输入 `yes` 确认后，依次配置：

1. 完整店铺链接，支持 HTTP 和 HTTPS：

```text
http://店铺域名/shop/店铺标识
https://店铺域名/shop/店铺标识
```

2. 对外运行端口，范围 `1-65535`。
3. 绑定域名；暂时不绑定可按提示跳过。

程序默认安装到 `/opt/shop-pro`，管理命令安装到 `/usr/local/bin/shop-pro`。安装程序会尝试通过 firewalld、UFW 或 iptables 开放运行端口。

直接访问地址：

```text
http://服务器IP:运行端口/
```

云服务器还需要在云厂商安全组中放行相同的 TCP 端口。

## 3. 管理菜单

执行：

```bash
shop-pro
```

菜单功能：

```text
1. 重置店铺链接
2. 重置运行端口
3. 安装/升级
4. 卸载程序（不包括菜单文件）
5. 添加绑定域名
6. 移除绑定域名
7. 给绑定域名添加 SSL 证书
0. 退出菜单
```

### 3.1 重置店铺链接

选择 `1`，输入新的完整店铺链接。配置写入 `/opt/shop-pro/.env`，随后自动重建容器。

### 3.2 重置运行端口

选择 `2`，输入新端口。脚本会更新配置、尝试开放防火墙、重建容器并同步域名反向代理端口。

### 3.3 安装或升级

选择 `3`。程序会下载 GitHub `main` 分支最新代码，保留 `.env`、域名和证书配置，重新构建镜像并同步最新版管理菜单。

仅执行 `docker restart` 不会应用新代码，升级必须通过菜单或重新构建镜像。

### 3.4 卸载

选择 `4`。容器和 `/opt/shop-pro` 会被删除，`/usr/local/bin/shop-pro` 管理菜单保留，之后仍可选择 `3` 重新安装。

### 3.5 域名和 SSL

- 选择 `5` 添加一个或多个绑定域名。
- 选择 `6` 移除域名及对应反向代理配置。
- 选择 `7` 为已绑定域名粘贴 PEM 证书链和私钥。
- 证书链支持多个证书块；粘贴完成后连续按两次回车结束输入。

检测到宝塔面板时，程序复用宝塔 Nginx，不占用 Docker 主机的 80/443 端口，配置写入：

```text
/www/server/panel/vhost/nginx/域名.conf
```

## 4. 页面使用

1. 首次访问时输入 11 位手机号创建本地账号。
2. 顶部左侧显示接口获取的店铺名称，右侧“用户管理”可查看当前手机号或退出登录。
3. 店铺公告只能点击右上角 `×` 或底部“我知道了”关闭。
4. “客服联系方式”弹窗显示 QQ、手机号/微信号和在线客服按钮。
5. 选择分类、商品、数量和支付渠道后点击“去支付”。
6. 后端 Chromium 访问支付入口、跟踪跳转并截取最终支付页面二维码。
7. 二维码出现后立即显示；页面会自动轮询支付状态，付款成功后进入订单详情。
8. 已付款但上游尚未发卡时，订单详情每 3 秒自动刷新，最多约两分钟。
9. “我的订单”通过图形验证码授权查询历史订单和卡密。

本地手机号保存在浏览器本地存储中；支付会话保存在浏览器会话存储和 Node.js 服务端内存中。清理浏览器数据或重启容器后，未完成的临时支付/查询授权可能失效。

## 5. 支付流程说明

支付流程为：

```text
浏览器创建订单
  → Node.js 后端请求上游
  → 后端保存支付地址和上游会话
  → 浏览器仅获得 payment_id
  → 后端 Chromium 跟踪支付跳转
  → 后端截取二维码并返回图片
  → 浏览器自动查询支付状态
  → 支付成功后获取订单详情和卡密
```

前端不会收到初始支付地址、上游 `PHPSESSID`、验证码会话、店铺 Token 或上游原始响应。二维码和用户实际需要查看的商品、订单、卡密仍会显示在浏览器中。

Chromium 进程会在容器内复用，每笔支付使用独立浏览器上下文，Cookie 和页面数据相互隔离。首笔支付需要启动 Chromium，后续支付通常更快。

## 6. 常用运维命令

```bash
cd /opt/shop-pro
docker compose ps
docker compose logs --tail=100 shop
docker compose restart shop
docker compose up -d --build
docker compose down
```

容器名称为：

```text
yimengyun-shop-node
```

直接查看日志：

```bash
docker logs --tail 100 yimengyun-shop-node
```

健康检查：

```bash
curl http://127.0.0.1:运行端口/api/health
```

正常响应：

```json
{"code":1,"msg":"success","data":{"ok":true}}
```

## 7. 手动反向代理

未使用安装程序自动配置域名时，可使用以下 Nginx 配置：

```nginx
server {
    listen 80;
    server_name shop.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

将 `3000` 替换为实际对外端口。HTTP 可以使用，生产环境建议配置 HTTPS。

## 8. 故障排查

### 页面无法访问

```bash
cd /opt/shop-pro
docker compose ps
docker compose logs --tail=100 shop
```

同时检查系统防火墙和云服务器安全组。

### 店铺数据为空

检查 `/opt/shop-pro/.env` 中 `SHOP_URL` 是否为完整店铺链接，然后执行：

```bash
cd /opt/shop-pro
docker compose up -d --force-recreate
```

### 支付一直显示正在获取二维码

查看后端真实错误：

```bash
docker logs --tail 100 yimengyun-shop-node
```

检查容器配置：

```bash
docker exec yimengyun-shop-node printenv HOME
docker exec yimengyun-shop-node df -h /tmp /dev/shm
```

正常配置应为：

- `HOME=/tmp`
- `/tmp` 约 256MB
- `/dev/shm` 约 256MB

支付页面最多检测二维码约 12 秒。支付站点无法访问、二维码加载失败或被安全策略拦截时，后端会记录错误，前端仅显示通用提示。

### 已付款但没有卡密

程序会使用 `dump: 1` 请求订单详情并自动刷新。若超过约两分钟仍无卡密，先确认上游订单详情页面是否已经显示“已发货”，再检查容器日志。

### 修改后仍显示旧页面

强制刷新浏览器缓存，并确认已经重新构建镜像：

```bash
cd /opt/shop-pro
docker compose up -d --build
```
