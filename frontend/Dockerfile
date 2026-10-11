FROM debian:bookworm-slim
WORKDIR /app
COPY .node-version ./
# Use the checkout's Node version for both building and serving the viewer.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) exit 1 ;; esac \
    && version="$(cat .node-version)" \
    && curl -fsSLO "https://nodejs.org/dist/v${version}/node-v${version}-linux-${node_arch}.tar.xz" \
    && curl -fsSLO "https://nodejs.org/dist/v${version}/SHASUMS256.txt" \
    && grep " node-v${version}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "node-v${version}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1 \
    && rm node-*.tar.xz SHASUMS256.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci --include=optional && npm run build -w @tarskia/frontend
EXPOSE 4173
CMD ["npm", "run", "preview", "-w", "@tarskia/frontend", "--", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
