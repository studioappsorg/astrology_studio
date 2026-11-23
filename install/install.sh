#!/usr/bin/env bash
# AstrologyStudio ·
# install/install.sh
#
# AstrologyStudio installer:
#
# https://getstudioapps.com
#
#   curl -fsSL https://get.getstudioapps.com/astrologystudio | sudo bash
#
# On a fresh Ubuntu or Debian server, this:
#   1. installs Docker (if it isn't there),
#   2. checks your domain points at this server,
#   3. sets up AstrologyStudio with Caddy, which gets and renews the HTTPS certificate,
#   4. adds a `astrologystudio` command for updates, backups and logs, and a daily backup.
#
# Running it again is safe: it keeps your data and settings and updates the setup.
#
# Options (all optional; you're asked for anything missing):
#   --domain astro.example.com  the address AstrologyStudio will live at
#   --ephemeral URL             the ephemeralREST address (can be set later in Settings)
#   --email you@example.com     for certificate expiry notices from Let's Encrypt
#   --dir /opt/astrologystudio  where it's installed
#   --image IMAGE               the AstrologyStudio container image to run
#   --yes                       don't ask questions (needs --domain)
#   --skip-dns-check            don't check the domain points here
#   --dry-run                   write the files, but don't install or start anything
#
# Copyright (c) 2026 Gavin Melhuish
# MIT License; see LICENSE in the project root.
# SPDX-License-Identifier: MIT

# Plain `sh` (dash on Ubuntu) can't run this script. Say so before it trips over Bash syntax.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "AstrologyStudio's installer needs bash. Run it like this:" >&2
  echo "  curl -fsSL https://get.getstudioapps.com/astrologystudio | sudo bash" >&2
  exit 1
fi

set -Eeuo pipefail
# Never stop silently: say where it went wrong.
trap 'printf "\nError: the installer stopped unexpectedly (line %s). Please report this, with the output above.\n" "$LINENO" >&2' ERR

# Until 1.0 the newest release; from 1.0, the major version (`:1`), so a future 2.0
# with breaking changes never arrives through `astrologystudio update` by surprise.
# Built and published by the build server (deploy/build-server); change here if its address changes.
DEFAULT_IMAGE="registry.getstudioapps.com/astrologystudio:latest"
DEFAULT_DIR="/opt/astrologystudio"
APP_UID=10001  # the container's astrologystudio user

# Everything runs from main(), at the very end, so a half-downloaded script does nothing.

bold=""; dim=""; red=""; green=""; reset=""
if [ -t 1 ]; then
  bold=$'\e[1m'; dim=$'\e[2m'; red=$'\e[31m'; green=$'\e[32m'; reset=$'\e[0m'
fi

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$red" "$reset" "$*" >&2; }
die()  { printf '\n%sError:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

# Questions read from the terminal, because stdin is this script when piped from curl.
has_tty() { [ -r /dev/tty ] && [ -w /dev/tty ] && { : < /dev/tty; } 2>/dev/null; }
ask() {
  local prompt=$1 default=${2:-} answer
  if [ -n "$default" ]; then prompt="$prompt [$default]"; fi
  printf '%s: ' "$prompt" > /dev/tty
  IFS= read -r answer < /dev/tty || answer=""
  printf '%s' "${answer:-$default}"
}

valid_domain() {
  [[ $1 =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]
}

usage() { sed -n '5,27p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------

parse_args() {
  DOMAIN=""; ACME_EMAIL=""; DIR="$DEFAULT_DIR"; IMAGE=""; EPHEMERAL=""; HOSTED=""; YES=0; DRY_RUN=0; SKIP_DNS=0
  while [ $# -gt 0 ]; do
    case $1 in
      --domain) DOMAIN=${2:-}; shift 2 ;;
      --email) ACME_EMAIL=${2:-}; shift 2 ;;
      --dir) DIR=${2:-}; shift 2 ;;
      --image) IMAGE=${2:-}; shift 2 ;;
      --ephemeral) EPHEMERAL=${2:-}; shift 2 ;;
      --yes|-y) YES=1; shift ;;
      --skip-dns-check) SKIP_DNS=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
  done
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's|^https\{0,1\}://||; s|/.*$||')
}

