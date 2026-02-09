const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\u00ad/g, "")
    .trim();
}

function collectText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "object") {
    return Object.values(node).map(collectText).join(" ");
  }
  return "";
}

function collectNameText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectNameText).join(" ");
  if (typeof node === "object") {
    if (node["#text"] != null) return collectText(node["#text"]);
    if (node.text != null) return collectText(node.text);
  }
  return "";
}

function parseAuthors(authorNode) {
  const authors = [];
  toArray(authorNode).forEach((author) => {
    if (!author) return;
    const pers = author.persName || author;
    const forenames = toArray(pers.forename).map(collectNameText).join(" ");
    const surname = collectNameText(pers.surname);
    const name = cleanText([forenames, surname].filter(Boolean).join(" "));
    if (name) authors.push(name);
  });
  return authors;
}

function extractMetadata(tei) {
  const header = tei.TEI?.teiHeader || {};
  const fileDesc = header.fileDesc || {};
  const titleStmt = fileDesc.titleStmt || {};
  const sourceDesc = fileDesc.sourceDesc || {};
  const bibl = sourceDesc.biblStruct || {};
  const analytic = bibl.analytic || {};
  const monogr = bibl.monogr || {};
  const imprint = monogr.imprint || {};

  const title =
    cleanText(collectText(analytic.title)) ||
    cleanText(collectText(titleStmt.title)) ||
    cleanText(collectText(monogr.title));

  let authors = parseAuthors(analytic.author);
  if (!authors.length) authors = parseAuthors(titleStmt.author);
  if (!authors.length) authors = parseAuthors(monogr.author);

  const idnos = toArray(analytic.idno);
  const doiObj = idnos.find(
    (id) => typeof id === "object" && String(id.type || "").toLowerCase() === "doi"
  );
  let doi = "";
  if (doiObj) {
    doi = cleanText(doiObj["#text"] || doiObj.text || collectText(doiObj));
  } else if (idnos.length && typeof idnos[0] === "string") {
    doi = cleanText(idnos[0]);
  }

  const year = cleanText(imprint.date?.when || imprint.date?.["#text"] || "");
  const venue = cleanText(collectText(monogr.title));

  return {
    title: title || "",
    authors,
    doi: doi || "",
    year: year || "",
    venue: venue || "",
  };
}

function extractSections(tei) {
  const body = tei.TEI?.text?.body;
  if (!body) return [];

  const divs = toArray(body.div);
  if (divs.length === 0 && body.p) {
    const paragraphs = toArray(body.p)
      .map((p) => cleanText(collectText(p)))
      .filter(Boolean);
    return [
      {
        id: "body",
        title: "Body",
        paragraphs,
      },
    ];
  }

  return divs.map((div, index) => {
    const title = cleanText(collectText(div.head)) || `Section ${index + 1}`;
    const paragraphs = toArray(div.p)
      .map((p) => cleanText(collectText(p)))
      .filter(Boolean);
    return {
      id: `sec_${index + 1}`,
      title,
      paragraphs,
    };
  });
}

function teiToDoc(teiXml) {
  const tei = parser.parse(teiXml);
  const metadata = extractMetadata(tei);
  const sections = extractSections(tei);
  return { metadata, doc: { sections } };
}

function docToMarkdown(doc) {
  const sections = doc.sections || [];
  const parts = [];
  sections.forEach((section) => {
    parts.push(`# ${section.title}`);
    (section.paragraphs || []).forEach((p) => parts.push(p));
    parts.push("");
  });
  return parts.join("\n\n").trim() + "\n";
}

module.exports = {
  teiToDoc,
  docToMarkdown,
};
