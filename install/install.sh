#!/usr/bin/env bash
# AstrologyStudio ·
# install/install.sh
#
# AstrologyStudio installer:
#
# https://getstudioapps.com · https://github.com/studioappsorg/astrology_studio
#
#   curl -fsSL https://astro.getstudioapps.com | sudo bash
#
# On a fresh Ubuntu or Debian server, this:
#   1. installs Docker (if it isn't there),
#   2. checks your domain points at this server,
#   3. sets up the server's shared Caddy (the `studioapps` command), which every Studio app
#      on the server uses, and which gets and renews the HTTPS certificates,
#   4. sets up AstrologyStudio behind it,
#   5. adds a `astrologystudio` command for updates, backups and logs, and a daily backup.
#
# Running it again is safe: it keeps your data and settings and updates the setup. An install
# from before 1.22.0, which ran its own Caddy, is moved onto the shared Caddy with its certificate.
#
# Options (all optional; you're asked for anything missing):
#   --domain astro.example.com  the address AstrologyStudio will live at
#   --ephemeral URL             the ephemeralREST address (can be set later in Settings)
#   --email you@example.com     for certificate expiry notices from Let's Encrypt
#   --dir DIR                   where it's installed (default /opt/studioapps/astrologystudio;
#                               an install from before 1.22.0 stays in /opt/astrologystudio)
#   --image IMAGE               the AstrologyStudio container image to run
#   --caddy-extra FILE          extra lines for its site in the shared Caddy, e.g. a tls block
#   --edge-script FILE          use this copy of the shared Caddy's script (it's still checked)
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
  echo "  curl -fsSL https://astro.getstudioapps.com | sudo bash" >&2
  exit 1
fi

set -Eeuo pipefail
# Never stop silently: say where it went wrong.
trap 'printf "\nError: the installer stopped unexpectedly (line %s). Please report this, with the output above.\n" "$LINENO" >&2' ERR

# Until 1.0 the newest release; from 1.0, the major version (`:1`), so a future 2.0
# with breaking changes never arrives through `astrologystudio update` by surprise.
# Built and published to GitHub's registry by .github/workflows/release.yml on each vX.Y.Z tag.
DEFAULT_IMAGE="ghcr.io/studioappsorg/astrologystudio:latest"
# Installs before 1.21.6 pulled from the build server's registry: moved to GitHub's, same tag.
OLD_REGISTRY="registry.getstudioapps.com/astrologystudio"
DEFAULT_DIR="/opt/studioapps/astrologystudio"
OLD_DEFAULT_DIR="/opt/astrologystudio"  # installs before 1.22.0 live here, and stay here
APP_UID=10001  # the container's astrologystudio user

# The server's shared Caddy (github.com/studioappsorg/studio-edge), installed as the
# `studioapps` command. This is the version this release was tested with: never a newer one
# by surprise, and never one whose SHA-256 doesn't match.
EDGE_VERSION="0.1.0"
EDGE_SHA256="e52391e30d05f40ff1c0c42074e36c4658f9892d0be76277d058d7a6cb066bef"
EDGE_URL="https://getstudioapps.com/edge/edge-${EDGE_VERSION}.sh"
STUDIOAPPS=/usr/local/bin/studioapps
EDGE_DIR="${STUDIOAPPS_EDGE_DIR:-/opt/studioapps/edge}"
EDGE_CONTAINER="studioapps-edge"
EDGE_IP="172.31.250.2"   # fixed by studio-edge; the app trusts forwarded addresses from here only
SITE="astrologystudio"   # this app's site name in the shared Caddy, and its network alias prefix

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

