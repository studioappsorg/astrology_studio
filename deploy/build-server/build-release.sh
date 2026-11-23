#!/usr/bin/env bash
# AstrologyStudio ·
# deploy/build-server/build-release.sh
#
# studio-build:
#
# build the AstrologyStudio image on this server and publish it to its registry.
#
#   studio-build release [REF]   build REF (a branch, tag or commit; default: main) and publish it
#                                as :VERSION, :MAJOR.MINOR, :MAJOR and :latest
#   studio-build watch           build any release tag (vX.Y.Z) not yet in the registry (the timer)
#   studio-build list            the versions in the registry
#   studio-build prune           keep the newest KEEP versions, delete the rest and free the space
#
# Options for release:  --force (publish even if that version is already there)
#                       --no-latest (don't move :latest, e.g. for a test build)
#
# The version comes from server/astrologystudio/__init__.py, so bump it before releasing.
# Settings are in /etc/studio-build.conf (written by setup.sh).
#
# Copyright (c) 2026 Gavin Melhuish
# MIT License; see LICENSE in the project root.
# SPDX-License-Identifier: MIT

set -Eeuo pipefail
trap 'printf "\nError: studio-build stopped unexpectedly (line %s).\n" "$LINENO" >&2' ERR

# shellcheck source=/dev/null
[ -f /etc/studio-build.conf ] && . /etc/studio-build.conf
SRC_DIR=${SRC_DIR:-/opt/studio-build/src}
REGISTRY_DOMAIN=${REGISTRY_DOMAIN:?Set REGISTRY_DOMAIN in /etc/studio-build.conf}
IMAGE_NAME=${IMAGE_NAME:-astrologystudio}
KEEP=${KEEP:-10}
LOCAL="127.0.0.1:5000"   # pushes go straight to the registry on this server

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
api() { curl -fsS "$@"; }
ACCEPT=(-H "Accept: application/vnd.oci.image.index.v1+json"
        -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json"
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json"
        -H "Accept: application/vnd.oci.image.manifest.v1+json")

tags() {
  api "http://$LOCAL/v2/$IMAGE_NAME/tags/list" 2>/dev/null \
    | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin).get("tags") or []))' || true
}
versions() { tags | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V || true; }
has_version() { versions | grep -qx "$1"; }

checkout() {
  local ref=$1
  cd "$SRC_DIR"
  git fetch --quiet --tags --prune origin
  if git rev-parse --verify --quiet "origin/$ref" >/dev/null; then
    git checkout --quiet --detach "origin/$ref"
  else
    git checkout --quiet --detach "$ref" || die "No branch, tag or commit called $ref."
  fi
}

version_here() {
  sed -n 's/^__version__ = "\(.*\)"$/\1/p' "$SRC_DIR/server/astrologystudio/__init__.py"
}

release() {
  local ref="main" force=0 latest=1
  while [ $# -gt 0 ]; do
    case $1 in
      --force) force=1 ;;
      --no-latest) latest=0 ;;
      -*) die "Unknown option: $1" ;;
      *) ref=$1 ;;
    esac
    shift
  done
  checkout "$ref"
  local version commit major minor
  version=$(version_here)
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Couldn't read the version from server/astrologystudio/__init__.py."
  if [[ $ref =~ ^v[0-9] ]] && [ "$version" != "${ref#v}" ]; then
    die "Tag $ref has version $version in server/astrologystudio/__init__.py. Bump the version before tagging."
  fi
  commit=$(git -C "$SRC_DIR" rev-parse --short HEAD)
  if has_version "$version" && [ "$force" -eq 0 ]; then
    die "$version is already in the registry. Bump the version, or use --force to replace it."
  fi
  major=${version%%.*}
  minor=${version%.*}
  say "== Building $IMAGE_NAME $version ($ref, $commit)"
  docker build --pull \
    --file "$SRC_DIR/server/Dockerfile" \
    --label "org.opencontainers.image.version=$version" \
    --label "org.opencontainers.image.revision=$commit" \
    --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --tag "$LOCAL/$IMAGE_NAME:$version" \
    "$SRC_DIR"
  local tags_to_push=("$version" "$minor" "$major")
  [ "$latest" -eq 1 ] && tags_to_push+=("latest")
  for t in "${tags_to_push[@]}"; do
    [ "$t" = "$version" ] || docker tag "$LOCAL/$IMAGE_NAME:$version" "$LOCAL/$IMAGE_NAME:$t"
    docker push --quiet "$LOCAL/$IMAGE_NAME:$t" >/dev/null
    say "   published $REGISTRY_DOMAIN/$IMAGE_NAME:$t"
  done
  docker image prune -f >/dev/null
  say "Done. Installs get it with: astrologystudio update"
}

watch() {
  cd "$SRC_DIR"
  git fetch --quiet --tags --prune origin
  local tag built=0
  local newest
  newest=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -n 1)
  for tag in $(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -n 5); do
    has_version "${tag#v}" && continue
    # Only the newest release moves :latest. A tag that fails is reported, and the rest still build.
    if [ "$tag" = "$newest" ]; then
      ( release "$tag" ) || say "   $tag didn't build; see above"
    else
      ( release "$tag" --no-latest ) || say "   $tag didn't build; see above"
    fi
    built=1
  done
  [ "$built" -eq 1 ] || say "Nothing new to build."
}

prune() {
  local old digest v
  mapfile -t old < <(versions | head -n "-$KEEP")
  if [ "${#old[@]}" -eq 0 ]; then say "Nothing to prune (keeping $KEEP versions)."; return; fi
  for v in "${old[@]}"; do
    digest=$(curl -fsSI "${ACCEPT[@]}" "http://$LOCAL/v2/$IMAGE_NAME/manifests/$v" \
      | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p')
    [ -n "$digest" ] || { say "   couldn't find $v; skipped"; continue; }
    curl -fsS -X DELETE "http://$LOCAL/v2/$IMAGE_NAME/manifests/$digest" >/dev/null && say "   removed $v"
  done
  # Free the space. Nothing should be pushing while this runs; studio-build doesn't push here.
  local registry
  registry=$(docker ps --filter "publish=5000" --format '{{.Names}}' | head -n 1)
  [ -n "$registry" ] && docker exec "$registry" registry garbage-collect --delete-untagged /etc/docker/registry/config.yml >/dev/null
  say "Pruned. Kept the newest $KEEP versions."
}

case ${1:-help} in
  release) shift; release "$@" ;;
  watch) watch ;;
  list) versions ;;
  prune) prune ;;
  help|-h|--help) sed -n '5,19p' "$0" ;;
  *) sed -n '5,19p' "$0"; exit 1 ;;
esac
