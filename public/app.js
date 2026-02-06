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
  metadataChecks: {},
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
    if (!hl.used) item.appendChild(pageInput);
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
    container.innerHTML = '<div class="muted">Optional. Add concepts first if needed.</div>';
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
      used: false,
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
  consumeHighlights(Array.from(state.highlightSelection.concept));
  el("conceptLabel").value = "";
  el("conceptAliases").value = "";
  document.querySelectorAll(".roles input").forEach((input) => (input.checked = false));
  state.highlightSelection.concept.clear();

  renderConceptList();
  renderArgumentConceptRefs();
  renderHighlightPickers();
  renderHighlights();
}

function createArgument() {
  const text = el("argumentText").value.trim();
  if (!text) return;

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
  state.metadataChecks = data.annotation?.metadata_checks || {};
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
    metadata_checks: state.metadataChecks,
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
