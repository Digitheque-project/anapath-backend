# ---------- Builder ----------
FROM node:22-alpine AS builder
WORKDIR /app

# Outils de build pour les modules natifs (bcrypt)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
# Retire les devDependencies (garde bcrypt & co)
RUN npm prune --omit=dev

# ---------- Runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Le code écoute sur process.env.PORT || 3334
EXPOSE 3334
CMD ["node", "dist/main"]
