# 鲸pro店铺反代程序（Node.js Docker 版）

当前版本：`1.2.0`

本项目是 Node.js Docker 部署版本，用于代理已授权店铺接口，并提供商品浏览、创建订单、支付、订单查询、店铺公告和客服联系方式展示。

## 功能

- 动态读取店铺名称并设置浏览器标题
- 弹窗显示店铺公告
- 显示 QQ、手机号/微信号及在线企微客服按钮
- 商品分类、商品搜索、实时价格和支付渠道
- 本地手机号账号、创建订单及支付状态查询
- 图形验证码授权查询历史订单和卡密
- Docker Compose 部署、自动重启和只读容器
- `shop-pro` 管理店铺链接、端口、升级及卸载

## 环境要求

- 64 位 Linux 服务器
- root 权限
- Docker Engine
- Docker Compose 插件（`docker compose`）
- `curl`、`tar`
- 服务器能够访问店铺上游接口及支付渠道

## 一键安装

将 `install.sh` 部署到公开 HTTPS 地址后执行：

```bash
bash <(curl -Ls https://你的域名/install.sh)
```

安装程序将要求输入：

1. 完整店铺链接，例如 `https://shop.example.com/shop/demo`
2. 对外运行端口，默认 `3000`

程序默认安装到 `/opt/shop-pro`，管理命令安装到 `/usr/local/bin/shop-pro`。安装脚本会尝试通过 firewalld、UFW 或 iptables 开放配置端口。

## 手动部署

```bash
cp .env.example .env
# 编辑 .env 后执行
docker compose up -d --build
```

主要配置：

| 配置 | 说明 | 示例 |
|---|---|---|
| `SHOP_URL` | 完整店铺链接，必须包含 `/shop/店铺标识` | `https://shop.example.com/shop/demo` |
| `PORT` | 服务器对外端口 | `3000` |
| `VERIFY_SSL` | 是否验证上游 HTTPS 证书 | `true` |
| `CACHE_TTL` | 店铺基础数据缓存秒数 | `60` |

## 目录

```text
├─ public/          前端静态资源
├─ src/             Node.js 服务端代码
├─ test/            自动化测试
├─ compose.yaml     Docker Compose 配置
├─ Dockerfile       镜像构建配置
├─ install.sh       一键安装及管理菜单生成脚本
├─ AGREEMENT.md     使用协议与免责声明
├─ API.md           本程序接口文档
├─ USAGE.md         使用和运维文档
└─ CHANGELOG.md     Node.js Docker 版更新日志
```

## 健康检查

```bash
curl http://127.0.0.1:3000/api/health
```

## 安全说明

- `.env` 包含店铺地址，不应提交到代码仓库或公开分享。
- 请优先使用 Nginx、Caddy 等反向代理配置 HTTPS。
- 本程序只应用于已获授权的店铺和接口。

更多操作见 [USAGE.md](USAGE.md)，接口说明见 [API.md](API.md)。