usage() { sed -n '5,33p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; }

edge_running() {
  command -v docker >/dev/null 2>&1 &&
    [ "$(docker inspect -f '{{.State.Running}}' "$EDGE_CONTAINER" 2>/dev/null || true)" = "true" ]
}

# ---------------------------------------------------------------------------

parse_args() {
  DOMAIN=""; ACME_EMAIL=""; DIR=""; IMAGE=""; EPHEMERAL=""; HOSTED=""; CADDY_EXTRA=""; EDGE_SCRIPT=""
  YES=0; DRY_RUN=0; SKIP_DNS=0
  while [ $# -gt 0 ]; do
    case $1 in
      --domain) DOMAIN=${2:-}; shift 2 ;;
      --email) ACME_EMAIL=${2:-}; shift 2 ;;
      --dir) DIR=${2:-}; shift 2 ;;
      --image) IMAGE=${2:-}; shift 2 ;;
      --ephemeral) EPHEMERAL=${2:-}; shift 2 ;;
      --caddy-extra) CADDY_EXTRA=${2:-}; shift 2 ;;
      --edge-script) EDGE_SCRIPT=${2:-}; shift 2 ;;
      --yes|-y) YES=1; shift ;;
      --skip-dns-check) SKIP_DNS=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
  done
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's|^https\{0,1\}://||; s|/.*$||')
  # An install from before 1.22.0 stays where it is; new installs go beside the shared Caddy.
  if [ -z "$DIR" ]; then
    if [ -f "$OLD_DEFAULT_DIR/.env" ]; then DIR=$OLD_DEFAULT_DIR; else DIR=$DEFAULT_DIR; fi
  fi
  if [ -n "$CADDY_EXTRA" ]; then
    [ -f "$CADDY_EXTRA" ] || die "--caddy-extra: there's no file at $CADDY_EXTRA"
    CADDY_EXTRA=$(cd "$(dirname "$CADDY_EXTRA")" && printf '%s/%s' "$PWD" "$(basename "$CADDY_EXTRA")")
  fi
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
  # Before 1.22.0 each install ran its own Caddy (a `caddy` service in its compose.yml).
  OWN_CADDY=0
  if [ "$EXISTING" -eq 1 ] && [ -f "$DIR/compose.yml" ] && grep -q '^  caddy:' "$DIR/compose.yml"; then
    OWN_CADDY=1
  fi
  case $IMAGE in "$OLD_REGISTRY":*) IMAGE="${DEFAULT_IMAGE%:*}:${IMAGE##*:}" ;; esac
  [ -n "$IMAGE" ] || IMAGE=$DEFAULT_IMAGE
}

check_system() {
  step "Checking this server"
  [ "$(uname -s)" = "Linux" ] || die "AstrologyStudio installs on Linux servers."
  if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
    die "Run it as root: curl -fsSL https://astro.getstudioapps.com | sudo bash"
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

# Ports 80 and 443 belong to the server's shared Caddy, which every Studio app uses. Before
# anything is installed, check nothing else holds them. Our own Caddy from before 1.22.0 is
# fine: it's moved onto the shared Caddy below. The shared Caddy repeats this check itself.
check_ports() {
  [ "$DRY_RUN" -eq 1 ] && return
  edge_running && return
  local busy="" others="" name project dir
  # A web server running directly on this server.
  if command -v ss >/dev/null 2>&1; then
    busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
  fi
  # Or another app's container, such as another Studio app's own Caddy from before the shared one.
  if command -v docker >/dev/null 2>&1; then
    others=$(for port in 80 443; do
        docker ps --filter "publish=$port" \
          --format '{{.Names}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null
      done | sort -u || true)
  fi
  local problem=0 studio_apps=" mailstudio ledgerstudio formstudio bookingstudio astrologystudio "
  if [ -n "$busy" ]; then
    warn "Something else is using port 80 or 443 on this server:"
    printf '%s\n' "$busy" >&2
    problem=1
  fi
  while IFS='|' read -r name project dir; do
    [ -n "$name" ] || continue
    [ "$dir" = "$DIR" ] && continue
    case $studio_apps in
      *" $project "*)
        warn "$project's own Caddy ($name, in ${dir:-?}) is using ports 80 and 443."
        say "Update $project with its newest installer first: that moves it onto the shared Caddy." ;;
      *)
        warn "The container $name (${dir:-not from docker compose}) is using ports 80 and 443." ;;
    esac
    problem=1
  done <<< "$others"
  if [ "$problem" -eq 1 ]; then
    say "Studio apps share ports 80 and 443 through one Caddy, so nothing else can hold them."
    die "Nothing has been changed. Stop what's using the ports (or update that app), then run this again."
  fi
}

