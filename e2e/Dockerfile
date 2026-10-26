FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY e2e/package.json e2e/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY playwright.config.js ./
COPY e2e ./e2e
RUN mkdir -p /out/visuals && chown -R 1001:1001 /app /out
USER 1001
CMD ["npx", "playwright", "test"]
