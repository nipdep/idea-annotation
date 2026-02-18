const artifactTypes = [
  "algorithm",
  "component",
  "dataset",
  "framework",
  "hyperparameter",
  "metric",
  "model",
  "task",
  "resource",
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

const descriptorTypes = [
  "description",
  "definition",
  "composition",
  "comparison",
  "limitation",
];

const requiredArgumentTypes = ["issue", "idea", "approach", "claim"];

const state = {
  paperId: null,
  pdfHash: "",
  metadata: {},
  metadataChecks: {},
  doc: null,
  teiXml: "",
  annotations: { concepts: [], arguments: [], descriptors: [], created_at: null },
  highlights: [],
  pendingSelection: null,
  argumentDescription: "",
  docMode: "text",
  virtualHighlightSeq: 0,
  editing: {
    conceptId: null,
    argumentId: null,
    descriptorId: null,
  },
  highlightSelection: {
    concept: new Set(),
    argument: new Set(),
    descriptor: new Set(),
  },
  conceptType: "",
  library: {
    items: [],
    filtered: [],
    selectedId: null,
    view: "table",
    loaded: false,
    expanded: new Set(),
    selectedInstance: null,
    graphPositions: {},
    descriptorOffsets: {},
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
  const hint = el("highlightHint");
  if (hint) hint.textContent = message || "";
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

function showChecklistToast(requiredTypes, presentTypes, options = {}) {
  const container = el("toastContainer");
  if (!container) return null;
  const toast = document.createElement("div");
  toast.className = "toast checklist";

  const title = document.createElement("div");
  title.className = "toast-title";
  title.textContent = "Missing required argument types";
  toast.appendChild(title);

  const list = document.createElement("div");
  list.className = "toast-checklist";
  const present = new Set(presentTypes || []);
  requiredTypes.forEach((type) => {
    const item = document.createElement("div");
    const done = present.has(type);
    item.className = `toast-checklist-item ${done ? "done" : "missing"}`;

    const icon = document.createElement("span");
    icon.className = "toast-checklist-icon";
    icon.textContent = done ? "✓" : "✕";

    const label = document.createElement("span");
    label.textContent = formatTypeLabel(type);

    item.appendChild(icon);
    item.appendChild(label);
    list.appendChild(item);
  });

  toast.appendChild(list);
  container.appendChild(toast);

  const duration = options.duration || 8000;
  setTimeout(() => toast.remove(), duration);
  return toast;
}

function updateDescription(kind) {
  if (kind !== "argument") return;
  const ids = Array.from(state.highlightSelection[kind]);
  const texts = state.highlights
    .filter((hl) => ids.includes(hl.id) && !hl.virtual)
    .map((hl) => hl.text);
  state.argumentDescription = texts.join("\n\n");
  const textarea = el("argumentDescription");
  if (textarea) textarea.value = state.argumentDescription;
}

function clearVirtualHighlights(target) {
  state.highlights = state.highlights.filter((hl) => {
    const remove = hl.virtual && (!target || hl.target === target);
    if (!remove) return true;
    state.highlightSelection.concept.delete(hl.id);
    state.highlightSelection.argument.delete(hl.id);
    state.highlightSelection.descriptor.delete(hl.id);
    return false;
  });
}

function hydrateSourceRefsForEdit(target, sourceRefs, single = false) {
  clearVirtualHighlights(target);
  if (target === "concept") {
    state.highlightSelection.concept.clear();
  } else if (target === "argument") {
    state.highlightSelection.argument.clear();
    updateDescription("argument");
  } else {
    state.highlightSelection.descriptor.clear();
  }
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return;
  const created = [];

  sourceRefs.forEach((ref, idx) => {
    if (!ref) return;
    if (single && idx > 0) return;
    const section = ref.section || "Body";
    const page = ref.page == null ? "" : String(ref.page);
    const fallbackText = page ? `${section} (p.${page})` : section;
    const text = normalizeSourceRefValue(ref.text, fallbackText);
    const id = `V${++state.virtualHighlightSeq}`;

    state.highlights.push({
      id,
      text,
      section,
      page,
      used: false,
      target,
      virtual: true,
    });
    created.push(id);
  });

  if (target === "concept") {
    if (created[0]) state.highlightSelection.concept.add(created[0]);
  } else if (target === "argument") {
    created.forEach((id) => state.highlightSelection.argument.add(id));
    updateDescription("argument");
  } else {
    created.forEach((id) => state.highlightSelection.descriptor.add(id));
  }
}

function hydrateArgumentRefsFromDescription(description, sourceRefs) {
  clearVirtualHighlights("argument");
  state.highlightSelection.argument.clear();
  updateDescription("argument");

  const refs = Array.isArray(sourceRefs) ? sourceRefs : [];
  const chunks = String(description || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const total = Math.max(chunks.length, refs.length);
  if (!total) return;

  const created = [];
  for (let i = 0; i < total; i += 1) {
    const ref = refs[i] || {};
    const section = ref.section || "Body";
    const page = ref.page == null ? "" : String(ref.page);
    const fallbackText = page ? `${section} (p.${page})` : section;
    const text = chunks[i] || fallbackText;
    const id = `V${++state.virtualHighlightSeq}`;

    state.highlights.push({
      id,
      text,
      section,
      page,
      used: false,
      target: "argument",
      virtual: true,
    });
    created.push(id);
  }

  created.forEach((id) => state.highlightSelection.argument.add(id));
}

function getSelectionContext(range) {
  const element = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const sectionEl = element ? element.closest("[data-section]") : null;
  return {
    section: sectionEl?.dataset.section || "Body",
  };
}

function showSelectionMenu(rect) {
  const menu = el("selectionMenu");
  if (!menu) return;
  menu.classList.remove("hidden");
  menu.style.visibility = "hidden";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const padding = 8;
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 6;

  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - padding;
  }
  if (top + menuHeight > window.innerHeight + window.scrollY) {
    top = rect.top + window.scrollY - menuHeight - 6;
  }

  menu.style.left = `${Math.max(padding, left)}px`;
  menu.style.top = `${Math.max(padding, top)}px`;
  menu.style.visibility = "visible";
}

function hideSelectionMenu() {
  const menu = el("selectionMenu");
  if (!menu) return;
  menu.classList.add("hidden");
}

function handleDocSelection() {
  const docView = el("docView");
  if (!docView) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    state.pendingSelection = null;
    hideSelectionMenu();
    return;
  }

  const range = selection.getRangeAt(0);
  if (!docView.contains(range.commonAncestorContainer)) {
    state.pendingSelection = null;
    hideSelectionMenu();
    return;
  }

  const context = getSelectionContext(range);
  const text = selection.toString().trim();
  if (!context || !text) {
    state.pendingSelection = null;
    hideSelectionMenu();
    return;
  }

  state.pendingSelection = {
    range: range.cloneRange(),
    text,
    section: context.section,
  };
  showSelectionMenu(range.getBoundingClientRect());
}

function commitPendingHighlight(target) {
  const pending = state.pendingSelection;
  if (!pending || !pending.range || !pending.text) {
    showToast("Select text in the document first.", "error");
    return;
  }

  try {
    const mark = document.createElement("mark");
    const id = `H${state.highlights.length + 1}`;
    mark.dataset.hid = id;
    try {
      pending.range.surroundContents(mark);
    } catch (err) {
      const contents = pending.range.extractContents();
      mark.appendChild(contents);
      pending.range.insertNode(mark);
    }

    state.highlights.push({
      id,
      text: pending.text,
      section: pending.section,
      page: "",
      used: false,
      target,
    });

    if (target === "argument") {
      state.highlightSelection.argument.add(id);
      updateDescription("argument");
      requestNormalization(pending.text);
    } else if (target === "descriptor") {
      state.highlightSelection.descriptor.add(id);
    } else {
      const existingConceptIds = Array.from(state.highlightSelection.concept);
      existingConceptIds.forEach((existingId) => removeHighlight(existingId));
      state.highlightSelection.concept.clear();
      state.highlightSelection.concept.add(id);
      const labelInput = el("conceptLabel");
      if (labelInput) {
        labelInput.value = pending.text;
      }
    }

    window.getSelection().removeAllRanges();
    state.pendingSelection = null;
    hideSelectionMenu();
    renderHighlightPickers();
  } catch (err) {
    showToast("Could not create highlight. Try a smaller selection.", "error");
  }
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

function normalizeAnnotations(annotation) {
  const base = annotation || {};
  return {
    concepts: Array.isArray(base.concepts) ? base.concepts : [],
    arguments: Array.isArray(base.arguments) ? base.arguments : [],
    descriptors: Array.isArray(base.descriptors) ? base.descriptors : [],
    created_at: base.created_at || null,
    updated_at: base.updated_at || null,
  };
}

function renderArtifactTypeSelect() {
  const select = el("artifactType");
  if (!select) return;
  const current = state.conceptType || "";
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a category";
  select.appendChild(placeholder);

  artifactTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = formatTypeLabel(type);
    select.appendChild(option);
  });

  select.value = artifactTypes.includes(current) ? current : "";
  select.onchange = (event) => {
    state.conceptType = event.target.value || "";
  };
}

function normalizeArgType(value) {
  return String(value || "").toLowerCase();
}

const argumentClassNames = [
  "Issue",
  "Idea",
  "Approach",
  "Evidence",
  "Claim",
  "Warrant",
  "Backing",
  "Qualifier",
  "Rebuttal",
];

const argumentClassRelations = [
  { source: "Idea", target: "Issue", label: "resolves" },
  { source: "Idea", target: "Approach", label: "realizes" },
  { source: "Approach", target: "Evidence", label: "generates" },
  { source: "Evidence", target: "Claim", label: "supports" },
  { source: "Warrant", target: "Claim", label: "warrants" },
  { source: "Backing", target: "Claim", label: "backs" },
  { source: "Qualifier", target: "Claim", label: "qualifies" },
  { source: "Rebuttal", target: "Claim", label: "rebuts" },
];

function mapArgumentToClass(argType) {
  const type = normalizeArgType(argType);
  if (type === "issue") return "Issue";
  if (type === "idea") return "Idea";
  if (type === "approach") return "Approach";
  if (type === "claim" || type === "central argument") return "Claim";
  if (type === "warrant") return "Warrant";
  if (type === "backing") return "Backing";
  if (type === "qualifier") return "Qualifier";
  if (type === "rebuttal") return "Rebuttal";
  if (type === "evidence" || type === "result" || type.startsWith("experiment")) return "Evidence";
  return null;
}

function activateAnnotationTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const content = el(`${tabName}Tab`);
  if (tab) tab.classList.add("active");
  if (content) content.classList.add("active");
}

