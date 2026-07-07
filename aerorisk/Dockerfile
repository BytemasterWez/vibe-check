# AeroRisk Automated Ingestion — zero npm dependencies, needs only Node + unzip.
#
# Build:  docker build -t aerorisk .
# Run:    docker run --rm -v aerorisk-data:/data aerorisk ingest all --base /data
# Report: docker run --rm -v aerorisk-data:/data aerorisk report N123AB --data /data/db/production
#
# Schedule nightly ingestion (FAA registry refreshes daily at 23:30 Central):
#   30 5 * * * docker run --rm -v aerorisk-data:/data aerorisk ingest all --base /data

FROM node:22-alpine
RUN apk add --no-cache unzip
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY data/sample ./data/sample
ENTRYPOINT ["node", "bin/aerorisk.js"]
CMD ["help"]