load_existing() {
  # Re-running: keep what was chosen last time unless told otherwise.
  if [ -f "$DIR/.env" ]; then
    local key value
    while IFS='=' read -r key value; do
      case $key in
        ASTROLOGYSTUDIO_DOMAIN) [ -n "$DOMAIN" ] || DOMAIN=$value ;;
        ACME_EMAIL) [ -n "$ACME_EMAIL" ] || ACME_EMAIL=$value ;;
        ASTROLOGYSTUDIO_IMAGE) [ -n "$IMAGE" ] || IMAGE=$value ;;
        ASTROLOGYSTUDIO_EPHEMERAL_URL) [ -n "$EPHEMERAL" ] || EPHEMERAL=$value ;;
        ASTROLOGYSTUDIO_HOSTED) [ -n "$HOSTED" ] || HOSTED=$value ;;
      esac
    done < "$DIR/.env"
    EXISTING=1
  else
    EXISTING=0
  fi
  [ -n "$IMAGE" ] || IMAGE=$DEFAULT_IMAGE
}

check_system() {
  step "Checking this server"
  [ "$(uname -s)" = "Linux" ] || die "AstrologyStudio installs on Linux servers."
  if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
    die "Run it as root: curl -fsSL https://get.getstudioapps.com/astrologystudio | sudo bash"
  fi
  case $(uname -m) in
    x86_64|amd64|aarch64|arm64) ;;
    *) die "This processor ($(uname -m)) isn't supported. Use a 64-bit Intel/AMD or ARM server." ;;
  esac
  local memory_mb disk_mb
  memory_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "$memory_mb" -gt 0 ] && [ "$memory_mb" -lt 900 ]; then
    warn "This server has ${memory_mb} MB of memory. 1 GB or more is recommended."
  fi
  local probe=$DIR  # the nearest folder that exists: on some servers even /opt doesn't yet
  while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
  disk_mb=$(df -Pm "$probe" 2>/dev/null | awk 'NR==2 {print $4}' || true)
  if [ -n "$disk_mb" ] && [ "$disk_mb" -lt 2048 ]; then
    warn "Only ${disk_mb} MB of disk space is free. 2 GB or more is recommended."
  fi
  # shellcheck disable=SC1091
  ok "$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-Linux}"), $(uname -m), ${memory_mb} MB memory"
}

# Catch servers that can't reach the internet, or have no public IPv4 address, before
# anything else: otherwise they fail later with confusing download or certificate errors.
check_internet() {
  local problem=""
  if command -v ip >/dev/null 2>&1 && ! ip -4 route show default 2>/dev/null | grep -q .; then
    problem="This server has no public IPv4 address (it has no IPv4 route to the internet).
AstrologyStudio needs one: your domain's A record points to it, and it's how the server downloads
Docker and AstrologyStudio. In your hosting provider's dashboard, make sure the server has a public
IPv4 address (some providers offer IPv6-only or private-network-only servers). Then restart the
server and run the installer again."
  elif command -v curl >/dev/null 2>&1 && ! curl -4 -fsS --max-time 15 -o /dev/null https://get.docker.com 2>/dev/null; then
    problem="This server can't reach the internet: https://get.docker.com didn't answer.
Check its network and firewall settings in your hosting provider's dashboard (outgoing
connections must be allowed), then run the installer again."
  fi
  [ -z "$problem" ] && return
  if [ "$DRY_RUN" -eq 1 ]; then warn "(dry run) $problem"; return; fi
  die "$problem"
}

choose_domain() {
  step "Your AstrologyStudio address"
  if [ -z "$DOMAIN" ]; then
    if [ "$YES" -eq 1 ] || ! has_tty; then die "Give the address with --domain, e.g. --domain astro.yourname.com"; fi
    say "AstrologyStudio needs its own address, like ${bold}astro.yourname.com${reset}."
    say "In your domain's DNS settings, add an ${bold}A record${reset} for it pointing to this server's IP address."
    while :; do
      DOMAIN=$(ask "Address" | tr '[:upper:]' '[:lower:]' | sed 's|^https\{0,1\}://||; s|/.*$||')
      valid_domain "$DOMAIN" && break
      warn "That doesn't look like a domain name. Try something like astro.yourname.com"
    done
  fi
  valid_domain "$DOMAIN" || die "\"$DOMAIN\" isn't a valid domain name."
  if [ -z "$ACME_EMAIL" ] && [ "$YES" -eq 0 ] && has_tty; then
    ACME_EMAIL=$(ask "Your email, for certificate notices (optional)" "")
  fi
  ok "https://$DOMAIN"
}

