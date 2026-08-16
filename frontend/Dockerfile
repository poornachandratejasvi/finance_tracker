# Build stage: produce a static production bundle. CRA content-hashes every
# filename under /static/ (main.<hash>.js, etc.), so unlike the old `npm start`
# dev-server setup (which always served a fixed "bundle.js"), a new deploy is
# never blocked by a browser/CDN cache holding an old copy of the same path --
# only index.html's reference to the hash changes, and index.html itself is
# set to never cache below.
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# REACT_APP_* vars are baked into the bundle at build time by CRA -- they
# must be passed as a build-arg (see docker-build.yml), a runtime environment
# variable on the container has no effect once this is a static build.
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build

# Serve stage: nginx with cache-control tuned per file type (see nginx.conf).
FROM nginx:alpine

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
