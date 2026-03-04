const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const FormData = require("form-data");
const { teiToDoc, docToMarkdown } = require("./tei");
let pdfParse = null;
try {
  pdfParse = require("pdf-parse");
} catch (err) {
  console.warn(
    '[startup] Optional dependency "pdf-parse" is missing. PDF metadata extraction will be skipped.'
  );
}

const app = express();
const PORT = process.env.PORT || 3000;
const CUSTOM_DATA_DIR = process.env.ANNOTATOR_DATA_DIR || process.env.DATA_DIR;
const STORAGE_DIR = path.resolve(
  CUSTOM_DATA_DIR || path.join(__dirname, "..", "dataset")
);
const DATASET_DIR = path.join(STORAGE_DIR, "papers");
const TMP_DIR = path.resolve(
  process.env.TMP_DIR ||
    (CUSTOM_DATA_DIR
      ? path.join(STORAGE_DIR, "tmp")
      : path.join(__dirname, "..", "tmp"))
);
const INDEX_PATH = path.join(DATASET_DIR, "index.json");
const GROBID_URL = process.env.GROBID_URL || "http://localhost:8070";
const LLM_URL = process.env.LLM_URL || "http://localhost:1234/v1/chat/completions";
const LLM_MODEL = process.env.LLM_MODEL || "qwen2.5-7b-instruct-1m";
const LLM_MODE = process.env.LLM_MODE || "chat";
const BASE_PATH = (process.env.BASE_PATH || "/").replace(/\/?$/, "/");
const PDFJS_DIR = path.join(__dirname, "..", "node_modules", "pdfjs-dist");
const parseJobs = new Map();
let pdfJsNodeModulePromise = null;

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

function sanitizeInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAbstractLines(lines) {
  return lines
    .map((line) => sanitizeInlineText(line))
    .filter(Boolean);
}

function compactHeadingText(value) {
  return String(value || "")
    .replace(/[\s:.\-–—]/g, "")
    .toUpperCase();
}

function joinParagraphLines(lines) {
  return normalizeAbstractLines(lines).reduce((acc, line) => {
    if (!line) return acc;
    if (!acc) return line;
    if (acc.endsWith("-")) {
      return `${acc.slice(0, -1)}${line}`;
    }
    return `${acc} ${line}`;
  }, "");
}

async function loadPdfJsNodeModule() {
  if (!pdfJsNodeModulePromise) {
    pdfJsNodeModulePromise = (async () => {
      try {
        const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
        return mod?.default || mod;
      } catch (firstErr) {
        try {
          const mod = await import("pdfjs-dist/build/pdf.mjs");
          return mod?.default || mod;
        } catch (secondErr) {
          throw new Error(
            `Unable to load pdfjs-dist in Node (${firstErr.message}; ${secondErr.message})`
          );
        }
      }
    })();
  }
  return pdfJsNodeModulePromise;
}

