const conceptTypeTree = [
  {
    label: "idea:Assumption",
    children: [
      { label: "idea:Methodological", children: [{ label: "idea:DataCollection" }] },
      { label: "idea:Theoretical", children: [{ label: "idea:Analytical" }] },
      { label: "idea:Scoping", children: [{ label: "idea:Negligence" }, { label: "idea:Restriction" }] },
      { label: "idea:Resource", children: [{ label: "idea:Access" }, { label: "idea:Stability" }] },
    ],
  },
  {
    label: "idea:artifact",
    children: [
      { label: "idea:Algorithm" },
      { label: "idea:Model" },
      { label: "idea:Design" },
      { label: "idea:Framework" },
      { label: "idea:Dataset" },
    ],
  },
];

const argumentTypes = [
  "issue",
  "backing",
  "idea",
  "approach",
  "experiment",
  "experiment design",
  "experiment goal",
  "experiment hypothesis",
  "experiment result",
  "claim",
  "warrant",
  "central argument",
];

const requiredArgumentTypes = ["issue", "idea", "approach", "claim"];

const state = {
  paperId: null,
  pdfHash: "",
  metadata: {},
  metadataChecks: {},
  doc: null,
  teiXml: "",
  annotations: { concepts: [], arguments: [], created_at: null },
  highlights: [],
  highlightSelection: {
    concept: new Set(),
    argument: new Set(),
  },
  conceptTypePath: [],
  library: {
    items: [],
    filtered: [],
    selectedId: null,
    view: "table",
    loaded: false,
  },
};

const el = (id) => document.getElementById(id);
const BASE_PATH = document.querySelector("base")?.getAttribute("href") || "/";

