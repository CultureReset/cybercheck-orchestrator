# The kernel. No ADB, no device tooling, no package-specific anything.
#
# A package that needs more than this ships its own Dockerfile beside its own
# manifest. That is the whole rule: the kernel's image contains what the kernel
# needs, and nothing a module happens to want.

FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3000
CMD ["node", "src/http/server.js"]
