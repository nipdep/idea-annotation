const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { teiToDoc, docToMarkdown } = require("./tei");

const app = express();
const PORT = process.env.PORT || 3000;
const DATASET_DIR = path.join(__dirname, "..", "dataset", "papers");
const TMP_DIR = path.join(__dirname, "..", "tmp");
const INDEX_PATH = path.join(DATASET_DIR, "index.json");
const GROBID_URL = process.env.GROBID_URL || "http://localhost:8070";
const LLM_URL = process.env.LLM_URL || "http://localhost:1234/v1/chat/completions";
const LLM_MODEL = process.env.LLM_MODEL || "qwen2.5-7b-instruct-1m";
const LLM_MODE = process.env.LLM_MODE || "chat";
const BASE_PATH = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");

app.use(express.json({ limit: "10mb" }));

const upload = multer({ dest: TMP_DIR });

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(TMP_DIR);
ensureDir(DATASET_DIR);

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { version: 1, items: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return { version: 1, items: {} };
  }
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function hasMetadataObject(metadata) {
  return !!metadata && typeof metadata === "object" && !Array.isArray(metadata) && Object.keys(metadata).length > 0;
}

function resolvePaperMetadata(loaded, fallbackMetadata = null) {
  const annotationMetadata = loaded?.annotation?.metadata;
  if (hasMetadataObject(annotationMetadata)) return annotationMetadata;
  if (hasMetadataObject(fallbackMetadata)) return fallbackMetadata;
  return loaded?.metadata || {};
}

function findIndexEntryByPaperId(index, paperId) {
  const items = index?.items || {};
  return Object.values(items).find((entry) => entry?.paper_id === paperId) || null;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function loadPaper(paperId) {
  const mdPath = paperPath(paperId, "md");
  const teiPath = paperPath(paperId, "tei.xml");
  const jsonPath = paperPath(paperId, "json");

  if (!fs.existsSync(mdPath) || !fs.existsSync(teiPath)) return null;

  const teiXml = fs.readFileSync(teiPath, "utf8");
  const { metadata: extractedMetadata, doc } = teiToDoc(teiXml);
  const annotation = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
    : null;
  const metadata = hasMetadataObject(annotation?.metadata) ? annotation.metadata : extractedMetadata;

  return { teiXml, metadata, extractedMetadata, doc, annotation };
}

function renderIndex(res) {
  const indexPath = path.join(__dirname, "..", "public", "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  html = html.replace("{{BASE_PATH}}", BASE_PATH);
  res.type("html").send(html);
}

app.get("/", (req, res) => renderIndex(res));
app.get("/index.html", (req, res) => renderIndex(res));

app.use(express.static(path.join(__dirname, "..", "public")));

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
    title: extra.title || base.title || "",
    doi: extra.doi || base.doi || "",
    year: extra.year || base.year || "",
    venue: extra.venue || base.venue || "",
    authors: extra.authors?.length ? extra.authors : base.authors || [],
  };
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    ensureDir(DATASET_DIR);
    ensureDir(TMP_DIR);

    const tempPath = req.file.path;
    const pdfHash = await hashFile(tempPath);
    const index = loadIndex();
    const existing = index.items?.[pdfHash];

    if (existing?.paper_id) {
      const existingPaper = loadPaper(existing.paper_id);
      if (existingPaper) {
        fs.unlinkSync(tempPath);
        const metadata = resolvePaperMetadata(existingPaper, existing.metadata);
        return res.json({
          paper_id: existing.paper_id,
          metadata,
          doc: existingPaper.doc,
          tei_xml: existingPaper.teiXml,
          annotation: existingPaper.annotation,
          pdf_hash: pdfHash,
          existing: true,
        });
      }
      delete index.items[pdfHash];
      saveIndex(index);
    }

    const paperId = randomId();
    const pdfPath = paperPath(paperId, "pdf");
    fs.renameSync(tempPath, pdfPath);

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

    index.items[pdfHash] = {
      paper_id: paperId,
      uploaded_at: new Date().toISOString(),
      metadata,
    };
    saveIndex(index);

    res.json({
      paper_id: paperId,
      metadata,
      doc,
      tei_xml: teiXml,
      annotation: null,
      pdf_hash: pdfHash,
      existing: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/paper/:id", (req, res) => {
  try {
    const paperId = req.params.id;
    const loaded = loadPaper(paperId);
    if (!loaded) {
      return res.status(404).json({ error: "Paper not found" });
    }
    const index = loadIndex();
    const entry = findIndexEntryByPaperId(index, paperId);
    const metadata = resolvePaperMetadata(loaded, entry?.metadata);

    res.json({
      paper_id: paperId,
      metadata,
      doc: loaded.doc,
      tei_xml: loaded.teiXml,
      annotation: loaded.annotation,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/paper/:id/pdf", (req, res) => {
  try {
    const paperId = req.params.id;
    const pdfPath = paperPath(paperId, "pdf");
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: "PDF not found" });
    }
    res.sendFile(pdfPath);
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
      metadata_checks: payload.metadata_checks || {},
      concepts: payload.concepts || [],
      arguments: payload.arguments || [],
      descriptors: payload.descriptors || [],
      pdf_hash: payload.pdf_hash || "",
      updated_at: now,
      created_at: payload.created_at || now,
    };

    fs.writeFileSync(paperPath(paperId, "json"), JSON.stringify(out, null, 2));

    const index = loadIndex();
    const hash = String(payload.pdf_hash || "").trim();
    if (hash && index.items?.[hash]) {
      index.items[hash].metadata = payload.metadata || {};
    } else {
      const items = index.items || {};
      Object.keys(items).forEach((key) => {
        const entry = items[key];
        if (entry?.paper_id === paperId) {
          items[key].metadata = payload.metadata || {};
        }
      });
    }
    saveIndex(index);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/normalize", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const instruction = `
You are normalizing a highlighted span from a scientific paper into one standalone canonical statement.

Goal:
- Produce exactly one precise statement.
- Keep only the most impactful claim if multiple independent claims are present.
- If multiple clauses are complementary and complete each other, abstract them into one coherent statement.

Rules:
1) Remove epistemic/rhetorical modifiers (e.g., "significantly", "we believe", "suggests that", "to the best of our knowledge") unless removing changes polarity.
2) Resolve implicit subjects/referents to explicit ones when possible.
3) Prefer factual proposition over examples, parenthetical detail, and citation framing.
4) Keep the statement verifiable from the paper content alone.
5) Do not invent entities, relations, or conclusions not present in the input.

