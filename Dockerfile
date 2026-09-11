FROM node:22-slim

WORKDIR /root
COPY package.json package-lock.json /root/
RUN npm ci

COPY tsconfig.json tsconfig.build.json /root/
COPY src /root/src
COPY resources /root/resources

RUN npm run build

EXPOSE 8080

CMD ["bash", "-c", "node dist/index.js --upnp.config.address=$(ip route get 8.8.8.8 | egrep -o '[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\s*$')"]
