# Paper Annotator (v0)

A minimal web app for annotating **Concepts** and **Arguments** from research papers.

## UI Flow (minimal clicks)
1. Upload PDF.
2. Metadata panel shows extracted + missing fields (missing highlighted).
3. Read document, highlight passages, then attach those highlights to a Concept or Argument.
4. Create Concepts first, then Arguments referencing Concepts.
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
      "type": "Method",
      "roles": ["argument_anchor"],
      "source_refs": [{ "section": "Introduction", "page": 2 }]
    }
  ],
  "arguments": [
    {
      "argument_id": "A01",
      "text": "Latent Dirichlet Allocation is used for topic modeling.",
      "arg_type": "Claim",
      "concept_refs": ["C01"],
      "source_refs": [{ "section": "Introduction", "page": 2 }]
    }
  ]
}
```

Notes:
- `metadata` is UI-facing context; only `concepts` + `arguments` are annotation objects.
- `source_refs` are coarse anchors (section + optional page), avoiding brittle offsets.

## Tech Stack (fast to ship)
- **Backend**: Node.js + Express + Multer
- **Parsing**: Grobid (external Docker), TEI -> JSON conversion
- **Metadata**: Crossref (optional, best-effort)
- **Frontend**: Vanilla JS + HTML + CSS (no build tooling)

Why this stack:
- Lowest overhead for v0
- Easy to deploy behind existing Grobid
- Simple JSON outputs for evaluators

## Run
1. Ensure Grobid is running (default `http://localhost:8070`).
2. Install dependencies and start:
   ```bash
   npm install
   npm run dev
   ```
3. Open `http://localhost:3000`.

## File Layout
```
dataset/
  papers/
    paper_xxx.pdf
    paper_xxx.tei.xml
    paper_xxx.md
    paper_xxx.json
```

## Notes on v0 behavior
- Highlights must stay within a single paragraph (simplifies DOM range handling).
- Crossref enrichment is best-effort; the app will continue if it fails.
- `page` is manually entered per highlight.

## Bug report 
- when concept highlight section changes even though the element in source ref changes, "label" section say the same as previous. 
- Some paper annotation submission are not saving properly

## Proposed features
- Add running example 
- from annotated section, when user click the element it'll automatically populate the annotation fields 
- 
- Defined (structure) what each argument type means and who those fit together to avoid ambiguity in annotation
- add speech act into the canonicalized text 