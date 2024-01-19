# Stage 1: Build Node.js app
FROM node:14 as nodejs_build

WORKDIR /app
COPY package*.json ./
RUN npm -g install

# Stage 2: Final image with Splunk and Node.js app
FROM splunk/splunk:latest
