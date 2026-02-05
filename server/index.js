const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { teiToDoc, docToMarkdown } = require("./tei");

const app = express();
const PORT = process.env.PORT || 3000;
const DATASET_DIR = path.join(__dirname, "..", "dataset", "papers");
const TMP_DIR = path.join(__dirname, "..", "tmp");
const GROBID_URL = process.env.GROBID_URL || "http://localhost:8070";

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({ dest: TMP_DIR });

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(TMP_DIR);
ensureDir(DATASET_DIR);

function paperPath(paperId, ext) {
  return path.join(DATASET_DIR, `${paperId}.${ext}`);
}

function randomId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `paper_${Date.now()}_${rand}`;
}

async function callGrobid(pdfPath) {
  const form = new FormData();
  form.append("input", fs.createReadStream(pdfPath));
  form.append("consolidateHeader", "1");

  const res = await fetch(`${GROBID_URL}/api/processFulltextDocument`, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grobid error: ${res.status} ${text}`);
  }
  return res.text();
}

async function fetchCrossref(metadata) {
  const doi = metadata.doi?.trim();
  const title = metadata.title?.trim();
  let url = "";

  if (doi) {
    url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  } else if (title) {
    url = `https://api.crossref.org/works?query.title=${encodeURIComponent(
      title
    )}&rows=1`;
  } else {
    return null;
  }

  const res = await fetch(url, { headers: { "User-Agent": "paper-annotator/0.1" } });
  if (!res.ok) return null;
  const data = await res.json();
  const item = doi ? data?.message : data?.message?.items?.[0];
  if (!item) return null;

  return {
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    doi: item.DOI || metadata.doi || "",
    year:
      item.published?.["date-parts"]?.[0]?.[0] ||
      item.created?.["date-parts"]?.[0]?.[0] ||
      "",
    venue: Array.isArray(item["container-title"]) ? item["container-title"][0] : item["container-title"],
    authors: Array.isArray(item.author)
      ? item.author.map((a) => [a.given, a.family].filter(Boolean).join(" "))
      : [],
  };
}

function mergeMetadata(base, extra) {
  if (!extra) return base;
  return {
    title: base.title || extra.title || "",
    doi: base.doi || extra.doi || "",
    year: base.year || extra.year || "",
    venue: base.venue || extra.venue || "",
    authors: base.authors?.length ? base.authors : extra.authors || [],
  };
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    ensureDir(DATASET_DIR);
    ensureDir(TMP_DIR);

    const paperId = randomId();
    const pdfPath = paperPath(paperId, "pdf");
    fs.renameSync(req.file.path, pdfPath);

    let teiXml = "";
    try {
      teiXml = await callGrobid(pdfPath);
    } catch (err) {
      teiXml = `<?xml version=\"1.0\"?><TEI><text><body><p>Grobid failed: ${err.message}</p></body></text></TEI>`;
    }

    fs.writeFileSync(paperPath(paperId, "tei.xml"), teiXml, "utf8");

    const { metadata: extractedMetadata, doc } = teiToDoc(teiXml);
    const crossref = await fetchCrossref(extractedMetadata).catch(() => null);
    const metadata = mergeMetadata(extractedMetadata, crossref);

    const md = docToMarkdown(doc);
    fs.writeFileSync(paperPath(paperId, "md"), md, "utf8");

    res.json({ paper_id: paperId, metadata, doc, annotation: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/paper/:id", (req, res) => {
  try {
    const paperId = req.params.id;
    const mdPath = paperPath(paperId, "md");
    const teiPath = paperPath(paperId, "tei.xml");
    const jsonPath = paperPath(paperId, "json");

    if (!fs.existsSync(mdPath) || !fs.existsSync(teiPath)) {
      return res.status(404).json({ error: "Paper not found" });
    }

    const teiXml = fs.readFileSync(teiPath, "utf8");
    const { metadata, doc } = teiToDoc(teiXml);
    const annotation = fs.existsSync(jsonPath)
      ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
      : null;

    res.json({ paper_id: paperId, metadata, doc, annotation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/annotation/:id", (req, res) => {
  try {
    ensureDir(DATASET_DIR);
    const paperId = req.params.id;
    const payload = req.body || {};
    const now = new Date().toISOString();
    const out = {
      paper_id: paperId,
      schema_version: "0.1",
      metadata: payload.metadata || {},
      concepts: payload.concepts || [],
      arguments: payload.arguments || [],
      updated_at: now,
      created_at: payload.created_at || now,
    };

    fs.writeFileSync(paperPath(paperId, "json"), JSON.stringify(out, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/annotation/:id", (req, res) => {
  try {
    const jsonPath = paperPath(req.params.id, "json");
    if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: "Not found" });
    res.json(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Annotator running at http://localhost:${PORT}`);
});
