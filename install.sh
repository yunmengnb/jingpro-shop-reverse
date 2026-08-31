#!/usr/bin/env bash
# 忆梦云团队开发
set -Eeuo pipefail

readonly INSTALL_DIR="${SHOP_PRO_INSTALL_DIR:-/opt/shop-pro}"
readonly COMMAND_PATH="${SHOP_PRO_COMMAND_PATH:-/usr/local/bin/shop-pro}"
readonly SOURCE_URL="${SHOP_PRO_SOURCE_URL:-https://github.com/yunmengnb/jingpro-shop-reverse/archive/refs/heads/main.tar.gz}"

fail() { printf '错误：%s\n' "$1" >&2; exit 1; }
validate_shop_url() { [[ "$1" =~ ^https?://[^/]+/shop/[A-Za-z0-9_-]+/?$ ]]; }
validate_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
require_root() { ((EUID == 0)) || fail "请使用 root 用户运行安装命令。"; }
show_agreement() {
  cat <<'AGREEMENT'

================ 使用协议与免责声明 ================
1. 本程序仅限合法合规用途，只能连接你拥有或已获明确授权的店铺及接口。
2. 禁止用于欺诈、钓鱼、洗钱、窃取数据、侵犯隐私、绕过访问控制或网络攻击。
3. 你须自行保障服务器、店铺配置、订单数据、支付信息及用户隐私安全。
4. 你须独立承担商品、交易、支付、履约、退款、售后及数据处理的全部责任。
5. 本程序按“现状”提供，不保证持续可用或永久兼容第三方接口。
6. 因上游变更、网络或支付异常、服务器配置、第三方服务、错误操作造成的损失，程序提供方不承担责任。
7. 因违法违规、违反第三方协议或超出授权范围使用产生的一切责任由使用者承担。
8. 完整协议随程序提供于 AGREEMENT.md。输入 AGREE 表示你已完整阅读、理解并接受协议。
====================================================
AGREEMENT
  local agreement_answer
  printf '请输入 AGREE 确认接受协议，输入其他内容将退出安装：'
  IFS= read -r agreement_answer
  [[ "$agreement_answer" == 'AGREE' ]] || fail "你未接受使用协议与免责声明，安装已终止。"
}

open_port() {
  local port=$1
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null
    firewall-cmd --reload >/dev/null
  elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
    ufw allow "${port}/tcp" >/dev/null
  elif command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT >/dev/null 2>&1 || iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  else
    printf '提示：未检测到受支持的防火墙，Docker 已发布端口 %s。\n' "$port"
  fi
}

install_source() {
  local archive extract_root source_root backup
  archive=$(mktemp)
  extract_root=$(mktemp -d)
  backup=$(mktemp -d)
  trap 'rm -f "${archive:-}"; rm -rf "${extract_root:-}" "${backup:-}"' RETURN
  printf '正在下载程序文件...\n'
  curl --fail --location --silent --show-error "$SOURCE_URL" --output "$archive" || fail "程序文件下载失败。"
  tar -xzf "$archive" -C "$extract_root" || fail "程序压缩包解压失败。"
  source_root=$(find "$extract_root" -mindepth 2 -maxdepth 2 -type d -print -quit)
  [[ -n "$source_root" ]] || fail "压缩包解压为空。"
  if [[ ! -f "$source_root/compose.yaml" ]]; then
    source_root=$(find "$extract_root" -mindepth 3 -maxdepth 3 -type d -name node-docker -print -quit)
    [[ -n "$source_root" && -f "$source_root/compose.yaml" ]] || fail "压缩包中未找到 compose.yaml。"
  fi
  mkdir -p "$INSTALL_DIR"
  [[ ! -f "$INSTALL_DIR/.env" ]] || cp "$INSTALL_DIR/.env" "$backup/.env"
  cp -a "$source_root/." "$INSTALL_DIR/"
  [[ ! -f "$backup/.env" ]] || cp "$backup/.env" "$INSTALL_DIR/.env"
}

write_env() {
  local shop_url=$1 port=$2
  umask 077
  cat > "$INSTALL_DIR/.env" <<EOF
# 忆梦云团队开发；由 install.sh 生成
SHOP_URL=$shop_url
PORT=$port
VERIFY_SSL=false
CACHE_TTL=60
EOF
}

install_command() {
  cat > "$COMMAND_PATH" <<'MENU'
#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_DIR="${SHOP_PRO_INSTALL_DIR:-/opt/shop-pro}"
SOURCE_URL="${SHOP_PRO_SOURCE_URL:-__SOURCE_URL__}"
ENV_FILE="$INSTALL_DIR/.env"
validate_shop_url() { [[ "$1" =~ ^https?://[^/]+/shop/[A-Za-z0-9_-]+/?$ ]]; }
validate_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
set_env() {
  local key=$1 value=$2 temporary
  temporary=$(mktemp)
  awk -v key="$key" -v value="$value" 'BEGIN{found=0} index($0,key "=")==1{print key "=" value;found=1;next}{print} END{if(!found)print key "=" value}' "$ENV_FILE" > "$temporary"
  chmod 600 "$temporary"; mv "$temporary" "$ENV_FILE"
}
open_port() {
  local port=$1
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --add-port="${port}/tcp" >/dev/null; firewall-cmd --reload >/dev/null
  elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then ufw allow "${port}/tcp" >/dev/null
  elif command -v iptables >/dev/null 2>&1; then iptables -C INPUT -p tcp --dport "$port" -j ACCEPT >/dev/null 2>&1 || iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  else printf '提示：未检测到受支持的防火墙，Docker 已发布端口 %s。\n' "$port"; fi
}
reset_shop_url() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local value
  printf '请输入新的完整店铺链接：'; IFS= read -r value
  validate_shop_url "$value" || { printf '错误：店铺链接格式无效。\n' >&2; return; }
  set_env SHOP_URL "$value"
  docker compose --project-directory "$INSTALL_DIR" up -d --force-recreate
  printf '店铺链接已重置。\n'
}
reset_port() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local value
  printf '请输入新的运行端口：'; IFS= read -r value
  validate_port "$value" || { printf '错误：端口必须是 1-65535 的数字。\n' >&2; return; }
  set_env PORT "$value"; open_port "$value"
  docker compose --project-directory "$INSTALL_DIR" up -d --force-recreate
  printf '运行端口已重置为 %s。\n' "$value"
}
install_or_upgrade() {
  local archive extract_root source_root shop_url port saved_env
  archive=$(mktemp); extract_root=$(mktemp -d); saved_env=$(mktemp)
  [[ ! -f "$ENV_FILE" ]] || cp "$ENV_FILE" "$saved_env"
  printf '正在下载并安装/升级...\n'
  if ! curl -fsSL "$SOURCE_URL" -o "$archive" || ! tar -xzf "$archive" -C "$extract_root"; then rm -rf "$archive" "$extract_root" "$saved_env"; printf '错误：下载或解压失败。\n' >&2; return; fi
  source_root=$(find "$extract_root" -mindepth 2 -maxdepth 2 -type d -print -quit)
  if [[ -z "$source_root" || ! -f "$source_root/compose.yaml" ]]; then
    source_root=$(find "$extract_root" -mindepth 3 -maxdepth 3 -type d -name node-docker -print -quit)
  fi
  [[ -n "$source_root" && -f "$source_root/compose.yaml" ]] || { rm -rf "$archive" "$extract_root" "$saved_env"; printf '错误：未找到程序目录。\n' >&2; return; }
  mkdir -p "$INSTALL_DIR"; cp -a "$source_root/." "$INSTALL_DIR/"
  if [[ -s "$saved_env" ]]; then cp "$saved_env" "$ENV_FILE"
  else
    printf '请输入完整店铺链接（支持 http:// 或 https://）：'; IFS= read -r shop_url; validate_shop_url "$shop_url" || { printf '错误：店铺链接格式无效。\n' >&2; return; }
    printf '请输入运行端口 [3000]：'; IFS= read -r port; port=${port:-3000}; validate_port "$port" || { printf '错误：端口无效。\n' >&2; return; }
    umask 077; printf 'SHOP_URL=%s\nPORT=%s\nVERIFY_SSL=false\nCACHE_TTL=60\n' "$shop_url" "$port" > "$ENV_FILE"
  fi
  port=$(get_env PORT); open_port "$port"
  docker compose --project-directory "$INSTALL_DIR" up -d --build
  rm -rf "$archive" "$extract_root" "$saved_env"
  printf '安装/升级完成。\n'
}
uninstall_program() {
  if [[ -f "$INSTALL_DIR/compose.yaml" ]]; then docker compose --project-directory "$INSTALL_DIR" down --remove-orphans || true; fi
  rm -rf "$INSTALL_DIR"
  printf '程序已卸载，shop-pro 菜单已保留。\n'
}
((EUID == 0)) || { printf '错误：请使用 root 用户运行 shop-pro。\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf '错误：未安装 Docker。\n' >&2; exit 1; }
while true; do
  printf '\nshop-pro 管理菜单\n1. 重置店铺链接\n2. 重置运行端口\n3. 安装/升级\n4. 卸载程序（不包括菜单文件）\n0. 退出菜单\n请选择：'
  IFS= read -r choice
  case "$choice" in 1) reset_shop_url;; 2) reset_port;; 3) install_or_upgrade;; 4) uninstall_program;; 0) exit 0;; *) printf '错误：请输入 0-4。\n' >&2;; esac
