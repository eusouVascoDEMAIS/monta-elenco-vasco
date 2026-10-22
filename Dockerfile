# Playwright image ships Chromium + its system libs (Sofascore needs a real browser)
FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js index.html ./
ENV HOST=0.0.0.0
CMD ["node", "server.js"]
