# AstrologyStudio ·
# server/Dockerfile
#
# Build from the repository root:
#
# docker build -f server/Dockerfile .
#
# Copyright (c) 2026 Gavin Melhuish
# MIT License; see LICENSE in the project root.
# SPDX-License-Identifier: MIT

# 1. The web app
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2. The server, serving the API and the web app
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ASTROLOGYSTUDIO_DATA_DIR=/data \
    ASTROLOGYSTUDIO_WEB_DIR=/app/web

RUN useradd --system --uid 10001 --home-dir /app astrologystudio
WORKDIR /app

COPY server/pyproject.toml server/README.md ./server/
COPY server/astrologystudio ./server/astrologystudio
RUN pip install --no-cache-dir ./server && mkdir -p /data && chown astrologystudio /data
COPY --from=web /web/dist ./web

USER astrologystudio
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/v1/health')"

CMD ["astrologystudio", "serve", "--host", "0.0.0.0", "--port", "8080"]
