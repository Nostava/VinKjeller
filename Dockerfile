# ---------- build stage ----------
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY data ./data
# SQLite database lives here (bind-mounted in docker-compose)
VOLUME /app/data
EXPOSE 3001
CMD ["node", "server/src/index.js"]
