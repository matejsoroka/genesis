(function () {
  "use strict";

  const STORAGE_KEY = "ontomobile:model";
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
  } = window.OWL;

  /** @type {ReturnType<typeof emptyOntology>} */
  let model = load();
  let currentTab = "classes";
  const searchTerm = {
    classes: "",
    objectProperties: "",
    dataProperties: "",
    individuals: "",
  };

  /* --------------- Storage --------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        return normalize(obj);
      }
    } catch (_) {}
    return emptyOntology();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } catch (e) {
      toast("Could not save locally");
    }
  }

  function normalize(m) {
    const base = emptyOntology(m.iri);
    return Object.assign(base, {
      iri: m.iri || base.iri,
      label: m.label || "",
      comment: m.comment || "",
      prefixes: Object.assign({}, base.prefixes, m.prefixes || {}),
      classes: (m.classes || []).map((c) => ({
        iri: c.iri,
        label: c.label || "",
        comment: c.comment || "",
        subClassOf: c.subClassOf || [],
        equivalent: c.equivalent || [],
        disjointWith: c.disjointWith || [],
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
    });
  }

  /* --------------- IRI helpers --------------- */
  function defaultNs() {
    return (model.prefixes && model.prefixes[""]) || defaultPrefixes(model.iri)[""];
  }
  function makeIri(localName) {
    localName = (localName || "").trim();
    if (!localName) return "";
    if (window.OWL.isAbsoluteIri(localName)) return localName;
    // Remove invalid characters, keep word chars and underscore/hyphen
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

  /* --------------- Rendering --------------- */
  const $ = (id) => document.getElementById(id);

  function render() {
    $("ontologyTitle").textContent = model.label || "Untitled ontology";
    $("ontologyIri").textContent = model.iri || "";
    renderList("classes");
    renderList("objectProperties");
    renderList("dataProperties");
    renderList("individuals");
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
    listEl.innerHTML = "";
    const items = (model[kind] || []).filter((it) => {
      if (!term) return true;
      const hay = [it.label, it.iri, it.comment].join(" ").toLowerCase();
      return hay.includes(term);
    });
    if (items.length === 0) {
      emptyEl.classList.add("show");
    } else {
      emptyEl.classList.remove("show");
    }
    for (const it of items) {
      listEl.appendChild(renderItem(kind, it));
    }
  }

  function renderItem(kind, it) {
    const li = document.createElement("li");
    li.className = "item";
    const main = document.createElement("div");
    main.className = "item-main";

    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = displayLabel(it);
    main.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "item-sub";
    sub.textContent = display(it.iri);
    main.appendChild(sub);

    // chips
    const chips = document.createElement("div");
    if (kind === "classes") {
      for (const parent of it.subClassOf || [])
        chips.appendChild(chip("⊑ " + display(parent)));
    } else if (kind === "objectProperties" || kind === "dataProperties") {
      if ((it.domain || []).length)
        chips.appendChild(chip("dom: " + it.domain.map(display).join(", ")));
      if ((it.range || []).length)
        chips.appendChild(chip("ran: " + it.range.map(display).join(", ")));
      for (const c of it.characteristics || []) chips.appendChild(chip(c));
    } else if (kind === "individuals") {
      for (const t of it.types || []) chips.appendChild(chip("∈ " + display(t)));
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

  function deleteEntity(kind, iri) {
    model[kind] = model[kind].filter((x) => x.iri !== iri);
    // Clean up references
    if (kind === "classes") {
      for (const c of model.classes) {
        c.subClassOf = c.subClassOf.filter((x) => x !== iri);
        c.equivalent = c.equivalent.filter((x) => x !== iri);
        c.disjointWith = c.disjointWith.filter((x) => x !== iri);
      }
      for (const p of model.objectProperties.concat(model.dataProperties)) {
        p.domain = p.domain.filter((x) => x !== iri);
        p.range = p.range.filter((x) => x !== iri);
      }
      for (const i of model.individuals) {
        i.types = i.types.filter((x) => x !== iri);
      }
    } else if (kind === "objectProperties" || kind === "dataProperties") {
      for (const p of model[kind]) {
        p.subPropertyOf = p.subPropertyOf.filter((x) => x !== iri);
        if (p.inverseOf === iri) p.inverseOf = "";
      }
      for (const i of model.individuals) {
        if (kind === "objectProperties") {
          i.objectAssertions = i.objectAssertions.filter((a) => a.property !== iri);
        } else {
          i.dataAssertions = i.dataAssertions.filter((a) => a.property !== iri);
        }
      }
    }
    save();
    render();
    toast("Deleted");
  }

  /* --------------- Tabs --------------- */
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      setTab(tab);
    });
  });
  function setTab(tab) {
    currentTab = tab;
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.toggle("active", p.dataset.tab === tab));
  }

  /* --------------- Search --------------- */
  function wireSearch(id, kind) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      searchTerm[kind] = el.value;
      renderList(kind);
    });
  }
  wireSearch("searchClasses", "classes");
  wireSearch("searchObjectProperties", "objectProperties");
  wireSearch("searchDataProperties", "dataProperties");
  wireSearch("searchIndividuals", "individuals");

  /* --------------- FAB / add --------------- */
  $("fab").addEventListener("click", () => {
    openEditor(currentTab, null);
  });

  /* --------------- Menu --------------- */
  const sideMenu = $("sideMenu");
  const backdrop = $("backdrop");
  $("menuBtn").addEventListener("click", openMenu);
  $("closeMenuBtn").addEventListener("click", closeMenu);
  backdrop.addEventListener("click", closeMenu);
  function openMenu() {
    sideMenu.classList.add("open");
    sideMenu.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
  }
  function closeMenu() {
    sideMenu.classList.remove("open");
    sideMenu.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
  }

  sideMenu.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    closeMenu();
    if (action === "edit-meta") openMetadataEditor();
    else if (action === "import") $("fileInput").click();
    else if (action === "export") exportOwl();
    else if (action === "view-raw") openRawView();
    else if (action === "new") {
      if (confirm("Start a new empty ontology? Your current work will be lost unless exported.")) {
        model = emptyOntology();
        save();
        render();
      }
    } else if (action === "clear") {
      if (confirm("Clear all entities (keep metadata)?")) {
        model.classes = [];
        model.objectProperties = [];
        model.dataProperties = [];
        model.individuals = [];
        save();
        render();
      }
    }
  });

  /* --------------- Save button ---------------*/
  $("saveBtn").addEventListener("click", () => {
    save();
    toast("Saved");
  });

  /* --------------- Sheet --------------- */
  const sheet = $("sheet");
  const sheetTitle = $("sheetTitle");
  const sheetBody = $("sheetBody");
  let sheetSaveHandler = null;
  sheet.addEventListener("click", (e) => {
    if (
      e.target.classList.contains("sheet-backdrop") ||
      e.target.dataset.sheetCancel !== undefined
    ) {
      closeSheet();
    }
    if (e.target.dataset.sheetSave !== undefined) {
      if (sheetSaveHandler) sheetSaveHandler();
    }
  });
  function openSheet(title, body, onSave) {
    sheetTitle.textContent = title;
    sheetBody.innerHTML = "";
    sheetBody.appendChild(body);
    sheetSaveHandler = onSave;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
  }
  function closeSheet() {
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    sheetSaveHandler = null;
  }

  /* --------------- Form helpers --------------- */
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

  /**
   * Multi-select input storing IRIs, with autocomplete from a list of entities.
   */
  function multiIriInput(values, suggestions, placeholder) {
    const container = document.createElement("div");
    container.className = "multi";
    const state = Array.from(values || []);
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder || "Add…";
    const dl = document.createElement("datalist");
    const dlId = "dl-" + Math.random().toString(36).slice(2);
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
        rm.setAttribute("aria-label", "Remove");
        rm.addEventListener("click", () => {
          state.splice(idx, 1);
          renderTags();
        });
        tag.appendChild(rm);
        container.insertBefore(tag, input);
      }
    }

    function commit() {
      const raw = input.value.trim();
      if (!raw) return;
      let iri = raw;
      // if user typed the *label* of a suggestion, resolve back to its value
      const match = (suggestions || []).find(
        (s) => s.label === raw || s.value === raw
      );
      if (match) iri = match.value;
      else if (!window.OWL.isAbsoluteIri(iri) && !iri.includes(":")) {
        iri = makeIri(iri);
      } else {
        iri = expand(model.prefixes, iri);
      }
      if (!state.includes(iri)) state.push(iri);
      input.value = "";
      renderTags();
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
      } else if (e.key === "Backspace" && input.value === "" && state.length) {
        state.pop();
        renderTags();
      }
    });
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);

    container.appendChild(input);
    container.appendChild(dl);
    renderTags();

    return {
      element: container,
      getValues: () => {
        commit();
        return state.slice();
      },
    };
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

  function checkboxList(options, values) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px";
    const set = new Set(values || []);
    const inputs = [];
    for (const opt of options) {
      const lab = document.createElement("label");
      lab.style.display = "inline-flex";
      lab.style.alignItems = "center";
      lab.style.gap = "4px";
      lab.style.background = "var(--surface-2)";
      lab.style.border = "1px solid var(--border)";
      lab.style.borderRadius = "8px";
      lab.style.padding = "6px 10px";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = opt;
      cb.checked = set.has(opt);
      inputs.push(cb);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(opt));
      wrap.appendChild(lab);
    }
    return {
      element: wrap,
      getValues: () => inputs.filter((i) => i.checked).map((i) => i.value),
    };
  }

  /* --------------- Editors --------------- */
  function openEditor(kind, entity) {
    const isNew = !entity;
    const orig = entity;
    const data = entity
      ? JSON.parse(JSON.stringify(entity))
      : { iri: "", label: "", comment: "" };

    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "12px";

    const labelInput = inputEl(data.label, "Human-readable label");
    const localInput = inputEl(
      isNew ? "" : shorten(model.prefixes, data.iri),
      "e.g. Person, or ex:Person, or full IRI"
    );
    const commentInput = textareaEl(data.comment, "Description / comment");

    body.appendChild(field("Label", labelInput));
    body.appendChild(
      field(
        isNew ? "Name / IRI" : "IRI",
        localInput,
        isNew
          ? "Short name becomes " + defaultNs() + "…"
          : "Change the IRI to rename"
      )
    );
    body.appendChild(field("Comment", commentInput));

    let specific = {};
    if (kind === "classes") {
      const classSug = entitySuggestions(model.classes);
      const parents = multiIriInput(data.subClassOf, classSug, "Superclass");
      const eq = multiIriInput(data.equivalent, classSug, "Equivalent class");
      const dj = multiIriInput(data.disjointWith, classSug, "Disjoint class");
      body.appendChild(field("Subclass of", parents.element));
      body.appendChild(field("Equivalent to", eq.element));
      body.appendChild(field("Disjoint with", dj.element));
      specific = {
        collect: () => ({
          subClassOf: parents.getValues(),
          equivalent: eq.getValues(),
          disjointWith: dj.getValues(),
        }),
      };
    } else if (kind === "objectProperties" || kind === "dataProperties") {
      const classSug = entitySuggestions(model.classes);
      const propSug = entitySuggestions(model[kind]);
      const dom = multiIriInput(data.domain, classSug, "Domain class");
      const rngValues =
        kind === "dataProperties"
          ? XSD_DATATYPES.map((d) => ({ value: "xsd:" + d, label: "xsd:" + d }))
          : classSug;
      const rng = multiIriInput(data.range, rngValues, "Range");
      const sup = multiIriInput(data.subPropertyOf, propSug, "Super-property");
      const chars = checkboxList(
        kind === "objectProperties"
          ? OBJECT_PROPERTY_CHARACTERISTICS
          : DATA_PROPERTY_CHARACTERISTICS,
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
      specific = {
        collect: () => {
          const result = {
            domain: dom.getValues(),
            range: rng.getValues(),
            subPropertyOf: sup.getValues(),
            characteristics: chars.getValues(),
          };
          if (invInput) {
            const v = invInput.value.trim();
            result.inverseOf = v ? expand(model.prefixes, v) : "";
            if (result.inverseOf && !window.OWL.isAbsoluteIri(result.inverseOf)) {
              result.inverseOf = makeIri(v);
            }
          }
          return result;
        },
      };
    } else if (kind === "individuals") {
      const classSug = entitySuggestions(model.classes);
      const types = multiIriInput(data.types, classSug, "Type (class)");
      body.appendChild(field("Types", types.element));

      // Object assertions
      const objSection = assertionSection(
        "Object property assertions",
        data.objectAssertions || [],
        { kind: "object" }
      );
      body.appendChild(objSection.element);

      // Data assertions
      const dataSection = assertionSection(
        "Data property assertions",
        data.dataAssertions || [],
        { kind: "data" }
      );
      body.appendChild(dataSection.element);

      specific = {
        collect: () => ({
          types: types.getValues(),
          objectAssertions: objSection.getValues(),
          dataAssertions: dataSection.getValues(),
        }),
      };
    }

    openSheet(isNew ? `New ${labelForKind(kind)}` : `Edit ${labelForKind(kind)}`, body, () => {
      const label = labelInput.value.trim();
      const localRaw = localInput.value.trim();
      if (!localRaw && !data.iri) {
        toast("Please provide a name or IRI");
        return;
      }
      let iri = data.iri;
      if (localRaw) {
        iri = window.OWL.isAbsoluteIri(localRaw)
          ? localRaw
          : expand(model.prefixes, localRaw);
        if (!window.OWL.isAbsoluteIri(iri)) {
          iri = makeIri(localRaw);
        }
      }
      if (!iri) {
        toast("Invalid IRI");
        return;
      }

      const updated = {
        iri,
        label,
        comment: commentInput.value.trim(),
      };
      Object.assign(updated, specific.collect());

      // Check collisions in new entities
      if (isNew || (orig && orig.iri !== iri)) {
        if (model[kind].some((x) => x.iri === iri && x !== orig)) {
          toast("An entity with that IRI already exists");
          return;
        }
      }

      if (isNew) {
        model[kind].push(updated);
      } else {
        const idx = model[kind].indexOf(orig);
        if (idx >= 0) {
          // If IRI changed, update refs across the model
          if (orig.iri !== iri) renameIri(orig.iri, iri);
          model[kind][idx] = updated;
        }
      }
      save();
      render();
      closeSheet();
      toast(isNew ? "Added" : "Saved");
    });
  }

  function labelForKind(kind) {
    return {
      classes: "class",
      objectProperties: "object property",
      dataProperties: "data property",
      individuals: "individual",
    }[kind];
  }

  function renameIri(oldIri, newIri) {
    const refs = (list, field) => {
      for (const e of list) {
        if (Array.isArray(e[field])) {
          e[field] = e[field].map((x) => (x === oldIri ? newIri : x));
        } else if (e[field] === oldIri) {
          e[field] = newIri;
        }
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
      for (const a of i.objectAssertions) {
        if (a.property === oldIri) a.property = newIri;
        if (a.target === oldIri) a.target = newIri;
      }
      for (const a of i.dataAssertions) {
        if (a.property === oldIri) a.property = newIri;
      }
    }
  }

  function assertionSection(title, items, { kind }) {
    const section = document.createElement("div");
    section.className = "field";
    const h = document.createElement("label");
    h.textContent = title;
    section.appendChild(h);

    const rows = document.createElement("div");
    rows.style.display = "flex";
    rows.style.flexDirection = "column";
    rows.style.gap = "6px";
    section.appendChild(rows);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "secondary";
    add.textContent = "+ Add";
    add.style.alignSelf = "flex-start";
    section.appendChild(add);

    const state = items.map((a) => Object.assign({}, a));

    function renderRows() {
      rows.innerHTML = "";
      state.forEach((a, idx) => {
        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "1fr 1fr auto";
        row.style.gap = "6px";

        const propSelect = document.createElement("input");
        propSelect.type = "text";
        propSelect.placeholder = "property";
        propSelect.value = a.property
          ? shorten(model.prefixes, a.property)
          : "";
        const propDlId = "pdl-" + Math.random().toString(36).slice(2);
        const propDl = document.createElement("datalist");
        propDl.id = propDlId;
        propSelect.setAttribute("list", propDlId);
        const propList =
          kind === "object" ? model.objectProperties : model.dataProperties;
        for (const p of propList) {
          const o = document.createElement("option");
          o.value = shorten(model.prefixes, p.iri);
          if (p.label) o.label = p.label;
          propDl.appendChild(o);
        }
        propSelect.addEventListener("change", () => {
          a.property = expand(model.prefixes, propSelect.value.trim());
        });

        let valueInput;
        if (kind === "object") {
          valueInput = document.createElement("input");
          valueInput.type = "text";
          valueInput.placeholder = "target individual";
          valueInput.value = a.target ? shorten(model.prefixes, a.target) : "";
          const dlId = "idl-" + Math.random().toString(36).slice(2);
          const dl = document.createElement("datalist");
          dl.id = dlId;
          valueInput.setAttribute("list", dlId);
          for (const ind of model.individuals) {
            const o = document.createElement("option");
            o.value = shorten(model.prefixes, ind.iri);
            if (ind.label) o.label = ind.label;
            dl.appendChild(o);
          }
          valueInput.addEventListener("change", () => {
            a.target = expand(model.prefixes, valueInput.value.trim());
          });
          row.appendChild(propSelect);
          row.appendChild(propDl);
          row.appendChild(valueInput);
          row.appendChild(dl);
        } else {
          const wrap = document.createElement("div");
          wrap.style.display = "flex";
          wrap.style.gap = "4px";
          valueInput = document.createElement("input");
          valueInput.type = "text";
          valueInput.placeholder = "value";
          valueInput.value = a.value || "";
          valueInput.addEventListener("input", () => {
            a.value = valueInput.value;
          });
          const dtSel = document.createElement("select");
          const noDt = document.createElement("option");
          noDt.value = "";
          noDt.textContent = "(type)";
          dtSel.appendChild(noDt);
          for (const d of XSD_DATATYPES) {
            const o = document.createElement("option");
            o.value = "xsd:" + d;
            o.textContent = "xsd:" + d;
            if (a.datatype && shorten(model.prefixes, a.datatype) === "xsd:" + d)
              o.selected = true;
            dtSel.appendChild(o);
          }
          dtSel.style.maxWidth = "100px";
          dtSel.addEventListener("change", () => {
            a.datatype = dtSel.value
              ? expand(model.prefixes, dtSel.value)
              : "";
          });
          wrap.appendChild(valueInput);
          wrap.appendChild(dtSel);
          row.appendChild(propSelect);
          row.appendChild(propDl);
          row.appendChild(wrap);
        }

        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "×";
        del.className = "icon-btn";
        del.addEventListener("click", () => {
          state.splice(idx, 1);
          renderRows();
        });
        row.appendChild(del);

        rows.appendChild(row);
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
          if (kind === "object") {
            if (!a.target) continue;
            clean.push({ property: a.property, target: a.target });
          } else {
            clean.push({
              property: a.property,
              value: a.value || "",
              datatype: a.datatype || undefined,
            });
          }
        }
        return clean;
      },
    };
  }

  /* --------------- Metadata editor --------------- */
  function openMetadataEditor() {
    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "12px";

    const iri = inputEl(model.iri, "http://example.org/my-ontology");
    const label = inputEl(model.label, "My ontology");
    const comment = textareaEl(model.comment, "Description");
    const prefixesTa = textareaEl(
      Object.entries(model.prefixes)
        .map(([p, n]) => `${p || ""}: ${n}`)
        .join("\n"),
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
      // ensure we always have a default namespace
      if (!model.prefixes[""]) {
        model.prefixes = Object.assign(defaultPrefixes(model.iri), model.prefixes);
      }
      save();
      render();
      closeSheet();
      toast("Updated");
    });
  }

  /* --------------- Raw OWL view --------------- */
  function openRawView() {
    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "8px";
    const ta = document.createElement("textarea");
    ta.className = "raw-view";
    ta.spellcheck = false;
    ta.value = serialize(model);
    body.appendChild(ta);

    const row = document.createElement("div");
    row.className = "row";
    const copyBtn = document.createElement("button");
    copyBtn.className = "secondary";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        toast("Copied to clipboard");
      } catch (_) {
        ta.select();
        document.execCommand("copy");
        toast("Copied");
      }
    });
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "secondary";
    downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", () => exportOwl(ta.value));
    row.appendChild(copyBtn);
    row.appendChild(downloadBtn);
    body.appendChild(row);

    openSheet("Raw OWL / RDF-XML", body, () => {
      // Replace model with parsed text
      try {
        const parsed = parse(ta.value);
        model = normalize(parsed);
        save();
        render();
        closeSheet();
        toast("Ontology updated from text");
      } catch (e) {
        toast("Parse error: " + e.message);
      }
    });
  }

  /* --------------- Import / export --------------- */
  function exportOwl(text) {
    const content = text || serialize(model);
    const filename = sanitizeFilename(model.label || "ontology") + ".owl";
    const blob = new Blob([content], { type: "application/rdf+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Exported " + filename);
  }

  function sanitizeFilename(name) {
    return (
      name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "ontology"
    );
  }

  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parse(text);
      model = normalize(parsed);
      save();
      render();
      toast("Imported " + file.name);
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      e.target.value = "";
    }
  });

  /* --------------- Toast --------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  /* --------------- Init --------------- */
  render();
})();
