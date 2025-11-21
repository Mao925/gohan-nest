# ---------- Build stage ----------
  FROM node:20-bullseye-slim AS build
  WORKDIR /app
  
  RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
  
  COPY package*.json ./
  RUN npm install
  
  COPY tsconfig.json ./tsconfig.json
  COPY prisma ./prisma
  COPY src ./src
  
  # Generate Prisma Client
  RUN npx prisma generate
  RUN npm run build
  
  # ---------- Runtime stage ----------
  FROM node:20-bullseye-slim
  WORKDIR /app
  
  ENV NODE_ENV=production
  
  RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
  
  COPY --from=build /app/node_modules ./node_modules
  COPY --from=build /app/dist ./dist
  COPY --from=build /app/prisma ./prisma
  COPY package.json ./package.json
  
  # IMPORTANT: DO NOT MIGRATE ON STARTUP
  CMD ["node", "dist/server.js"]
  
  EXPOSE 3001