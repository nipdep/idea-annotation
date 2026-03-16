FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server ./server

RUN mkdir -p /app/dataset/papers /app/tmp

ENV NODE_ENV=production
ENV PORT=3000
ENV BASE_URL=/
ENV DATA_ROOT=/app/dataset
ENV TMP_DIR=/app/tmp
ENV GROBID_URL=http://host.docker.internal:8070

EXPOSE 3000

CMD ["npm", "run", "start"]
