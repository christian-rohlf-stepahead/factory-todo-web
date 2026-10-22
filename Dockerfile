FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY --from=build /app/public ./public
RUN chown -R 1001:1001 /app
USER 1001
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
