FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

# Baileys' auth session lives here -- mounted as a named volume in
# docker-compose so re-creating the container doesn't force re-pairing.
RUN mkdir -p /data/auth
VOLUME ["/data/auth"]

CMD ["node", "index.js"]