install_docker() {
  step "Docker"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    local version
    version=$(docker version --format '{{.Server.Version}}' 2>/dev/null) || version=""
    if [ -z "$version" ] && [ "$DRY_RUN" -eq 0 ]; then
      systemctl start docker >/dev/null 2>&1 || true
      version=$(docker version --format '{{.Server.Version}}' 2>/dev/null) || version=""
      [ -n "$version" ] || die "Docker is installed but isn't running. Try: systemctl start docker"
    fi
    ok "Docker ${version:+$version }is ready"
    return
  fi
  if [ "$DRY_RUN" -eq 1 ]; then say "${dim}(dry run: would install Docker from get.docker.com)${reset}"; return; fi
  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  say "Installing Docker (a minute or two)..."
  curl -fsSL https://get.docker.com | sh >/tmp/astrologystudio-docker-install.log 2>&1 \
    || die "Installing Docker failed. Details: /tmp/astrologystudio-docker-install.log"
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker installed, but 'docker compose' isn't available."
  ok "Docker installed"
}

public_ip() {
  curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null \
    || curl -4 -fsS --max-time 10 https://ifconfig.me 2>/dev/null \
    || true
}

resolved_ips() {
  getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u
}

check_dns() {
  step "Checking $DOMAIN points to this server"
  if [ "$SKIP_DNS" -eq 1 ] || [ "$DRY_RUN" -eq 1 ]; then say "${dim}(skipped)${reset}"; return; fi
  local ip found
  ip=$(public_ip)
  [ -n "$ip" ] || { warn "Couldn't find this server's public IP address; skipping the check."; return; }
  while :; do
    found=$(resolved_ips | tr '\n' ' ')
    if printf ' %s ' "$found" | grep -q " $ip "; then ok "$DOMAIN → $ip"; return; fi
    warn "$DOMAIN points to: ${found:-nothing yet}. It needs to point to this server: $ip"
    say "Add (or fix) an A record for $DOMAIN with the value ${bold}$ip${reset} at your domain's DNS provider."
    say "Changes usually show up within a few minutes, sometimes longer."
    if [ "$YES" -eq 1 ] || ! has_tty; then die "The domain doesn't point here yet. Run the installer again once it does."; fi
    ask "Press Enter to check again (or Ctrl+C to stop)" "" >/dev/null
  done
}

check_ports() {
  [ "$DRY_RUN" -eq 1 ] && return
  command -v ss >/dev/null 2>&1 || return
  local busy
  busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
  if [ -n "$busy" ]; then
    warn "Something else is using port 80 or 443:"
    printf '%s\n' "$busy" >&2
    die "Stop that web server (for example: systemctl disable --now nginx apache2), then run the installer again."
  fi
}

open_firewall() {
  [ "$DRY_RUN" -eq 1 ] && return
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null
    ok "Opened ports 80 and 443 in the firewall"
  fi
}

# ---------------------------------------------------------------------------
# Files

write_env() {
  cat > "$DIR/.env" <<EOF
# AstrologyStudio settings, read by docker compose. Edit, then run: astrologystudio restart
ASTROLOGYSTUDIO_DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
ASTROLOGYSTUDIO_IMAGE=$IMAGE
ASTROLOGYSTUDIO_EPHEMERAL_URL=$EPHEMERAL
# 1 for a hosted service: people who sign up never see ephemeralREST. Empty for your own install.
ASTROLOGYSTUDIO_HOSTED=$HOSTED
EOF
  chmod 600 "$DIR/.env"
}