function withBase(path) {
  const base = (BASE_PATH || "/").replace(/\/$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}` || clean;
}

function setHint(message) {
  el("highlightHint").textContent = message || "";
}

function showToast(message, type = "info", options = {}) {
  const container = el("toastContainer");
  if (!container) return null;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  if (type === "loading") {
    const spinner = document.createElement("div");
    spinner.className = "spinner";
    toast.appendChild(spinner);
  }

  const text = document.createElement("div");
  text.textContent = message;
  toast.appendChild(text);
  container.appendChild(toast);

  if (!options.persist) {
    const duration = options.duration || 2800;
    setTimeout(() => toast.remove(), duration);
  }
  return toast;
}

async function requestNormalization(text) {
  const textArea = el("argumentText");
  if (!textArea) return;
  textArea.value = "Generating suggestion...";
  textArea.readOnly = true;
  textArea.classList.add("loading");
  const toast = showToast("Generating canonical statement...", "loading", { persist: true });

  try {
    const res = await fetch(withBase("/api/normalize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("LLM request failed");
    const data = await res.json();
    const suggestion = data.normalized || text;
    textArea.value = suggestion;
  } catch (err) {
    textArea.value = text;
    showToast("LLM suggestion failed. Using original text.", "error");
  } finally {
    textArea.readOnly = false;
    textArea.classList.remove("loading");
    if (toast) toast.remove();
  }
}

function formatTypeLabel(value) {
  return value
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function uniqueId(prefix, list) {
  const next = list.length + 1;
  return `${prefix}${String(next).padStart(2, "0")}`;
}

function normalizeAliases(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderConceptTypePicker(path = state.conceptTypePath) {
  const container = el("conceptTypePicker");
  if (!container) return;
  container.innerHTML = "";

  let nodes = conceptTypeTree;
  let depth = 0;
  const currentPath = Array.isArray(path) ? path : [];

  while (nodes && nodes.length) {
    const select = document.createElement("select");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = depth === 0 ? "Select a category" : "Stop here";
      placeholder.disabled = depth === 0;
    select.appendChild(placeholder);

    nodes.forEach((node) => {
      const option = document.createElement("option");
      option.value = node.label;
      option.textContent = node.label;
      select.appendChild(option);
    });

    const value = currentPath[depth] || "";
    if (value) {
      select.value = value;
    } else if (depth === 0) {
      select.selectedIndex = 0;
    }

    select.addEventListener("change", (e) => {
      const nextValue = e.target.value;
      const nextPath = state.conceptTypePath.slice(0, depth);
      if (nextValue) nextPath.push(nextValue);
      state.conceptTypePath = nextPath;
      renderConceptTypePicker(nextPath);
      renderConceptTypePath();
    });

    container.appendChild(select);

    if (!value) break;
    const node = nodes.find((item) => item.label === value);
    nodes = node?.children || [];
    depth += 1;
  }
}

function renderConceptTypePath() {
  const display = el("conceptTypePath");
  if (!display) return;
  if (!state.conceptTypePath.length) {
    display.textContent = "Select a category. You can stop at any level.";
    return;
  }
  display.textContent = `Selected: ${state.conceptTypePath.join(" > ")}`;
}

function normalizeArgType(value) {
  return String(value || "").toLowerCase();
}

function renderFlowGuide() {
  const container = el("flowGuide");
  if (!container) return;
  container.innerHTML = "";

  const present = new Set(
    (state.annotations.arguments || []).map((arg) => normalizeArgType(arg.arg_type))
  );

  const steps = [
    { label: "Issue + Backing", required: ["issue"], optional: ["backing"] },
    { label: "Idea", required: ["idea"] },
    { label: "Approach", required: ["approach"] },
    {
      label: "Experiments (design, goal, hypothesis, result)",
      optional: [
        "experiment",
        "experiment design",
        "experiment goal",
        "experiment hypothesis",
        "experiment result",
      ],
    },
    { label: "Claims + Warrants", required: ["claim"], optional: ["warrant", "central argument"] },
  ];

  steps.forEach((step) => {
    const item = document.createElement("div");
    item.className = "flow-item";

    const label = document.createElement("div");
    label.textContent = step.label;

    const badge = document.createElement("span");
    const requiredMissing = (step.required || []).some((type) => !present.has(type));
    const optionalHit = (step.optional || []).some((type) => present.has(type));

    if (step.required?.length) {
      badge.className = `badge ${requiredMissing ? "missing" : "done"}`;
      badge.textContent = requiredMissing ? "Required" : "Done";
    } else {
      badge.className = `badge ${optionalHit ? "done" : ""}`;
      badge.textContent = optionalHit ? "Done" : "Optional";
    }

    item.appendChild(label);
    item.appendChild(badge);
    container.appendChild(item);
  });
}

function flattenAuthors(authors) {
  if (!authors) return "";
  if (Array.isArray(authors)) return authors.join(" ");
  return String(authors);
}

function librarySearchText(item) {
  const metadata = item.metadata || {};
  const conceptLabels = (item.concepts || []).map((c) => c.label || "").join(" ");
  const argumentTexts = (item.arguments || []).map((a) => a.text || "").join(" ");
  return [
    metadata.title || "",
    flattenAuthors(metadata.authors),
    metadata.doi || "",
    metadata.venue || "",
    metadata.year || "",
    conceptLabels,
    argumentTexts,
  ]
    .join(" ")
    .toLowerCase();
}

function applyLibraryFilter(query) {
  const q = (query || "").trim().toLowerCase();
  const items = state.library.items || [];
  state.library.filtered = q
    ? items.filter((item) => librarySearchText(item).includes(q))
    : items.slice();

  if (
    state.library.selectedId &&
    !state.library.filtered.find((item) => item.paper_id === state.library.selectedId)
  ) {
    state.library.selectedId = null;
  }

  renderLibraryTable();
  renderLibraryGraph();
  renderLibraryDetail();
}

function renderLibraryTable() {
  const tbody = el("libraryTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!state.library.filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "muted";
    cell.textContent = "No papers found.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  state.library.filtered.forEach((item) => {
    const row = document.createElement("tr");
    if (state.library.selectedId === item.paper_id) row.classList.add("active");

    const title = item.metadata?.title || "Untitled";
    const year = item.metadata?.year || "-";
    const venue = item.metadata?.venue || "-";
    const conceptCount = item.concepts?.length || 0;
    const argumentCount = item.arguments?.length || 0;

    row.innerHTML = `
      <td>${title}</td>
      <td>${year}</td>
      <td>${venue}</td>
      <td>${conceptCount}</td>
      <td>${argumentCount}</td>
    `;
    row.addEventListener("click", () => selectLibraryItem(item.paper_id));
    tbody.appendChild(row);
  });
}

function renderLibraryGraph() {
  const svg = el("graphSvg");
  if (!svg) return;
  svg.innerHTML = "";

  const items = state.library.filtered || [];
  const count = items.length;
  if (count === 0) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "20");
    text.setAttribute("y", "40");
    text.setAttribute("fill", "#6b6157");
    text.textContent = "No papers found.";
    svg.appendChild(text);
    return;
  }

  const width = 800;
  const height = 420;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 60;

  const positions = items.map((item, idx) => {
    const angle = (2 * Math.PI * idx) / count;
    return {
      id: item.paper_id,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      label: (item.metadata?.title || "Untitled").slice(0, 18),
    };
  });

  for (let i = 0; i < positions.length - 1; i += 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", positions[i].x);
    line.setAttribute("y1", positions[i].y);
    line.setAttribute("x2", positions[i + 1].x);
    line.setAttribute("y2", positions[i + 1].y);
    line.setAttribute("stroke", "#d0c6bd");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
  }

  positions.forEach((pos) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", "18");
    circle.classList.add("graph-node");
    if (state.library.selectedId === pos.id) circle.classList.add("active");
    circle.addEventListener("click", () => selectLibraryItem(pos.id));

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", pos.x);
    label.setAttribute("y", pos.y + 32);
    label.setAttribute("text-anchor", "middle");
    label.classList.add("graph-label");
    label.textContent = pos.label;

    group.appendChild(circle);
    group.appendChild(label);
    svg.appendChild(group);
  });
}

function renderLibraryDetail() {
  const container = el("libraryDetailBody");
  if (!container) return;
  container.innerHTML = "";

  const selected = state.library.filtered.find((item) => item.paper_id === state.library.selectedId);
  if (!selected) {
    container.innerHTML = '<div class="muted">Select a paper to view details.</div>';
    return;
  }

  const metadata = selected.metadata || {};
  const details = document.createElement("div");
  details.className = "stack";
  details.innerHTML = `
    <div><strong>${metadata.title || "Untitled"}</strong></div>
    <div class="meta">${flattenAuthors(metadata.authors) || "Unknown authors"}</div>
    <div class="meta">Year: ${metadata.year || "-"}</div>
    <div class="meta">Venue: ${metadata.venue || "-"}</div>
    <div class="meta">DOI: ${metadata.doi || "-"}</div>
  `;
  container.appendChild(details);

  const conceptBlock = document.createElement("div");
  conceptBlock.className = "list-block";
  conceptBlock.innerHTML = `<div class="subhead">Concepts</div>`;
  const conceptList = document.createElement("div");
  conceptList.className = "list";
  (selected.concepts || []).forEach((concept) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <div><strong>${concept.concept_id}</strong> ${concept.label || ""}</div>
        <div class="meta">${concept.type || ""}</div>
      </div>
    `;
    conceptList.appendChild(item);
  });
  if (!selected.concepts?.length) {
    conceptList.innerHTML = '<div class="muted">No concepts recorded.</div>';
  }
  conceptBlock.appendChild(conceptList);
  container.appendChild(conceptBlock);

  const argumentBlock = document.createElement("div");
  argumentBlock.className = "list-block";
  argumentBlock.innerHTML = `<div class="subhead">Arguments</div>`;
  const argumentList = document.createElement("div");
  argumentList.className = "list";
  (selected.arguments || []).forEach((argument) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <div><strong>${argument.argument_id}</strong> ${formatTypeLabel(argument.arg_type || "")}</div>
        <div class="meta">${argument.text ? argument.text.slice(0, 120) : ""}</div>
      </div>
    `;
    argumentList.appendChild(item);
  });
  if (!selected.arguments?.length) {
    argumentList.innerHTML = '<div class="muted">No arguments recorded.</div>';
  }
  argumentBlock.appendChild(argumentList);
  container.appendChild(argumentBlock);
}

function selectLibraryItem(paperId) {
  state.library.selectedId = paperId;
  renderLibraryTable();
  renderLibraryGraph();
  renderLibraryDetail();
}

async function fetchLibrary() {
  const res = await fetch(withBase("/api/papers"));
  if (!res.ok) {
    showToast("Failed to load paper library.", "error");
    return;
  }
  const data = await res.json();
  state.library.items = data.items || [];
  state.library.loaded = true;
  applyLibraryFilter(el("librarySearch")?.value || "");
}

function wireLibraryControls() {
  const searchInput = el("librarySearch");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => applyLibraryFilter(e.target.value));
  }

  document.querySelectorAll(".view-toggle .toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-toggle .toggle").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.library.view = btn.dataset.view;
      document.querySelectorAll(".library-view").forEach((view) => view.classList.remove("active"));
      if (state.library.view === "graph") {
        el("libraryGraphView")?.classList.add("active");
      } else {
        el("libraryTableView")?.classList.add("active");
      }
      renderLibraryGraph();
    });
  });
}

function renderMetadata() {
  const form = el("metadataForm");
  form.innerHTML = "";
  const fields = [
    { key: "title", label: "Title" },
    { key: "authors", label: "Authors" },
    { key: "doi", label: "DOI" },
    { key: "year", label: "Year" },
    { key: "venue", label: "Venue" },
  ];

  fields.forEach(({ key, label }) => {
    const raw = state.metadata[key];
    const value = Array.isArray(raw) ? raw.join(", ") : raw || "";
    const isMissing = Array.isArray(raw) ? raw.length === 0 : !raw;

    if (key === "authors") {
      const details = document.createElement("details");
      details.className = "authors-block";
      details.open = false;

      const summary = document.createElement("summary");
      summary.textContent = `${label} (${Array.isArray(raw) ? raw.length : 0})`;

      const verify = document.createElement("label");
      verify.className = "verify";
      const verifyBox = document.createElement("input");
      verifyBox.type = "checkbox";
      verifyBox.checked = !!state.metadataChecks[key];
      verifyBox.addEventListener("change", (e) => {
        state.metadataChecks[key] = e.target.checked;
      });
      verify.appendChild(verifyBox);
      verify.append(" Verified");

      summary.appendChild(verify);
      details.appendChild(summary);

      const listContainer = document.createElement("div");
      listContainer.className = "author-list";
      (Array.isArray(raw) ? raw : []).forEach((name) => {
        const chip = document.createElement("span");
        chip.className = "author-chip";
        chip.textContent = name;
        listContainer.appendChild(chip);
      });

      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.placeholder = "Comma-separated";
      textarea.value = value;
      textarea.addEventListener("input", (e) => {
        const list = e.target.value
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        state.metadata[key] = list;
        summary.textContent = `${label} (${list.length})`;
        summary.appendChild(verify);
        if (list.length === 0) {
          details.classList.add("missing");
        } else {
          details.classList.remove("missing");
        }
        listContainer.innerHTML = "";
        list.forEach((name) => {
          const chip = document.createElement("span");
          chip.className = "author-chip";
          chip.textContent = name;
          listContainer.appendChild(chip);
        });
      });

      if (!isMissing) details.classList.remove("missing");
      if (isMissing) details.classList.add("missing");

      details.appendChild(textarea);
      details.appendChild(listContainer);
      form.appendChild(details);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `meta-field ${isMissing ? "missing" : ""}`;

    const row = document.createElement("div");
    row.className = "meta-row";
    const fieldLabel = document.createElement("div");
    fieldLabel.textContent = label;

    const verify = document.createElement("label");
    verify.className = "verify";
    const verifyBox = document.createElement("input");
    verifyBox.type = "checkbox";
    verifyBox.checked = !!state.metadataChecks[key];
    verifyBox.addEventListener("change", (e) => {
      state.metadataChecks[key] = e.target.checked;
    });
    verify.appendChild(verifyBox);
    verify.append(" Verified");

    row.appendChild(fieldLabel);
    row.appendChild(verify);

    const input =
      key === "title" ? document.createElement("textarea") : document.createElement("input");
    if (key === "title") input.rows = 3;
    input.value = value;
    input.addEventListener("input", (e) => {
      const trimmed = e.target.value.trim();
      state.metadata[key] = trimmed;
      wrapper.className = `meta-field ${trimmed ? "" : "missing"}`;
    });

    wrapper.appendChild(row);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });
}

function renderDoc() {
  const docView = el("docView");
  docView.innerHTML = "";

  if (state.teiXml) {
    if (renderTeiDoc(state.teiXml, docView)) return;
  }

  if (!state.doc) {
    docView.innerHTML = '<p class="muted">Upload a paper to begin.</p>';
    return;
  }

  state.doc.sections.forEach((section) => {
    const sectionEl = document.createElement("div");
    sectionEl.className = "section";
    sectionEl.dataset.section = section.title;

    const heading = document.createElement("h3");
    heading.textContent = section.title;
    sectionEl.appendChild(heading);

    section.paragraphs.forEach((paragraph) => {
      const p = document.createElement("p");
      p.textContent = paragraph;
      sectionEl.appendChild(p);
    });

    docView.appendChild(sectionEl);
  });
}

function renderTeiDoc(teiXml, docView) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(teiXml, "text/xml");
  if (xml.querySelector("parsererror")) {
    return false;
  }

  const container = document.createElement("div");
  container.className = "tei-doc";

  const header = document.createElement("section");
  header.className = "tei-header";
  header.dataset.section = "Header";

  const titleStmt = getByTag(xml, "titleStmt")[0] || null;
  const titleNode = titleStmt ? getByTag(titleStmt, "title")[0] : null;
  const title = extractText(titleNode);
  if (title) {
    const h1 = document.createElement("h1");
    h1.className = "tei-title";
    h1.textContent = title;
    header.appendChild(h1);
  }

  const authorNodes = titleStmt ? getByTag(titleStmt, "author") : [];
  const authors = Array.from(authorNodes)
    .map((node) => formatAuthor(node))
    .filter(Boolean);
  if (authors.length) {
    const authorBlock = document.createElement("div");
    authorBlock.className = "tei-authors";
    authorBlock.textContent = authors.join(", ");
    header.appendChild(authorBlock);
  }

  if (header.childNodes.length) container.appendChild(header);

  const profileDesc = getByTag(xml, "profileDesc")[0] || null;
  const front = getByTag(xml, "front")[0] || null;
  const abstractNode =
    (profileDesc ? getByTag(profileDesc, "abstract")[0] : null) ||
    (front ? getByTag(front, "abstract")[0] : null) ||
    getByTag(xml, "abstract")[0] ||
    null;
  const abstractText = extractText(abstractNode);
  if (abstractText) {
    const abstractSection = document.createElement("section");
    abstractSection.className = "tei-abstract";
    abstractSection.dataset.section = "Abstract";
    const label = document.createElement("h3");
    label.textContent = "Abstract";
    abstractSection.appendChild(label);
    const p = document.createElement("p");
    p.className = "doc-paragraph";
    p.textContent = abstractText;
    abstractSection.appendChild(p);
    container.appendChild(abstractSection);
  }

  const textNode = getByTag(xml, "text")[0] || null;
  const body = (textNode ? getByTag(textNode, "body")[0] : null) || getByTag(xml, "body")[0];
  if (body) {
    renderTeiChildren(body, container, "Body");
  }

  const back = (textNode ? getByTag(textNode, "back")[0] : null) || getByTag(xml, "back")[0];
  const listBibl = back ? getByTag(back, "listBibl")[0] : null;
  if (listBibl) {
    const refSection = document.createElement("section");
    refSection.className = "tei-section";
    refSection.dataset.section = "References";
    const head = document.createElement("h3");
    head.textContent = "References";
    refSection.appendChild(head);

    const list = document.createElement("ol");
    list.className = "tei-bibl";
    const biblNodes = [
      ...getByTag(listBibl, "biblStruct"),
      ...getByTag(listBibl, "bibl"),
    ];
    biblNodes.forEach((bibl) => {
      const item = document.createElement("li");
      item.textContent = extractText(bibl);
      list.appendChild(item);
    });
    refSection.appendChild(list);
    container.appendChild(refSection);
  }

  docView.appendChild(container);
  return true;
}

function extractText(node) {
  if (!node) return "";
  return node.textContent.replace(/\s+/g, " ").trim();
}

function formatAuthor(authorNode) {
  if (!authorNode) return "";
  const forenames = getByTag(authorNode, "forename").map((n) => extractText(n));
  const surname = extractText(getByTag(authorNode, "surname")[0]);
  const name = [...forenames, surname].filter(Boolean).join(" ");
  return name || extractText(authorNode);
}

function renderTeiChildren(node, parent, fallbackSection) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType !== 1) return;
    const tag = (child.localName || child.tagName || "").toLowerCase();

    if (tag === "div") {
      const headNode = Array.from(child.children).find(
        (el) => (el.localName || el.tagName || "").toLowerCase() === "head"
      );
      const title = extractText(headNode);
      if (!title) {
        renderTeiChildren(child, parent, fallbackSection);
        return;
      }
      const section = document.createElement("section");
      section.className = "tei-section";
      section.dataset.section = title;
      const h3 = document.createElement("h3");
      h3.textContent = title;
      section.appendChild(h3);
      parent.appendChild(section);
      renderTeiChildren(child, section, title);
      return;
    }

    if (tag === "head") {
      return;
    }

    if (tag === "p") {
      const p = document.createElement("p");
      p.className = "doc-paragraph";
      p.textContent = extractText(child);
      parent.appendChild(p);
      return;
    }

    if (tag === "figure") {
      const fig = document.createElement("div");
      fig.className = "tei-figure";
      const figHead = extractText(getByTag(child, "head")[0]);
      const figDesc = extractText(getByTag(child, "figDesc")[0]);
      const graphic = getByTag(child, "graphic")[0] || null;
      const graphicRef = graphic?.getAttribute("url") || graphic?.getAttribute("target") || "";
      const title = figHead || "Figure";
      const label = document.createElement("div");
      label.className = "tei-figure-title";
      label.textContent = title;
      fig.appendChild(label);
      if (graphicRef) {
        const ref = document.createElement("div");
        ref.className = "tei-figure-desc";
        ref.textContent = `Graphic: ${graphicRef}`;
        fig.appendChild(ref);
      }
      if (figDesc) {
        const desc = document.createElement("div");
        desc.className = "tei-figure-desc";
        desc.textContent = figDesc;
        fig.appendChild(desc);
      }
      const figTable = getByTag(child, "table")[0] || null;
      if (figTable) {
        const tableEl = buildTable(figTable);
        if (tableEl) fig.appendChild(tableEl);
      }
      parent.appendChild(fig);
      return;
    }

    if (tag === "table") {
      const tableEl = buildTable(child);
      if (tableEl) parent.appendChild(tableEl);
      return;
    }

    if (tag === "formula") {
      const block = document.createElement("div");
      block.className = "tei-formula";
      const formulaText = extractText(child);
      block.textContent = formulaText || "[Formula]";
      parent.appendChild(block);
      return;
    }

    if (tag === "list") {
      const ul = document.createElement("ul");
      ul.className = "tei-list";
      getByTag(child, "item").forEach((itemNode) => {
        const li = document.createElement("li");
        li.textContent = extractText(itemNode);
        ul.appendChild(li);
      });
      parent.appendChild(ul);
      return;
    }

    renderTeiChildren(child, parent, fallbackSection);
  });
}

function buildTable(tableNode) {
  const rows = getByTag(tableNode, "row");
  if (rows.length === 0) {
    const fallback = extractText(tableNode);
    if (!fallback) return null;
    const wrap = document.createElement("div");
    wrap.className = "tei-table-wrap";
    const badge = document.createElement("img");
    badge.className = "tei-table-badge";
    badge.src = withBase("/assets/icon.png");
    badge.alt = "Table";
    const pre = document.createElement("div");
    pre.className = "tei-figure-desc";
    pre.textContent = fallback;
    wrap.appendChild(badge);
    wrap.appendChild(pre);
    return wrap;
  }

  const wrap = document.createElement("div");
  wrap.className = "tei-table-wrap";
  const badge = document.createElement("img");
  badge.className = "tei-table-badge";
  badge.src = withBase("/assets/icon.png");
  badge.alt = "Table";

  const table = document.createElement("table");
  table.className = "tei-table";
  rows.forEach((rowNode) => {
    const tr = document.createElement("tr");
    getByTag(rowNode, "cell").forEach((cellNode) => {
      const td = document.createElement("td");
      td.textContent = extractText(cellNode);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  wrap.appendChild(badge);
  wrap.appendChild(table);
  return wrap;
}

function getByTag(root, tag) {
  if (!root) return [];
  if (root.getElementsByTagNameNS) {
    return Array.from(root.getElementsByTagNameNS("*", tag));
  }
  return Array.from(root.getElementsByTagName(tag));
}

function renderHighlights() {
  const list = el("highlightList");
  list.innerHTML = "";
  const available = state.highlights.filter((hl) => !hl.used);
  if (available.length === 0) {
    list.innerHTML = '<div class="muted">No highlights yet.</div>';
    return;
  }

  available.forEach((hl) => {
    const item = document.createElement("div");
    item.className = `highlight-entry ${hl.used ? "used" : ""}`;

    const text = document.createElement("div");
    text.textContent = hl.text;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Section: ${hl.section}${hl.page ? ` - Page ${hl.page}` : ""}${hl.used ? " - Used" : ""}`;

    const pageInput = document.createElement("input");
    pageInput.type = "text";
    pageInput.placeholder = "Page #";
    pageInput.value = hl.page || "";
    pageInput.addEventListener("input", (e) => {
      hl.page = e.target.value.trim();
    });

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      removeHighlight(hl.id);
      state.highlightSelection.concept.delete(hl.id);
      state.highlightSelection.argument.delete(hl.id);
      renderHighlights();
      renderHighlightPickers();
    });

    item.appendChild(text);
    item.appendChild(meta);
    item.appendChild(pageInput);
    item.appendChild(remove);
    list.appendChild(item);
  });
}