# ---------------------------------------------------------------------------
# Files

write_env() {
  cat > "$DIR/.env" <<EOF
# AstrologyStudio settings, read by docker compose. Edit, then run: astrologystudio restart
# (to change the domain, run the installer again with --domain, so the shared Caddy follows)
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
  cat > "$DIR/compose.yml" <<EOF
# Written by the AstrologyStudio installer; re-running it replaces this file.
# Your settings are in .env; your data is in ./data. The server's shared Caddy (studioapps)
# serves it, using the site file astrologystudio.caddy beside this one.
name: astrologystudio

services:
  app:
    image: \${ASTROLOGYSTUDIO_IMAGE}
    restart: unless-stopped
    environment:
      ASTROLOGYSTUDIO_BASE_URL: https://\${ASTROLOGYSTUDIO_DOMAIN}
      ASTROLOGYSTUDIO_EPHEMERAL_URL: \${ASTROLOGYSTUDIO_EPHEMERAL_URL:-}
      ASTROLOGYSTUDIO_HOSTED: \${ASTROLOGYSTUDIO_HOSTED:-}
      # Forwarded client addresses are trusted from the shared Caddy only. Other apps'
      # containers share its network, and could otherwise claim to be any address.
      ASTROLOGYSTUDIO_TRUSTED_PROXIES: "$EDGE_IP"
    volumes:
      - ./data:/data
    networks:
      default: {}
      studioapps:
        aliases: [$SITE-app]
    logging:
      driver: local
      options:
        max-size: 10m

networks:
  # Created by the shared Caddy. Only this service joins it.
  studioapps:
    external: true
EOF
}

# The site file this installer adds to the shared Caddy. Extra lines (--caddy-extra) are kept in
# site-extra.caddy, so a re-run keeps them.
write_site() {
  if [ -n "$CADDY_EXTRA" ] && [ "$CADDY_EXTRA" != "$DIR/site-extra.caddy" ]; then
    cp "$CADDY_EXTRA" "$DIR/site-extra.caddy"
  fi
  {
    printf '# Written by the AstrologyStudio installer (%s); re-running it replaces this file.\n' "$DIR"
    printf '# The shared Caddy serves it: studioapps site add %s --file <this file>\n' "$SITE"
    printf '%s {\n' "$DOMAIN"
    printf '\timport studio %s\n' "$SITE"
    printf '\trequest_body {\n\t\tmax_size 5MB\n\t}\n'
    if [ -f "$DIR/site-extra.caddy" ]; then
      sed -e '/^[[:space:]]*$/d' -e 's/^/\t/' "$DIR/site-extra.caddy"
    fi
    printf '\treverse_proxy %s-app:8080\n' "$SITE"
    printf '}\n'
  } > "$DIR/$SITE.caddy"
}

write_files() {
  step "Writing the setup to $DIR"
  mkdir -p "$DIR/data" "$DIR/backups"
  write_env
  write_compose
  write_site
  if [ "$DRY_RUN" -eq 0 ]; then chown -R "$APP_UID:$APP_UID" "$DIR/data"; fi
  chmod 700 "$DIR/backups"
  ok "compose.yml, $SITE.caddy and .env"
}

# ---------------------------------------------------------------------------
# The shared Caddy

# Keep an installed `studioapps` if it's this version or newer: another app may have put it there.
edge_current() {
  [ -x "$STUDIOAPPS" ] || return 1
  local have
  have=$("$STUDIOAPPS" version 2>/dev/null || true)
  [ -n "$have" ] && [ "$(printf '%s\n%s\n' "$EDGE_VERSION" "$have" | sort -V | head -n 1)" = "$EDGE_VERSION" ]
}

