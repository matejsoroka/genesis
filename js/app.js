(function () {
  "use strict";

  const STORAGE_KEY = "ontomobile:model:v2";
  const LEGACY_KEY = "ontomobile:model";
  const {
    emptyOntology,
    serialize,
    parse,
    defaultPrefixes,
    expand,
    shorten,
    XSD_DATATYPES,
    OBJECT_PROPERTY_CHARACTERISTICS,
    DATA_PROPERTY_CHARACTERISTICS,
    RESTRICTION_KINDS,
    SH_NODE_KINDS,
    isAbsoluteIri,
    makeId,
  } = window.OWL;

  const CATEGORY_PALETTE = [
    "#38bdf8", "#a78bfa", "#22c55e", "#f59e0b", "#ef4444",
    "#ec4899", "#14b8a6", "#eab308", "#64748b", "#8b5cf6"
  ];

  /** @type {ReturnType<typeof emptyOntology>} */
  let model = load();
  let currentTab = "classes";
  let currentPropertyKind = "object";
  let currentGraphMode = "schema";
  let graphInstance = null;
  let activeCategoryFilter = null; // null = all

  const searchTerm = {
    classes: "",
    objectProperties: "",
    dataProperties: "",
    individuals: "",
    shapes: "",
  };

  /* =========================================================
   * Persistence
   * ========================================================= */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) return normalize(JSON.parse(legacy));
    } catch (_) {}
    return emptyOntology();
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } catch (e) { toast("Could not save locally"); }
  }
  function normalize(m) {
    const base = emptyOntology(m.iri);
    const categoryIdByIri = new Map();
    const categories = (m.categories || []).map((c, idx) => {
      const id = c.id || "cat_" + makeId();
      if (c.iri) categoryIdByIri.set(c.iri, id);
      return {
        id,
        iri: c.iri || "",
        name: c.name || "",
        description: c.description || "",
        color: c.color || CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length],
      };
    });

    return Object.assign(base, {
      iri: m.iri || base.iri,
      label: m.label || "",
      comment: m.comment || "",
      prefixes: Object.assign({}, base.prefixes, m.prefixes || {}),
      categories,
      classes: (m.classes || []).map((c) => ({
        iri: c.iri,
        label: c.label || "",
        comment: c.comment || "",
        categories: (c.categories || [])
          .map((cid) => categoryIdByIri.get(cid) || cid)
          .filter((cid) => categories.some((x) => x.id === cid)),
        subClassOf: c.subClassOf || [],
        equivalent: c.equivalent || [],
        disjointWith: c.disjointWith || [],
        restrictions: (c.restrictions || []).map((r) => ({ ...r })),
      })),
      objectProperties: (m.objectProperties || []).map((p) => ({
        iri: p.iri,
        label: p.label || "",
        comment: p.comment || "",
        subPropertyOf: p.subPropertyOf || [],
        domain: p.domain || [],
        range: p.range || [],
        inverseOf: p.inverseOf || "",
        characteristics: p.characteristics || [],
      })),
      dataProperties: (m.dataProperties || []).map((p) => ({
        iri: p.iri,
        label: p.label || "",
        comment: p.comment || "",
        subPropertyOf: p.subPropertyOf || [],
        domain: p.domain || [],
        range: p.range || [],
        characteristics: p.characteristics || [],
      })),
      individuals: (m.individuals || []).map((i) => ({
        iri: i.iri,
        label: i.label || "",
        comment: i.comment || "",
        types: i.types || [],
        objectAssertions: i.objectAssertions || [],
        dataAssertions: i.dataAssertions || [],
      })),
      shapes: (m.shapes || []).map((s) => ({
        iri: s.iri,
        label: s.label || "",
        comment: s.comment || "",
        targetClass: s.targetClass || "",
        targetNode: s.targetNode || "",
        targetSubjectsOf: s.targetSubjectsOf || "",
        targetObjectsOf: s.targetObjectsOf || "",
        closed: !!s.closed,
        severity: s.severity || "",
        message: s.message || "",
        properties: (s.properties || []).map((p) => ({ ...p })),
      })),
    });
  }

  /* =========================================================
   * IRI helpers
   * ========================================================= */
  function defaultNs() {
    return (model.prefixes && model.prefixes[""]) || defaultPrefixes(model.iri)[""];
  }
  function makeIri(localName) {
    localName = (localName || "").trim();
    if (!localName) return "";
    if (isAbsoluteIri(localName)) return localName;
    const safe = localName.replace(/\s+/g, "_").replace(/[^\w\-.]/g, "");
    return defaultNs() + safe;
  }
  function display(iri) {
    if (!iri) return "";
    return shorten(model.prefixes, iri) || iri;
  }
  function displayLabel(entity) {
    if (entity && entity.label) return entity.label;
    if (entity && entity.iri) {
      const s = shorten(model.prefixes, entity.iri);
      return s || entity.iri;
    }
    return "(unnamed)";
  }

  /* =========================================================
   * Rendering
   * ========================================================= */
  const $ = (id) => document.getElementById(id);

  function render() {
    $("ontologyTitle").textContent = model.label || "Untitled ontology";
    $("ontologyIri").textContent = model.iri || "";
    renderCategoryFilter();
    renderList("classes");
    renderList("objectProperties");
    renderList("dataProperties");
    renderList("individuals");
    renderShapeList();
    updateValidationBadge();
    if (currentTab === "graph") renderGraph();
  }

  function renderCategoryFilter() {
    const wrap = $("categoryFilter");
    wrap.innerHTML = "";
    if (!model.categories.length) return;
    const all = document.createElement("button");
    all.className = "cat-chip" + (activeCategoryFilter == null ? " active" : "");
    all.textContent = "All";
    all.addEventListener("click", () => { activeCategoryFilter = null; renderCategoryFilter(); renderList("classes"); });
    wrap.appendChild(all);
    for (const cat of model.categories) {
      const b = document.createElement("button");
      b.className = "cat-chip" + (activeCategoryFilter === cat.id ? " active" : "");
      b.innerHTML = `<span class="swatch" style="background:${cat.color}"></span>${escapeHtml(cat.name || "(unnamed)")}`;
      b.addEventListener("click", () => { activeCategoryFilter = cat.id; renderCategoryFilter(); renderList("classes"); });
      wrap.appendChild(b);
    }
  }

  function renderList(kind) {
    const term = (searchTerm[kind] || "").toLowerCase();
    const listIds = {
      classes: "classList",
      objectProperties: "objectPropertyList",
      dataProperties: "dataPropertyList",
      individuals: "individualList",
    };
    const emptyIds = {
      classes: "classEmpty",
      objectProperties: "objectPropertyEmpty",
      dataProperties: "dataPropertyEmpty",
      individuals: "individualEmpty",
    };
    const listEl = $(listIds[kind]);
    const emptyEl = $(emptyIds[kind]);
    if (!listEl) return;
    listEl.innerHTML = "";
    let items = (model[kind] || []).filter((it) => {
      if (!term) return true;
      const hay = [it.label, it.iri, it.comment].join(" ").toLowerCase();
      return hay.includes(term);
    });
    if (kind === "classes" && activeCategoryFilter) {
      items = items.filter((c) => (c.categories || []).includes(activeCategoryFilter));
    }
    if (items.length === 0) {
      emptyEl.classList.add("show");
    } else {
      emptyEl.classList.remove("show");
    }
    for (const it of items) listEl.appendChild(renderItem(kind, it));
  }

  function renderShapeList() {
    const listEl = $("shapeList");
    const emptyEl = $("shapeEmpty");
    const term = (searchTerm.shapes || "").toLowerCase();
    listEl.innerHTML = "";
    const items = (model.shapes || []).filter((s) => {
      if (!term) return true;
      const hay = [s.label, s.iri, s.comment, s.targetClass].join(" ").toLowerCase();
      return hay.includes(term);
    });
    if (!items.length) emptyEl.classList.add("show");
    else emptyEl.classList.remove("show");
    for (const s of items) listEl.appendChild(renderShapeItem(s));
  }

  function renderShapeItem(s) {
    const li = document.createElement("li");
    li.className = "item";
    const main = document.createElement("div");
    main.className = "item-main";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = displayLabel(s);
    main.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = display(s.iri);
    main.appendChild(sub);

    const chips = document.createElement("div");
    if (s.targetClass) chips.appendChild(chip("on " + display(s.targetClass)));
    if (s.targetNode) chips.appendChild(chip("node " + display(s.targetNode)));
    if (s.closed) chips.appendChild(chip("closed"));
    chips.appendChild(chip((s.properties || []).length + " constraints"));
    if (chips.childNodes.length) main.appendChild(chips);
    li.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openShapeEditor(s));
    actions.appendChild(edit);
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "del";
    del.addEventListener("click", () => {
      if (!confirm(`Delete shape “${displayLabel(s)}”?`)) return;
      model.shapes = model.shapes.filter((x) => x !== s);
      save(); render();
      toast("Deleted");
    });
    actions.appendChild(del);
    li.appendChild(actions);
    return li;
  }

  function renderItem(kind, it) {
    const li = document.createElement("li");
    li.className = "item";
    const main = document.createElement("div");
    main.className = "item-main";

    const title = document.createElement("div");
    title.className = "item-title";
    title.appendChild(document.createTextNode(displayLabel(it)));
    if (kind === "classes") {
      for (const catId of it.categories || []) {
        const cat = model.categories.find((c) => c.id === catId);
        if (!cat) continue;
        const c = document.createElement("span");
        c.className = "chip cat";
        c.style.background = "color-mix(in srgb, " + cat.color + " 25%, transparent)";
        c.style.borderColor = "color-mix(in srgb, " + cat.color + " 60%, transparent)";
        c.innerHTML = `<span class="swatch" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cat.color};margin-right:2px"></span>${escapeHtml(cat.name)}`;
        title.appendChild(c);
      }
    }
    main.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = display(it.iri);
    main.appendChild(sub);

    const chips = document.createElement("div");
    if (kind === "classes") {
      for (const parent of it.subClassOf || []) chips.appendChild(chip("⊑ " + display(parent)));
      for (const r of it.restrictions || []) chips.appendChild(chip(restrictionSummary(r)));
    } else if (kind === "objectProperties" || kind === "dataProperties") {
      if ((it.domain || []).length) chips.appendChild(chip("dom: " + it.domain.map(display).join(", ")));
      if ((it.range || []).length) chips.appendChild(chip("ran: " + it.range.map(display).join(", ")));
      for (const c of it.characteristics || []) chips.appendChild(chip(c));
    } else if (kind === "individuals") {
      for (const t of it.types || []) chips.appendChild(chip("∈ " + display(t)));
      const n = (it.objectAssertions || []).length + (it.dataAssertions || []).length;
      if (n) chips.appendChild(chip(n + " facts"));
    }
    if (chips.childNodes.length) main.appendChild(chips);
    li.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditor(kind, it));
    actions.appendChild(edit);
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "del";
    del.addEventListener("click", () => {
      if (!confirm(`Delete “${displayLabel(it)}”?`)) return;
      deleteEntity(kind, it.iri);
    });
    actions.appendChild(del);
    li.appendChild(actions);
    return li;
  }

  function chip(txt) {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = txt;
    return c;
  }

  function restrictionSummary(r) {
    const prop = display(r.property || "?");
    switch (r.kind) {
      case "someValuesFrom": return `${prop} some ${display(r.classIri || "?")}`;
      case "allValuesFrom": return `${prop} only ${display(r.classIri || "?")}`;
      case "hasValue": return `${prop} = ${r.valueIri ? display(r.valueIri) : (r.valueLiteral || "?")}`;
      case "minCardinality": return `${prop} ≥ ${r.count || 0}`;
      case "maxCardinality": return `${prop} ≤ ${r.count || 0}`;
      case "cardinality": return `${prop} = ${r.count || 0}`;
      case "minQualifiedCardinality": return `${prop} ≥ ${r.count || 0} ${display(r.qualifiedClassIri || r.classIri || "?")}`;
      case "maxQualifiedCardinality": return `${prop} ≤ ${r.count || 0} ${display(r.qualifiedClassIri || r.classIri || "?")}`;
      case "qualifiedCardinality": return `${prop} = ${r.count || 0} ${display(r.qualifiedClassIri || r.classIri || "?")}`;
      default: return prop;
    }
  }

  function deleteEntity(kind, iri) {
    model[kind] = model[kind].filter((x) => x.iri !== iri);
    if (kind === "classes") {
      for (const c of model.classes) {
        c.subClassOf = c.subClassOf.filter((x) => x !== iri);
        c.equivalent = c.equivalent.filter((x) => x !== iri);
        c.disjointWith = c.disjointWith.filter((x) => x !== iri);
        c.restrictions = (c.restrictions || []).filter(
          (r) => r.classIri !== iri && r.qualifiedClassIri !== iri
        );
      }
      for (const p of model.objectProperties.concat(model.dataProperties)) {
        p.domain = p.domain.filter((x) => x !== iri);
        p.range = p.range.filter((x) => x !== iri);
      }
      for (const i of model.individuals) i.types = i.types.filter((x) => x !== iri);
      for (const s of model.shapes) if (s.targetClass === iri) s.targetClass = "";
    } else if (kind === "objectProperties" || kind === "dataProperties") {
      for (const p of model[kind]) {
        p.subPropertyOf = p.subPropertyOf.filter((x) => x !== iri);
        if (p.inverseOf === iri) p.inverseOf = "";
      }
      for (const i of model.individuals) {
        if (kind === "objectProperties") i.objectAssertions = i.objectAssertions.filter((a) => a.property !== iri);
        else i.dataAssertions = i.dataAssertions.filter((a) => a.property !== iri);
      }
      for (const c of model.classes) {
        c.restrictions = (c.restrictions || []).filter((r) => r.property !== iri);
      }
      for (const s of model.shapes) {
        s.properties = (s.properties || []).filter((p) => p.path !== iri);
      }
    }
    save();
    render();
    toast("Deleted");
  }

  /* =========================================================
   * Tab bar
   * ========================================================= */
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === tab));
    const fab = $("fab");
    // Graph tab hides the FAB; everything else shows it
    if (tab === "graph") fab.classList.add("hidden");
    else fab.classList.remove("hidden");
    if (tab === "graph") renderGraph();
    if (tab === "shapes") renderValidationSummary(lastReport);
  }

  /* Segmented control on Relations tab */
  document.querySelectorAll(".segmented .seg-btn[data-seg]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".segmented .seg-btn[data-seg]").forEach((x) => x.classList.toggle("active", x === b));
      currentPropertyKind = b.dataset.seg;
      $("objectPropertyList").hidden = currentPropertyKind !== "object";
      $("objectPropertyEmpty").hidden = currentPropertyKind !== "object";
      $("dataPropertyList").hidden = currentPropertyKind !== "data";
      $("dataPropertyEmpty").hidden = currentPropertyKind !== "data";
      renderList(currentPropertyKind === "object" ? "objectProperties" : "dataProperties");
    });
  });

  /* Graph mode segmented control */
  document.querySelectorAll(".segmented .seg-btn[data-graph-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".segmented .seg-btn[data-graph-mode]").forEach((x) => x.classList.toggle("active", x === b));
      currentGraphMode = b.dataset.graphMode;
      renderGraph();
    });
  });

  $("graphFit").addEventListener("click", () => graphInstance && graphInstance.fit());
  $("graphReheat").addEventListener("click", () => graphInstance && graphInstance.reheat());

  /* Search inputs */
  wireSearch("searchClasses", "classes");
  wireSearch("searchRelations", currentPropertyKind === "object" ? "objectProperties" : "dataProperties", () => currentPropertyKind === "object" ? "objectProperties" : "dataProperties");
  wireSearch("searchIndividuals", "individuals");
  wireSearch("searchShapes", "shapes");
  function wireSearch(id, kindOrFn) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const k = typeof kindOrFn === "function" ? kindOrFn() : kindOrFn;
      searchTerm[k] = el.value;
      if (k === "shapes") renderShapeList(); else renderList(k);
    });
  }
  // Relations tab needs search to re-route when switching segments
  $("searchRelations").addEventListener("input", (e) => {
    const k = currentPropertyKind === "object" ? "objectProperties" : "dataProperties";
    searchTerm[k] = e.target.value;
    renderList(k);
  });

  /* FAB */
  $("fab").addEventListener("click", () => {
    if (currentTab === "classes") openEditor("classes", null);
    else if (currentTab === "relations") {
      const k = currentPropertyKind === "object" ? "objectProperties" : "dataProperties";
      openEditor(k, null);
    }
    else if (currentTab === "individuals") openEditor("individuals", null);
    else if (currentTab === "shapes") openShapeEditor(null);
  });

  /* Side menu */
  const sideMenu = $("sideMenu");
  const backdrop = $("backdrop");
  $("menuBtn").addEventListener("click", openMenu);
  $("closeMenuBtn").addEventListener("click", closeMenu);
  backdrop.addEventListener("click", closeMenu);
  function openMenu() { sideMenu.classList.add("open"); sideMenu.setAttribute("aria-hidden", "false"); backdrop.hidden = false; }
  function closeMenu() { sideMenu.classList.remove("open"); sideMenu.setAttribute("aria-hidden", "true"); backdrop.hidden = true; }

  sideMenu.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    closeMenu();
    if (action === "edit-meta") openMetadataEditor();
    else if (action === "categories") openCategoryManager();
    else if (action === "import") $("fileInput").click();
    else if (action === "export") exportOwl();
    else if (action === "view-raw") openRawView();
    else if (action === "validate") { runValidation(true); setTab("shapes"); }
    else if (action === "new") {
      if (confirm("Start a new empty ontology? Your current work will be lost unless exported.")) {
        model = emptyOntology(); save(); render();
      }
    } else if (action === "clear") {
      if (confirm("Clear all entities (keep metadata)?")) {
        model.classes = []; model.objectProperties = []; model.dataProperties = [];
        model.individuals = []; model.shapes = []; model.categories = [];
        save(); render();
      }
    }
  });

  $("saveBtn").addEventListener("click", () => { save(); toast("Saved"); });
  $("validateBtn").addEventListener("click", () => { runValidation(true); setTab("shapes"); });

  /* =========================================================
   * Sheet helpers
   * ========================================================= */
  const sheet = $("sheet");
  const sheetTitle = $("sheetTitle");
  const sheetBody = $("sheetBody");
  let sheetSaveHandler = null;
  sheet.addEventListener("click", (e) => {
    if (e.target.classList.contains("sheet-backdrop") || e.target.dataset.sheetCancel !== undefined) closeSheet();
    if (e.target.dataset.sheetSave !== undefined) { if (sheetSaveHandler) sheetSaveHandler(); }
  });
  function openSheet(title, body, onSave) {
    sheetTitle.textContent = title;
    sheetBody.innerHTML = "";
    sheetBody.appendChild(body);
    sheetSaveHandler = onSave;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
  }
  function closeSheet() { sheet.classList.remove("open"); sheet.setAttribute("aria-hidden", "true"); sheetSaveHandler = null; }

  function field(labelText, input, hint) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(input);
    if (hint) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent = hint;
      wrap.appendChild(h);
    }
    return wrap;
  }
  function inputEl(value, placeholder) {
    const i = document.createElement("input");
    i.type = "text";
    i.value = value || "";
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  function numberEl(value, placeholder) {
    const i = document.createElement("input");
    i.type = "number";
    i.value = value == null ? "" : value;
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  function textareaEl(value, placeholder) {
    const t = document.createElement("textarea");
    t.value = value || "";
    if (placeholder) t.placeholder = placeholder;
    return t;
  }
  function selectEl(options, value) {
    const s = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }
  function multiIriInput(values, suggestions, placeholder) {
    const container = document.createElement("div");
    container.className = "multi";
    const state = Array.from(values || []);
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder || "Add…";
    const dlId = "dl-" + Math.random().toString(36).slice(2);
    const dl = document.createElement("datalist");
    dl.id = dlId;
    input.setAttribute("list", dlId);
    for (const s of suggestions || []) {
      const opt = document.createElement("option");
      opt.value = s.value;
      if (s.label && s.label !== s.value) opt.label = s.label;
      dl.appendChild(opt);
    }
    function renderTags() {
      for (const t of container.querySelectorAll(".tag")) t.remove();
      for (const [idx, v] of state.entries()) {
        const tag = document.createElement("span");
        tag.className = "tag";
        const label = suggestionLabel(suggestions, v) || display(v) || v;
        tag.appendChild(document.createTextNode(label));
        const rm = document.createElement("button");
        rm.type = "button";
        rm.textContent = "×";
        rm.addEventListener("click", () => { state.splice(idx, 1); renderTags(); });
        tag.appendChild(rm);
        container.insertBefore(tag, input);
      }
    }
    function commit() {
      const raw = input.value.trim();
      if (!raw) return;
      let iri = raw;
      const match = (suggestions || []).find((s) => s.label === raw || s.value === raw);
      if (match) iri = match.value;
      else if (!isAbsoluteIri(iri) && !iri.includes(":")) iri = makeIri(iri);
      else iri = expand(model.prefixes, iri);
      if (!state.includes(iri)) state.push(iri);
      input.value = ""; renderTags();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
      else if (e.key === "Backspace" && input.value === "" && state.length) { state.pop(); renderTags(); }
    });
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    container.appendChild(input);
    container.appendChild(dl);
    renderTags();
    return { element: container, getValues: () => { commit(); return state.slice(); } };
  }
  function suggestionLabel(suggestions, value) {
    const m = (suggestions || []).find((s) => s.value === value);
    return m ? m.label : null;
  }
  function entitySuggestions(list) {
    return (list || []).map((e) => ({
      value: e.iri,
      label: e.label ? `${e.label} (${shorten(model.prefixes, e.iri)})` : shorten(model.prefixes, e.iri),
    }));
  }
  function classSuggestions() { return entitySuggestions(model.classes); }
  function objectPropertySuggestions() { return entitySuggestions(model.objectProperties); }
  function dataPropertySuggestions() { return entitySuggestions(model.dataProperties); }
  function propertySuggestions() {
    return entitySuggestions(model.objectProperties.concat(model.dataProperties));
  }
  function datatypeSuggestions() {
    return XSD_DATATYPES.map((d) => ({ value: "xsd:" + d, label: "xsd:" + d }));
  }
  function checkboxList(options, values) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px";
    const set = new Set(values || []);
    const inputs = [];
    for (const opt of options) {
      const lab = document.createElement("label");
      lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = opt; cb.checked = set.has(opt);
      inputs.push(cb);
      lab.appendChild(cb); lab.appendChild(document.createTextNode(opt));
      wrap.appendChild(lab);
    }
    return { element: wrap, getValues: () => inputs.filter((i) => i.checked).map((i) => i.value) };
  }
  function categoryMultiSelect(values) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
    const set = new Set(values || []);
    const inputs = new Map();
    for (const cat of model.categories) {
      const b = document.createElement("button");
      b.type = "button";
      const active = set.has(cat.id);
      b.className = "cat-chip" + (active ? " active" : "");
      b.innerHTML = `<span class="swatch" style="background:${cat.color}"></span>${escapeHtml(cat.name)}`;
      b.addEventListener("click", () => {
        if (set.has(cat.id)) { set.delete(cat.id); b.classList.remove("active"); }
        else { set.add(cat.id); b.classList.add("active"); }
      });
      inputs.set(cat.id, b);
      wrap.appendChild(b);
    }
    if (!model.categories.length) {
      const h = document.createElement("div");
      h.className = "hint";
      h.textContent = "Create categories via menu → Manage categories";
      wrap.appendChild(h);
    }
    return { element: wrap, getValues: () => Array.from(set) };
  }

  /* =========================================================
   * Entity editor (classes, properties, individuals)
   * ========================================================= */
  function openEditor(kind, entity) {
    const isNew = !entity;
    const orig = entity;
    const data = entity ? JSON.parse(JSON.stringify(entity)) : { iri: "", label: "", comment: "" };

    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:12px";

    const labelInput = inputEl(data.label, "Human-readable label");
    const localInput = inputEl(isNew ? "" : shorten(model.prefixes, data.iri), "e.g. Person, ex:Person, or full IRI");
    const commentInput = textareaEl(data.comment, "Description / comment");

    body.appendChild(field("Label", labelInput));
    body.appendChild(field(isNew ? "Name / IRI" : "IRI", localInput, isNew ? "Short name becomes " + defaultNs() + "…" : "Change the IRI to rename"));
    body.appendChild(field("Comment", commentInput));

    let specific = { collect: () => ({}) };

    if (kind === "classes") {
      const catPicker = categoryMultiSelect(data.categories || []);
      body.appendChild(field("Categories", catPicker.element));

      const classSug = classSuggestions();
      const parents = multiIriInput(data.subClassOf, classSug, "Superclass");
      const eq = multiIriInput(data.equivalent, classSug, "Equivalent class");
      const dj = multiIriInput(data.disjointWith, classSug, "Disjoint class");
      body.appendChild(field("Subclass of", parents.element));
      body.appendChild(field("Equivalent to", eq.element));
      body.appendChild(field("Disjoint with", dj.element));

      const restrSection = restrictionsSection(data.restrictions || []);
      body.appendChild(restrSection.element);

      specific.collect = () => ({
        categories: catPicker.getValues(),
        subClassOf: parents.getValues(),
        equivalent: eq.getValues(),
        disjointWith: dj.getValues(),
        restrictions: restrSection.getValues(),
      });
    } else if (kind === "objectProperties" || kind === "dataProperties") {
      const classSug = classSuggestions();
      const propSug = entitySuggestions(model[kind]);
      const dom = multiIriInput(data.domain, classSug, "Domain class");
      const rngValues = kind === "dataProperties" ? datatypeSuggestions() : classSug;
      const rng = multiIriInput(data.range, rngValues, "Range");
      const sup = multiIriInput(data.subPropertyOf, propSug, "Super-property");
      const chars = checkboxList(
        kind === "objectProperties" ? OBJECT_PROPERTY_CHARACTERISTICS : DATA_PROPERTY_CHARACTERISTICS,
        data.characteristics || []
      );
      let invInput = null;
      if (kind === "objectProperties") {
        invInput = inputEl(data.inverseOf ? shorten(model.prefixes, data.inverseOf) : "", "Inverse property IRI (optional)");
      }
      body.appendChild(field("Domain", dom.element));
      body.appendChild(field("Range", rng.element));
      body.appendChild(field("Sub-property of", sup.element));
      body.appendChild(field("Characteristics", chars.element));
      if (invInput) body.appendChild(field("Inverse of", invInput));
      specific.collect = () => {
        const result = {
          domain: dom.getValues(),
          range: rng.getValues(),
          subPropertyOf: sup.getValues(),
          characteristics: chars.getValues(),
        };
        if (invInput) {
          const v = invInput.value.trim();
          result.inverseOf = v ? (isAbsoluteIri(v) ? v : expand(model.prefixes, v)) : "";
          if (result.inverseOf && !isAbsoluteIri(result.inverseOf)) result.inverseOf = makeIri(v);
        }
        return result;
      };
    } else if (kind === "individuals") {
      const types = multiIriInput(data.types, classSuggestions(), "Type (class)");
      body.appendChild(field("Types", types.element));
      const objSection = assertionSection("Object property facts", data.objectAssertions || [], { kind: "object" });
      body.appendChild(objSection.element);
      const dataSection = assertionSection("Data property facts", data.dataAssertions || [], { kind: "data" });
      body.appendChild(dataSection.element);
      specific.collect = () => ({
        types: types.getValues(),
        objectAssertions: objSection.getValues(),
        dataAssertions: dataSection.getValues(),
      });
    }

    openSheet(isNew ? `New ${labelForKind(kind)}` : `Edit ${labelForKind(kind)}`, body, () => {
      const label = labelInput.value.trim();
      const localRaw = localInput.value.trim();
      if (!localRaw && !data.iri) { toast("Please provide a name or IRI"); return; }
      let iri = data.iri;
      if (localRaw) {
        iri = isAbsoluteIri(localRaw) ? localRaw : expand(model.prefixes, localRaw);
        if (!isAbsoluteIri(iri)) iri = makeIri(localRaw);
      }
      if (!iri) { toast("Invalid IRI"); return; }
      const updated = { iri, label, comment: commentInput.value.trim() };
      Object.assign(updated, specific.collect());
      if (isNew || (orig && orig.iri !== iri)) {
        if (model[kind].some((x) => x.iri === iri && x !== orig)) { toast("An entity with that IRI already exists"); return; }
      }
      if (isNew) model[kind].push(updated);
      else {
        const idx = model[kind].indexOf(orig);
        if (idx >= 0) {
          if (orig.iri !== iri) renameIri(orig.iri, iri);
          model[kind][idx] = updated;
        }
      }
      save(); render(); closeSheet();
      toast(isNew ? "Added" : "Saved");
    });
  }

  function labelForKind(kind) {
    return {
      classes: "class",
      objectProperties: "object property",
      dataProperties: "data property",
      individuals: "instance",
    }[kind];
  }

  function renameIri(oldIri, newIri) {
    const refs = (list, field) => {
      for (const e of list) {
        if (Array.isArray(e[field])) e[field] = e[field].map((x) => (x === oldIri ? newIri : x));
        else if (e[field] === oldIri) e[field] = newIri;
      }
    };
    refs(model.classes, "subClassOf");
    refs(model.classes, "equivalent");
    refs(model.classes, "disjointWith");
    refs(model.objectProperties, "domain");
    refs(model.objectProperties, "range");
    refs(model.objectProperties, "subPropertyOf");
    refs(model.objectProperties, "inverseOf");
    refs(model.dataProperties, "domain");
    refs(model.dataProperties, "range");
    refs(model.dataProperties, "subPropertyOf");
    refs(model.individuals, "types");
    for (const i of model.individuals) {
      for (const a of i.objectAssertions) { if (a.property === oldIri) a.property = newIri; if (a.target === oldIri) a.target = newIri; }
      for (const a of i.dataAssertions) { if (a.property === oldIri) a.property = newIri; }
    }
    for (const c of model.classes) {
      for (const r of c.restrictions || []) {
        if (r.property === oldIri) r.property = newIri;
        if (r.classIri === oldIri) r.classIri = newIri;
        if (r.qualifiedClassIri === oldIri) r.qualifiedClassIri = newIri;
        if (r.valueIri === oldIri) r.valueIri = newIri;
      }
    }
    for (const s of model.shapes) {
      if (s.targetClass === oldIri) s.targetClass = newIri;
      if (s.targetNode === oldIri) s.targetNode = newIri;
      if (s.targetSubjectsOf === oldIri) s.targetSubjectsOf = newIri;
      if (s.targetObjectsOf === oldIri) s.targetObjectsOf = newIri;
      for (const p of s.properties || []) {
        if (p.path === oldIri) p.path = newIri;
        if (p.class === oldIri) p.class = newIri;
        if (p.datatype === oldIri) p.datatype = newIri;
        if (p.hasValueIri === oldIri) p.hasValueIri = newIri;
        for (const it of p.in || []) if (it.iri === oldIri) it.iri = newIri;
      }
    }
  }

  /* ---------- Restrictions section (for classes) ---------- */
  function restrictionsSection(items) {
    const wrap = document.createElement("div");
    wrap.className = "group";
    const h = document.createElement("div");
    h.className = "group-title";
    h.textContent = "Restrictions";
    wrap.appendChild(h);
    const rows = document.createElement("div");
    rows.style.cssText = "display:flex;flex-direction:column;gap:6px";
    wrap.appendChild(rows);
    const add = document.createElement("button");
    add.type = "button"; add.className = "secondary small";
    add.textContent = "+ Add restriction";
    add.style.alignSelf = "flex-start";
    wrap.appendChild(add);

    const state = items.map((r) => ({ ...r }));

    function renderRows() {
      rows.innerHTML = "";
      state.forEach((r, idx) => {
        const card = document.createElement("div");
        card.className = "row-card";

        const head = document.createElement("div");
        head.className = "row-head";

        const propSel = document.createElement("input");
        propSel.placeholder = "property";
        propSel.value = r.property ? shorten(model.prefixes, r.property) : "";
        const pdId = "rp-" + Math.random().toString(36).slice(2);
        const pdl = document.createElement("datalist"); pdl.id = pdId;
        for (const p of model.objectProperties.concat(model.dataProperties)) {
          const o = document.createElement("option");
          o.value = shorten(model.prefixes, p.iri);
          if (p.label) o.label = p.label;
          pdl.appendChild(o);
        }
        propSel.setAttribute("list", pdId);
        propSel.addEventListener("change", () => { r.property = expand(model.prefixes, propSel.value.trim()); });

        const kindSel = document.createElement("select");
        for (const k of RESTRICTION_KINDS) {
          const o = document.createElement("option"); o.value = k.id; o.textContent = k.label;
          if (r.kind === k.id) o.selected = true;
          kindSel.appendChild(o);
        }
        if (!r.kind) r.kind = "someValuesFrom";
        kindSel.addEventListener("change", () => { r.kind = kindSel.value; renderRows(); });

        const del = document.createElement("button");
        del.type = "button"; del.className = "row-del"; del.textContent = "×";
        del.addEventListener("click", () => { state.splice(idx, 1); renderRows(); });

        head.appendChild(propSel);
        head.appendChild(pdl);
        head.appendChild(kindSel);
        head.appendChild(del);
        card.appendChild(head);

        const meta = RESTRICTION_KINDS.find((k) => k.id === r.kind);
        const extras = document.createElement("div");
        extras.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
        if (meta.needs === "class" || meta.needs === "count+class") {
          const cls = document.createElement("input");
          cls.placeholder = meta.needs === "class" ? "filler class/datatype" : "qualified class";
          cls.value = r.qualifiedClassIri || r.classIri || "";
          cls.addEventListener("change", () => {
            const v = expand(model.prefixes, cls.value.trim());
            if (meta.needs === "class") r.classIri = v; else r.qualifiedClassIri = v;
          });
          cls.style.flex = "2";
          const dlid = "rc-" + Math.random().toString(36).slice(2);
          const dl = document.createElement("datalist"); dl.id = dlid;
          for (const c of model.classes) {
            const o = document.createElement("option"); o.value = shorten(model.prefixes, c.iri);
            if (c.label) o.label = c.label; dl.appendChild(o);
          }
          for (const d of XSD_DATATYPES) {
            const o = document.createElement("option"); o.value = "xsd:" + d;
            dl.appendChild(o);
          }
          cls.setAttribute("list", dlid);
          extras.appendChild(cls); extras.appendChild(dl);
        }
        if (meta.needs === "count" || meta.needs === "count+class") {
          const cnt = numberEl(r.count, "count");
          cnt.min = "0";
          cnt.style.flex = "1";
          cnt.addEventListener("change", () => { r.count = Number(cnt.value || 0); });
          extras.appendChild(cnt);
        }
        if (meta.needs === "value") {
          const val = inputEl(r.valueIri || r.valueLiteral || "", "value IRI or literal");
          val.style.flex = "2";
          val.addEventListener("change", () => {
            const v = val.value.trim();
            if (!v) { r.valueIri = ""; r.valueLiteral = ""; return; }
            if (isAbsoluteIri(v) || /^\w+:\w/.test(v)) r.valueIri = expand(model.prefixes, v);
            else r.valueLiteral = v;
          });
          extras.appendChild(val);
        }
        if (extras.childNodes.length) card.appendChild(extras);
        rows.appendChild(card);
      });
    }
    add.addEventListener("click", () => {
      state.push({ kind: "someValuesFrom", property: "", classIri: "" });
      renderRows();
    });
    renderRows();
    return { element: wrap, getValues: () => state.filter((r) => r.property && r.kind) };
  }

  /* ---------- Assertion section (for individuals) ---------- */
  function assertionSection(title, items, { kind }) {
    const section = document.createElement("div");
    section.className = "group";
    const h = document.createElement("div");
    h.className = "group-title";
    h.textContent = title;
    section.appendChild(h);
    const rows = document.createElement("div");
    rows.style.cssText = "display:flex;flex-direction:column;gap:6px";
    section.appendChild(rows);
    const add = document.createElement("button");
    add.type = "button"; add.className = "secondary small";
    add.textContent = "+ Add";
    add.style.alignSelf = "flex-start";
    section.appendChild(add);

    const state = items.map((a) => ({ ...a }));

    function renderRows() {
      rows.innerHTML = "";
      state.forEach((a, idx) => {
        const card = document.createElement("div");
        card.className = "row-card";
        const row = document.createElement("div");
        row.className = "row-head";

        const propSel = document.createElement("input");
        propSel.placeholder = "property";
        propSel.value = a.property ? shorten(model.prefixes, a.property) : "";
        const propDlId = "pdl-" + Math.random().toString(36).slice(2);
        const propDl = document.createElement("datalist"); propDl.id = propDlId;
        propSel.setAttribute("list", propDlId);
        const propList = kind === "object" ? model.objectProperties : model.dataProperties;
        for (const p of propList) {
          const o = document.createElement("option");
          o.value = shorten(model.prefixes, p.iri);
          if (p.label) o.label = p.label;
          propDl.appendChild(o);
        }
        propSel.addEventListener("change", () => { a.property = expand(model.prefixes, propSel.value.trim()); });

        let valueInput;
        if (kind === "object") {
          valueInput = document.createElement("input");
          valueInput.placeholder = "target instance";
          valueInput.value = a.target ? shorten(model.prefixes, a.target) : "";
          const dlId = "idl-" + Math.random().toString(36).slice(2);
          const dl = document.createElement("datalist"); dl.id = dlId;
          valueInput.setAttribute("list", dlId);
          for (const ind of model.individuals) {
            const o = document.createElement("option");
            o.value = shorten(model.prefixes, ind.iri);
            if (ind.label) o.label = ind.label;
            dl.appendChild(o);
          }
          valueInput.addEventListener("change", () => { a.target = expand(model.prefixes, valueInput.value.trim()); });
          row.appendChild(propSel); row.appendChild(propDl);
          row.appendChild(valueInput); row.appendChild(dl);
        } else {
          const wrap = document.createElement("div");
          wrap.style.cssText = "display:flex;gap:4px;flex:1;min-width:0";
          valueInput = document.createElement("input");
          valueInput.placeholder = "value";
          valueInput.value = a.value || "";
          valueInput.style.flex = "1"; valueInput.style.minWidth = "0";
          valueInput.addEventListener("input", () => { a.value = valueInput.value; });
          const dtSel = document.createElement("select");
          const noDt = document.createElement("option"); noDt.value = ""; noDt.textContent = "(type)"; dtSel.appendChild(noDt);
          for (const d of XSD_DATATYPES) {
            const o = document.createElement("option");
            o.value = "xsd:" + d; o.textContent = "xsd:" + d;
            if (a.datatype && shorten(model.prefixes, a.datatype) === "xsd:" + d) o.selected = true;
            dtSel.appendChild(o);
          }
          dtSel.style.maxWidth = "110px";
          dtSel.addEventListener("change", () => { a.datatype = dtSel.value ? expand(model.prefixes, dtSel.value) : ""; });
          wrap.appendChild(valueInput); wrap.appendChild(dtSel);
          row.appendChild(propSel); row.appendChild(propDl); row.appendChild(wrap);
        }

        const del = document.createElement("button");
        del.type = "button"; del.className = "row-del"; del.textContent = "×";
        del.addEventListener("click", () => { state.splice(idx, 1); renderRows(); });
        row.appendChild(del);
        card.appendChild(row);
        rows.appendChild(card);
      });
    }
    add.addEventListener("click", () => {
      if (kind === "object") state.push({ property: "", target: "" });
      else state.push({ property: "", value: "", datatype: "" });
      renderRows();
    });
    renderRows();
    return {
      element: section,
      getValues: () => {
        const clean = [];
        for (const a of state) {
          if (!a.property) continue;
          if (kind === "object") { if (!a.target) continue; clean.push({ property: a.property, target: a.target }); }
          else clean.push({ property: a.property, value: a.value || "", datatype: a.datatype || undefined });
        }
        return clean;
      },
    };
  }

  /* =========================================================
   * Category manager
   * ========================================================= */
  function openCategoryManager() {
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:10px";
    const state = model.categories.map((c) => ({ ...c }));

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:8px";
    body.appendChild(list);

    function renderRows() {
      list.innerHTML = "";
      state.forEach((cat, idx) => {
        const row = document.createElement("div");
        row.className = "row-card";
        const head = document.createElement("div");
        head.className = "row-head";

        const color = document.createElement("input");
        color.type = "color";
        color.value = cat.color || CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
        color.style.cssText = "width:40px;height:40px;padding:0;border:1px solid var(--border);border-radius:8px;background:transparent";
        color.addEventListener("change", () => { cat.color = color.value; });

        const name = inputEl(cat.name, "Category name");
        name.addEventListener("change", () => { cat.name = name.value.trim(); });
        const desc = inputEl(cat.description, "Description (optional)");
        desc.addEventListener("change", () => { cat.description = desc.value.trim(); });

        const del = document.createElement("button");
        del.type = "button"; del.className = "row-del"; del.textContent = "×";
        del.addEventListener("click", () => { state.splice(idx, 1); renderRows(); });

        head.appendChild(color); head.appendChild(name); head.appendChild(del);
        row.appendChild(head);
        row.appendChild(desc);
        list.appendChild(row);
      });
    }

    const add = document.createElement("button");
    add.type = "button"; add.className = "secondary";
    add.textContent = "+ Add category";
    add.addEventListener("click", () => {
      state.push({
        id: "cat_" + makeId(),
        name: "New category",
        description: "",
        color: CATEGORY_PALETTE[state.length % CATEGORY_PALETTE.length],
      });
      renderRows();
    });
    body.appendChild(add);
    renderRows();

    openSheet("Categories", body, () => {
      const validIds = new Set(state.map((c) => c.id));
      for (const c of model.classes) c.categories = (c.categories || []).filter((cid) => validIds.has(cid));
      model.categories = state;
      save(); render(); closeSheet();
      toast("Categories saved");
    });
  }

  /* =========================================================
   * Shape editor
   * ========================================================= */
  function openShapeEditor(shape) {
    const isNew = !shape;
    const orig = shape;
    const data = shape ? JSON.parse(JSON.stringify(shape)) : {
      iri: "", label: "", comment: "", targetClass: "", targetNode: "",
      targetSubjectsOf: "", targetObjectsOf: "",
      closed: false, severity: "", message: "", properties: []
    };

    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:12px";

    const labelInput = inputEl(data.label, "Shape label");
    const localInput = inputEl(isNew ? "" : shorten(model.prefixes, data.iri), "e.g. PersonShape");
    const commentInput = textareaEl(data.comment, "Description");

    body.appendChild(field("Label", labelInput));
    body.appendChild(field("Name / IRI", localInput));
    body.appendChild(field("Comment", commentInput));

    const tgtGroup = document.createElement("div");
    tgtGroup.className = "group";
    const tgtH = document.createElement("div"); tgtH.className = "group-title"; tgtH.textContent = "Target";
    tgtGroup.appendChild(tgtH);
    const tgtClass = inputEl(data.targetClass ? shorten(model.prefixes, data.targetClass) : "", "targetClass (IRI)");
    const tgtClassDlId = "tc-" + Math.random().toString(36).slice(2);
    const tgtClassDl = document.createElement("datalist"); tgtClassDl.id = tgtClassDlId;
    for (const c of model.classes) {
      const o = document.createElement("option"); o.value = shorten(model.prefixes, c.iri);
      if (c.label) o.label = c.label;
      tgtClassDl.appendChild(o);
    }
    tgtClass.setAttribute("list", tgtClassDlId);
    const tgtNode = inputEl(data.targetNode ? shorten(model.prefixes, data.targetNode) : "", "targetNode (individual IRI)");
    const tgtSubj = inputEl(data.targetSubjectsOf ? shorten(model.prefixes, data.targetSubjectsOf) : "", "targetSubjectsOf (property IRI)");
    const tgtObj = inputEl(data.targetObjectsOf ? shorten(model.prefixes, data.targetObjectsOf) : "", "targetObjectsOf (property IRI)");

    tgtGroup.appendChild(field("sh:targetClass", tgtClass));
    tgtGroup.appendChild(tgtClassDl);
    tgtGroup.appendChild(field("sh:targetNode", tgtNode));
    tgtGroup.appendChild(field("sh:targetSubjectsOf", tgtSubj));
    tgtGroup.appendChild(field("sh:targetObjectsOf", tgtObj));
    body.appendChild(tgtGroup);

    const closedCb = document.createElement("input");
    closedCb.type = "checkbox"; closedCb.checked = !!data.closed;
    const closedLabel = document.createElement("label");
    closedLabel.style.cssText = "display:inline-flex;align-items:center;gap:8px";
    closedLabel.appendChild(closedCb);
    closedLabel.appendChild(document.createTextNode("sh:closed (only declared properties are allowed)"));
    body.appendChild(closedLabel);

    const sev = selectEl(
      [
        { value: "", label: "Violation (default)" },
        { value: "sh:Violation", label: "Violation" },
        { value: "sh:Warning", label: "Warning" },
        { value: "sh:Info", label: "Info" },
      ],
      data.severity || ""
    );
    body.appendChild(field("Severity", sev));
    const msgInput = inputEl(data.message, "Default message shown for failing values");
    body.appendChild(field("Default message", msgInput));

    const propsSection = propertyShapesSection(data.properties || []);
    body.appendChild(propsSection.element);

    openSheet(isNew ? "New shape" : "Edit shape", body, () => {
      const label = labelInput.value.trim();
      const localRaw = localInput.value.trim();
      if (!localRaw && !data.iri) { toast("Please provide a name or IRI"); return; }
      let iri = data.iri;
      if (localRaw) {
        iri = isAbsoluteIri(localRaw) ? localRaw : expand(model.prefixes, localRaw);
        if (!isAbsoluteIri(iri)) iri = makeIri(localRaw);
      }
      const updated = {
        iri, label, comment: commentInput.value.trim(),
        targetClass: normIri(tgtClass.value),
        targetNode: normIri(tgtNode.value),
        targetSubjectsOf: normIri(tgtSubj.value),
        targetObjectsOf: normIri(tgtObj.value),
        closed: closedCb.checked,
        severity: sev.value,
        message: msgInput.value.trim(),
        properties: propsSection.getValues(),
      };
      if (isNew || (orig && orig.iri !== iri)) {
        if (model.shapes.some((x) => x.iri === iri && x !== orig)) { toast("A shape with that IRI already exists"); return; }
      }
      if (isNew) model.shapes.push(updated);
      else {
        const idx = model.shapes.indexOf(orig);
        if (idx >= 0) model.shapes[idx] = updated;
      }
      save(); render(); closeSheet();
      runValidation(false);
      toast(isNew ? "Shape added" : "Shape saved");
    });
  }

  function normIri(raw) {
    const v = (raw || "").trim();
    if (!v) return "";
    if (isAbsoluteIri(v)) return v;
    return expand(model.prefixes, v);
  }

  function propertyShapesSection(items) {
    const wrap = document.createElement("div");
    wrap.className = "group";
    const h = document.createElement("div"); h.className = "group-title"; h.textContent = "Property constraints";
    wrap.appendChild(h);
    const rows = document.createElement("div");
    rows.style.cssText = "display:flex;flex-direction:column;gap:8px";
    wrap.appendChild(rows);
    const add = document.createElement("button");
    add.type = "button"; add.className = "secondary small";
    add.textContent = "+ Add property shape";
    add.style.alignSelf = "flex-start";
    wrap.appendChild(add);

    const state = items.map((p) => ({ in: [], ...p }));

    function row(ps, idx) {
      const card = document.createElement("div");
      card.className = "row-card";
      const head = document.createElement("div"); head.className = "row-head";
      const path = inputEl(ps.path ? shorten(model.prefixes, ps.path) : "", "sh:path (property IRI)");
      const pdlId = "ps-path-" + Math.random().toString(36).slice(2);
      const pdl = document.createElement("datalist"); pdl.id = pdlId;
      for (const p of model.objectProperties.concat(model.dataProperties)) {
        const o = document.createElement("option"); o.value = shorten(model.prefixes, p.iri);
        if (p.label) o.label = p.label;
        pdl.appendChild(o);
      }
      path.setAttribute("list", pdlId);
      path.addEventListener("change", () => { ps.path = normIri(path.value); });

      const del = document.createElement("button");
      del.type = "button"; del.className = "row-del"; del.textContent = "×";
      del.addEventListener("click", () => { state.splice(idx, 1); renderRows(); });
      head.appendChild(path); head.appendChild(pdl); head.appendChild(del);
      card.appendChild(head);

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px";

      const minC = numberEl(ps.minCount, "minCount"); minC.min = "0";
      minC.addEventListener("change", () => { ps.minCount = minC.value === "" ? undefined : Number(minC.value); });
      const maxC = numberEl(ps.maxCount, "maxCount"); maxC.min = "0";
      maxC.addEventListener("change", () => { ps.maxCount = maxC.value === "" ? undefined : Number(maxC.value); });
      grid.appendChild(minC); grid.appendChild(maxC);

      const dt = inputEl(ps.datatype ? shorten(model.prefixes, ps.datatype) : "", "datatype (xsd:…)");
      const dtDlId = "dt-" + Math.random().toString(36).slice(2);
      const dtDl = document.createElement("datalist"); dtDl.id = dtDlId;
      for (const d of XSD_DATATYPES) { const o = document.createElement("option"); o.value = "xsd:" + d; dtDl.appendChild(o); }
      dt.setAttribute("list", dtDlId);
      dt.addEventListener("change", () => { ps.datatype = normIri(dt.value); });

      const cls = inputEl(ps.class ? shorten(model.prefixes, ps.class) : "", "class (instance must be of)");
      const clsDlId = "cls-" + Math.random().toString(36).slice(2);
      const clsDl = document.createElement("datalist"); clsDl.id = clsDlId;
      for (const c of model.classes) { const o = document.createElement("option"); o.value = shorten(model.prefixes, c.iri); if (c.label) o.label = c.label; clsDl.appendChild(o); }
      cls.setAttribute("list", clsDlId);
      cls.addEventListener("change", () => { ps.class = normIri(cls.value); });
      grid.appendChild(dt); grid.appendChild(cls);

      const nk = selectEl(
        [{ value: "", label: "nodeKind (any)" }].concat(SH_NODE_KINDS.map((k) => ({ value: k, label: k }))),
        ps.nodeKind || ""
      );
      nk.addEventListener("change", () => { ps.nodeKind = nk.value; });
      const pat = inputEl(ps.pattern || "", "pattern (regex)");
      pat.addEventListener("change", () => { ps.pattern = pat.value; });
      grid.appendChild(nk); grid.appendChild(pat);

      const minL = numberEl(ps.minLength, "minLength"); minL.min = "0";
      minL.addEventListener("change", () => { ps.minLength = minL.value === "" ? undefined : Number(minL.value); });
      const maxL = numberEl(ps.maxLength, "maxLength"); maxL.min = "0";
      maxL.addEventListener("change", () => { ps.maxLength = maxL.value === "" ? undefined : Number(maxL.value); });
      grid.appendChild(minL); grid.appendChild(maxL);

      const mi = inputEl(ps.minInclusive || "", "minInclusive");
      mi.addEventListener("change", () => { ps.minInclusive = mi.value; });
      const mx = inputEl(ps.maxInclusive || "", "maxInclusive");
      mx.addEventListener("change", () => { ps.maxInclusive = mx.value; });
      grid.appendChild(mi); grid.appendChild(mx);

      const hv = inputEl(ps.hasValueIri ? shorten(model.prefixes, ps.hasValueIri) : (ps.hasValueLiteral || ""), "hasValue (IRI or literal)");
      hv.addEventListener("change", () => {
        const v = hv.value.trim();
        if (!v) { ps.hasValueIri = ""; ps.hasValueLiteral = ""; return; }
        if (isAbsoluteIri(v) || /^\w+:\w/.test(v)) { ps.hasValueIri = normIri(v); ps.hasValueLiteral = ""; }
        else { ps.hasValueLiteral = v; ps.hasValueIri = ""; }
      });
      const inp = inputEl((ps.in || []).map((x) => x.iri ? shorten(model.prefixes, x.iri) : x.literal).join(", "), "in: comma-separated IRIs/literals");
      inp.addEventListener("change", () => {
        ps.in = inp.value.split(",").map((x) => x.trim()).filter(Boolean).map((raw) => {
          if (isAbsoluteIri(raw) || /^\w+:\w/.test(raw)) return { iri: normIri(raw) };
          return { literal: raw };
        });
      });
      grid.appendChild(hv); grid.appendChild(inp);

      card.appendChild(grid);
      card.appendChild(pdl); card.appendChild(dtDl); card.appendChild(clsDl);

      const msg = inputEl(ps.message || "", "custom message (optional)");
      msg.addEventListener("change", () => { ps.message = msg.value; });
      card.appendChild(msg);
      return card;
    }

    function renderRows() {
      rows.innerHTML = "";
      state.forEach((ps, idx) => rows.appendChild(row(ps, idx)));
    }
    add.addEventListener("click", () => { state.push({ path: "", in: [] }); renderRows(); });
    renderRows();
    return {
      element: wrap,
      getValues: () => state.filter((p) => p.path),
    };
  }

  /* =========================================================
   * Metadata editor
   * ========================================================= */
  function openMetadataEditor() {
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:12px";
    const iri = inputEl(model.iri, "http://example.org/my-ontology");
    const label = inputEl(model.label, "My ontology");
    const comment = textareaEl(model.comment, "Description");
    const prefixesTa = textareaEl(
      Object.entries(model.prefixes).map(([p, n]) => `${p || ""}: ${n}`).join("\n"),
      "prefix: namespace (one per line)"
    );
    body.appendChild(field("Ontology IRI", iri));
    body.appendChild(field("Label", label));
    body.appendChild(field("Comment", comment));
    body.appendChild(field("Prefixes", prefixesTa, "Use an empty prefix for the default namespace"));
    openSheet("Ontology metadata", body, () => {
      model.iri = iri.value.trim() || model.iri;
      model.label = label.value.trim();
      model.comment = comment.value.trim();
      const prefixes = {};
      for (const line of prefixesTa.value.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][\w-]*)?\s*:\s*(.+?)\s*$/);
        if (m) prefixes[m[1] || ""] = m[2];
      }
      if (Object.keys(prefixes).length) model.prefixes = prefixes;
      if (!model.prefixes[""]) model.prefixes = Object.assign(defaultPrefixes(model.iri), model.prefixes);
      save(); render(); closeSheet();
      toast("Updated");
    });
  }

  /* =========================================================
   * Raw view
   * ========================================================= */
  function openRawView() {
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:8px";
    const ta = document.createElement("textarea");
    ta.className = "raw-view"; ta.spellcheck = false;
    ta.value = serialize(model);
    body.appendChild(ta);
    const row = document.createElement("div"); row.className = "row";
    const copyBtn = document.createElement("button"); copyBtn.className = "secondary"; copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(ta.value); toast("Copied to clipboard"); }
      catch (_) { ta.select(); document.execCommand("copy"); toast("Copied"); }
    });
    const downloadBtn = document.createElement("button"); downloadBtn.className = "secondary"; downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", () => exportOwl(ta.value));
    row.appendChild(copyBtn); row.appendChild(downloadBtn);
    body.appendChild(row);
    openSheet("Raw OWL + SHACL (RDF/XML)", body, () => {
      try {
        const parsed = parse(ta.value);
        model = normalize(parsed); save(); render(); closeSheet();
        toast("Model updated from raw");
      } catch (e) { toast("Parse error: " + e.message); }
    });
  }

  /* =========================================================
   * Import / export
   * ========================================================= */
  function exportOwl(text) {
    const content = text || serialize(model);
    const filename = sanitizeFilename(model.label || "ontology") + ".owl";
    const blob = new Blob([content], { type: "application/rdf+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Exported " + filename);
  }
  function sanitizeFilename(name) {
    return (name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "ontology");
  }
  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parse(text);
      model = normalize(parsed); save(); render();
      toast("Imported " + file.name);
    } catch (err) { alert("Import failed: " + err.message); }
    finally { e.target.value = ""; }
  });

  /* =========================================================
   * Graph rendering
   * ========================================================= */
  function renderGraph() {
    const canvas = $("graphCanvas");
    if (!graphInstance) {
      graphInstance = window.Graph.create(canvas, {
        onSelect: (node) => {
          if (!node || !node.iri) return;
          const c = model.classes.find((x) => x.iri === node.iri);
          if (c) { openEditor("classes", c); return; }
          const ind = model.individuals.find((x) => x.iri === node.iri);
          if (ind) { openEditor("individuals", ind); return; }
        },
      });
    }
    const { nodes, links } = buildGraphData(currentGraphMode);
    graphInstance.setData(nodes, links);
    $("graphInfo").textContent = `${nodes.length} nodes · ${links.length} edges`;
  }

  function categoryColorForClass(c) {
    const catId = (c.categories || [])[0];
    const cat = model.categories.find((x) => x.id === catId);
    return cat ? cat.color : "#38bdf8";
  }

  function buildGraphData(mode) {
    const nodes = [];
    const nodeByIri = new Map();
    const links = [];
    function ensureNode(n) {
      if (nodeByIri.has(n.iri)) return nodeByIri.get(n.iri);
      nodeByIri.set(n.iri, n);
      nodes.push(n);
      return n;
    }
    if (mode === "schema") {
      for (const c of model.classes) {
        ensureNode({
          iri: c.iri,
          kind: "class",
          label: displayLabel(c),
          subtitle: display(c.iri),
          borderColor: categoryColorForClass(c),
        });
      }
      for (const c of model.classes) {
        for (const p of c.subClassOf) {
          const t = model.classes.find((x) => x.iri === p);
          if (!t) continue;
          links.push({
            source: nodeByIri.get(c.iri),
            target: nodeByIri.get(t.iri),
            kind: "sub",
            label: "subClassOf",
          });
        }
        for (const r of c.restrictions || []) {
          const targetIri = r.classIri || r.qualifiedClassIri;
          if (!targetIri) continue;
          const tnode = model.classes.find((x) => x.iri === targetIri);
          if (!tnode) continue;
          links.push({
            source: nodeByIri.get(c.iri),
            target: nodeByIri.get(tnode.iri),
            kind: "restr",
            dashed: true,
            label: restrictionSummary(r),
          });
        }
      }
      for (const p of model.objectProperties) {
        for (const d of p.domain || []) for (const r of p.range || []) {
          const a = model.classes.find((x) => x.iri === d);
          const b = model.classes.find((x) => x.iri === r);
          if (!a || !b) continue;
          links.push({
            source: nodeByIri.get(a.iri),
            target: nodeByIri.get(b.iri),
            kind: "obj",
            label: displayLabel(p),
          });
        }
      }
    } else {
      for (const ind of model.individuals) {
        const typeIri = (ind.types || [])[0];
        const typeClass = typeIri ? model.classes.find((x) => x.iri === typeIri) : null;
        ensureNode({
          iri: ind.iri,
          kind: "individual",
          label: displayLabel(ind),
          subtitle: typeClass ? displayLabel(typeClass) : display(ind.iri),
          borderColor: typeClass ? categoryColorForClass(typeClass) : "#a78bfa",
        });
      }
      for (const ind of model.individuals) {
        for (const a of ind.objectAssertions || []) {
          if (!nodeByIri.has(a.target)) {
            ensureNode({
              iri: a.target,
              kind: "individual",
              label: display(a.target),
              subtitle: "external",
              borderColor: "#64748b",
            });
          }
          const prop = model.objectProperties.find((p) => p.iri === a.property);
          links.push({
            source: nodeByIri.get(ind.iri),
            target: nodeByIri.get(a.target),
            kind: "obj",
            label: prop ? displayLabel(prop) : display(a.property),
          });
        }
      }
    }
    return { nodes, links };
  }

  /* =========================================================
   * SHACL validation
   * ========================================================= */
  let lastReport = null;
  function runValidation(notify) {
    if (!window.SHACL) return;
    const report = window.SHACL.validate(model);
    lastReport = report;
    renderValidationSummary(report);
    updateValidationBadge();
    if (notify) {
      if (report.conforms) toast("Validation passed");
      else toast(`${report.results.length} violation(s) found`);
    }
  }
  function updateValidationBadge() {
    const badge = $("validateBadge");
    if (!lastReport) { badge.hidden = true; return; }
    if (lastReport.conforms) {
      badge.hidden = false;
      badge.textContent = "✓";
      badge.classList.add("ok");
    } else {
      badge.hidden = false;
      badge.textContent = String(lastReport.results.length);
      badge.classList.remove("ok");
    }
  }
  function renderValidationSummary(report) {
    const wrap = $("validationSummary");
    if (!report) { wrap.classList.remove("show"); return; }
    wrap.innerHTML = "";
    const h = document.createElement("h3");
    const pill = document.createElement("span");
    pill.className = "status-pill " + (report.conforms ? "ok" : "err");
    pill.textContent = report.conforms ? "conforms" : `${report.results.length} violation(s)`;
    h.appendChild(document.createTextNode("Validation"));
    h.appendChild(pill);
    wrap.appendChild(h);
    if (!report.results.length) {
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = "No issues. Run again after edits to re-check.";
      wrap.appendChild(p);
    } else {
      const ul = document.createElement("ul");
      for (const r of report.results) {
        const li = document.createElement("li");
        if (r.severity === "sh:Warning") li.classList.add("warn");
        const msg = document.createElement("div");
        msg.textContent = r.message || "Constraint violation";
        li.appendChild(msg);
        const focus = document.createElement("div");
        focus.className = "focus";
        focus.textContent = `focus: ${display(r.focusNode)}${r.resultPath ? "  path: " + display(r.resultPath) : ""}${r.value != null ? "  value: " + String(r.value) : ""}`;
        li.appendChild(focus);
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
    }
    wrap.classList.add("show");
  }

  /* =========================================================
   * Toast
   * ========================================================= */
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* =========================================================
   * Init
   * ========================================================= */
  render();
  // Seed an example if the model is empty to showcase features.
  if (!model.classes.length && !model.individuals.length && !model.shapes.length) {
    seedExample();
    render();
  }

  function seedExample() {
    const ns = defaultNs();
    const catPerson = { id: "cat_" + makeId(), name: "Agent", description: "People & organizations", color: "#38bdf8" };
    const catPlace = { id: "cat_" + makeId(), name: "Place", description: "Physical places", color: "#22c55e" };
    model.categories.push(catPerson, catPlace);

    model.classes.push(
      { iri: ns + "Agent", label: "Agent", comment: "", categories: [catPerson.id], subClassOf: [], equivalent: [], disjointWith: [], restrictions: [] },
      { iri: ns + "Person", label: "Person", comment: "A human.", categories: [catPerson.id], subClassOf: [ns + "Agent"], equivalent: [], disjointWith: [], restrictions: [] },
      { iri: ns + "Organization", label: "Organization", comment: "", categories: [catPerson.id], subClassOf: [ns + "Agent"], equivalent: [], disjointWith: [], restrictions: [] },
      { iri: ns + "City", label: "City", comment: "", categories: [catPlace.id], subClassOf: [], equivalent: [], disjointWith: [], restrictions: [] }
    );
    model.objectProperties.push(
      { iri: ns + "knows", label: "knows", comment: "", subPropertyOf: [], domain: [ns + "Person"], range: [ns + "Person"], inverseOf: "", characteristics: ["Symmetric"] },
      { iri: ns + "livesIn", label: "livesIn", comment: "", subPropertyOf: [], domain: [ns + "Person"], range: [ns + "City"], inverseOf: "", characteristics: [] }
    );
    model.dataProperties.push(
      { iri: ns + "name", label: "name", comment: "", subPropertyOf: [], domain: [ns + "Person"], range: [window.OWL.NS.xsd + "string"], characteristics: [] },
      { iri: ns + "age", label: "age", comment: "", subPropertyOf: [], domain: [ns + "Person"], range: [window.OWL.NS.xsd + "integer"], characteristics: ["Functional"] }
    );
    // Add a useful restriction: every Person knows only Person.
    const personCls = model.classes.find((c) => c.iri === ns + "Person");
    personCls.restrictions.push({ kind: "allValuesFrom", property: ns + "knows", classIri: ns + "Person" });

    model.individuals.push(
      { iri: ns + "alice", label: "Alice", comment: "", types: [ns + "Person"],
        objectAssertions: [{ property: ns + "knows", target: ns + "bob" }, { property: ns + "livesIn", target: ns + "berlin" }],
        dataAssertions: [{ property: ns + "name", value: "Alice", datatype: window.OWL.NS.xsd + "string" },
                         { property: ns + "age", value: "30", datatype: window.OWL.NS.xsd + "integer" }] },
      { iri: ns + "bob", label: "Bob", comment: "", types: [ns + "Person"],
        objectAssertions: [], dataAssertions: [{ property: ns + "name", value: "Bob" }] },
      { iri: ns + "berlin", label: "Berlin", comment: "", types: [ns + "City"], objectAssertions: [], dataAssertions: [] }
    );

    model.shapes.push({
      iri: ns + "PersonShape",
      label: "Person shape",
      comment: "Example: every Person must have exactly one name and a non-negative age.",
      targetClass: ns + "Person",
      targetNode: "", targetSubjectsOf: "", targetObjectsOf: "",
      closed: false, severity: "", message: "",
      properties: [
        { path: ns + "name", minCount: 1, maxCount: 1, datatype: window.OWL.NS.xsd + "string" },
        { path: ns + "age", datatype: window.OWL.NS.xsd + "integer", minInclusive: "0", maxInclusive: "150" },
      ],
    });
    save();
  }
})();