write_compose() {
  cat > "$DIR/compose.yml" <<'EOF'
# Written by the AstrologyStudio installer; re-running it replaces this file.
# Your settings are in .env; your data is in ./data.
name: astrologystudio

services:
  app:
    image: ${ASTROLOGYSTUDIO_IMAGE}
    restart: unless-stopped
    environment:
      ASTROLOGYSTUDIO_BASE_URL: https://${ASTROLOGYSTUDIO_DOMAIN}
      ASTROLOGYSTUDIO_EPHEMERAL_URL: ${ASTROLOGYSTUDIO_EPHEMERAL_URL:-}
      ASTROLOGYSTUDIO_HOSTED: ${ASTROLOGYSTUDIO_HOSTED:-}
      # Only Caddy can reach the app, so its forwarded client addresses are trusted.
      ASTROLOGYSTUDIO_TRUSTED_PROXIES: "*"
    volumes:
      - ./data:/data
    logging:
      driver: local
      options:
        max-size: 10m

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      ASTROLOGYSTUDIO_DOMAIN: ${ASTROLOGYSTUDIO_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    logging:
      driver: local
      options:
        max-size: 10m

volumes:
  caddy_data:
  caddy_config:
EOF
}

write_caddyfile() {
  {
    printf '# Written by the AstrologyStudio installer. Caddy gets and renews the HTTPS certificate.\n'
    if [ -n "$ACME_EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"; fi
    cat <<'EOF'
{$ASTROLOGYSTUDIO_DOMAIN} {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	request_body {
		max_size 5MB
	}
	reverse_proxy app:8080
}
EOF
  } > "$DIR/Caddyfile"
}

write_files() {
  step "Writing the setup to $DIR"
  mkdir -p "$DIR/data" "$DIR/backups"
  write_env
  write_compose
  write_caddyfile
  if [ "$DRY_RUN" -eq 0 ]; then chown -R "$APP_UID:$APP_UID" "$DIR/data"; fi
  chmod 700 "$DIR/backups"
  ok "compose.yml, Caddyfile and .env"
}

install_command() {
  local bin=/usr/local/bin/astrologystudio cron=/etc/cron.daily/astrologystudio-backup
  if [ "$DRY_RUN" -eq 1 ]; then bin="$DIR/astrologystudio"; cron="$DIR/astrologystudio-backup.cron"; fi
  write_ctl > "$bin"
  chmod 755 "$bin"
  printf '#!/bin/sh\n# Daily AstrologyStudio backup, keeping two weeks.\n%s backup --keep 14 --quiet\n' "$bin" > "$cron"
  chmod 755 "$cron"
  ok "Added the 'astrologystudio' command and a daily backup"
}

# The `astrologystudio` command installed on the server.
write_ctl() {
  printf '#!/usr/bin/env bash\nASTROLOGYSTUDIO_DIR=%q\n' "$DIR"
  cat <<'EOF'
# Manage AstrologyStudio. Installed by the AstrologyStudio installer.
set -euo pipefail
cd "$ASTROLOGYSTUDIO_DIR"
compose() { docker compose --project-directory "$ASTROLOGYSTUDIO_DIR" "$@"; }
domain() { sed -n 's/^ASTROLOGYSTUDIO_DOMAIN=//p' .env; }

usage() {
  cat <<USAGE
Usage: astrologystudio COMMAND

  status                     Is it running? Shows the address and version.
  logs [app|caddy]           Follow the logs (Ctrl+C to stop).
  update                     Get the latest version and restart. Your data is backed up first.
  backup [--keep N]          Back up the database and secret key to $ASTROLOGYSTUDIO_DIR/backups.
  restore FILE               Replace everything with a backup (asks first).
  restart | stop | start
  reset-password EMAIL       Set a new password for someone who's locked out.
  version
USAGE
}

backup() {
  local keep=0 quiet=0 stamp file
  while [ $# -gt 0 ]; do
    case $1 in --keep) keep=$2; shift 2 ;; --quiet) quiet=1; shift ;; *) shift ;; esac
  done
  stamp=$(date +%Y-%m-%d-%H%M%S)
  compose exec -T app astrologystudio backup "/data/backups/snapshot-$stamp.db" >/dev/null
  file="backups/astrologystudio-$stamp.tar.gz"
  local parts=("backups/snapshot-$stamp.db")
  # The secret key decrypts everyone's stored ephemeralREST keys: it goes with the database.
  if [ -f data/secret.key ]; then parts+=(secret.key); fi
  tar -czf "$file" -C data "${parts[@]}"
  rm -f "data/backups/snapshot-$stamp.db"
  chmod 600 "$file"
  if [ "$keep" -gt 0 ]; then
    find backups -maxdepth 1 -name 'astrologystudio-*.tar.gz' | sort -r | tail -n +"$((keep + 1))" | xargs -r rm -f
  fi
  [ "$quiet" -eq 1 ] || echo "Backed up to $ASTROLOGYSTUDIO_DIR/$file"
}

restore() {
  local file=${1:-} work answer
  [ -f "$file" ] || { echo "Usage: astrologystudio restore backups/astrologystudio-....tar.gz" >&2; exit 1; }
  printf 'This replaces ALL current AstrologyStudio data with %s. A backup of the current data is made first.\nType "restore" to continue: ' "$file"
  read -r answer
  [ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }
  backup
  work=$(mktemp -d)
  tar -xzf "$file" -C "$work"
  compose stop app
  rm -f data/astrologystudio.db data/astrologystudio.db-wal data/astrologystudio.db-shm
  cp "$work"/backups/snapshot-*.db data/astrologystudio.db
  if [ -f "$work/secret.key" ]; then cp "$work/secret.key" data/secret.key && chmod 600 data/secret.key; fi
  chown -R 10001:10001 data
  rm -rf "$work"
  compose start app
  echo "Restored. Open https://$(domain)"
}

case ${1:-help} in
  status)
    compose ps
    printf '\nAddress: https://%s\n' "$(domain)"
    curl -fsS --max-time 5 "https://$(domain)/api/v1/health" && echo || echo "Not answering at https://$(domain) yet."
    ;;
  logs) shift; compose logs -f --tail 200 "$@" ;;
  update)
    backup
    compose pull --ignore-pull-failures  # an image built on this server has nothing to pull
    compose up -d --remove-orphans
    docker image prune -f >/dev/null
    echo "Updated. The database is migrated automatically on start."
    ;;
  backup) shift; backup "$@" ;;
  restore) shift; restore "$@" ;;
  restart) compose restart ;;
  stop) compose stop ;;
  start) compose up -d ;;
  reset-password) compose exec -T app astrologystudio reset-password --email "${2:?Usage: astrologystudio reset-password EMAIL}" ;;
  version) compose exec -T app python -c "import astrologystudio; print(astrologystudio.__version__)" ;;
  help|--help|-h) usage ;;
  *) usage; exit 1 ;;
