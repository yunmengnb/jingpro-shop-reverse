# Node.js Docker 版使用文档

当前版本：`1.2.0`

## 1. 安装

以 root 用户执行：

```bash
bash <(curl -Ls https://你的域名/install.sh)
```

安装脚本首先显示使用协议与免责声明。阅读后输入 `AGREE` 才能进入配置；输入其他内容会终止安装，且不会写入店铺和端口配置。

确认协议后，按提示输入完整店铺链接和运行端口。店铺链接格式必须为：

```text
https://店铺域名/shop/店铺标识
```

安装完成后访问：

```text
http://服务器IP:运行端口/
```

若云服务器使用安全组，还需在云厂商控制台放行相同的 TCP 端口。

## 2. 管理菜单

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
0. 退出菜单
```

### 重置店铺链接

选择 `1`，输入新的完整店铺链接。配置写入 `/opt/shop-pro/.env`，随后自动重建容器。

### 重置运行端口

选择 `2`，输入 `1-65535` 范围内的新端口。脚本会更新端口、尝试开放防火墙并重建容器。

### 安装或升级

选择 `3`。升级会下载最新程序、保留原 `.env` 配置、重新构建并启动容器。

### 卸载

选择 `4`。程序容器和 `/opt/shop-pro` 会被删除，但 `/usr/local/bin/shop-pro` 菜单保留，可再次选择 `3` 安装。

## 3. 常用 Docker 命令

```bash
cd /opt/shop-pro
docker compose ps
docker compose logs --tail=100 shop
docker compose restart shop
docker compose up -d --build
docker compose down
```

## 4. 反向代理

Nginx 示例：

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

配置完成后应为域名申请 HTTPS 证书。若容器端口不是 `3000`，将 `proxy_pass` 改为实际端口。

## 5. 页面使用

1. 首次访问时输入手机号创建本地账号。
2. 店铺公告必须点击右上角 `×` 或底部“我知道了”关闭。
3. 点击顶部下方的“客服联系方式”查看 QQ、手机号/微信号和在线客服。
4. 选择分类、商品、数量及支付渠道后创建订单。
5. 在支付弹窗完成付款，程序会自动查询支付状态。
6. “我的订单”通过图形验证码授权查询订单和卡密。

本地账号及部分订单会话保存在浏览器本地存储中，清理浏览器数据后需要重新创建或验证。

## 6. 故障排查

### 页面无法访问

```bash
cd /opt/shop-pro
docker compose ps
docker compose logs --tail=100 shop
```

同时检查系统防火墙和云服务器安全组是否放行运行端口。

### 店铺数据为空

检查 `/opt/shop-pro/.env` 中 `SHOP_URL` 是否为完整链接，然后执行：

```bash
cd /opt/shop-pro
docker compose up -d --force-recreate
```

### 修改后页面仍是旧内容

强制刷新浏览器或清理站点缓存；升级后可重新构建镜像：

```bash
cd /opt/shop-pro
docker compose up -d --build
```

### 查看程序版本

```bash
curl http://127.0.0.1:运行端口/api/health
```
