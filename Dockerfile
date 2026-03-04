FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY server ./server

ENV NODE_ENV=production \
    PORT=3000 \
    ANNOTATOR_DATA_DIR=/data

RUN mkdir -p /data

EXPOSE 3000

VOLUME ["/data"]

CMD ["npm", "start"]