Output constraints:
- Return only one sentence.
- No bullet points, no explanation, no prefixes.`;

    const payload =
      LLM_MODE === "prompt"
        ? {
            model: LLM_MODEL || undefined,
            prompt: `${instruction}\n\nInput:\n${text}\n\nCanonical:`,
            max_tokens: 120,
            temperature: 0.2,
            stream: false,
          }
        : {
            model: LLM_MODEL || undefined,
            messages: [
              { role: "system", content: instruction.trim() },
              { role: "user", content: `Input: ${text}` },
            ],
            max_tokens: 120,
            temperature: 0.2,
            stream: false,
          };

    const response = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: errText || "LLM error" });
    }

    const data = await response.json();
    let output = "";
    if (data?.choices?.[0]?.message?.content) {
      output = data.choices[0].message.content.trim();
    } else if (data?.choices?.[0]?.text) {
      output = data.choices[0].text.trim();
    } else if (data?.content) {
      output = String(data.content).trim();
    }

    if (!output) output = text;
    res.json({ normalized: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/papers", (req, res) => {
  try {
    const index = loadIndex();
    const items = [];

    const hashes = Object.keys(index.items || {});
    if (hashes.length === 0) {
      const files = fs.readdirSync(DATASET_DIR);
      files
        .filter((file) => file.endsWith(".tei.xml"))
        .forEach((file) => {
          const paperId = file.replace(".tei.xml", "");
          const loaded = loadPaper(paperId);
          if (!loaded) return;
          items.push({
            paper_id: paperId,
            pdf_hash: "",
            metadata: loaded.metadata,
            concepts: loaded.annotation?.concepts || [],
            arguments: loaded.annotation?.arguments || [],
            descriptors: loaded.annotation?.descriptors || [],
            updated_at: loaded.annotation?.updated_at || "",
          });
        });
    } else {
      hashes.forEach((hash) => {
        const entry = index.items[hash];
        if (!entry?.paper_id) return;
        const loaded = loadPaper(entry.paper_id);
        if (!loaded) return;
        const metadata = resolvePaperMetadata(loaded, entry.metadata);
        items.push({
          paper_id: entry.paper_id,
          pdf_hash: hash,
          metadata,
          concepts: loaded.annotation?.concepts || [],
          arguments: loaded.annotation?.arguments || [],
          descriptors: loaded.annotation?.descriptors || [],
          updated_at: loaded.annotation?.updated_at || entry.uploaded_at || "",
        });
      });
    }

    res.json({ items });
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