function renderHighlightPickers() {
  const pickers = [
    { id: "highlightPicker", key: "concept" },
    { id: "highlightPickerArgument", key: "argument" },
  ];

  pickers.forEach(({ id, key }) => {
    const container = el(id);
    container.innerHTML = "";

    const available = state.highlights.filter((h) => !h.used);
    if (available.length === 0) {
      container.innerHTML = '<div class="muted">No highlights to attach.</div>';
      return;
    }

    available.forEach((hl) => {
      const row = document.createElement("label");
      row.className = "highlight-pill";
      row.title = `Section: ${hl.section}${hl.page ? ` - Page ${hl.page}` : ""}`;

      const text = document.createElement("span");
      text.className = "highlight-pill-text";
      text.textContent = hl.text;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.highlightSelection[key].has(hl.id);
      checkbox.addEventListener("change", (e) => {
        if (e.target.checked) {
          state.highlightSelection[key].add(hl.id);
        } else {
          state.highlightSelection[key].delete(hl.id);
        }
      });

      row.appendChild(text);
      row.appendChild(checkbox);
      container.appendChild(row);
    });
  });
}

function removeHighlight(id) {
  const mark = document.querySelector(`mark[data-hid="${id}"]`);
  if (mark) {
    mark.replaceWith(document.createTextNode(mark.textContent));
  }
  state.highlights = state.highlights.filter((h) => h.id !== id);
}

