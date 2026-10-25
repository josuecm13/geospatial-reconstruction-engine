# Dev server with hot reload. The source is bind-mounted over /app by docker-compose.yml;
# node_modules stays in the image (anonymous volume) so the mount doesn't hide it.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 55173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
