FROM node:20-alpine

# git is required at install time -- @whiskeysockets/baileys depends on
# libsignal-node, which npm resolves straight from GitHub (not the registry),
# and node:20-alpine ships without git.
RUN apk add --no-cache git

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./

# Baileys' auth session lives here -- mounted as a named volume in
# docker-compose so re-creating the container doesn't force re-pairing.
RUN mkdir -p /data/auth
VOLUME ["/data/auth"]

CMD ["node", "index.js"]