function setConceptButtonMode() {
  const btn = el("addConceptBtn");
  if (!btn) return;
  btn.textContent = state.editing.conceptId ? "Save Artifact" : "Add Artifact";
}

function setArgumentButtonMode() {
  const btn = el("addArgumentBtn");
  if (!btn) return;
  btn.textContent = state.editing.argumentId ? "Save Argument" : "Add Argument";
}

function setDescriptorButtonMode() {
  const btn = el("addDescriptorBtn");
  if (!btn) return;
  btn.textContent = state.editing.descriptorId ? "Save Descriptor" : "Add Descriptor";
}

function resetConceptEditor() {
  state.editing.conceptId = null;
  clearVirtualHighlights("concept");
  el("conceptLabel").value = "";
  el("conceptAliases").value = "";
  state.conceptType = "";
  const typeSelect = el("artifactType");
  if (typeSelect) typeSelect.value = "";
  state.highlightSelection.concept.clear();
  renderArtifactTypeSelect();
  renderHighlightPickers();
  setConceptButtonMode();
  renderConceptList();
}

function resetArgumentEditor() {
  state.editing.argumentId = null;
  clearVirtualHighlights("argument");
  el("argumentText").value = "";
  el("argumentType").value = argumentTypes[0];
  state.argumentDescription = "";
  state.highlightSelection.argument.clear();
  updateDescription("argument");
  el("argumentConceptRefs")
    .querySelectorAll(".ref-pill")
    .forEach((pill) => pill.classList.remove("selected"));
  renderHighlightPickers();
  setArgumentButtonMode();
  renderArgumentList();
}

function resetDescriptorEditor() {
  state.editing.descriptorId = null;
  clearVirtualHighlights("descriptor");
  el("descriptorType").value = descriptorTypes[0];
  state.highlightSelection.descriptor.clear();
  el("descriptorConceptRefs")
    .querySelectorAll(".ref-pill")
    .forEach((pill) => pill.classList.remove("selected"));
  renderHighlightPickers();
  setDescriptorButtonMode();
  renderDescriptorList();
}

function startConceptEdit(conceptId) {
  const concept = state.annotations.concepts.find((c) => c.concept_id === conceptId);
  if (!concept) return;
  if (state.editing.conceptId === conceptId) {
    resetConceptEditor();
    return;
  }
  state.editing.conceptId = conceptId;
  activateAnnotationTab("concept");
  el("conceptLabel").value = concept.label || "";
  el("conceptAliases").value = (concept.aliases || []).join(", ");
  state.conceptType = String(concept.type || "").trim().toLowerCase();
  const typeSelect = el("artifactType");
  if (typeSelect) typeSelect.value = state.conceptType;
  hydrateSourceRefsForEdit("concept", concept.source_refs, true);
  renderArtifactTypeSelect();
  renderHighlightPickers();
  setConceptButtonMode();
  renderConceptList();
}

function startArgumentEdit(argumentId) {
  const argument = state.annotations.arguments.find((a) => a.argument_id === argumentId);
  if (!argument) return;
  if (state.editing.argumentId === argumentId) {
    resetArgumentEditor();
    return;
  }
  state.editing.argumentId = argumentId;
  activateAnnotationTab("argument");
  el("argumentText").value = argument.text || "";
  el("argumentType").value = argument.arg_type || argumentTypes[0];
  state.argumentDescription = argument.description || "";
  hydrateArgumentRefsFromDescription(argument.description, argument.source_refs);
  renderArgumentConceptRefs();
  const selected = new Set(argument.concept_refs || []);
  el("argumentConceptRefs")
    .querySelectorAll(".ref-pill")
    .forEach((pill) => {
      const isSelected = selected.has(pill.dataset.conceptId);
      pill.classList.toggle("selected", isSelected);
      pill.dataset.selected = isSelected ? "true" : "false";
    });
  renderHighlightPickers();
  setArgumentButtonMode();
  renderArgumentList();
}