function consumeHighlights(ids) {
  ids.forEach((id) => {
    const hl = state.highlights.find((h) => h.id === id);
    if (!hl) return;
    hl.used = true;
    const mark = document.querySelector(`mark[data-hid="${id}"]`);
    if (mark) mark.classList.add("used");
  });
}

function renderConceptList() {
  const list = el("conceptList");
  list.innerHTML = "";
  if (state.annotations.concepts.length === 0) {
    list.innerHTML = '<div class="muted">No concepts yet.</div>';
    return;
  }

  state.annotations.concepts.forEach((concept) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const info = document.createElement("div");
    const roles = (concept.roles || []).join(", ");
    const sourceCount = concept.source_refs ? concept.source_refs.length : 0;
    info.innerHTML = `
      <div><strong>${concept.concept_id}</strong> ${concept.label}</div>
      <div class="meta">${concept.type || "Uncategorized"}${roles ? ` • ${roles}` : ""}</div>
      <div class="meta">Source refs: ${sourceCount}</div>
    `;

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      state.annotations.concepts = state.annotations.concepts.filter((c) => c.concept_id !== concept.concept_id);
      renderConceptList();
      renderArgumentConceptRefs();
    });

    item.appendChild(info);
    item.appendChild(remove);
    list.appendChild(item);
  });
}

