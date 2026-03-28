FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache git openssh-client python3 make g++
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile && pnpm rebuild node-pty

COPY . .

EXPOSE 4000

CMD ["pnpm", "start"]
