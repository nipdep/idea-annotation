const conceptTypes = [
  "Method",
  "Model",
  "Dataset",
  "Task",
  "Metric",
  "Theory",
  "Artifact",
];

const argumentTypes = [
  "Claim",
  "Evidence",
  "Result",
  "Assumption",
  "Hypothesis",
  "Definition",
  "MethodologicalStatement",
];

const state = {
  paperId: null,
  metadata: {},
  doc: null,
  annotations: { concepts: [], arguments: [], created_at: null },
  highlights: [],
  highlightSelection: {
    concept: new Set(),
    argument: new Set(),
  },
};

const el = (id) => document.getElementById(id);

function setHint(message) {
  el("highlightHint").textContent = message || "";
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

function renderMetadata() {
  const form = el("metadataForm");
  form.innerHTML = "";
  const fields = [
    { key: "title", label: "Title" },
    { key: "authors", label: "Authors (comma-separated)" },
    { key: "doi", label: "DOI" },
    { key: "year", label: "Year" },
    { key: "venue", label: "Venue" },
  ];

  fields.forEach(({ key, label }) => {
    const wrapper = document.createElement("label");
    const raw = state.metadata[key];
    const value = Array.isArray(raw) ? raw.join(", ") : raw || "";
    const isMissing = Array.isArray(raw) ? raw.length === 0 : !raw;
    wrapper.className = isMissing ? "missing" : "";
    wrapper.textContent = label;

    const input = document.createElement("input");
    input.value = Array.isArray(value) ? value.join(", ") : value;
    input.addEventListener("input", (e) => {
      const val = e.target.value;
      if (key === "authors") {
        const list = val.split(",").map((a) => a.trim()).filter(Boolean);
        state.metadata[key] = list;
        wrapper.className = list.length ? "" : "missing";
      } else {
        const trimmed = val.trim();
        state.metadata[key] = trimmed;
        wrapper.className = trimmed ? "" : "missing";
      }
    });

    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });
}

function renderDoc() {
  const docView = el("docView");
  docView.innerHTML = "";

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

function renderHighlights() {
  const list = el("highlightList");
  list.innerHTML = "";
  if (state.highlights.length === 0) {
    list.innerHTML = '<div class="muted">No highlights yet.</div>';
    return;
  }

  state.highlights.forEach((hl) => {
    const item = document.createElement("div");
    item.className = "highlight-entry";

    const text = document.createElement("div");
    text.textContent = hl.text;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `Section: ${hl.section}`;

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
      state.highlights = state.highlights.filter((h) => h.id !== hl.id);
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

    if (state.highlights.length === 0) {
      container.innerHTML = '<div class="muted">No highlights to attach.</div>';
      return;
    }

    state.highlights.forEach((hl) => {
      const row = document.createElement("label");
      row.className = "highlight-entry";

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

      const text = document.createElement("div");
      text.textContent = hl.text;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `Section: ${hl.section}${hl.page ? ` - Page ${hl.page}` : ""}`;

      row.appendChild(checkbox);
      row.appendChild(text);
      row.appendChild(meta);
      container.appendChild(row);
    });
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
    info.innerHTML = `<strong>${concept.label}</strong> <span class="meta">${concept.type}</span>`;

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
    info.innerHTML = `<strong>${argument.argument_id}</strong> <span class="meta">${argument.arg_type}</span>`;

    const remove = document.createElement("button");
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      state.annotations.arguments = state.annotations.arguments.filter((a) => a.argument_id !== argument.argument_id);
      renderArgumentList();
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
    container.innerHTML = '<div class="muted">Add concepts first.</div>';
    return;
  }

  state.annotations.concepts.forEach((concept) => {
    const label = document.createElement("label");
    label.className = "tag";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = concept.concept_id;
    label.appendChild(checkbox);
    label.append(` ${concept.label}`);
    container.appendChild(label);
  });
}

function populateSelects() {
  const conceptSelect = el("conceptType");
  const argumentSelect = el("argumentType");
  conceptTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    conceptSelect.appendChild(option);
  });
  argumentTypes.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    argumentSelect.appendChild(option);
  });
}