done
MENU
  sed -i "s|__SOURCE_URL__|$SOURCE_URL|g" "$COMMAND_PATH"
  chmod 0755 "$COMMAND_PATH"
}

main() {
  local shop_url port
  require_root
  command -v curl >/dev/null 2>&1 || fail "未安装 curl。"
  command -v tar >/dev/null 2>&1 || fail "未安装 tar。"
  command -v docker >/dev/null 2>&1 || fail "未安装 Docker。请先安装 Docker Engine 与 Compose 插件。"
  docker compose version >/dev/null 2>&1 || fail "缺少 docker compose 插件。"
  show_agreement
  printf '请输入完整店铺链接（支持 http:// 或 https://，示例 http://shop.example.com/shop/demo）：'; IFS= read -r shop_url
  validate_shop_url "$shop_url" || fail "店铺链接格式无效。"
  printf '请输入运行端口 [3000]：'; IFS= read -r port; port=${port:-3000}
  validate_port "$port" || fail "端口必须是 1-65535 的数字。"
  install_source
  write_env "$shop_url" "$port"
  install_command
  open_port "$port"
  docker compose --project-directory "$INSTALL_DIR" up -d --build
  printf '安装完成：http://服务器IP:%s/\n终端管理命令：shop-pro\n' "$port"
}
main "$@"
