# Idea Annotator

Web app for annotating **Artifacts**, **Arguments**, **Descriptors**, and **Relations** from research papers.

## Run (local Node)
```bash
npm install
PORT=3000 BASE_URL=/idea-annotator GROBID_URL=http://localhost:8070 npm run dev
```

Key env vars:
- `PORT`: server listen port (default `3000`)
- `BASE_URL`: URL prefix for reverse proxy hosting (default `/`)
- `GROBID_URL`: external Grobid endpoint (default `http://localhost:8070`)
- `DATA_ROOT`: data root directory (default `./dataset`)
- `DATASET_DIR`: override paper store directory (default `${DATA_ROOT}/papers`)
- `TMP_DIR`: upload temp directory (default `./tmp`)

`BASE_PATH` is still accepted for backward compatibility, but `BASE_URL` is preferred.

## Docker (persistent volumes)

### Build image
```bash
docker build -t idea-annotator:latest .
```

### Run container
```bash
docker run -d \
  --name idea-annotator \
  -p 3000:3000 \
  -e PORT=3000 \
  -e BASE_URL=/idea-annotator \
  -e GROBID_URL=http://host.docker.internal:8070 \
  -v "$(pwd)/dataset:/app/dataset" \
  -v "$(pwd)/tmp:/app/tmp" \
  --add-host host.docker.internal:host-gateway \
  idea-annotator:latest
```

Notes:
- `dataset` volume persists PDFs, TEI/MD, index, and annotation JSON files.
- `tmp` volume persists temporary upload files (safe to clear when container is down).
- For Grobid outside Docker, point `GROBID_URL` to a reachable host URL.

## Docker Compose
```bash
APP_PORT=3000 PORT=3000 BASE_URL=/idea-annotator \
GROBID_URL=http://host.docker.internal:8070 \
docker compose up -d --build
```

Compose file mounts:
- `./dataset -> /app/dataset`
- `./tmp -> /app/tmp`

## Caddy reverse proxy (path-based)

Example:
```caddy
:8081 {
  handle /idea-annotator* {
    reverse_proxy 127.0.0.1:3000
  }
}
```

Run app with:
```bash
BASE_URL=/idea-annotator PORT=3000 npm run dev
```

or in Docker/Compose with `BASE_URL=/idea-annotator`.

## Data layout
```text
dataset/
  papers/
    index.json
    paper_xxx.pdf
    paper_xxx.tei.xml
    paper_xxx.md
    paper_xxx.json
```