esac
EOF
}

# ---------------------------------------------------------------------------

start() {
  step "Starting AstrologyStudio"
  if [ "$DRY_RUN" -eq 1 ]; then say "${dim}(dry run: would run docker compose pull and up)${reset}"; return; fi
  (cd "$DIR" && docker compose pull --quiet --ignore-pull-failures && docker compose up -d --remove-orphans) \
    || die "Starting failed. See: cd $DIR && docker compose logs"
  say "Waiting for the HTTPS certificate (usually under a minute)..."
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 5 "https://$DOMAIN/api/v1/health" >/dev/null 2>&1; then
      ok "Running at https://$DOMAIN"
      return
    fi
    sleep 3
    [ $((i % 10)) -eq 0 ] && say "${dim}still waiting...${reset}"
  done
  warn "AstrologyStudio started, but https://$DOMAIN isn't answering yet."
  say "Check the domain's A record, and that ports 80 and 443 are open in your provider's firewall."
  say "Then see what Caddy says: astrologystudio logs caddy"
}

finish() {
  printf '\n%sAstrologyStudio is installed.%s\n\n' "$bold" "$reset"
  if [ "$EXISTING" -eq 1 ]; then
    say "  Open ${bold}https://$DOMAIN${reset} and log in as usual."
  else
    say "  Open ${bold}https://$DOMAIN${reset} to create your account. Do it now:"
    say "  the first person to open it becomes the owner."
  fi
  say ""
  say "  Useful commands:  astrologystudio status | logs | update | backup"
  say "  Your data:        $DIR/data   (backed up daily to $DIR/backups)"
  say ""
}

main() {
  parse_args "$@"
  load_existing
  printf '%sAstrologyStudio installer%s\n' "$bold" "$reset"
  check_system
  check_internet
  choose_domain
  install_docker
  check_dns
  check_ports
  open_firewall
  write_files
  install_command
  start
  finish
}

main "$@"