function renderArgumentList() {
  const list = el("argumentList");
  list.innerHTML = "";
  if (state.annotations.arguments.length === 0) {
    list.innerHTML = '<div class="muted">No arguments yet.</div>';
    return;
  }

  state.annotations.arguments.forEach((argument) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const info = document.createElement("div");
    const preview = argument.text ? `${argument.text.slice(0, 80)}${argument.text.length > 80 ? "..." : ""}` : "";
    const conceptCount = argument.concept_refs ? argument.concept_refs.length : 0;
    info.innerHTML = `
      <div><strong>${argument.argument_id}</strong> ${formatTypeLabel(argument.arg_type || "")}</div>
      <div class="meta">${preview}</div>
      <div class="meta">Concept refs: ${conceptCount}</div>
    `;

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      state.annotations.arguments = state.annotations.arguments.filter((a) => a.argument_id !== argument.argument_id);
      renderArgumentList();
      renderFlowGuide();
    });

    item.appendChild(info);
    item.appendChild(remove);
    list.appendChild(item);
  });
}

function renderArgumentConceptRefs() {
  const container = el("argumentConceptRefs");
  container.innerHTML = "";

  if (state.annotations.concepts.length === 0) {
    container.innerHTML = '<div class="muted">Optional. Add concepts first if needed.</div>';
    return;
  }

  state.annotations.concepts.forEach((concept) => {
    const label = document.createElement("label");
    label.className = "ref-pill";
    const text = document.createElement("span");
    text.textContent = `${concept.concept_id} ${concept.label}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = concept.concept_id;
    label.appendChild(text);
    label.appendChild(checkbox);
    container.appendChild(label);
  });
}

function populateSelects() {
  const argumentSelect = el("argumentType");
  argumentTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = formatTypeLabel(type);
    argumentSelect.appendChild(option);
  });
}

function addHighlight() {
  setHint("");
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    setHint("Select text in a single paragraph first.");
    showToast("Select text in a paragraph, then click Add Grounding.", "error");
    return;
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;

  const block = container.closest(
    ".doc-paragraph, p, h1, h2, h3, li, td, .tei-figure-desc, .tei-figure-title"
  );
  const sectionEl = container.closest("[data-section]");
  let sectionLabel = sectionEl?.dataset.section || "Body";

  if (!block) {
    setHint("Select text inside the document body.");
    showToast("Select text inside the document content.", "error");
    return;
  }

  try {
    const mark = document.createElement("mark");
    const id = `H${state.highlights.length + 1}`;
    mark.dataset.hid = id;
    range.surroundContents(mark);

    const text = selection.toString().trim();
    if (!text) return;

    state.highlights.push({
      id,
      text,
      section: sectionLabel,
      page: "",
      used: false,
    });

    const activeTab = document.querySelector(".tab.active")?.dataset.tab;
    if (activeTab === "argument") {
      state.highlightSelection.argument.add(id);
      requestNormalization(text);
    } else if (activeTab === "concept") {
      state.highlightSelection.concept.add(id);
      const labelInput = el("conceptLabel");
      if (labelInput && !labelInput.value.trim()) {
        labelInput.value = text;
      }
    }

    selection.removeAllRanges();
    renderHighlights();
    renderHighlightPickers();
  } catch (err) {
    setHint("Highlight must stay within a single paragraph.");
    showToast("Highlight must stay within a single paragraph.", "error");
  }
}

function createConcept() {
  const label = el("conceptLabel").value.trim();
  if (!label) {
    showToast("Add a concept label.", "error");
    return;
  }

  const aliases = normalizeAliases(el("conceptAliases").value);
  const typePath = state.conceptTypePath || [];
  if (!typePath.length) {
    showToast("Select a concept category.", "error");
    return;
  }
  const type = typePath.join(" > ");

  const sourceRefs = Array.from(state.highlightSelection.concept).map((id) => {
    const hl = state.highlights.find((h) => h.id === id);
    if (!hl) return null;
    return { section: hl.section, page: hl.page || null };
  }).filter(Boolean);

  const concept = {
    concept_id: uniqueId("C", state.annotations.concepts),
    label,
    aliases: aliases.length ? aliases : undefined,
    type,
    source_refs: sourceRefs.length ? sourceRefs : undefined,
  };

  state.annotations.concepts.push(concept);
  consumeHighlights(Array.from(state.highlightSelection.concept));
  el("conceptLabel").value = "";
  el("conceptAliases").value = "";
  state.conceptTypePath = [];
  renderConceptTypePicker();
  renderConceptTypePath();
  document.querySelectorAll(".roles input").forEach((input) => (input.checked = false));
  state.highlightSelection.concept.clear();

  renderConceptList();
  renderArgumentConceptRefs();
  renderHighlightPickers();
  renderHighlights();
}

function createArgument() {
  const text = el("argumentText").value.trim();
  if (!text) {
    showToast("Add canonical text for the argument.", "error");
    return;
  }

  const argType = el("argumentType").value;
  const conceptRefs = Array.from(el("argumentConceptRefs").querySelectorAll("input:checked")).map(
    (input) => input.value
  );

  const sourceRefs = Array.from(state.highlightSelection.argument).map((id) => {
    const hl = state.highlights.find((h) => h.id === id);
    if (!hl) return null;
    return { section: hl.section, page: hl.page || null };
  }).filter(Boolean);

  const argument = {
    argument_id: uniqueId("A", state.annotations.arguments),
    text,
    arg_type: argType,
    concept_refs: conceptRefs.length ? conceptRefs : undefined,
    source_refs: sourceRefs.length ? sourceRefs : undefined,
  };

  state.annotations.arguments.push(argument);
  consumeHighlights(Array.from(state.highlightSelection.argument));
  el("argumentText").value = "";
  state.highlightSelection.argument.clear();
  el("argumentConceptRefs").querySelectorAll("input").forEach((input) => (input.checked = false));

  renderArgumentList();
  renderHighlightPickers();
  renderHighlights();
  renderFlowGuide();
}

async function uploadPdf() {
  const file = el("pdfInput").files[0];
  if (!file) {
    showToast("Choose a PDF first.", "error");
    return;
  }

  const form = new FormData();
  form.append("file", file);

  setHint("");
  const loadingToast = showToast("Parsing PDF with Grobid...", "loading", { persist: true });
  const res = await fetch(withBase("/api/upload"), { method: "POST", body: form });
  if (!res.ok) {
    if (loadingToast) loadingToast.remove();
    showToast("Upload failed.", "error");
    return;
  }

  const data = await res.json();
  state.paperId = data.paper_id;
  state.pdfHash = data.pdf_hash || "";
  state.metadata = data.metadata || {};
  state.doc = data.doc;
  state.teiXml = data.tei_xml || "";
  state.annotations = data.annotation || { concepts: [], arguments: [], created_at: null };
  state.metadataChecks = data.annotation?.metadata_checks || {};
  state.highlights = [];
  state.highlightSelection.concept.clear();
  state.highlightSelection.argument.clear();
  state.conceptTypePath = [];

  el("paperInfo").textContent = `Saved as dataset/papers/${state.paperId}.{pdf,tei.xml,md,json}`;

  renderMetadata();
  renderDoc();
  renderHighlights();
  renderHighlightPickers();
  renderConceptList();
  renderArgumentList();
  renderArgumentConceptRefs();
  renderConceptTypePicker();
  renderConceptTypePath();
  renderFlowGuide();
  if (loadingToast) loadingToast.remove();
  if (data.existing) {
    showToast("Existing annotation loaded for this paper.", "success");
  } else {
    showToast("Paper loaded and ready to annotate.", "success");
  }
}

function validateRequiredArguments() {
  const present = new Set(
    (state.annotations.arguments || []).map((arg) => normalizeArgType(arg.arg_type))
  );
  return requiredArgumentTypes.filter((type) => !present.has(type));
}

async function submitAnnotations() {
  if (!state.paperId) {
    showToast("Upload a paper first.", "error");
    return;
  }

  const missing = validateRequiredArguments();
  if (missing.length) {
    showToast(
      `Missing required arguments: ${missing.map(formatTypeLabel).join(", ")}`,
      "error",
      { duration: 4000 }
    );
    renderFlowGuide();
    return;
  }

  const payload = {
    metadata: state.metadata,
    metadata_checks: state.metadataChecks,
    concepts: state.annotations.concepts,
    arguments: state.annotations.arguments,
    created_at: state.annotations.created_at,
    pdf_hash: state.pdfHash,
  };

  const savingToast = showToast("Saving annotations...", "loading", { persist: true });
  const res = await fetch(withBase(`/api/annotation/${state.paperId}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (savingToast) savingToast.remove();
  if (res.ok) {
    showToast("Annotations submitted successfully.", "success");
  } else {
    showToast("Save failed.", "error");
  }
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      el(`${tab.dataset.tab}Tab`).classList.add("active");
    });
  });
}

function wireNavigation() {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
      button.classList.add("active");
      const target = document.getElementById(button.dataset.page);
      if (target) target.classList.add("active");
      if (button.dataset.page === "libraryPage" && !state.library.loaded) {
        fetchLibrary();
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function init() {
  populateSelects();
  renderMetadata();
  renderDoc();
  renderHighlights();
  renderHighlightPickers();
  renderConceptList();
  renderArgumentList();
  renderArgumentConceptRefs();
  renderConceptTypePicker();
  renderConceptTypePath();
  renderFlowGuide();
  wireTabs();
  wireNavigation();
  wireLibraryControls();

  el("paperInfo").textContent = "Files will save under dataset/papers/";

  el("uploadBtn").addEventListener("click", uploadPdf);
  el("addHighlightBtn").addEventListener("click", addHighlight);
  el("addConceptBtn").addEventListener("click", createConcept);
  el("addArgumentBtn").addEventListener("click", createArgument);
  el("submitBtn").addEventListener("click", submitAnnotations);
}

init();
