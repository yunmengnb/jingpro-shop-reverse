#!/usr/bin/env bash
# 忆梦云团队开发
set -Eeuo pipefail

readonly INSTALL_DIR="${SHOP_PRO_INSTALL_DIR:-/opt/shop-pro}"
readonly COMMAND_PATH="${SHOP_PRO_COMMAND_PATH:-/usr/local/bin/shop-pro}"
readonly SOURCE_URL="${SHOP_PRO_SOURCE_URL:-https://github.com/yunmengnb/jingpro-shop-reverse/archive/refs/heads/main.tar.gz}"

fail() { printf '错误：%s\n' "$1" >&2; exit 1; }
validate_shop_url() { [[ "$1" =~ ^https?://[^/]+/shop/[A-Za-z0-9_-]+/?$ ]]; }
validate_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
validate_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
require_root() { ((EUID == 0)) || fail "请使用 root 用户运行安装命令。"; }
detect_server_ip() {
  local ip
  for svc in "https://api.ipify.org" "https://ifconfig.me/ip" "https://ip.sb" "https://icanhazip.com"; do
    ip=$(curl -fsSL --connect-timeout 3 --max-time 5 "$svc" 2>/dev/null | tr -d '\r\n ') && [[ -n "$ip" ]] && { printf '%s' "$ip"; return; }
  done
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [[ -n "$ip" ]] && { printf '%s' "$ip"; return; }
  printf '服务器IP'
}
# 检测宝塔面板
is_bt_panel() { [[ -d /www/server/panel ]] && [[ -f /www/server/nginx/conf/nginx.conf ]]; }
# 检测端口占用
port_in_use() {
  local port=$1
  # ss / netstat / lsof 任一可用
  if command -v ss >/dev/null 2>&1; then ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"; return $?; fi
  if command -v netstat >/dev/null 2>&1; then netstat -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"; return $?; fi
  if command -v lsof >/dev/null 2>&1; then lsof -i ":${port}" -sTCP:LISTEN >/dev/null 2>&1; return $?; fi
  return 1
}

show_agreement() {
  cat <<'AGREEMENT'

================ 使用协议与免责声明 ================
1. 本程序仅限合法合规用途，只能连接你拥有或已获明确授权的店铺及接口。
2. 禁止用于欺诈、钓鱼、洗钱、窃取数据、侵犯隐私、绕过访问控制或网络攻击。
3. 你须自行保障服务器、店铺配置、订单数据、支付信息及用户隐私安全。
4. 你须独立承担商品、交易、支付、履约、退款、售后及数据处理的全部责任。
5. 本程序按"现状"提供，不保证持续可用或永久兼容第三方接口。
6. 因上游变更、网络或支付异常、服务器配置、第三方服务、错误操作造成的损失，程序提供方不承担责任。
7. 因违法违规、违反第三方协议或超出授权范围使用产生的一切责任由使用者承担。
8. 完整协议随程序提供于 AGREEMENT.md。输入 yes 表示你已完整阅读、理解并接受协议。
====================================================
AGREEMENT
  local agreement_answer
  printf '请输入 yes 确认接受协议，输入其他内容将退出安装：'
  IFS= read -r agreement_answer < /dev/tty
  [[ "$agreement_answer" == 'yes' ]] || fail "你未接受使用协议与免责声明，安装已终止。"
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
  source_root=$(find "$extract_root" -mindepth 1 -maxdepth 1 -type d -print -quit)
  [[ -n "$source_root" ]] || fail "压缩包解压为空。"
  if [[ ! -f "$source_root/compose.yaml" ]]; then
    source_root=$(find "$extract_root" -mindepth 2 -maxdepth 2 -type d -name node-docker -print -quit)
    [[ -n "$source_root" && -f "$source_root/compose.yaml" ]] || fail "压缩包中未找到 compose.yaml。"
  fi
  mkdir -p "$INSTALL_DIR"
  [[ ! -f "$INSTALL_DIR/.env" ]] || cp "$INSTALL_DIR/.env" "$backup/.env"
  cp -a "$source_root/." "$INSTALL_DIR/"
  [[ ! -f "$backup/.env" ]] || cp "$backup/.env" "$INSTALL_DIR/.env"
  mkdir -p "$INSTALL_DIR/nginx/certs"
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

# ===== 域名配置（宝塔面板 / 通用 Nginx） =====
DOMAINS_FILE="$INSTALL_DIR/nginx/domains.conf"
# 写入反代配置文件到对应位置
write_proxy_conf() {
  local domain=$1 port=$2 cert_file=$3 key_file=$4
  local conf_path cert_dir
  if is_bt_panel; then
    conf_path="/www/server/panel/vhost/nginx/${domain}.conf"
    cert_dir="/www/server/panel/vhost/cert/${domain}"
    mkdir -p "$cert_dir"
    conf_content=$(build_proxy_block "$domain" "127.0.0.1" "$port" "$cert_file" "$key_file" "$cert_dir")
  else
    conf_path="$INSTALL_DIR/nginx/vhost/${domain}.conf"
    cert_dir="$INSTALL_DIR/nginx/certs"
    mkdir -p "$INSTALL_DIR/nginx/vhost"
    conf_content=$(build_proxy_block "$domain" "127.0.0.1" "$port" "$cert_file" "$key_file" "$cert_dir")
  fi
  printf '%s\n' "$conf_content" > "$conf_path"
  printf '已写入反代配置：%s\n' "$conf_path"
}
build_proxy_block() {
  local domain=$1 proxy_host=$2 proxy_port=$3 cert_file=$4 key_file=$5 cert_dir=$6
  local ssl_server=''
  if [[ -n "$cert_file" && -n "$key_file" && -f "${cert_dir}/${cert_file}" && -f "${cert_dir}/${key_file}" ]]; then
    ssl_server="
server {
    listen 443 ssl http2;
    server_name ${domain};
    ssl_certificate     ${cert_dir}/${cert_file};
    ssl_certificate_key ${cert_dir}/${key_file};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://${proxy_host}:${proxy_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
"
  fi
  printf '%s
server {
    listen 80;
    server_name %s;

    location / {
        proxy_pass http://%s:%s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
' "$ssl_server" "$domain" "$proxy_host" "$proxy_port"
}
reload_nginx() {
  # 重载 nginx：宝塔面板 & 通用
  if is_bt_panel && command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || \
      /etc/init.d/nginx reload 2>/dev/null || true
  elif command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || true
  fi
}
list_domains() {
  if [[ ! -f "$DOMAINS_FILE" ]] || [[ ! -s "$DOMAINS_FILE" ]]; then
    printf '（尚未绑定任何域名）\n'; return
  fi
  printf '当前绑定域名：\n'
  local n=1
  while IFS='|' read -r domain cert_file key_file; do
    [[ -z "$domain" || "$domain" == \#* ]] && continue
    local ssl_status='未配置 SSL'
    if [[ -n "$cert_file" && -n "$key_file" ]]; then ssl_status="已配置 SSL（证书: $cert_file / 密钥: $key_file）"; fi
    printf '  %d. %s  [%s]\n' "$n" "$domain" "$ssl_status"
    n=$((n+1))
  done < "$DOMAINS_FILE"
}
get_env() { sed -n "s/^$1=//p" "$INSTALL_DIR/.env" | tail -n 1; }
# 用 awk 替换 domains.conf 里某一行（纯 bash 安全可靠）
set_domain_record() {
  local domain=$1 cert_file=$2 key_file=$3
  awk -v d="$domain" -v cf="$cert_file" -v kf="$key_file" -F'|' '
    BEGIN{OFS="|"}
    $1==d{print d,cf,kf; found=1; next}
    {print}
    END{if(!found) print d,cf,kf}
  ' "$DOMAINS_FILE" > "${DOMAINS_FILE}.new" && mv "${DOMAINS_FILE}.new" "$DOMAINS_FILE"
}
remove_domain_record() {
  local domain=$1
  grep -v "^${domain}|" "$DOMAINS_FILE" > "${DOMAINS_FILE}.new" 2>/dev/null || true
  mv "${DOMAINS_FILE}.new" "$DOMAINS_FILE"
}
get_domain_record() {
  local domain=$1
  grep "^${domain}|" "$DOMAINS_FILE" 2>/dev/null | head -n1 || true
}

install_command() {
  cat > "$COMMAND_PATH" <<'MENU'
#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_DIR="${SHOP_PRO_INSTALL_DIR:-/opt/shop-pro}"
SOURCE_URL="${SHOP_PRO_SOURCE_URL:-__SOURCE_URL__}"
ENV_FILE="$INSTALL_DIR/.env"
DOMAINS_FILE="$INSTALL_DIR/nginx/domains.conf"
NGINX_CERTS="$INSTALL_DIR/nginx/certs"
validate_shop_url() { [[ "$1" =~ ^https?://[^/]+/shop/[A-Za-z0-9_-]+/?$ ]]; }
validate_port() { [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
validate_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
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
is_bt_panel() { [[ -d /www/server/panel ]] && [[ -f /www/server/nginx/conf/nginx.conf ]]; }
reload_nginx() {
  if is_bt_panel && command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || /etc/init.d/nginx reload 2>/dev/null || true
  elif command -v nginx >/dev/null 2>&1; then
    nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || true
  fi
}
list_domains() {
  if [[ ! -f "$DOMAINS_FILE" ]] || [[ ! -s "$DOMAINS_FILE" ]]; then printf '（尚未绑定任何域名）\n'; return; fi
  printf '当前绑定域名：\n'
  local n=1
  while IFS='|' read -r domain cert_file key_file; do
    [[ -z "$domain" || "$domain" == \#* ]] && continue
    local ssl_status='未配置 SSL'
    [[ -n "$cert_file" && -n "$key_file" ]] && ssl_status="已配置 SSL（证书: $cert_file / 密钥: $key_file）"
    printf '  %d. %s  [%s]\n' "$n" "$domain" "$ssl_status"
    n=$((n+1))
  done < "$DOMAINS_FILE"
}
set_domain_record() {
  local domain=$1 cert_file=$2 key_file=$3
  awk -v d="$domain" -v cf="$cert_file" -v kf="$key_file" -F'|' 'BEGIN{OFS="|"} $1==d{print d,cf,kf; found=1; next}{print} END{if(!found) print d,cf,kf}' "$DOMAINS_FILE" > "${DOMAINS_FILE}.new" && mv "${DOMAINS_FILE}.new" "$DOMAINS_FILE"
}
remove_domain_record() { local domain=$1; grep -v "^${domain}|" "$DOMAINS_FILE" > "${DOMAINS_FILE}.new" 2>/dev/null || true; mv "${DOMAINS_FILE}.new" "$DOMAINS_FILE"; }
get_domain_record() { local domain=$1; grep "^${domain}|" "$DOMAINS_FILE" 2>/dev/null | head -n1 || true; }
build_proxy_block() {
  local domain=$1 proxy_host=$2 proxy_port=$3 cert_file=$4 key_file=$5 cert_dir=$6
  local ssl_server=''
  if [[ -n "$cert_file" && -n "$key_file" && -f "${cert_dir}/${cert_file}" && -f "${cert_dir}/${key_file}" ]]; then
    ssl_server=$'\nserver {\n    listen 443 ssl http2;\n    server_name '"${domain}"$';\n    ssl_certificate     '"${cert_dir}"'/'"${cert_file}"$';\n    ssl_certificate_key '"${cert_dir}"'/'"${key_file}"$';\n    ssl_protocols       TLSv1.2 TLSv1.3;\n    ssl_ciphers         HIGH:!aNULL:!MD5;\n    ssl_prefer_server_ciphers on;\n\n    location / {\n        proxy_pass http://'"${proxy_host}"':'"${proxy_port}"$';\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n'
  fi
  printf '%s\nserver {\n    listen 80;\n    server_name %s;\n\n    location / {\n        proxy_pass http://%s:%s;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n' "$ssl_server" "$domain" "$proxy_host" "$proxy_port"
}
apply_domain_conf() {
  # 根据 domains.conf 里所有域名，重写反代配置文件并 reload nginx
  local port cert_dir
  port=$(get_env PORT); [[ -n "$port" ]] || port="3000"
  if [[ ! -f "$DOMAINS_FILE" ]] || [[ ! -s "$DOMAINS_FILE" ]]; then return; fi
  while IFS='|' read -r domain cert_file key_file; do
    [[ -z "$domain" || "$domain" == \#* ]] && continue
    local conf_path
    if is_bt_panel; then
      conf_path="/www/server/panel/vhost/nginx/${domain}.conf"
      cert_dir="/www/server/panel/vhost/cert/${domain}"
      mkdir -p "$cert_dir"
    else
      conf_path="$INSTALL_DIR/nginx/vhost/${domain}.conf"
      cert_dir="$INSTALL_DIR/nginx/certs"
      mkdir -p "$INSTALL_DIR/nginx/vhost"
    fi
    build_proxy_block "$domain" "127.0.0.1" "$port" "$cert_file" "$key_file" "$cert_dir" > "$conf_path"
    printf '  反代配置已写入：%s\n' "$conf_path"
  done < "$DOMAINS_FILE"
  reload_nginx
}
reset_shop_url() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local value
  printf '请输入新的完整店铺链接：'; IFS= read -r value < /dev/tty
  validate_shop_url "$value" || { printf '错误：店铺链接格式无效。\n' >&2; return; }
  set_env SHOP_URL "$value"
  docker compose --project-directory "$INSTALL_DIR" up -d --force-recreate shop
  printf '店铺链接已重置。\n'
}
reset_port() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local value
  printf '请输入新的运行端口：'; IFS= read -r value < /dev/tty
  validate_port "$value" || { printf '错误：端口必须是 1-65535 的数字。\n' >&2; return; }
  local old_port; old_port=$(get_env PORT)
  set_env PORT "$value"; open_port "$value"
  # 如果有域名反代配置，也要把 proxy_pass 里的端口改掉
  if [[ -f "$DOMAINS_FILE" ]] && [[ -s "$DOMAINS_FILE" ]]; then
    apply_domain_conf
  fi
  docker compose --project-directory "$INSTALL_DIR" up -d --force-recreate shop
  printf '运行端口已重置为 %s。\n' "$value"
}
install_or_upgrade() {
  local archive extract_root source_root shop_url port saved_env
  archive=$(mktemp); extract_root=$(mktemp -d); saved_env=$(mktemp)
  [[ ! -f "$ENV_FILE" ]] || cp "$ENV_FILE" "$saved_env"
  printf '正在下载并安装/升级...\n'
  if ! curl -fsSL "$SOURCE_URL" -o "$archive" || ! tar -xzf "$archive" -C "$extract_root"; then rm -rf "$archive" "$extract_root" "$saved_env"; printf '错误：下载或解压失败。\n' >&2; return; fi
  source_root=$(find "$extract_root" -mindepth 1 -maxdepth 1 -type d -print -quit)
  if [[ -z "$source_root" || ! -f "$source_root/compose.yaml" ]]; then
    source_root=$(find "$extract_root" -mindepth 2 -maxdepth 2 -type d -name node-docker -print -quit)
  fi
  [[ -n "$source_root" && -f "$source_root/compose.yaml" ]] || { rm -rf "$archive" "$extract_root" "$saved_env"; printf '错误：未找到程序目录。\n' >&2; return; }
  mkdir -p "$INSTALL_DIR"; cp -a "$source_root/." "$INSTALL_DIR/"
  mkdir -p "$INSTALL_DIR/nginx/certs"; mkdir -p "$INSTALL_DIR/nginx/vhost"
  if [[ -s "$saved_env" ]]; then cp "$saved_env" "$ENV_FILE"
  else
    printf '请输入完整店铺链接（支持 http:// 或 https://）：'; IFS= read -r shop_url < /dev/tty; validate_shop_url "$shop_url" || { printf '错误：店铺链接格式无效。\n' >&2; return; }
    printf '请输入运行端口 [3000]：'; IFS= read -r port < /dev/tty; port=${port:-3000}; validate_port "$port" || { printf '错误：端口无效。\n' >&2; return; }
    umask 077; printf 'SHOP_URL=%s\nPORT=%s\nVERIFY_SSL=false\nCACHE_TTL=60\n' "$shop_url" "$port" > "$ENV_FILE"
  fi
  port=$(get_env PORT); open_port "$port"
  docker compose --project-directory "$INSTALL_DIR" up -d --build
  apply_domain_conf
  rm -rf "$archive" "$extract_root" "$saved_env"
  printf '安装/升级完成。\n'
}
uninstall_program() {
  # 先移除域名反代配置
  if [[ -f "$DOMAINS_FILE" ]] && [[ -s "$DOMAINS_FILE" ]]; then
    while IFS='|' read -r domain _ _; do
      [[ -z "$domain" || "$domain" == \#* ]] && continue
      if is_bt_panel; then
        rm -f "/www/server/panel/vhost/nginx/${domain}.conf" "/www/server/panel/vhost/cert/${domain}/" 2>/dev/null || true
      else
        rm -f "$INSTALL_DIR/nginx/vhost/${domain}.conf" 2>/dev/null || true
      fi
    done < "$DOMAINS_FILE"
  fi
  if [[ -f "$INSTALL_DIR/compose.yaml" ]]; then docker compose --project-directory "$INSTALL_DIR" down --remove-orphans || true; fi
  rm -rf "$INSTALL_DIR"
  reload_nginx
  printf '程序已卸载，shop-pro 菜单已保留。\n'
}
add_domain() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local domain port
  port=$(get_env PORT); [[ -n "$port" ]] || port="3000"
  printf '当前已绑定的域名：\n'; list_domains
  printf '\n请输入要绑定的域名（多个用空格分隔，例如 vip.example.com api.example.com）：'; IFS= read -r domain < /dev/tty
  [[ -n "$domain" ]] || return
  mkdir -p "$INSTALL_DIR/nginx/certs"; mkdir -p "$INSTALL_DIR/nginx/vhost"
  for d in $domain; do
    validate_domain "$d" || { printf '错误：域名 %s 格式无效，跳过。\n' "$d" >&2; continue; }
    if get_domain_record "$d" | grep -q .; then printf '域名 %s 已存在，跳过。\n' "$d"; continue; fi
    set_domain_record "$d" "" ""
    printf '已添加：%s（SSL 未配置，仅 80 端口）\n' "$d"
  done
  apply_domain_conf
  printf '域名绑定已生效。如需 SSL，请选择菜单 7。\n'
}
remove_domain() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local domain cert_file key_file cert_dir
  printf '当前已绑定的域名：\n'; list_domains
  printf '\n请输入要移除的域名：'; IFS= read -r domain < /dev/tty
  [[ -n "$domain" ]] || return
  local record
  record=$(get_domain_record "$domain")
  if [[ -z "$record" ]]; then printf '域名 %s 未绑定。\n' "$domain"; return; fi
  cert_file=$(echo "$record" | cut -d'|' -f2)
  key_file=$(echo "$record" | cut -d'|' -f3)
  # 删除反代配置文件
  if is_bt_panel; then
    rm -f "/www/server/panel/vhost/nginx/${domain}.conf" 2>/dev/null || true
    cert_dir="/www/server/panel/vhost/cert/${domain}"
  else
    rm -f "$INSTALL_DIR/nginx/vhost/${domain}.conf" 2>/dev/null || true
    cert_dir="$INSTALL_DIR/nginx/certs"
  fi
  [[ -n "$cert_file" && -f "${cert_dir}/${cert_file}" ]] && rm -f "${cert_dir}/${cert_file}"
  [[ -n "$key_file" && -f "${cert_dir}/${key_file}" ]] && rm -f "${cert_dir}/${key_file}"
  remove_domain_record "$domain"
  reload_nginx
  printf '域名 %s 已移除，反代配置和证书文件已清理。\n' "$domain"
}
add_ssl() {
  [[ -f "$ENV_FILE" ]] || { printf '程序尚未安装，请选择 3。\n'; return; }
  local domain cert_file key_file cert_content key_content cert_dir
  printf '请输入要配置 SSL 的域名：'; IFS= read -r domain < /dev/tty
  [[ -n "$domain" ]] || return
  if ! get_domain_record "$domain" | grep -q .; then printf '域名 %s 未绑定，请先选择菜单 5 添加。\n' "$domain"; return; fi
  cert_file="${domain}.pem"
  key_file="${domain}.key"
  printf '\n请粘贴证书内容（-----BEGIN CERTIFICATE----- 到 -----END CERTIFICATE-----），粘贴完成后直接回车：\n'
  IFS= read -r cert_content < /dev/tty
  if [[ -z "$cert_content" ]]; then cert_content=$(cat < /dev/tty); fi
  [[ -n "$cert_content" ]] || { printf '证书内容为空。\n' >&2; return; }
  printf '\n请粘贴私钥内容（-----BEGIN PRIVATE KEY----- 或 -----BEGIN RSA PRIVATE KEY----- 到 -----END PRIVATE KEY-----），粘贴完成后直接回车：\n'
  IFS= read -r key_content < /dev/tty
  if [[ -z "$key_content" ]]; then key_content=$(cat < /dev/tty); fi
  [[ -n "$key_content" ]] || { printf '私钥内容为空。\n' >&2; return; }
  # 写入证书到对应目录
  if is_bt_panel; then
    cert_dir="/www/server/panel/vhost/cert/${domain}"
  else
    cert_dir="$INSTALL_DIR/nginx/certs"
  fi
  mkdir -p "$cert_dir"
  printf '%s\n' "$cert_content" > "${cert_dir}/${cert_file}"
  printf '%s\n' "$key_content" > "${cert_dir}/${key_file}"
  chmod 600 "${cert_dir}/${cert_file}" "${cert_dir}/${key_file}"
  set_domain_record "$domain" "$cert_file" "$key_file"
  apply_domain_conf
  printf 'SSL 已配置完成。证书目录：%s\n' "$cert_dir"
  if is_bt_panel; then printf '提示：请在宝塔面板 - 网站 - %s - SSL 中确认/上传证书（面板可能会覆盖）。\n' "$domain"; fi
}
((EUID == 0)) || { printf '错误：请使用 root 用户运行 shop-pro。\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf '错误：未安装 Docker。\n' >&2; exit 1; }
while true; do
  printf '\nshop-pro 管理菜单\n1. 重置店铺链接\n2. 重置运行端口\n3. 安装/升级\n4. 卸载程序（不包括菜单文件）\n5. 添加绑定域名\n6. 移除绑定域名\n7. 给绑定域名添加 SSL 证书\n0. 退出菜单\n请选择：'
  IFS= read -r choice < /dev/tty
  case "$choice" in
    1) reset_shop_url;;
    2) reset_port;;
    3) install_or_upgrade;;
    4) uninstall_program;;
    5) add_domain;;
    6) remove_domain;;
    7) add_ssl;;
    0) exit 0;;
    *) printf '错误：请输入 0-7。\n' >&2;;
  esac
done
MENU
  sed -i "s|__SOURCE_URL__|$SOURCE_URL|g" "$COMMAND_PATH"
  chmod 0755 "$COMMAND_PATH"
}

main() {
  local shop_url port server_ip domain
  require_root
  command -v curl >/dev/null 2>&1 || fail "未安装 curl。"
  command -v tar >/dev/null 2>&1 || fail "未安装 tar。"
  command -v docker >/dev/null 2>&1 || fail "未安装 Docker。请先安装 Docker Engine 与 Compose 插件。"
  docker compose version >/dev/null 2>&1 || fail "缺少 docker compose 插件。"
  show_agreement
  printf '请输入完整店铺链接（支持 http:// 或 https://，示例 http://shop.example.com/shop/demo）：'; IFS= read -r shop_url < /dev/tty
  validate_shop_url "$shop_url" || fail "店铺链接格式无效。"
  printf '请输入运行端口 [3000]：'; IFS= read -r port < /dev/tty; port=${port:-3000}
  validate_port "$port" || fail "端口必须是 1-65535 的数字。"
  if port_in_use "$port"; then
    printf '警告：端口 %s 已被占用，Docker 将无法绑定此端口。请选择其他端口。\n' "$port"
    printf '请重新输入运行端口：'; IFS= read -r port < /dev/tty
    validate_port "$port" || fail "端口必须是 1-65535 的数字。"
  fi
  printf '请输入要绑定的域名（多个用空格分隔，留回车跳过）：'; IFS= read -r domain < /dev/tty
  install_source
  write_env "$shop_url" "$port"
  install_command
  mkdir -p "$INSTALL_DIR/nginx/certs"; mkdir -p "$INSTALL_DIR/nginx/vhost"
  # 初始化 domains.conf 并生成反代配置
  : > "$DOMAINS_FILE"
  if [[ -n "$domain" ]]; then
    for d in $domain; do
      if validate_domain "$d"; then printf '%s||\n' "$d" >> "$DOMAINS_FILE"; else printf '提示：域名 %s 格式无效，已跳过。\n' "$d"; fi
    done
  fi
  open_port "$port"
  docker compose --project-directory "$INSTALL_DIR" up -d --build
  # 应用域名反代配置
  if [[ -s "$DOMAINS_FILE" ]]; then
    # 复用 MENU 里的 apply_domain_conf 函数，直接在主脚本里做
    local cert_dir conf_path _d _cf _kf
    while IFS='|' read -r _d _cf _kf; do
      [[ -z "$_d" || "$_d" == \#* ]] && continue
      if is_bt_panel; then
        conf_path="/www/server/panel/vhost/nginx/${_d}.conf"; cert_dir="/www/server/panel/vhost/cert/${_d}"; mkdir -p "$cert_dir"
      else
        conf_path="$INSTALL_DIR/nginx/vhost/${_d}.conf"; cert_dir="$INSTALL_DIR/nginx/certs"; mkdir -p "$INSTALL_DIR/nginx/vhost"
      fi
      build_proxy_block "$_d" "127.0.0.1" "$port" "$_cf" "$_kf" "$cert_dir" > "$conf_path"
      printf '  反代配置已写入：%s\n' "$conf_path"
    done < "$DOMAINS_FILE"
    reload_nginx
  fi
  server_ip=$(detect_server_ip)
  printf '\n安装完成！\n'
  printf '  直接访问：http://%s:%s/\n' "$server_ip" "$port"
  if [[ -s "$DOMAINS_FILE" ]]; then
    printf '  域名访问：\n'
    while IFS='|' read -r _d _ _; do
      [[ -n "$_d" && "$_d" != \#* ]] && printf '    http://%s/\n' "$_d"
    done < "$DOMAINS_FILE"
    if is_bt_panel; then
      printf '\n  反代配置已写入宝塔 vhost：/www/server/panel/vhost/nginx/\n'
      printf '  如需 SSL 证书，运行 shop-pro 选 7，或在宝塔面板 - 网站里手动添加。\n'
    else
      printf '\n  如需 SSL 证书，请运行 shop-pro 选 7。\n'
    fi
  fi
  printf '终端管理命令：shop-pro\n'
}
main "$@"