function addHighlight() {
  setHint("");
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    setHint("Select text in a single paragraph first.");
    return;
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;

  const paragraph = container.closest("p");
  const section = container.closest(".section");
  if (!paragraph || !section) {
    setHint("Select text inside the document body.");
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
      section: section.dataset.section || "Unknown",
      page: "",
    });

    selection.removeAllRanges();
    renderHighlights();
    renderHighlightPickers();
  } catch (err) {
    setHint("Highlight must stay within a single paragraph.");
  }
}

function createConcept() {
  const label = el("conceptLabel").value.trim();
  if (!label) return;

  const aliases = normalizeAliases(el("conceptAliases").value);
  const type = el("conceptType").value;
  const roles = Array.from(document.querySelectorAll(".roles input:checked")).map((input) => input.value);
  if (roles.length === 0) {
    alert("Select at least one role.");
    return;
  }

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
    roles,
    source_refs: sourceRefs.length ? sourceRefs : undefined,
  };

  state.annotations.concepts.push(concept);
  el("conceptLabel").value = "";
  el("conceptAliases").value = "";
  document.querySelectorAll(".roles input").forEach((input) => (input.checked = false));
  state.highlightSelection.concept.clear();

  renderConceptList();
  renderArgumentConceptRefs();
  renderHighlightPickers();
}

function createArgument() {
  const text = el("argumentText").value.trim();
  if (!text) return;

  const argType = el("argumentType").value;
  const conceptRefs = Array.from(el("argumentConceptRefs").querySelectorAll("input:checked")).map(
    (input) => input.value
  );
  if (conceptRefs.length === 0) {
    alert("Select at least one concept ref.");
    return;
  }

  const sourceRefs = Array.from(state.highlightSelection.argument).map((id) => {
    const hl = state.highlights.find((h) => h.id === id);
    if (!hl) return null;
    return { section: hl.section, page: hl.page || null };
  }).filter(Boolean);

  const argument = {
    argument_id: uniqueId("A", state.annotations.arguments),
    text,
    arg_type: argType,
    concept_refs: conceptRefs,
    source_refs: sourceRefs.length ? sourceRefs : undefined,
  };

  state.annotations.arguments.push(argument);
  el("argumentText").value = "";
  state.highlightSelection.argument.clear();
  el("argumentConceptRefs").querySelectorAll("input").forEach((input) => (input.checked = false));

  renderArgumentList();
  renderHighlightPickers();
}

async function uploadPdf() {
  const file = el("pdfInput").files[0];
  if (!file) return;

  const form = new FormData();
  form.append("file", file);

  setHint("Parsing PDF with Grobid...");
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    setHint("Upload failed.");
    return;
  }

  const data = await res.json();
  state.paperId = data.paper_id;
  state.metadata = data.metadata || {};
  state.doc = data.doc;
  state.annotations = data.annotation || { concepts: [], arguments: [], created_at: null };
  state.highlights = [];
  state.highlightSelection.concept.clear();
  state.highlightSelection.argument.clear();

  el("paperInfo").textContent = state.paperId;

  renderMetadata();
  renderDoc();
  renderHighlights();
  renderHighlightPickers();
  renderConceptList();
  renderArgumentList();
  renderArgumentConceptRefs();
  setHint("");
}

async function saveAnnotations() {
  if (!state.paperId) return;

  const payload = {
    metadata: state.metadata,
    concepts: state.annotations.concepts,
    arguments: state.annotations.arguments,
    created_at: state.annotations.created_at,
  };

  const res = await fetch(`/api/annotation/${state.paperId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    alert("Annotation saved.");
  } else {
    alert("Save failed.");
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

function init() {
  populateSelects();
  renderMetadata();
  renderDoc();
  renderHighlights();
  renderHighlightPickers();
  renderConceptList();
  renderArgumentList();
  renderArgumentConceptRefs();
  wireTabs();

  el("uploadBtn").addEventListener("click", uploadPdf);
  el("addHighlightBtn").addEventListener("click", addHighlight);
  el("addConceptBtn").addEventListener("click", createConcept);
  el("addArgumentBtn").addEventListener("click", createArgument);
  el("saveAnnoBtn").addEventListener("click", saveAnnotations);
  el("saveMetaBtn").addEventListener("click", () => alert("Metadata staged. It will save with annotations."));
}

init();