install_edge() {
  step "The shared Caddy"
  if edge_current; then
    ok "The studioapps command is installed ($("$STUDIOAPPS" version))"
    return
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "${dim}(dry run: would install ${EDGE_SCRIPT:-$EDGE_URL} as $STUDIOAPPS)${reset}"
    return
  fi
  local fetched
  fetched=$(mktemp)
  if [ -n "$EDGE_SCRIPT" ]; then
    cp "$EDGE_SCRIPT" "$fetched"
  elif ! curl -fsSL --max-time 30 "$EDGE_URL" -o "$fetched"; then
    rm -f "$fetched"
    die "Couldn't download the shared Caddy's script from $EDGE_URL"
  fi
  if ! printf '%s  %s\n' "$EDGE_SHA256" "$fetched" | sha256sum -c --quiet - >/dev/null 2>&1; then
    rm -f "$fetched"
    die "The shared Caddy's script doesn't match the one this installer was tested with, so it wasn't used."
  fi
  install -m 0755 "$fetched" "$STUDIOAPPS"
  rm -f "$fetched"
  ok "Installed the studioapps command ($EDGE_VERSION)"
}

# Start the shared Caddy, or update its files. It keeps an email it already has: Let's Encrypt
# notices are for the whole server, and another app may have set one.
ensure_edge() {
  local args=()
  if [ -n "$ACME_EMAIL" ] && ! grep -qs '^ACME_EMAIL=.' "$EDGE_DIR/.env"; then
    args=(--email "$ACME_EMAIL")
  fi
  "$STUDIOAPPS" edge ensure "${args[@]}"
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
  logs                       Follow AstrologyStudio's log (Ctrl+C to stop).
  logs caddy                 Follow the server's shared Caddy's log (certificates, errors).
  update                     Get the latest version and restart. Your data is backed up first.
  backup [--keep N]          Back up the database and secret key to $ASTROLOGYSTUDIO_DIR/backups.
  restore FILE               Replace everything with a backup (asks first).
  restart | stop | start
  reset-password EMAIL       Set a new password for someone who's locked out.
  version

The shared Caddy, which every Studio app on this server uses, has its own command:
studioapps sites | edge status | edge logs astrologystudio
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
  logs)
    if [ "${2:-}" = "caddy" ]; then docker logs -f --tail 200 studioapps-edge
    else compose logs -f --tail 200 app
    fi ;;
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

# Start the app, then give the shared Caddy its site. Returns non-zero (after saying why) if either
# fails, so a move from the old setup can put that back.
start() {
  step "Starting AstrologyStudio"
  if [ "$DRY_RUN" -eq 1 ]; then say "${dim}(dry run: would run docker compose pull and up, then studioapps site add)${reset}"; return; fi
  if ! (cd "$DIR" && docker compose pull --quiet --ignore-pull-failures && docker compose up -d --remove-orphans); then
    warn "Starting AstrologyStudio failed. See: cd $DIR && docker compose logs"
    return 1
  fi
  if ! "$STUDIOAPPS" site add "$SITE" --file "$DIR/$SITE.caddy"; then
    warn "The shared Caddy refused AstrologyStudio's site file ($DIR/$SITE.caddy). Its message is above."
    return 1
  fi
}

