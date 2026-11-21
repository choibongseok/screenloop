# 컨텍스트는 저장소 루트. scripts/build-images.sh 가 먼저 `next build` 를 돌려 standalone 산출물을 만든다.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY apps/web/.next/standalone ./
COPY apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
