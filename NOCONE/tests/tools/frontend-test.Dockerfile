FROM node:20-bookworm-slim

WORKDIR /workspace/web_front

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# La instalación real se ejecuta en runtime porque el proyecto se monta por bind mount.
COPY web_front/package*.json ./