# Before 1.22.0 AstrologyStudio ran its own Caddy. Move it onto the shared Caddy, bringing its
# certificate (so Let's Encrypt isn't asked again), and put everything back if a step fails.
move_to_shared_caddy() {
  step "Moving AstrologyStudio onto the server's shared Caddy"
  if [ "$DRY_RUN" -eq 1 ]; then
    say "${dim}(dry run: would back up, stop its own Caddy, copy its certificates and start behind the shared Caddy)${reset}"
    write_files
    return
  fi
  local keep old certs edge_was_running=0
  keep="$DIR/backups/before-shared-caddy-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$keep"
  chmod 700 "$keep"
  cp -p "$DIR/compose.yml" "$DIR/.env" "$keep/"
  if [ -f "$DIR/Caddyfile" ]; then cp -p "$DIR/Caddyfile" "$keep/"; fi
  if edge_running; then edge_was_running=1; fi

  # The data first, while the app is still running with the command from the old installer.
  if [ -x /usr/local/bin/astrologystudio ] && /usr/local/bin/astrologystudio backup >/dev/null 2>&1; then
    ok "Backed up the data to $DIR/backups"
  else
    warn "Couldn't make a data backup first (is AstrologyStudio running?). Its data isn't touched by this move."
  fi

  # Its certificates and Caddy's account, from the old Caddy's storage.
  old=$(cd "$DIR" && docker compose ps -a -q caddy 2>/dev/null | head -n 1 || true)
  certs="$keep/caddy-data"
  if [ -n "$old" ] && docker cp "$old:/data/caddy" "$certs" >/dev/null 2>&1; then
    ok "Copied the certificates from AstrologyStudio's own Caddy"
  else
    certs=""
    warn "Couldn't copy the old Caddy's certificates: the shared Caddy will get a new one."
  fi

  # Free ports 80 and 443 for the shared Caddy.
  (cd "$DIR" && docker compose stop caddy >/dev/null 2>&1) || true

  if ! ensure_edge; then
    put_back "$keep" "$edge_was_running" "The shared Caddy didn't start."
  fi
  # Into the shared Caddy's storage, never replacing anything it already has.
  if [ -n "$certs" ]; then
    mkdir -p "$EDGE_DIR/data/caddy"
    tar -C "$certs" -cf - . | tar -C "$EDGE_DIR/data/caddy" --skip-old-files -xf -
  fi

  write_files
  if ! start; then
    put_back "$keep" "$edge_was_running" "AstrologyStudio didn't start behind the shared Caddy."
  fi
  rm -f "$DIR/Caddyfile"
  ok "Moved onto the shared Caddy. The old setup is kept in $keep"
  MOVED_FROM_OWN_CADDY=1
}

# Undo a move that failed part-way: AstrologyStudio runs with its own Caddy again, as before.
put_back() {
  local keep=$1 edge_was_running=$2 why=$3
  warn "$why Putting the old setup back..."
  if edge_running; then
    "$STUDIOAPPS" site remove "$SITE" >/dev/null 2>&1 || true
    if [ "$edge_was_running" -eq 0 ] && ! ls "$EDGE_DIR"/sites/*.caddy >/dev/null 2>&1; then
      docker stop "$EDGE_CONTAINER" >/dev/null 2>&1 || true   # it started for us alone; free the ports
    fi
  fi
  cp -p "$keep/compose.yml" "$keep/.env" "$DIR/"
  if [ -f "$keep/Caddyfile" ]; then cp -p "$keep/Caddyfile" "$DIR/"; fi
  rm -f "$DIR/$SITE.caddy"
  if [ "$edge_was_running" -eq 0 ] && (cd "$DIR" && docker compose up -d --remove-orphans >/dev/null 2>&1); then
    die "AstrologyStudio is running as it was before, with its own Caddy. The problem is described above."
  fi
  die "Couldn't put AstrologyStudio's own Caddy back. Its old files are in $DIR again, and copies are in $keep.
Fix the problem described above, then run the installer again."
}

wait_until_answering() {
  [ "$DRY_RUN" -eq 1 ] && return
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
  say "Then see what the shared Caddy says: astrologystudio logs caddy"
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
  say "  Shared Caddy:     studioapps sites   (other Studio apps can share this server)"
  if [ "$MOVED_FROM_OWN_CADDY" -eq 1 ]; then
    say ""
    say "  The old Caddy's storage is kept until you're happy. To remove it:"
    say "    docker volume rm astrologystudio_caddy_data astrologystudio_caddy_config"
  fi
  say ""
}

main() {
  MOVED_FROM_OWN_CADDY=0
  parse_args "$@"
  load_existing
  printf '%sAstrologyStudio installer%s\n' "$bold" "$reset"
  check_system
  check_internet
  choose_domain
  check_ports
  install_docker
  check_dns
  install_edge
  if [ "$OWN_CADDY" -eq 1 ]; then
    move_to_shared_caddy
  else
    if [ "$DRY_RUN" -eq 0 ]; then
      step "Starting the shared Caddy"
      ensure_edge || die "The shared Caddy didn't start. Its message is above."
    fi
    write_files
    start || die "Nothing else on the server was changed. Fix the problem above, then run the installer again."
  fi
  install_command
  wait_until_answering
  finish
}

main "$@"