function resolveExistingFile(candidates) {
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

const PDFJS_MAIN_FILE = resolveExistingFile([
  path.join(PDFJS_DIR, "build", "pdf.js"),
  path.join(PDFJS_DIR, "build", "pdf.min.js"),
  path.join(PDFJS_DIR, "legacy", "build", "pdf.js"),
  path.join(PDFJS_DIR, "legacy", "build", "pdf.min.js"),
]);

const PDFJS_WORKER_FILE = resolveExistingFile([
  path.join(PDFJS_DIR, "build", "pdf.worker.js"),
  path.join(PDFJS_DIR, "build", "pdf.worker.min.js"),
  path.join(PDFJS_DIR, "legacy", "build", "pdf.worker.js"),
  path.join(PDFJS_DIR, "legacy", "build", "pdf.worker.min.js"),
]);

function hasMetadataObject(metadata) {
  return !!metadata && typeof metadata === "object" && !Array.isArray(metadata) && Object.keys(metadata).length > 0;
}

function sanitizeMetadata(metadata) {
  return {
    title: String(metadata?.title || "").trim(),
    abstract: String(metadata?.abstract || "").trim(),
    doi: String(metadata?.doi || "").trim(),
    year: String(metadata?.year || "").trim(),
    venue: String(metadata?.venue || "").trim(),
    authors: normalizeAuthors(metadata?.authors),
  };
}

function resolvePaperMetadata(loaded, fallbackMetadata = null) {
  const annotationMetadata = loaded?.annotation?.metadata;
  if (hasMetadataObject(annotationMetadata)) return sanitizeMetadata(annotationMetadata);
  if (hasMetadataObject(fallbackMetadata)) return sanitizeMetadata(fallbackMetadata);
  return sanitizeMetadata(loaded?.metadata || {});
}

function findIndexEntryByPaperId(index, paperId) {
  const items = index?.items || {};
  return Object.values(items).find((entry) => entry?.paper_id === paperId) || null;
}

function sanitizeAuthorName(name) {
  return String(name || "")
    .replace(/\b(first|middle|last)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthors(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[;,]/);
  return raw.map((name) => sanitizeAuthorName(name)).filter(Boolean);
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
  const pdfPath = paperPath(paperId, "pdf");
  const jsonPath = paperPath(paperId, "json");
  const teiPath = paperPath(paperId, "tei.xml");

  if (!fs.existsSync(pdfPath)) return null;
  const annotation = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
    : null;
  let teiXml = "";
  let extractedMetadata = {};
  let doc = null;

  if (fs.existsSync(teiPath)) {
    teiXml = fs.readFileSync(teiPath, "utf8");
    try {
      const parsed = teiToDoc(teiXml);
      extractedMetadata = parsed.metadata || {};
      doc = parsed.doc || null;
    } catch (err) {
      console.warn(`[loadPaper] Failed to parse ${teiPath}: ${err.message}`);
    }
  }

  const metadata = hasMetadataObject(annotation?.metadata)
    ? annotation.metadata
    : extractedMetadata;

  return { pdfPath, metadata, extractedMetadata, annotation, teiXml, doc };
}

function renderIndex(res) {
  const indexPath = path.join(__dirname, "..", "public", "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  html = html.replace("{{BASE_PATH}}", BASE_PATH);
  res.type("html").send(html);
}

app.get("/", (req, res) => renderIndex(res));
app.get("/index.html", (req, res) => renderIndex(res));

app.get("/pdfjs/pdf.js", (req, res) => {
  if (!PDFJS_MAIN_FILE) return res.status(404).send("pdf.js not found");
  res.type("application/javascript").sendFile(PDFJS_MAIN_FILE);
});

app.get("/pdfjs/pdf.worker.js", (req, res) => {
  if (!PDFJS_WORKER_FILE) return res.status(404).send("pdf.worker.js not found");
  res.type("application/javascript").sendFile(PDFJS_WORKER_FILE);
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/pdfjs", express.static(path.join(__dirname, "..", "node_modules", "pdfjs-dist")));

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

function fallbackTeiXml(message = "Grobid parsing failed.") {
  const safe = String(message || "Grobid parsing failed.")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<TEI><text><body><div><head>Parsed Output Unavailable</head><p>${safe}</p></div></body></text></TEI>`
  );
}

async function ensureParsedArtifacts(paperId, pdfPath) {
  const teiPath = paperPath(paperId, "tei.xml");
  const mdPath = paperPath(paperId, "md");

  if (fs.existsSync(teiPath)) {
    const teiXml = fs.readFileSync(teiPath, "utf8");
    try {
      const parsed = teiToDoc(teiXml);
      return {
        teiXml,
        extractedMetadata: parsed.metadata || {},
        doc: parsed.doc || null,
      };
    } catch (err) {
      console.warn(`[grobid] Stored TEI parse failed for ${paperId}: ${err.message}`);
    }
  }

  let teiXml = "";
  try {
    teiXml = await callGrobid(pdfPath);
  } catch (err) {
    console.warn(`[grobid] ${paperId}: ${err.message}`);
    teiXml = fallbackTeiXml(err.message);
  }

  fs.writeFileSync(teiPath, teiXml, "utf8");

  const parsed = teiToDoc(teiXml);
  fs.writeFileSync(mdPath, docToMarkdown(parsed.doc), "utf8");

  return {
    teiXml,
    extractedMetadata: parsed.metadata || {},
    doc: parsed.doc || null,
  };
}

function getParseStatus(paperId) {
  const loaded = loadPaper(paperId);
  const parsedReady = !!loaded?.doc;
  const parsing = parseJobs.has(paperId);
  return {
    loaded,
    parsedReady,
    parsing,
  };
}

function startParseJob(paperId, pdfPath) {
  if (!paperId || !pdfPath || !fs.existsSync(pdfPath)) return null;
  if (parseJobs.has(paperId)) return parseJobs.get(paperId);

  const job = (async () => {
    try {
      const parsed = await ensureParsedArtifacts(paperId, pdfPath);
      if (hasMetadataObject(parsed?.extractedMetadata)) {
        const index = loadIndex();
        const items = index.items || {};
        Object.keys(items).forEach((key) => {
          const entry = items[key];
          if (entry?.paper_id === paperId) {
            entry.metadata = mergeMetadata(parsed.extractedMetadata, entry.metadata || {});
          }
        });
        saveIndex(index);
      }
    } catch (err) {
      console.error(`[grobid] Background parse failed for ${paperId}: ${err.message}`);
    } finally {
      parseJobs.delete(paperId);
    }
  })();

  parseJobs.set(paperId, job);
  return job;
}

async function extractPdfMetadata(pdfPath) {
  const fallback = { title: "", abstract: "", doi: "", year: "", venue: "", authors: [] };
  if (!pdfParse) return fallback;
  try {
    const buffer = fs.readFileSync(pdfPath);
    const parsed = await pdfParse(buffer);
    const info = parsed?.info || {};
    const text = String(parsed?.text || "");

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const infoTitle = String(info.Title || "").trim();
    const inferredTitle = lines.find((line) => line.length > 12) || "";
    const title =
      infoTitle && !/^(untitled|microsoft word|acrobat)/i.test(infoTitle)
        ? infoTitle
        : inferredTitle;

    const doiMatch = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    const authors = normalizeAuthors(info.Author);

    return {
      title: title || "",
      abstract: "",
      doi: doiMatch ? doiMatch[0] : "",
      year: yearMatch ? yearMatch[0] : "",
      venue: "",
      authors,
    };
  } catch {
    return fallback;
  }
}

async function detectAbstractFromPdf(pdfPath) {
  let loadingTask = null;
  try {
    const pdfjsLib = await loadPdfJsNodeModule();
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    loadingTask = pdfjsLib.getDocument({
      data,
      disableWorker: true,
      useSystemFonts: true,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = Number(viewport?.width) || 600;
    const textContent = await page.getTextContent();
    const rawItems = Array.isArray(textContent?.items) ? textContent.items : [];
    const items = rawItems
      .map((item) => {
        const str = sanitizeInlineText(item?.str);
        if (!str) return null;
        const transform = Array.isArray(item?.transform) ? item.transform : [];
        const x = Number(transform[4]);
        const y = Number(transform[5]);
        const width = Number(item?.width) || 0;
        const height =
          Math.abs(Number(item?.height)) ||
          Math.abs(Number(transform[3])) ||
          0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          str,
          x,
          y,
          width: Number.isFinite(width) ? width : 0,
          height: Number.isFinite(height) ? height : 0,
        };
      })
      .filter(Boolean);

    if (!items.length) return "";

    const sorted = items.slice().sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 3) return yDiff;
      return a.x - b.x;
    });

    const lines = [];
    sorted.forEach((item) => {
      const tolerance = Math.max(2, item.height * 0.45 || 2);
      const match = lines.find((line) => Math.abs(line.y - item.y) <= tolerance);
      if (match) {
        match.items.push(item);
        match.y = (match.y * (match.items.length - 1) + item.y) / match.items.length;
      } else {
        lines.push({ y: item.y, items: [item] });
      }
    });

    const normalizedLines = lines
      .map((line) => {
        const sortedItems = line.items.slice().sort((a, b) => a.x - b.x);
        const xMin = sortedItems[0]?.x || 0;
        const xMax = sortedItems.reduce(
          (max, item) => Math.max(max, item.x + item.width),
          xMin
        );
        const avgHeight =
          sortedItems.reduce((sum, item) => sum + (item.height || 0), 0) /
            (sortedItems.length || 1) || 0;
        return {
          y: line.y,
          xMin,
          xMax,
          width: Math.max(0, xMax - xMin),
          avgHeight,
          text: sanitizeInlineText(sortedItems.map((item) => item.str).join(" ")),
        };
      })
      .filter((line) => line.text);

    const isLikelySectionHeading = (line) => {
      const text = String(line?.text || "");
      const compact = compactHeadingText(text);
      if (!text) return false;
      if (compact === "ABSTRACT") return true;
      if (compact === "INTRODUCTION") return true;
      if (compact === "KEYWORDS") return true;
      if (compact === "INDEXTERMS") return true;
      if (compact === "REFERENCES") return true;
      if (compact === "ACKNOWLEDGEMENTS" || compact === "ACKNOWLEDGMENTS") return true;
      if (/^\d+INTRODUCTION$/.test(compact)) return true;
      if (/^(keywords|index terms)\b/i.test(text)) return true;
      if (/^(\d+[\.\)]?\s+)?introduction\b/i.test(text)) return true;
      if (/^(references|acknowledg(e)?ments?)\b/i.test(text)) return true;
      if (/^\d+(\.\d+)*\s+[A-Z]/.test(text)) return true;
      const words = text.split(/\s+/).filter(Boolean);
      if (
        words.length <= 6 &&
        text === text.toUpperCase() &&
        line.width <= pageWidth * 0.75
      ) {
        return true;
      }
      return false;
    };

    let headingIndex = normalizedLines.findIndex((line) => {
      const compact = compactHeadingText(line.text);
      return compact === "ABSTRACT";
    });
    if (headingIndex < 0) {
      headingIndex = normalizedLines.findIndex((line) => {
        const compact = compactHeadingText(line.text);
        return compact.startsWith("ABSTRACT") && line.width <= pageWidth * 0.7;
      });
    }
    if (headingIndex < 0) return "";

    const collected = [];
    const headingLine = normalizedLines[headingIndex];
    const headingText = headingLine.text;
    const compactHeading = compactHeadingText(headingText);
    if (compactHeading.startsWith("ABSTRACT") && compactHeading !== "ABSTRACT") {
      const sameLineTail = sanitizeInlineText(
        headingText.replace(/^\s*abstract\b[:.\-–—]*/i, "")
      );
      if (sameLineTail) {
        collected.push(sameLineTail);
      }
    }

    let bodyStartIndex = -1;
    for (let i = headingIndex + 1; i < normalizedLines.length; i += 1) {
      const line = normalizedLines[i];
      const words = line.text.split(/\s+/).filter(Boolean);
      if (isLikelySectionHeading(line)) break;
      if (words.length >= 5 || line.width >= pageWidth * 0.3) {
        bodyStartIndex = i;
        break;
      }
    }
    if (bodyStartIndex < 0) {
      return sanitizeInlineText(joinParagraphLines(collected));
    }

    const firstBodyLine = normalizedLines[bodyStartIndex];
    const paragraphLeft = firstBodyLine.xMin;
    let previousLine = firstBodyLine;

    for (let i = bodyStartIndex; i < normalizedLines.length; i += 1) {
      const line = normalizedLines[i];
      if (isLikelySectionHeading(line)) break;

      const yGap = Math.max(0, previousLine.y - line.y);
      const maxGap = Math.max(20, Math.max(previousLine.avgHeight, line.avgHeight) * 3.2);
      if (i > bodyStartIndex && yGap > maxGap) break;

      if (i > bodyStartIndex && line.xMin < paragraphLeft - 60) break;

      collected.push(line.text);
      previousLine = line;
    }

    return sanitizeInlineText(joinParagraphLines(collected));
  } catch (err) {
    console.warn(`[abstract] ${path.basename(pdfPath)}: ${err.message}`);
    return "";
  } finally {
    if (loadingTask && typeof loadingTask.destroy === "function") {
      try {
        await loadingTask.destroy();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

async function enrichMetadataWithDetectedAbstract(metadata, pdfPath) {
  const current = sanitizeMetadata(metadata || {});
  if (current.abstract) return current;
  const detected = await detectAbstractFromPdf(pdfPath);
  if (!detected) return current;
  return sanitizeMetadata({
    ...current,
    abstract: detected,
  });
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
    abstract: metadata.abstract || "",
    doi: item.DOI || metadata.doi || "",
    year:
      item.published?.["date-parts"]?.[0]?.[0] ||
      item.created?.["date-parts"]?.[0]?.[0] ||
      "",
    venue: Array.isArray(item["container-title"]) ? item["container-title"][0] : item["container-title"],
    authors: Array.isArray(item.author)
      ? item.author.map((a) => sanitizeAuthorName([a.given, a.family].filter(Boolean).join(" ")))
      : [],
  };
}

function mergeMetadata(base, extra) {
  if (!extra) return sanitizeMetadata(base || {});
  return sanitizeMetadata({
    title: extra.title || base.title || "",
    abstract: extra.abstract || base.abstract || "",
    doi: extra.doi || base.doi || "",
    year: extra.year || base.year || "",
    venue: extra.venue || base.venue || "",
    authors: extra.authors?.length ? normalizeAuthors(extra.authors) : normalizeAuthors(base.authors),
  });
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
      let existingPaper = loadPaper(existing.paper_id);
      if (existingPaper) {
        if (!existingPaper.doc) {
          startParseJob(existing.paper_id, existingPaper.pdfPath);
        }
        fs.unlinkSync(tempPath);
        const metadata = await enrichMetadataWithDetectedAbstract(
          resolvePaperMetadata(existingPaper, existing.metadata),
          existingPaper.pdfPath
        );
        if (!existing.metadata?.abstract && metadata.abstract) {
          existing.metadata = mergeMetadata(existing.metadata || {}, metadata);
          saveIndex(index);
        }
        const status = getParseStatus(existing.paper_id);
        return res.json({
          paper_id: existing.paper_id,
          metadata,
          doc: existingPaper.doc,
          tei_xml: existingPaper.teiXml || "",
          annotation: existingPaper.annotation,
          pdf_hash: pdfHash,
          parsed_ready: status.parsedReady,
          parsing: status.parsing || !status.parsedReady,
          existing: true,
        });
      }
      delete index.items[pdfHash];
      saveIndex(index);
    }

    const paperId = randomId();
    const pdfPath = paperPath(paperId, "pdf");
    fs.renameSync(tempPath, pdfPath);
    startParseJob(paperId, pdfPath);

    const extractedMetadata = await enrichMetadataWithDetectedAbstract(
      await extractPdfMetadata(pdfPath),
      pdfPath
    );
    const crossref = await fetchCrossref(extractedMetadata).catch(() => null);
    const metadata = await enrichMetadataWithDetectedAbstract(
      mergeMetadata(extractedMetadata, crossref),
      pdfPath
    );

    index.items[pdfHash] = {
      paper_id: paperId,
      uploaded_at: new Date().toISOString(),
      metadata,
    };
    saveIndex(index);

    res.json({
      paper_id: paperId,
      metadata,
      doc: null,
      tei_xml: "",
      annotation: null,
      pdf_hash: pdfHash,
      parsed_ready: false,
      parsing: true,
      existing: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/paper/:id", async (req, res) => {
  try {
    const paperId = req.params.id;
    const loaded = loadPaper(paperId);
    if (!loaded) {
      return res.status(404).json({ error: "Paper not found" });
    }
    const index = loadIndex();
    const entry = findIndexEntryByPaperId(index, paperId);
    const metadata = await enrichMetadataWithDetectedAbstract(
      resolvePaperMetadata(loaded, entry?.metadata),
      loaded.pdfPath
    );
    const status = getParseStatus(paperId);

    res.json({
      paper_id: paperId,
      metadata,
      doc: loaded.doc,
      tei_xml: loaded.teiXml || "",
      annotation: loaded.annotation,
      parsed_ready: status.parsedReady,
      parsing: status.parsing,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/paper/:id/status", (req, res) => {
  try {
    const paperId = req.params.id;
    const loaded = loadPaper(paperId);
    if (!loaded) {
      return res.status(404).json({ error: "Paper not found" });
    }

    const teiPath = paperPath(paperId, "tei.xml");
    if (!fs.existsSync(teiPath) && !parseJobs.has(paperId)) {
      startParseJob(paperId, loaded.pdfPath);
    }

    const status = getParseStatus(paperId);
    res.json({
      paper_id: paperId,
      parsed_ready: status.parsedReady,
      parsing: status.parsing,
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
    const metadata = sanitizeMetadata(payload.metadata || {});
    const out = {
      paper_id: paperId,
      schema_version: "0.1",
      metadata,
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
      index.items[hash].metadata = metadata;
    } else {
      const items = index.items || {};
      Object.keys(items).forEach((key) => {
        const entry = items[key];
        if (entry?.paper_id === paperId) {
          items[key].metadata = metadata;
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
    const indexItems = index.items || {};

    const hashes = Object.keys(indexItems);
    if (hashes.length === 0) {
      const files = fs.readdirSync(DATASET_DIR);
      files
        .filter((file) => file.endsWith(".pdf"))
        .forEach((file) => {
          const paperId = file.replace(".pdf", "");
          const loaded = loadPaper(paperId);
          if (!loaded) return;
          const entry = findIndexEntryByPaperId(index, paperId);
          const metadata = resolvePaperMetadata(loaded, entry?.metadata);
          items.push({
            paper_id: paperId,
            pdf_hash: "",
            metadata,
            concepts: loaded.annotation?.concepts || [],
            arguments: loaded.annotation?.arguments || [],
            descriptors: loaded.annotation?.descriptors || [],
            updated_at: loaded.annotation?.updated_at || "",
          });
        });
    } else {
      hashes.forEach((hash) => {
        const entry = indexItems[hash];
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
