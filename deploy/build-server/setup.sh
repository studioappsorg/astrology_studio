#!/usr/bin/env bash
# AstrologyStudio ·
# deploy/build-server/setup.sh
#
# One-time setup of the build server:
#
# an Ubuntu server that builds the AstrologyStudio image and keeps it in its own registry, where
# every install pulls it from.
#
#   sudo bash setup.sh --domain registry.getstudioapps.com --git https://github.com/studioappsorg/astrology_studio.git
#
# It:
#   1. installs Docker and git (if they aren't there),
#   2. runs a container registry with Caddy in front of it for HTTPS. The registry is read-only
#      from outside (anyone can pull, nobody can push); this server pushes to it directly on
#      127.0.0.1:5000, so there are no push passwords to manage,
#   3. clones the code, and installs the `studio-build` command (build-release.sh),
#   4. with --watch, checks for new release tags every 10 minutes and builds them.
#
# Point the registry's domain at this server first (an A record; in Cloudflare, "DNS only" so
# Caddy can get its certificate and large downloads go straight to the server).
#
# Options:
#   --domain NAME   the registry's address, e.g. registry.getstudioapps.com (required)
#   --email EMAIL   for Let's Encrypt certificate notices
#   --git URL       where to clone the code from (default below)
#   --dir DIR       where the registry and the code live (default /opt/studio-build)
#   --watch         build new release tags (vX.Y.Z) automatically
#   --keep N        how many versions to keep in the registry (default 10)
#
# Copyright (c) 2026 Gavin Melhuish
# MIT License; see LICENSE in the project root.
# SPDX-License-Identifier: MIT

set -Eeuo pipefail
trap 'printf "\nError: setup stopped unexpectedly (line %s).\n" "$LINENO" >&2' ERR

DOMAIN=""; EMAIL=""; DIR="/opt/studio-build"; WATCH=0; KEEP=10
GIT_URL="https://github.com/studioappsorg/astrology_studio.git"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case $1 in
    --domain) DOMAIN=${2:-}; shift 2 ;;
    --email) EMAIL=${2:-}; shift 2 ;;
    --git) GIT_URL=${2:-}; shift 2 ;;
    --dir) DIR=${2:-}; shift 2 ;;
    --watch) WATCH=1; shift ;;
    --keep) KEEP=${2:-}; shift 2 ;;
    -h|--help) sed -n '5,29p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done
[ "$(id -u)" -eq 0 ] || die "Run it with sudo."
[ -n "$DOMAIN" ] || die "Give the registry's address with --domain."
case $KEEP in ''|*[!0-9]*) die "--keep needs a number." ;; esac

say "== Docker and git"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
command -v git >/dev/null 2>&1 || { apt-get update -q && apt-get install -yq git; }
command -v curl >/dev/null 2>&1 || apt-get install -yq curl

busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
[ -z "$busy" ] || die "Something else is using port 80 or 443 on this server:
$busy
Caddy needs them for the registry's certificate. Stop that service, or put the registry behind it."

say "== Registry at https://$DOMAIN"
mkdir -p "$DIR/registry"
cat > "$DIR/registry/compose.yml" <<'YML'
# The image registry. Read-only from outside through Caddy; this server pushes to 127.0.0.1:5000.
services:
  registry:
    image: registry:2
    restart: unless-stopped
    environment:
      REGISTRY_STORAGE_DELETE_ENABLED: "true"   # so old versions can be removed (studio-build prune)
    ports:
      - "127.0.0.1:5000:5000"
    volumes:
      - images:/var/lib/registry
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      REGISTRY_DOMAIN: ${REGISTRY_DOMAIN}
      ACME_EMAIL: ${ACME_EMAIL}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
volumes:
  images:
  caddy-data:
YML
cat > "$DIR/registry/Caddyfile" <<'CADDY'
{
	email {$ACME_EMAIL}
}

{$REGISTRY_DOMAIN} {
	# Pulling only: anything that would change the registry is refused here.
	@write not method GET HEAD
	respond @write "This registry is read-only." 405
	reverse_proxy registry:5000
}
CADDY
cat > "$DIR/registry/.env" <<ENV
REGISTRY_DOMAIN=$DOMAIN
ACME_EMAIL=${EMAIL:-admin@$DOMAIN}
ENV
docker compose --project-directory "$DIR/registry" up -d

say "== Code"
if [ ! -d "$DIR/src/.git" ]; then
  git clone "$GIT_URL" "$DIR/src" || die "Couldn't clone $GIT_URL.
For an SSH address, add this server's key (/root/.ssh/id_ed25519.pub, made with ssh-keygen -t ed25519)
to the repository as a read-only deploy key, then run setup again."
fi

say "== studio-build command"
install -m 755 "$(dirname "$0")/build-release.sh" /usr/local/bin/studio-build
cat > /etc/studio-build.conf <<CONF
# Read by studio-build. Edit as needed.
SRC_DIR=$DIR/src
REGISTRY_DOMAIN=$DOMAIN
IMAGE_NAME=astrologystudio
KEEP=$KEEP
CONF

if [ "$WATCH" -eq 1 ]; then
  say "== Building new release tags automatically"
  cat > /etc/systemd/system/studio-build.service <<'UNIT'
[Unit]
Description=Build new AstrologyStudio release tags
After=network-online.target docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/studio-build watch
UNIT
  cat > /etc/systemd/system/studio-build.timer <<'UNIT'
[Unit]
Description=Check for new AstrologyStudio release tags every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now studio-build.timer
fi

say ""
say "Done. Build and publish the current code with:  studio-build release"
say "Installs pull:  $DOMAIN/astrologystudio:latest"
