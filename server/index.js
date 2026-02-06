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

    res.json({ paper_id: paperId, metadata, doc, tei_xml: teiXml, annotation: null });
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

    res.json({ paper_id: paperId, metadata, doc, tei_xml: teiXml, annotation });
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
      updated_at: now,
      created_at: payload.created_at || now,
    };

    fs.writeFileSync(paperPath(paperId, "json"), JSON.stringify(out, null, 2));
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
Strip to the semantic core. Apply three deterministic rules:
1) Remove epistemic modifiers (e.g., significantly, suggests that, to the best of our knowledge).
2) Collapse enumerations when possible, or produce one canonical assertion per comparison dimension.
3) Make implicit subjects explicit.
Then enforce canonical form: a competent reader should judge support/contradiction using the paper alone.
Return only the canonical sentence.`;

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