function startDescriptorEdit(descriptorId) {
  const descriptor = state.annotations.descriptors.find((d) => d.descriptor_id === descriptorId);
  if (!descriptor) return;
  if (state.editing.descriptorId === descriptorId) {
    resetDescriptorEditor();
    return;
  }
  state.editing.descriptorId = descriptorId;
  activateAnnotationTab("descriptor");
  el("descriptorType").value = descriptor.descriptor_type || descriptorTypes[0];
  hydrateSourceRefsForEdit("descriptor", descriptor.source_refs, false);
  renderDescriptorConceptRefs();
  const selected = new Set(descriptor.concept_refs || []);
  el("descriptorConceptRefs")
    .querySelectorAll(".ref-pill")
    .forEach((pill) => {
      const isSelected = selected.has(pill.dataset.conceptId);
      pill.classList.toggle("selected", isSelected);
      pill.dataset.selected = isSelected ? "true" : "false";
    });
  renderHighlightPickers();
  setDescriptorButtonMode();
  renderDescriptorList();
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
  const descriptorTypesText = (item.descriptors || []).map((d) => d.descriptor_type || "").join(" ");
  return [
    metadata.title || "",
    flattenAuthors(metadata.authors),
    metadata.doi || "",
    metadata.venue || "",
    metadata.year || "",
    conceptLabels,
    argumentTexts,
    descriptorTypesText,
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
  svg.setAttribute("viewBox", "0 0 800 420");

  const items = state.library.filtered || [];
  const count = items.length;
  const selected = items.find((item) => item.paper_id === state.library.selectedId);
  if (selected) {
    renderPaperFocusedGraph(svg, selected);
    return;
  }
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function layoutNodesInBand(items, minX, maxX, minY, maxY, maxCols) {
  if (!items.length) return [];
  const cols = Math.min(Math.max(1, maxCols), items.length);
  const rows = Math.ceil(items.length / cols);
  const xSpan = Math.max(0, maxX - minX);
  const ySpan = Math.max(0, maxY - minY);
  const xStep = cols > 1 ? xSpan / (cols - 1) : 0;
  const yStep = rows > 1 ? ySpan / (rows - 1) : 0;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return items.map((item, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    return {
      ...item,
      x: cols === 1 ? centerX : minX + xStep * col,
      y: rows === 1 ? centerY : minY + yStep * row,
    };
  });
}

function getBandBounds(layerBands, key, padX = 0, padY = 0, width = 860) {
  const band = layerBands.find((entry) => entry.key === key);
  if (!band) {
    return {
      minX: 40,
      maxX: 820,
      minY: 40,
      maxY: 520,
    };
  }
  return {
    minX: 18 + padX,
    maxX: width - 18 - padX,
    minY: band.y + padY,
    maxY: band.y + band.h - padY,
  };
}

function buildLayeredGraphData(item) {
  const argumentByClass = Object.fromEntries(argumentClassNames.map((name) => [name, []]));

  (item.arguments || []).forEach((arg) => {
    const className = mapArgumentToClass(arg.arg_type);
    if (!className) return;
    argumentByClass[className].push({
      kind: "argument",
      id: arg.argument_id,
      data: arg,
    });
  });

  const artifacts = (item.concepts || []).map((concept) => ({
    kind: "concept",
    id: concept.concept_id,
    data: concept,
  }));

  const descriptors = (item.descriptors || []).map((descriptor) => ({
    kind: "descriptor",
    id: descriptor.descriptor_id,
    data: descriptor,
  }));

  return { argumentByClass, artifacts, descriptors };
}

function drawGraphEdges(svgSel, edges, nodeMap) {
  const edgeGroup = svgSel.append("g");
  const labelGroup = svgSel.append("g");

  const lines = edgeGroup
    .selectAll("line")
    .data(edges)
    .join("line")
    .attr("class", (edge) => `graph-edge graph-edge-${edge.type || "default"}`)
    .attr("stroke-width", (edge) => edge.weight || 1.2)
    .attr("marker-end", (edge) => (edge.directed ? "url(#arrowhead)" : null));

  const labels = labelGroup
    .selectAll("text")
    .data(edges.filter((edge) => edge.label))
    .join("text")
    .attr("text-anchor", "middle")
    .attr("class", (edge) => `graph-edge-label graph-edge-label-${edge.type || "default"}`)
    .text((edge) => edge.label);

  function nodeRadius(node, dx = 0, dy = 0) {
    if (!node) return 0;
    if (node.nodeKind === "argument-class") {
      const halfWidth = (node.w || 0) / 2;
      const halfHeight = (node.h || 0) / 2;
      if (!halfWidth || !halfHeight) return 0;
      const absDx = Math.abs(dx) || 0.0001;
      const absDy = Math.abs(dy) || 0.0001;
      const distanceToVertical = (halfWidth * Math.hypot(dx, dy)) / absDx;
      const distanceToHorizontal = (halfHeight * Math.hypot(dx, dy)) / absDy;
      return Math.min(distanceToVertical, distanceToHorizontal);
    }
    return node.r || 0;
  }

  function updatePositions() {
    lines.each(function updateLine(edge) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy) || 1;
      const sourceRadius = nodeRadius(source, dx, dy);
      const targetRadius = nodeRadius(target, -dx, -dy);
      const x1 = source.x + (dx / length) * sourceRadius;
      const y1 = source.y + (dy / length) * sourceRadius;
      const x2 = target.x - (dx / length) * (targetRadius + 4);
      const y2 = target.y - (dy / length) * (targetRadius + 4);
      window.d3.select(this).attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2);
    });

    labels
      .attr("x", (edge) => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) return 0;
        return (source.x + target.x) / 2;
      })
      .attr("y", (edge) => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) return 0;
        return (source.y + target.y) / 2 - 6;
      });
  }

  updatePositions();
  return { updatePositions };
}

