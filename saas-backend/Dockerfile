FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/saas-backend

COPY saas-backend/package.json saas-backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY saas-backend/public ./public
COPY saas-backend/src ./src

RUN mkdir -p /app/saas-backend/downloads/pos-installers \
    && chown -R node:node /app

USER node
EXPOSE 4000

CMD ["node", "src/app.js"]
