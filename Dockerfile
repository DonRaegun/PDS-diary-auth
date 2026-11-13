FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY db.js server.js auth.js experiment.js claim-legacy.js ./
COPY public ./public
RUN mkdir -p /data
COPY contracts ./contracts
ENV PORT=8080 PDS_DB=/data/diary.sqlite NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
