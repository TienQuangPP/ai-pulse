FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# Optional dependency (@anthropic-ai/sdk) powers "Ask AI Pulse"; the app runs without it.
RUN npm ci --omit=dev || true
COPY server ./server
COPY public ./public
ENV HOST=0.0.0.0 PORT=8787 AIPULSE_DATA_DIR=/runtime
VOLUME /runtime
EXPOSE 8787
CMD ["node", "server/index.js"]
