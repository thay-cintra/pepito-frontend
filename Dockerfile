FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# SSO obrigatório em todo build de imagem — apenas @cora.com.br
ENV VITE_SSO_ATIVO=true
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY server.cjs .

EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:4173/health || exit 1
CMD ["node", "server.cjs"]
