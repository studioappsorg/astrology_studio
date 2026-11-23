#!/usr/bin/env bash
# AstrologyStudio ·
# scripts/release-image.sh
#
# Build and push the image by hand to any registry you can push to (for example GitHub's).
# Releases normally come from the build server instead: see deploy/build-server/README.md.
#   scripts/release-image.sh 1.0.0 [ghcr.io/OWNER/astrologystudio]
#
# Copyright (c) 2026 Gavin Melhuish
# MIT License; see LICENSE in the project root.
# SPDX-License-Identifier: MIT

set -euo pipefail
version=${1:?Usage: scripts/release-image.sh VERSION [IMAGE]}
image=${2:-ghcr.io/gmelh/astrologystudio}
major=${version%%.*}
minor=${version%.*}
cd "$(dirname "$0")/.."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file server/Dockerfile \
  --tag "$image:$version" --tag "$image:$minor" --tag "$image:$major" --tag "$image:latest" \
  --push .
