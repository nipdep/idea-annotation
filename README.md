# Idea Annotator

A minimal web app for annotating **Artifacts**, **Arguments**, and **Descriptors** from research papers.

## UI Flow (minimal clicks)
1. Upload PDF.
2. Metadata panel shows extracted + missing fields (missing highlighted).
3. Read PDF in the embedded PDF.js viewer, highlight passages, then attach those highlights to an Artifact, Argument, or Descriptor.
4. Create Artifacts first, then Arguments/Descriptors referencing Artifacts.
5. Submit to save JSON alongside the parsed paper.

## Internal Data Model (maps to JSON)
The app keeps only the required first-class annotation objects and a small metadata wrapper.

```json
{
  "paper_id": "paper_1700000000000_ab12cd",
  "schema_version": "0.1",
  "metadata": {
    "title": "...",
    "authors": ["..."],
    "doi": "...",
    "year": "...",
    "venue": "..."
  },
  "concepts": [
    {
      "concept_id": "C01",
      "label": "Latent Dirichlet Allocation",
      "aliases": ["LDA"],
      "type": "model",
      "source_refs": [{ "section": "Page 1", "page": 1, "text": "..." }]
    }
  ],
  "arguments": [
    {
      "argument_id": "A01",
      "text": "Latent Dirichlet Allocation is used for topic modeling.",
      "arg_type": "claim",
      "concept_refs": ["C01"],
      "description": "...",
      "source_refs": [{ "section": "Page 1", "page": 1, "text": "..." }]
    }
  ],
  "descriptors": [
    {
      "descriptor_id": "D01",
      "descriptor_type": "definition",
      "concept_refs": ["C01"],
      "source_refs": [{ "section": "Page 1", "page": 1, "text": "..." }]
    }
  ]
}
```

Notes:
- `metadata` is UI-facing context.
- `source_refs` keep the selected text plus coarse location (`section` + `page`).

## Tech Stack (fast to ship)
- **Backend**: Node.js + Express + Multer
- **PDF viewer**: PDF.js (served locally from `pdfjs-dist`)
- **PDF metadata extraction**: `pdf-parse` (best effort)
- **Metadata**: Crossref (optional, best-effort)
- **Frontend**: Vanilla JS + HTML + CSS (no build tooling)

Why this stack:
- Lowest overhead for v0
- No external parser dependency
- Simple JSON outputs for evaluators

## Run without reverse proxy

1. Install dependencies and start:
   ```bash
   npm install
   npm run dev
   ```
2. Open `http://localhost:3000`.

## Run in Docker

The container keeps all uploaded PDFs, parsed TEI/Markdown, and saved annotations under `ANNOTATOR_DATA_DIR` (default: `/data`). Mount that path to a persistent volume so data survives container restarts.

1. Build the image:
   ```bash
   docker build -t paper-annotator .
   ```
2. Run it with a persistent bind mount and explicit external service URLs:
   ```bash
   docker run \
     --name paper-annotator \
     -p 3000:3000 \
     -v "$(pwd)/annotator-data:/data" \
     -e ANNOTATOR_DATA_DIR=/data \
     -e GROBID_URL=http://host.docker.internal:8070 \
     -e LLM_URL=http://host.docker.internal:1234/v1/chat/completions \
     --add-host=host.docker.internal:host-gateway \
     paper-annotator
   ```

Notes:
- `GROBID_URL` and `LLM_URL` must point to services running outside the container.
- `--add-host=host.docker.internal:host-gateway` is useful on Linux so the container can reach services on the Docker host.
- If your `grobid` or LLM service is on another machine, replace those URLs with that machine's reachable hostname/IP.

## Run with Caddy reverse proxy
1. setup or check for the reverse proxy setup
  ```bash
  nano /etc/caddy/Caddyfile
  ```
  ```bash
:8081 {
  handle_path /idea-annotator/* {
    reverse_proxy 127.0.0.1:3000
  }

  handle_path /static/* {
    reverse_proxy 127.0.0.1:3030
  }

  handle_path /fuseki/* {
    reverse_proxy 127.0.0.1:3030
  }
}
  ```

2. run the website
  ```bash
  BASE_PATH=/idea-annotator npm run dev
  ```

## File Layout
```
dataset/
  papers/
    paper_xxx.pdf
    paper_xxx.json
```