function renderPaperFocusedGraph(svg, item) {
  const width = 860;
  const height = 560;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const { argumentByClass, artifacts, descriptors } = buildLayeredGraphData(item);
  const svgSel = window.d3.select(svg);
  svgSel.selectAll("*").remove();

  const layerBands = [
    { key: "arguments", y: 72, h: 172, label: "ARGUMENT" },
    { key: "artifacts", y: 258, h: 186, label: "ARTIFACTS" },
    { key: "descriptors", y: 454, h: 90, label: "DESCRIPTORS" },
  ];

  const goBackToPaperGraph = () => {
    state.library.selectedId = null;
    state.library.selectedInstance = null;
    state.library.expanded = new Set();
    renderLibraryGraph();
    renderLibraryTable();
    renderLibraryDetail();
  };

  svgSel
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent");

  svgSel
    .append("text")
    .attr("x", 20)
    .attr("y", 32)
    .attr("fill", "#1e1b16")
    .attr("font-size", "14")
    .text((item.metadata?.title || "Selected Paper").slice(0, 95));

  const backButton = svgSel
    .append("g")
    .attr("class", "graph-back-button")
    .attr("transform", `translate(${width - 112}, 14)`)
    .style("cursor", "pointer")
    .on("click", (event) => {
      event.stopPropagation();
      goBackToPaperGraph();
    });

  backButton
    .append("rect")
    .attr("class", "graph-back-button-bg")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 84)
    .attr("height", 26)
    .attr("rx", 9)
    .attr("ry", 9);

  backButton
    .append("text")
    .attr("class", "graph-back-button-label")
    .attr("x", 42)
    .attr("y", 17)
    .attr("text-anchor", "middle")
    .text("Go back");

  const layerGroup = svgSel.append("g");
  layerBands.forEach((band) => {
    layerGroup
      .append("rect")
      .attr("class", `graph-layer-band graph-layer-band-${band.key}`)
      .attr("x", 18)
      .attr("y", band.y)
      .attr("rx", 14)
      .attr("ry", 14)
      .attr("width", width - 36)
      .attr("height", band.h);

    layerGroup
      .append("text")
      .attr("class", "graph-layer-label")
      .attr("x", 34)
      .attr("y", band.y + 18)
      .text(band.label);
  });

  const defs = svgSel.append("defs");
  defs
    .append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 9)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#d0c6bd");

  const argumentBand = getBandBounds(layerBands, "arguments", 40, 10, width);
  const artifactBand = getBandBounds(layerBands, "artifacts", 44, 16, width);
  const descriptorBand = getBandBounds(layerBands, "descriptors", 36, 14, width);
  const descriptorOffsets = state.library.descriptorOffsets || (state.library.descriptorOffsets = {});
  const descriptorYMin = descriptorBand.minY + 8;
  const descriptorYMax = descriptorBand.maxY - 8;

  const classNodeDefs = argumentClassNames.map((name) => ({
    id: `class:${name}`,
    label: name,
    nodeKind: "argument-class",
    className: name,
    w: clamp(Math.round(name.length * 7.6 + 16), 56, 96),
    h: 24,
    rx: 8,
    hasInstances: (argumentByClass[name] || []).length > 0,
  }));
  const classDefMap = new Map(classNodeDefs.map((node) => [node.className, node]));
  const topClassOrder = ["Warrant", "Backing", "Qualifier", "Rebuttal"];
  const bottomClassOrder = ["Issue", "Idea", "Approach", "Evidence", "Claim"];
  const topClassNodes = layoutNodesInBand(
    topClassOrder.map((name) => classDefMap.get(name)).filter(Boolean),
    argumentBand.minX + 28,
    argumentBand.maxX - 28,
    argumentBand.minY + 28,
    argumentBand.minY + 28,
    4
  );
  const bottomClassNodes = layoutNodesInBand(
    bottomClassOrder.map((name) => classDefMap.get(name)).filter(Boolean),
    argumentBand.minX,
    argumentBand.maxX,
    argumentBand.minY + 78,
    argumentBand.minY + 78,
    5
  );
  const placedClassNames = new Set([...topClassOrder, ...bottomClassOrder]);
  const remainingClassNodes = layoutNodesInBand(
    classNodeDefs.filter((node) => !placedClassNames.has(node.className)),
    argumentBand.minX,
    argumentBand.maxX,
    argumentBand.minY + 112,
    argumentBand.minY + 112,
    5
  );
  const classNodes = [...topClassNodes, ...bottomClassNodes, ...remainingClassNodes];

  const artifactCols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(Math.max(1, artifacts.length)))));
  const artifactNodes = layoutNodesInBand(
    artifacts.map((artifact) => ({
      id: `artifact:${artifact.id}`,
      label: artifact.data?.label || artifact.id,
      nodeKind: "artifact",
      entity: artifact,
      r: 14,
    })),
    artifactBand.minX,
    artifactBand.maxX,
    artifactBand.minY + 10,
    artifactBand.maxY - 10,
    artifactCols
  );

  artifactNodes.forEach((node) => {
    const cached = state.library.graphPositions[node.id];
    if (!cached) return;
    node.x = clamp(cached.x, artifactBand.minX, artifactBand.maxX);
    node.y = clamp(cached.y, artifactBand.minY + 10, artifactBand.maxY - 10);
  });

  const nodeMap = new Map();
  [...classNodes, ...artifactNodes].forEach((node) => nodeMap.set(node.id, node));

  const edges = [];
  argumentClassRelations.forEach((rel) => {
    edges.push({
      source: `class:${rel.source}`,
      target: `class:${rel.target}`,
      label: rel.label,
      directed: true,
      type: "class-relation",
    });
  });

  const expandedClassKeys = new Set(
    [...state.library.expanded].filter((key) => key.startsWith("arg:"))
  );
  expandedClassKeys.forEach((key) => {
    const className = key.slice(4);
    const classNode = nodeMap.get(`class:${className}`);
    const instances = argumentByClass[className] || [];
    if (!classNode || !instances.length) return;

    const instanceNodes = layoutNodesInBand(
      instances.map((inst) => ({
        id: `argument:${inst.id}`,
        label: inst.id,
        nodeKind: "argument",
        entity: inst,
        r: 14,
      })),
      clamp(classNode.x - 75, argumentBand.minX, argumentBand.maxX - 40),
      clamp(classNode.x + 75, argumentBand.minX + 40, argumentBand.maxX),
      clamp(classNode.y + 24, argumentBand.minY + 102, argumentBand.maxY - 16),
      argumentBand.maxY - 12,
      3
    );

    instanceNodes.forEach((instNode) => {
      nodeMap.set(instNode.id, instNode);
      edges.push({
        source: classNode.id,
        target: instNode.id,
        label: "",
        directed: false,
        type: "class-instance",
        weight: 1,
      });

      const conceptRefs = instNode.entity?.data?.concept_refs || [];
      conceptRefs.forEach((conceptId) => {
        const artifactNodeId = `artifact:${conceptId}`;
        if (!nodeMap.has(artifactNodeId)) return;
        edges.push({
          source: instNode.id,
          target: artifactNodeId,
          label: "about",
          directed: true,
          type: "about",
          weight: 1,
        });
      });
    });
  });

  const expandedArtifactKeys = new Set(
    [...state.library.expanded].filter((key) => key.startsWith("artifact:"))
  );
  expandedArtifactKeys.forEach((key) => {
    const artifactId = key.slice("artifact:".length);
    const artifactNode = nodeMap.get(`artifact:${artifactId}`);
    if (!artifactNode) return;
    const relatedDescriptors = descriptors.filter((descriptor) =>
      (descriptor.data?.concept_refs || []).includes(artifactId)
    );
    if (!relatedDescriptors.length) return;

    const descriptorNodes = layoutNodesInBand(
      relatedDescriptors.map((descriptor) => ({
        id: `descriptor:${descriptor.id}:for:${artifactId}`,
        label: formatTypeLabel(descriptor.data?.descriptor_type || "descriptor"),
        nodeKind: "descriptor",
        entity: descriptor,
        r: 14,
        parentArtifactId: artifactId,
      })),
      clamp(artifactNode.x - 78, descriptorBand.minX, descriptorBand.maxX - 48),
      clamp(artifactNode.x + 78, descriptorBand.minX + 48, descriptorBand.maxX),
      descriptorBand.minY + 16,
      descriptorBand.maxY - 14,
      3
    );

    descriptorNodes.forEach((descNode) => {
      const storedOffset = descriptorOffsets[descNode.id];
      if (
        storedOffset &&
        Number.isFinite(storedOffset.dx) &&
        Number.isFinite(storedOffset.dy)
      ) {
        descNode.x = clamp(artifactNode.x + storedOffset.dx, descriptorBand.minX, descriptorBand.maxX);
        descNode.y = clamp(artifactNode.y + storedOffset.dy, descriptorYMin, descriptorYMax);
      } else {
        const cached = state.library.graphPositions[descNode.id];
        if (cached) {
          descNode.x = clamp(cached.x, descriptorBand.minX, descriptorBand.maxX);
          descNode.y = clamp(cached.y, descriptorYMin, descriptorYMax);
        }
      }
      descriptorOffsets[descNode.id] = {
        dx: descNode.x - artifactNode.x,
        dy: descNode.y - artifactNode.y,
      };
      nodeMap.set(descNode.id, descNode);
      edges.push({
        source: artifactNode.id,
        target: descNode.id,
        label: "",
        directed: true,
        type: "artifact-descriptor",
        weight: 1,
      });
    });
  });

  const edgeRenderer = drawGraphEdges(svgSel, edges, nodeMap);

  const nodes = [...nodeMap.values()];
  const nodeSelection = svgSel
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .classed("draggable-node", (d) => d.nodeKind === "artifact" || d.nodeKind === "descriptor")
    .style("cursor", (d) => (d.nodeKind === "artifact" || d.nodeKind === "descriptor" ? "grab" : "pointer"))
    .attr("transform", (d) => `translate(${d.x}, ${d.y})`);

  const nodeClassName = (d) => {
      const isActiveClass =
        d.nodeKind === "argument-class" && state.library.expanded.has(`arg:${d.className}`);
      const isActiveArtifact =
        d.nodeKind === "artifact" && state.library.expanded.has(`artifact:${d.entity.id}`);
      const isSelected =
        (d.nodeKind === "argument-class" &&
          state.library.selectedInstance?.kind === "argumentClass" &&
          state.library.selectedInstance?.id === d.className) ||
        (d.nodeKind === "argument" &&
          state.library.selectedInstance?.kind === "argument" &&
          state.library.selectedInstance?.id === d.entity.id) ||
        (d.nodeKind === "artifact" &&
          state.library.selectedInstance?.kind === "concept" &&
          state.library.selectedInstance?.id === d.entity.id) ||
        (d.nodeKind === "descriptor" &&
          state.library.selectedInstance?.kind === "descriptor" &&
          state.library.selectedInstance?.id === d.entity.id);

      const classes = ["graph-node"];
      if (d.nodeKind !== "argument-class") classes.push("small-node");
      if (d.nodeKind === "argument-class") classes.push("graph-node-arg-class");
      if (d.nodeKind === "artifact") classes.push("graph-node-artifact");
      if (d.nodeKind === "argument") classes.push("graph-node-argument");
      if (d.nodeKind === "descriptor") classes.push("graph-node-descriptor");
      if (d.nodeKind === "argument-class" && !d.hasInstances) classes.push("empty");
      if (isActiveClass || isActiveArtifact || isSelected) classes.push("active");
      return classes.join(" ");
    };

  nodeSelection
    .filter((d) => d.nodeKind === "argument-class")
    .append("rect")
    .attr("x", (d) => -((d.w || 56) / 2))
    .attr("y", (d) => -((d.h || 24) / 2))
    .attr("width", (d) => d.w || 56)
    .attr("height", (d) => d.h || 24)
    .attr("rx", (d) => d.rx || 8)
    .attr("ry", (d) => d.rx || 8)
    .attr("class", nodeClassName);

  nodeSelection
    .filter((d) => d.nodeKind !== "argument-class")
    .append("circle")
    .attr("r", (d) => d.r)
    .attr("class", nodeClassName);

  nodeSelection
    .append("text")
    .attr("class", (d) => `graph-label graph-label-${d.nodeKind}`)
    .attr("text-anchor", "middle")
    .attr("dy", 4)
    .style("pointer-events", "none")
    .text((d) => {
      if (d.nodeKind === "artifact") return d.label.slice(0, 18);
      if (d.nodeKind === "descriptor") return d.label.slice(0, 16);
      return d.label;
    });

  const movableDrag = window.d3
    .drag()
    .on("start", (event, d) => {
      event.sourceEvent?.stopPropagation();
      if (d.nodeKind === "artifact") {
        d._dragStartX = d.x;
        d._dragStartY = d.y;
      }
    })
    .on("drag", (event, d) => {
      const prevX = d.x;
      const prevY = d.y;
      const band =
        d.nodeKind === "artifact"
          ? artifactBand
          : d.nodeKind === "descriptor"
            ? descriptorBand
            : null;
      const minY = band ? band.minY + 8 : 42;
      const maxY = band ? band.maxY - 8 : height - 42;
      const minX = band ? band.minX : 42;
      const maxX = band ? band.maxX : width - 42;
      d.x = clamp(event.x, minX, maxX);
      d.y = clamp(event.y, minY, maxY);

      const artifactId = d.nodeKind === "artifact" ? d.entity?.id : null;
      if (artifactId) {
        nodes.forEach((node) => {
          if (node.nodeKind === "descriptor" && node.parentArtifactId === artifactId) {
            const offset =
              descriptorOffsets[node.id] ||
              {
                dx: node.x - prevX,
                dy: node.y - prevY,
              };
            node.x = clamp(d.x + offset.dx, descriptorBand.minX, descriptorBand.maxX);
            node.y = clamp(d.y + offset.dy, descriptorYMin, descriptorYMax);
            descriptorOffsets[node.id] = {
              dx: node.x - d.x,
              dy: node.y - d.y,
            };
          }
        });
      }

      nodeSelection.attr("transform", (node) => `translate(${node.x}, ${node.y})`);
      edgeRenderer.updatePositions();
    })
    .on("end", (event, d) => {
      if (d.nodeKind === "artifact") {
        const artifactId = d.entity?.id;
        if (!artifactId) return;
        const deltaX = d.x - (d._dragStartX ?? d.x);
        const deltaY = d.y - (d._dragStartY ?? d.y);
        state.library.graphPositions[`artifact:${artifactId}`] = { x: d.x, y: d.y };
        const visibleDescriptorIds = new Set();
        nodes.forEach((node) => {
          if (node.nodeKind === "descriptor" && node.parentArtifactId === artifactId) {
            visibleDescriptorIds.add(node.id);
            state.library.graphPositions[node.id] = { x: node.x, y: node.y };
            descriptorOffsets[node.id] = {
              dx: node.x - d.x,
              dy: node.y - d.y,
            };
          }
        });
        if (deltaX || deltaY) {
          Object.entries(state.library.graphPositions).forEach(([nodeId, position]) => {
            if (
              !nodeId.startsWith("descriptor:") ||
              !nodeId.endsWith(`:for:${artifactId}`) ||
              visibleDescriptorIds.has(nodeId) ||
              !position
            ) {
              return;
            }
            const x = clamp((position.x || 0) + deltaX, descriptorBand.minX, descriptorBand.maxX);
            const y = clamp((position.y || 0) + deltaY, descriptorYMin, descriptorYMax);
            state.library.graphPositions[nodeId] = { x, y };
            descriptorOffsets[nodeId] = {
              dx: x - d.x,
              dy: y - d.y,
            };
          });
        }
        delete d._dragStartX;
        delete d._dragStartY;
        return;
      }
      if (d.nodeKind === "descriptor") {
        state.library.graphPositions[d.id] = { x: d.x, y: d.y };
        const artifactNode = nodeMap.get(`artifact:${d.parentArtifactId}`);
        if (artifactNode) {
          descriptorOffsets[d.id] = {
            dx: d.x - artifactNode.x,
            dy: d.y - artifactNode.y,
          };
        }
      }
    });

  nodeSelection
    .filter((d) => d.nodeKind === "artifact" || d.nodeKind === "descriptor")
    .call(movableDrag);

  nodeSelection.on("click", (event, d) => {
    if (event.defaultPrevented) return;
    event.stopPropagation();
    if (d.nodeKind === "argument-class") {
      const key = `arg:${d.className}`;
      if (state.library.expanded.has(key)) {
        state.library.expanded.delete(key);
      } else {
        state.library.expanded.add(key);
      }
      state.library.selectedInstance = { kind: "argumentClass", id: d.className };
      renderLibraryGraph();
      renderLibraryDetail();
      return;
    }

    if (d.nodeKind === "argument") {
      state.library.selectedInstance = { kind: "argument", id: d.entity.id };
      renderLibraryGraph();
      renderLibraryDetail();
      return;
    }

    if (d.nodeKind === "artifact") {
      const key = `artifact:${d.entity.id}`;
      if (state.library.expanded.has(key)) {
        state.library.expanded.delete(key);
      } else {
        state.library.expanded.add(key);
      }
      state.library.selectedInstance = { kind: "concept", id: d.entity.id };
      renderLibraryGraph();
      renderLibraryDetail();
      return;
    }

    if (d.nodeKind === "descriptor") {
      state.library.selectedInstance = { kind: "descriptor", id: d.entity.id };
      renderLibraryGraph();
      renderLibraryDetail();
    }
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

  if (state.library.selectedInstance) {
    const inst = state.library.selectedInstance;
    const block = document.createElement("div");
    block.className = "list-block";
    block.innerHTML = `<div class="subhead">Selected Node</div>`;
    const info = document.createElement("div");
    info.className = "stack";
    if (inst.kind === "argumentClass") {
      const className = String(inst.id || "");
      const matching = (selected.arguments || []).filter(
        (arg) => mapArgumentToClass(arg.arg_type) === className
      );

      const header = document.createElement("div");
      header.innerHTML = `<strong>${className}</strong>`;
      info.appendChild(header);

      const count = document.createElement("div");
      count.className = "meta";
      count.textContent = `Instances: ${matching.length}`;
      info.appendChild(count);

      if (matching.length) {
        const list = document.createElement("div");
        list.className = "list";
        matching.forEach((arg) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "concept-ref-link";
          button.textContent = `${arg.argument_id} ${arg.text ? `- ${arg.text.slice(0, 50)}` : ""}`;
          button.addEventListener("click", () => {
            state.library.selectedInstance = { kind: "argument", id: arg.argument_id };
            renderLibraryDetail();
            renderLibraryGraph();
          });
          list.appendChild(button);
        });
        info.appendChild(list);
      }
    } else if (inst.kind === "argument") {
      const arg = (selected.arguments || []).find((a) => a.argument_id === inst.id);
      if (arg) {
        const conceptRefs = Array.isArray(arg.concept_refs) ? arg.concept_refs : [];
        const fields = [
          { label: "Class", value: mapArgumentToClass(arg.arg_type) || formatTypeLabel(arg.arg_type || "") },
          { label: "Label", value: arg.text || "-" },
          { label: "Description", value: arg.description || "-" },
          {
            label: "Source refs",
            value: Array.isArray(arg.source_refs) && arg.source_refs.length
              ? arg.source_refs.map((ref) => ref.section || "Section").join(", ")
              : "",
          },
        ];

        const header = document.createElement("div");
        header.innerHTML = `<strong>${arg.argument_id}</strong>`;
        info.appendChild(header);

        fields.forEach((field) => {
          if (!field.value) return;
          const label = document.createElement("div");
          label.innerHTML = `<strong>${field.label}</strong>`;
          const value = document.createElement("div");
          value.className = "meta";
          value.textContent = field.value;
          info.appendChild(label);
          info.appendChild(value);
        });

        if (conceptRefs.length) {
          const refsLabel = document.createElement("div");
          refsLabel.innerHTML = "<strong>Artifact refs</strong>";
          info.appendChild(refsLabel);

          const refsWrap = document.createElement("div");
          refsWrap.className = "meta concept-ref-links";

          conceptRefs.forEach((conceptId) => {
            const concept = (selected.concepts || []).find((c) => c.concept_id === conceptId);
            const refBtn = document.createElement("button");
            refBtn.type = "button";
            refBtn.className = "concept-ref-link";
            refBtn.textContent = concept?.label
              ? `${conceptId} ${concept.label}`
              : conceptId;
            refBtn.addEventListener("click", () => {
              state.library.selectedInstance = { kind: "concept", id: conceptId };
              renderLibraryDetail();
              renderLibraryGraph();
            });
            refsWrap.appendChild(refBtn);
          });

          info.appendChild(refsWrap);
        }

        const updated = document.createElement("details");
        updated.innerHTML = `
          <summary class="meta">Last updated</summary>
          <div class="meta">${selected.updated_at || selected.annotation?.updated_at || "-"}</div>
        `;
        const annotator = document.createElement("details");
        annotator.innerHTML = `
          <summary class="meta">Annotator</summary>
          <div class="meta">${selected.metadata?.annotator || "-"}</div>
        `;
        info.appendChild(updated);
        info.appendChild(annotator);
      }
    } else if (inst.kind === "concept") {
      const concept = (selected.concepts || []).find((c) => c.concept_id === inst.id);
      if (concept) {
        const fields = [
          { label: "Class", value: concept.type || "-" },
          { label: "Label", value: concept.label || "-" },
          {
            label: "Aliases",
            value: Array.isArray(concept.aliases) && concept.aliases.length
              ? concept.aliases.join(", ")
              : "",
          },
          {
            label: "Source refs",
            value: Array.isArray(concept.source_refs) && concept.source_refs.length
              ? concept.source_refs.map((ref) => ref.section || "Section").join(", ")
              : "",
          },
        ];

        const header = document.createElement("div");
        header.innerHTML = `<strong>${concept.concept_id}</strong>`;
        info.appendChild(header);

        fields.forEach((field) => {
          if (!field.value) return;
          const label = document.createElement("div");
          label.innerHTML = `<strong>${field.label}</strong>`;
          const value = document.createElement("div");
          value.className = "meta";
          value.textContent = field.value;
          info.appendChild(label);
          info.appendChild(value);
        });

        const updated = document.createElement("details");
        updated.innerHTML = `
          <summary class="meta">Last updated</summary>
          <div class="meta">${selected.updated_at || selected.annotation?.updated_at || "-"}</div>
        `;
        const annotator = document.createElement("details");
        annotator.innerHTML = `
          <summary class="meta">Annotator</summary>
          <div class="meta">${selected.metadata?.annotator || "-"}</div>
        `;
        info.appendChild(updated);
        info.appendChild(annotator);
      }
    } else if (inst.kind === "descriptor") {
      const descriptor = (selected.descriptors || []).find((d) => d.descriptor_id === inst.id);
      if (descriptor) {
        const sourceTexts = Array.isArray(descriptor.source_refs)
          ? descriptor.source_refs
              .map((ref) => normalizeSourceRefValue(ref?.text, ""))
              .filter(Boolean)
          : [];
        const fields = [
          { label: "Class", value: formatTypeLabel(descriptor.descriptor_type || "") },
          { label: "Label", value: descriptor.descriptor_id || "-" },
          {
            label: "Source text",
            value: sourceTexts.length ? sourceTexts.join(" | ") : "",
          },
          {
            label: "Source refs",
            value: Array.isArray(descriptor.source_refs) && descriptor.source_refs.length
              ? descriptor.source_refs.map((ref) => ref.section || "Section").join(", ")
              : "",
          },
        ];

        const header = document.createElement("div");
        header.innerHTML = `<strong>${descriptor.descriptor_id}</strong>`;
        info.appendChild(header);

        fields.forEach((field) => {
          if (!field.value) return;
          const label = document.createElement("div");
          label.innerHTML = `<strong>${field.label}</strong>`;
          const value = document.createElement("div");
          value.className = "meta";
          value.textContent = field.value;
          info.appendChild(label);
          info.appendChild(value);
        });

        const conceptRefs = Array.isArray(descriptor.concept_refs) ? descriptor.concept_refs : [];
        if (conceptRefs.length) {
          const refsLabel = document.createElement("div");
          refsLabel.innerHTML = "<strong>Artifact refs</strong>";
          info.appendChild(refsLabel);

          const refsWrap = document.createElement("div");
          refsWrap.className = "meta concept-ref-links";
          conceptRefs.forEach((conceptId) => {
            const concept = (selected.concepts || []).find((c) => c.concept_id === conceptId);
            const refBtn = document.createElement("button");
            refBtn.type = "button";
            refBtn.className = "concept-ref-link";
            refBtn.textContent = concept?.label
              ? `${conceptId} ${concept.label}`
              : conceptId;
            refBtn.addEventListener("click", () => {
              state.library.selectedInstance = { kind: "concept", id: conceptId };
              renderLibraryDetail();
              renderLibraryGraph();
            });
            refsWrap.appendChild(refBtn);
          });
          info.appendChild(refsWrap);
        }
      }
    }
    if (!info.innerHTML) {
      info.textContent = "Details unavailable.";
    }
    block.appendChild(info);
    container.appendChild(block);
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
  conceptBlock.innerHTML = `<div class="subhead">Artifacts</div>`;
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
    conceptList.innerHTML = '<div class="muted">No artifacts recorded.</div>';
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

  const descriptorBlock = document.createElement("div");
  descriptorBlock.className = "list-block";
  descriptorBlock.innerHTML = `<div class="subhead">Descriptors</div>`;
  const descriptorList = document.createElement("div");
  descriptorList.className = "list";
  (selected.descriptors || []).forEach((descriptor) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <div><strong>${descriptor.descriptor_id}</strong> ${formatTypeLabel(descriptor.descriptor_type || "")}</div>
        <div class="meta">Artifact refs: ${(descriptor.concept_refs || []).length}</div>
      </div>
    `;
    descriptorList.appendChild(item);
  });
  if (!selected.descriptors?.length) {
    descriptorList.innerHTML = '<div class="muted">No descriptors recorded.</div>';
  }
  descriptorBlock.appendChild(descriptorList);
  container.appendChild(descriptorBlock);
}

function selectLibraryItem(paperId) {
  state.library.selectedId = paperId;
  state.library.expanded = new Set();
  state.library.selectedInstance = null;
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

function updatePdfSrc() {
  const frame = el("pdfFrame");
  const placeholder = el("pdfPlaceholder");
  if (!frame || !placeholder) return;
  if (!state.paperId) {
    frame.removeAttribute("src");
    placeholder.style.display = "block";
    return;
  }
  frame.src = withBase(`/api/paper/${state.paperId}/pdf`);
  placeholder.style.display = "none";
}

function setDocMode(mode) {
  state.docMode = mode;
  const textPane = el("docTextPane");
  const pdfPane = el("docPdfPane");
  if (textPane) textPane.classList.toggle("active", mode === "text");
  if (pdfPane) pdfPane.classList.toggle("active", mode === "pdf");
  document.querySelectorAll(".doc-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.doc === mode);
  });
  if (mode === "pdf") updatePdfSrc();
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
  if (!list) return;
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
      state.highlightSelection.descriptor.delete(hl.id);
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
    { id: "highlightPickerDescriptor", key: "descriptor" },
  ];

  pickers.forEach(({ id, key }) => {
    const container = el(id);
    if (!container) return;
    container.innerHTML = "";

    const available = state.highlights.filter((h) => !h.used && (!h.target || h.target === key));
    if (available.length === 0) {
      container.innerHTML = '<div class="muted">No highlights to attach.</div>';
      return;
    }

    available.forEach((hl) => {
      const row = document.createElement("div");
      const selected = state.highlightSelection[key].has(hl.id);
      row.className = `highlight-pill ${selected ? "selected" : ""}`;
      row.title = `Section: ${hl.section}${hl.page ? ` - Page ${hl.page}` : ""}`;

      const text = document.createElement("span");
      text.className = "highlight-pill-text";
      text.textContent = hl.text;

      const close = document.createElement("button");
      close.type = "button";
      close.className = "highlight-pill-close";
      close.setAttribute("aria-label", "Remove highlight");
      close.title = "Remove highlight";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        removeHighlight(hl.id);
        renderHighlightPickers();
      });

      row.appendChild(text);
      row.appendChild(close);
      row.addEventListener("click", () => {
        if (state.highlightSelection[key].has(hl.id)) {
          state.highlightSelection[key].delete(hl.id);
          row.classList.remove("selected");
          updateDescription(key);
          return;
        }

        if (key === "concept") {
          const existingConceptIds = Array.from(state.highlightSelection.concept);
          existingConceptIds.forEach((existingId) => removeHighlight(existingId));
          state.highlightSelection.concept.clear();
          const labelInput = el("conceptLabel");
          if (labelInput) {
            labelInput.value = hl.text;
          }
        }

        state.highlightSelection[key].add(hl.id);
        row.classList.add("selected");
        updateDescription(key);
      });

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
  state.highlightSelection.concept.delete(id);
  state.highlightSelection.argument.delete(id);
  state.highlightSelection.descriptor.delete(id);
  updateDescription("argument");
  renderHighlightPickers();
}

function consumeHighlights(ids) {
  ids.forEach((id) => {
    const hl = state.highlights.find((h) => h.id === id);
    if (!hl) return;
    hl.used = true;
    state.highlightSelection.concept.delete(id);
    state.highlightSelection.argument.delete(id);
    state.highlightSelection.descriptor.delete(id);
    const mark = document.querySelector(`mark[data-hid="${id}"]`);
    if (mark) mark.classList.add("used");
  });
  updateDescription("argument");
}

function normalizeSourceRefValue(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim();
}

function removeHighlightsForSourceRefs(target, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return;

  const pool = state.highlights.filter((hl) => {
    const sameTarget = (hl.target || "") === target;
    return sameTarget;
  });
  if (!pool.length) return;

  const consumedIds = [];
  sourceRefs.forEach((ref) => {
    const section = normalizeSourceRefValue(ref?.section, "Body");
    const page = normalizeSourceRefValue(ref?.page, "");
    const text = normalizeSourceRefValue(ref?.text, "");
    const match = pool.find((hl) => {
      if (consumedIds.includes(hl.id)) return false;
      const hlSection = normalizeSourceRefValue(hl.section, "Body");
      const hlPage = normalizeSourceRefValue(hl.page, "");
      const hlText = normalizeSourceRefValue(hl.text, "");
      if (text && hlText !== text) return false;
      return hlSection === section && hlPage === page;
    });
    if (match) consumedIds.push(match.id);
  });

  consumedIds.forEach((id) => removeHighlight(id));
}

function renderConceptList() {
  const list = el("conceptList");
  list.innerHTML = "";
  if (state.annotations.concepts.length === 0) {
    list.innerHTML = '<div class="muted">No artifacts yet.</div>';
    return;
  }

  state.annotations.concepts.forEach((concept) => {
    const item = document.createElement("div");
    item.className = "list-item";
    if (state.editing.conceptId === concept.concept_id) {
      item.classList.add("active-edit");
    }

    const info = document.createElement("div");
    const roles = (concept.roles || []).join(", ");
    const sourceCount = concept.source_refs ? concept.source_refs.length : 0;
    info.innerHTML = `
      <div><strong>${concept.concept_id}</strong> ${concept.label}</div>
      <div class="meta">${concept.type || "Uncategorized"}${roles ? ` • ${roles}` : ""}</div>
      <div class="meta">Source refs: ${sourceCount}</div>
    `;
    info.addEventListener("click", () => startConceptEdit(concept.concept_id));

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      removeHighlightsForSourceRefs("concept", concept.source_refs || []);
      state.annotations.concepts = state.annotations.concepts.filter((c) => c.concept_id !== concept.concept_id);
      if (state.editing.conceptId === concept.concept_id) {
        state.editing.conceptId = null;
        setConceptButtonMode();
      }
      renderConceptList();
      renderArgumentConceptRefs();
      renderDescriptorConceptRefs();
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
    if (state.editing.argumentId === argument.argument_id) {
      item.classList.add("active-edit");
    }

    const info = document.createElement("div");
    const preview = argument.text ? `${argument.text.slice(0, 80)}${argument.text.length > 80 ? "..." : ""}` : "";
    const conceptCount = argument.concept_refs ? argument.concept_refs.length : 0;
    info.innerHTML = `
      <div><strong>${argument.argument_id}</strong> ${formatTypeLabel(argument.arg_type || "")}</div>
      <div class="meta">${preview}</div>
      <div class="meta">Artifact refs: ${conceptCount}</div>
    `;
    info.addEventListener("click", () => startArgumentEdit(argument.argument_id));

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      removeHighlightsForSourceRefs("argument", argument.source_refs || []);
      state.annotations.arguments = state.annotations.arguments.filter((a) => a.argument_id !== argument.argument_id);
      if (state.editing.argumentId === argument.argument_id) {
        state.editing.argumentId = null;
        setArgumentButtonMode();
      }
      renderArgumentList();
    });

    item.appendChild(info);
    item.appendChild(remove);
    list.appendChild(item);
  });
}

function renderDescriptorList() {
  const list = el("descriptorList");
  list.innerHTML = "";
  if (state.annotations.descriptors.length === 0) {
    list.innerHTML = '<div class="muted">No descriptors yet.</div>';
    return;
  }

  state.annotations.descriptors.forEach((descriptor) => {
    const item = document.createElement("div");
    item.className = "list-item";
    if (state.editing.descriptorId === descriptor.descriptor_id) {
      item.classList.add("active-edit");
    }

    const info = document.createElement("div");
    const artifactCount = descriptor.concept_refs ? descriptor.concept_refs.length : 0;
    const sourceCount = descriptor.source_refs ? descriptor.source_refs.length : 0;
    info.innerHTML = `
      <div><strong>${descriptor.descriptor_id}</strong> ${formatTypeLabel(descriptor.descriptor_type || "")}</div>
      <div class="meta">Artifact refs: ${artifactCount}</div>
      <div class="meta">Source refs: ${sourceCount}</div>
    `;
    info.addEventListener("click", () => startDescriptorEdit(descriptor.descriptor_id));

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      removeHighlightsForSourceRefs("descriptor", descriptor.source_refs || []);
      state.annotations.descriptors = state.annotations.descriptors.filter(
        (d) => d.descriptor_id !== descriptor.descriptor_id
      );
      if (state.editing.descriptorId === descriptor.descriptor_id) {
        state.editing.descriptorId = null;
        setDescriptorButtonMode();
      }
      renderDescriptorList();
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
    container.innerHTML = '<div class="muted">Optional. Add artifacts first if needed.</div>';
    return;
  }

  state.annotations.concepts.forEach((concept) => {
    const label = document.createElement("div");
    label.className = "ref-pill";

    const text = document.createElement("span");
    text.textContent = `${concept.concept_id} ${concept.label}`;
    label.dataset.conceptId = concept.concept_id;
    label.dataset.selected = "false";

    label.appendChild(text);
    label.addEventListener("click", () => {
      label.classList.toggle("selected");
      label.dataset.selected = label.classList.contains("selected") ? "true" : "false";
    });

    container.appendChild(label);
  });
}

function renderDescriptorConceptRefs() {
  const container = el("descriptorConceptRefs");
  container.innerHTML = "";

  if (state.annotations.concepts.length === 0) {
    container.innerHTML = '<div class="muted">Optional. Add artifacts first if needed.</div>';
    return;
  }

  state.annotations.concepts.forEach((concept) => {
    const label = document.createElement("div");
    label.className = "ref-pill";

    const text = document.createElement("span");
    text.textContent = `${concept.concept_id} ${concept.label}`;
    label.dataset.conceptId = concept.concept_id;
    label.dataset.selected = "false";

    label.appendChild(text);
    label.addEventListener("click", () => {
      label.classList.toggle("selected");
      label.dataset.selected = label.classList.contains("selected") ? "true" : "false";
    });

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

  const descriptorSelect = el("descriptorType");
  descriptorTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = formatTypeLabel(type);
    descriptorSelect.appendChild(option);
  });
}

function addHighlight(target) {
  commitPendingHighlight(target);
}

function createConcept() {
  const label = el("conceptLabel").value.trim();
  if (!label) {
    showToast("Add an artifact label.", "error");
    return;
  }

  const aliases = normalizeAliases(el("conceptAliases").value);
  const type = String(el("artifactType")?.value || state.conceptType || "").trim().toLowerCase();
  state.conceptType = type;
  if (!type) {
    showToast("Select an artifact category.", "error");
    return;
  }

  const selectedConceptId = Array.from(state.highlightSelection.concept)[0];
  const sourceRefs = selectedConceptId
    ? [selectedConceptId]
        .map((id) => {
          const hl = state.highlights.find((h) => h.id === id);
          if (!hl) return null;
          return { section: hl.section, page: hl.page || null };
        })
        .filter(Boolean)
    : [];

  const editingId = state.editing.conceptId;
  const existingConcept = editingId
    ? state.annotations.concepts.find((c) => c.concept_id === editingId)
    : null;
  const concept = {
    concept_id: editingId || uniqueId("C", state.annotations.concepts),
    label,
    aliases: aliases.length ? aliases : undefined,
    type,
    source_refs: sourceRefs.length ? sourceRefs : existingConcept?.source_refs,
  };

  if (editingId) {
    const index = state.annotations.concepts.findIndex((c) => c.concept_id === editingId);
    if (index >= 0) state.annotations.concepts[index] = concept;
  } else {
    state.annotations.concepts.push(concept);
  }
  if (selectedConceptId) {
    consumeHighlights([selectedConceptId]);
  }
  resetConceptEditor();
  renderConceptList();
  renderArgumentConceptRefs();
  renderDescriptorConceptRefs();
  renderHighlightPickers();
  if (editingId) {
    showToast("Artifact updated.", "success");
  }
}

function createArgument() {
  const text = el("argumentText").value.trim();
  if (!text) {
    showToast("Add canonical text for the argument.", "error");
    return;
  }

  const argType = el("argumentType").value;
  const conceptRefs = Array.from(el("argumentConceptRefs").querySelectorAll(".ref-pill.selected")).map(
    (pill) => pill.dataset.conceptId
  );

  const sourceRefs = Array.from(state.highlightSelection.argument).map((id) => {
    const hl = state.highlights.find((h) => h.id === id);
    if (!hl) return null;
    return { section: hl.section, page: hl.page || null };
  }).filter(Boolean);

  const editingId = state.editing.argumentId;
  const existingArgument = editingId
    ? state.annotations.arguments.find((a) => a.argument_id === editingId)
    : null;
  const argument = {
    argument_id: editingId || uniqueId("A", state.annotations.arguments),
    text,
    arg_type: argType,
    description: state.argumentDescription.trim() || existingArgument?.description,
    concept_refs: conceptRefs.length ? conceptRefs : undefined,
    source_refs: sourceRefs.length ? sourceRefs : existingArgument?.source_refs,
  };

  if (editingId) {
    const index = state.annotations.arguments.findIndex((a) => a.argument_id === editingId);
    if (index >= 0) state.annotations.arguments[index] = argument;
  } else {
    state.annotations.arguments.push(argument);
  }
  consumeHighlights(Array.from(state.highlightSelection.argument));
  resetArgumentEditor();
  renderArgumentList();
  renderHighlightPickers();
  if (editingId) {
    showToast("Argument updated.", "success");
  }
}

function createDescriptor() {
  const descriptorType = el("descriptorType").value;
  if (!descriptorType) {
    showToast("Select a descriptor type.", "error");
    return;
  }

  const conceptRefs = Array.from(el("descriptorConceptRefs").querySelectorAll(".ref-pill.selected")).map(
    (pill) => pill.dataset.conceptId
  );

  const sourceRefs = Array.from(state.highlightSelection.descriptor)
    .map((id) => {
      const hl = state.highlights.find((h) => h.id === id);
      if (!hl) return null;
      return {
        section: hl.section,
        page: hl.page || null,
        text: hl.text || "",
      };
    })
    .filter(Boolean);

  if (!sourceRefs.length) {
    showToast("Add source refs for the descriptor.", "error");
    return;
  }

  const editingId = state.editing.descriptorId;
  const existingDescriptor = editingId
    ? state.annotations.descriptors.find((d) => d.descriptor_id === editingId)
    : null;
  const descriptor = {
    descriptor_id: editingId || uniqueId("D", state.annotations.descriptors),
    descriptor_type: descriptorType,
    concept_refs: conceptRefs.length ? conceptRefs : undefined,
    source_refs: sourceRefs.length ? sourceRefs : existingDescriptor?.source_refs,
  };

  if (editingId) {
    const index = state.annotations.descriptors.findIndex((d) => d.descriptor_id === editingId);
    if (index >= 0) state.annotations.descriptors[index] = descriptor;
  } else {
    state.annotations.descriptors.push(descriptor);
  }
  consumeHighlights(Array.from(state.highlightSelection.descriptor));
  resetDescriptorEditor();
  renderDescriptorList();
  renderHighlightPickers();
  if (editingId) {
    showToast("Descriptor updated.", "success");
  }
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
  state.annotations = normalizeAnnotations(data.annotation);
  state.metadataChecks = data.annotation?.metadata_checks || {};
  state.highlights = [];
  state.virtualHighlightSeq = 0;
  state.argumentDescription = "";
  state.highlightSelection.concept.clear();
  state.highlightSelection.argument.clear();
  state.highlightSelection.descriptor.clear();
  state.conceptType = "";
  state.editing.conceptId = null;
  state.editing.argumentId = null;
  state.editing.descriptorId = null;

  const info = el("paperInfo");
  if (info) {
    info.textContent = `Saved as dataset/papers/${state.paperId}.{pdf,tei.xml,md,json}`;
  }

  renderMetadata();
  renderDoc();
  renderHighlightPickers();
  renderConceptList();
  renderArgumentList();
  renderDescriptorList();
  renderArgumentConceptRefs();
  renderDescriptorConceptRefs();
  renderArtifactTypeSelect();
  setConceptButtonMode();
  setArgumentButtonMode();
  setDescriptorButtonMode();
  updateDescription("argument");
  if (loadingToast) loadingToast.remove();
  if (data.existing) {
    showToast("Existing annotation loaded for this paper.", "success");
  } else {
    showToast("Paper loaded and ready to annotate.", "success");
  }
  updatePdfSrc();
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
    const present = requiredArgumentTypes.filter((type) => !missing.includes(type));
    showChecklistToast(requiredArgumentTypes, present, { duration: 9000 });
    return;
  }

  const payload = {
    metadata: state.metadata,
    metadata_checks: state.metadataChecks,
    concepts: state.annotations.concepts,
    arguments: state.annotations.arguments,
    descriptors: state.annotations.descriptors,
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
      renderHighlightPickers();
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

function wireSelectionMenu() {
  const menu = el("selectionMenu");
  if (!menu) return;
  menu.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      commitPendingHighlight(button.dataset.action);
    });
  });

  menu.addEventListener("mousedown", (event) => event.stopPropagation());

  document.addEventListener("mousedown", (event) => {
    if (!menu.contains(event.target)) {
      hideSelectionMenu();
    }
  });

  document.addEventListener("scroll", hideSelectionMenu, true);
}

function init() {
  populateSelects();
  renderMetadata();
  renderDoc();
  renderHighlightPickers();
  renderConceptList();
  renderArgumentList();
  renderDescriptorList();
  renderArgumentConceptRefs();
  renderDescriptorConceptRefs();
  renderArtifactTypeSelect();
  setConceptButtonMode();
  setArgumentButtonMode();
  setDescriptorButtonMode();
  updateDescription("argument");
  wireTabs();
  wireNavigation();
  wireLibraryControls();
  wireSelectionMenu();
  setDocMode(state.docMode);

  const info = el("paperInfo");
  if (info) {
    info.textContent = "Files will save under dataset/papers/";
  }

  el("uploadBtn").addEventListener("click", uploadPdf);
  el("docView").addEventListener("mouseup", handleDocSelection);
  el("docView").addEventListener("keyup", handleDocSelection);
  el("addConceptBtn").addEventListener("click", createConcept);
  el("addArgumentBtn").addEventListener("click", createArgument);
  el("addDescriptorBtn").addEventListener("click", createDescriptor);
  el("submitBtn").addEventListener("click", submitAnnotations);
  const leftCollapseBtn = el("leftCollapseBtn");
  if (leftCollapseBtn) {
    leftCollapseBtn.addEventListener("click", () => {
      const page = el("annotatorPage");
      if (!page) return;
      page.classList.toggle("left-collapsed");
    });
  }

  const docExpandBtn = el("docExpandBtn");
  if (docExpandBtn) {
    docExpandBtn.addEventListener("click", () => {
      const page = el("annotatorPage");
      if (!page) return;
      page.classList.toggle("doc-expanded");
    });
  }

  const docSwapBtn = el("docSwapBtn");
  if (docSwapBtn) {
    docSwapBtn.addEventListener("click", () => {
      setDocMode(state.docMode === "text" ? "pdf" : "text");
    });
  }
}

init();
