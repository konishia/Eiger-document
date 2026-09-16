FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends\
    git \
    curl \
    zsh \
    procps \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /workspace/frontend/app

COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install

EXPOSE 3000
CMD ["pnpm", "dev"]
