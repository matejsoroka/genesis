/* OntoMobile OWL / RDF-XML serializer & parser.
 *
 * The ontology model:
 *   {
 *     iri: "http://example.org/my-ontology",
 *     label: "My ontology",
 *     comment: "…",
 *     prefixes: { ex: "http://example.org/my-ontology#", ... },
 *     classes: [{ iri, label, comment, subClassOf: [iri,…], equivalent: [iri,…], disjointWith: [iri,…] }],
 *     objectProperties: [{ iri, label, comment, domain: [iri,…], range: [iri,…], subPropertyOf: [iri,…], inverseOf, characteristics: ["Functional",…] }],
 *     dataProperties:   [{ iri, label, comment, domain: [iri,…], range: [iri,…], subPropertyOf: [iri,…], characteristics: [...] }],
 *     individuals: [{ iri, label, comment, types: [iri,…], objectAssertions: [{property, target}], dataAssertions: [{property, value, datatype?}] }]
 *   }
 */
(function (global) {
  "use strict";

  const NS = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    owl: "http://www.w3.org/2002/07/owl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    xml: "http://www.w3.org/XML/1998/namespace",
  };

  const OBJECT_PROPERTY_CHARACTERISTICS = [
    "Functional",
    "InverseFunctional",
    "Transitive",
    "Symmetric",
    "Asymmetric",
    "Reflexive",
    "Irreflexive",
  ];
  const DATA_PROPERTY_CHARACTERISTICS = ["Functional"];

  const XSD_DATATYPES = [
    "string",
    "boolean",
    "integer",
    "int",
    "long",
    "short",
    "decimal",
    "float",
    "double",
    "date",
    "dateTime",
    "time",
    "anyURI",
  ];

  function escapeXml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function isAbsoluteIri(s) {
    return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(s || "");
  }

  function defaultPrefixes(ontIri) {
    const base = ontIri || "http://example.org/ontology";
    const localNs = base.endsWith("#") || base.endsWith("/") ? base : base + "#";
    return {
      "": localNs,
      owl: NS.owl,
      rdf: NS.rdf,
      rdfs: NS.rdfs,
      xsd: NS.xsd,
    };
  }

  function expand(prefixes, curieOrIri) {
    if (!curieOrIri) return "";
    if (isAbsoluteIri(curieOrIri)) return curieOrIri;
    const idx = curieOrIri.indexOf(":");
    if (idx >= 0) {
      const p = curieOrIri.slice(0, idx);
      const local = curieOrIri.slice(idx + 1);
      if (prefixes && prefixes[p] != null) return prefixes[p] + local;
    }
    // treat as local name in default namespace
    const def = (prefixes && prefixes[""]) || "";
    return def + curieOrIri;
  }

  function shorten(prefixes, iri) {
    if (!iri) return "";
    const entries = Object.entries(prefixes || {}).sort(
      (a, b) => b[1].length - a[1].length
    );
    for (const [p, ns] of entries) {
      if (ns && iri.startsWith(ns)) {
        const local = iri.slice(ns.length);
        if (/^[A-Za-z_][\w.\-]*$/.test(local)) {
          return p ? `${p}:${local}` : local;
        }
      }
    }
    return iri;
  }

  /* ------------ Serialization ------------ */

  function serialize(model) {
    const prefixes = Object.assign({}, defaultPrefixes(model.iri), model.prefixes || {});
    const baseNs = prefixes[""] || defaultPrefixes(model.iri)[""];

    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    const docAttrs = [];
    for (const [p, ns] of Object.entries(prefixes)) {
      const name = p === "" ? "xmlns" : `xmlns:${p}`;
      docAttrs.push(`    ${name}="${escapeXml(ns)}"`);
    }
    docAttrs.push(`    xml:base="${escapeXml(model.iri || baseNs.replace(/#$/, ""))}"`);

    lines.push(`<rdf:RDF`);
    lines.push(docAttrs.join("\n") + ">");

    // Ontology declaration
    lines.push("");
    lines.push(`  <owl:Ontology rdf:about="${escapeXml(model.iri || "")}">`);
    if (model.label) {
      lines.push(`    <rdfs:label xml:lang="en">${escapeXml(model.label)}</rdfs:label>`);
    }
    if (model.comment) {
      lines.push(`    <rdfs:comment xml:lang="en">${escapeXml(model.comment)}</rdfs:comment>`);
    }
    lines.push(`  </owl:Ontology>`);

    function aboutIri(iri) {
      return escapeXml(expand(prefixes, iri));
    }

    function commonChildren(ent) {
      const out = [];
      if (ent.label) {
        out.push(`    <rdfs:label xml:lang="en">${escapeXml(ent.label)}</rdfs:label>`);
      }
      if (ent.comment) {
        out.push(`    <rdfs:comment xml:lang="en">${escapeXml(ent.comment)}</rdfs:comment>`);
      }
      return out;
    }

    function resourceRefs(tag, list) {
      const out = [];
      for (const iri of list || []) {
        if (!iri) continue;
        out.push(`    <${tag} rdf:resource="${aboutIri(iri)}"/>`);
      }
      return out;
    }

    // Classes
    for (const c of model.classes || []) {
      lines.push("");
      lines.push(`  <owl:Class rdf:about="${aboutIri(c.iri)}">`);
      lines.push(...commonChildren(c));
      lines.push(...resourceRefs("rdfs:subClassOf", c.subClassOf));
      lines.push(...resourceRefs("owl:equivalentClass", c.equivalent));
      lines.push(...resourceRefs("owl:disjointWith", c.disjointWith));
      lines.push(`  </owl:Class>`);
    }

    // Object properties
    for (const p of model.objectProperties || []) {
      lines.push("");
      lines.push(`  <owl:ObjectProperty rdf:about="${aboutIri(p.iri)}">`);
      lines.push(...commonChildren(p));
      lines.push(...resourceRefs("rdfs:subPropertyOf", p.subPropertyOf));
      lines.push(...resourceRefs("rdfs:domain", p.domain));
      lines.push(...resourceRefs("rdfs:range", p.range));
      if (p.inverseOf) {
        lines.push(`    <owl:inverseOf rdf:resource="${aboutIri(p.inverseOf)}"/>`);
      }
      for (const ch of p.characteristics || []) {
        lines.push(
          `    <rdf:type rdf:resource="${escapeXml(NS.owl + ch + "Property")}"/>`
        );
      }
      lines.push(`  </owl:ObjectProperty>`);
    }

    // Data properties
    for (const p of model.dataProperties || []) {
      lines.push("");
      lines.push(`  <owl:DatatypeProperty rdf:about="${aboutIri(p.iri)}">`);
      lines.push(...commonChildren(p));
      lines.push(...resourceRefs("rdfs:subPropertyOf", p.subPropertyOf));
      lines.push(...resourceRefs("rdfs:domain", p.domain));
      lines.push(...resourceRefs("rdfs:range", p.range));
      for (const ch of p.characteristics || []) {
        lines.push(
          `    <rdf:type rdf:resource="${escapeXml(NS.owl + ch + "Property")}"/>`
        );
      }
      lines.push(`  </owl:DatatypeProperty>`);
    }

    // Individuals
    for (const i of model.individuals || []) {
      lines.push("");
      lines.push(`  <owl:NamedIndividual rdf:about="${aboutIri(i.iri)}">`);
      lines.push(...commonChildren(i));
      for (const t of i.types || []) {
        lines.push(`    <rdf:type rdf:resource="${aboutIri(t)}"/>`);
      }
      for (const a of i.objectAssertions || []) {
        if (!a || !a.property || !a.target) continue;
        const pTag = shorten(prefixes, expand(prefixes, a.property));
        const looksPrefixed = pTag && pTag.includes(":") && !isAbsoluteIri(pTag);
        const tag = looksPrefixed ? pTag : escapeXml(pTag);
        lines.push(`    <${tag} rdf:resource="${aboutIri(a.target)}"/>`);
      }
      for (const a of i.dataAssertions || []) {
        if (!a || !a.property) continue;
        const pTag = shorten(prefixes, expand(prefixes, a.property));
        const looksPrefixed = pTag && pTag.includes(":") && !isAbsoluteIri(pTag);
        const tag = looksPrefixed ? pTag : escapeXml(pTag);
        const dt = a.datatype
          ? ` rdf:datatype="${escapeXml(expand(prefixes, a.datatype))}"`
          : "";
        lines.push(`    <${tag}${dt}>${escapeXml(a.value || "")}</${tag}>`);
      }
      lines.push(`  </owl:NamedIndividual>`);
    }

    lines.push("");
    lines.push("</rdf:RDF>");
    return lines.join("\n");
  }

  /* ------------ Parsing ------------ */

  function parse(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parseError = doc.getElementsByTagName("parsererror")[0];
    if (parseError) {
      throw new Error("Invalid XML: " + parseError.textContent.slice(0, 200));
    }
    const root = doc.documentElement;
    if (!root) throw new Error("Empty document");

    // Collect xmlns declarations
    const prefixes = {};
    for (const attr of Array.from(root.attributes)) {
      if (attr.name === "xmlns") prefixes[""] = attr.value;
      else if (attr.name.startsWith("xmlns:")) prefixes[attr.name.slice(6)] = attr.value;
    }
    if (!prefixes.owl) prefixes.owl = NS.owl;
    if (!prefixes.rdf) prefixes.rdf = NS.rdf;
    if (!prefixes.rdfs) prefixes.rdfs = NS.rdfs;
    if (!prefixes.xsd) prefixes.xsd = NS.xsd;

    const xmlBase = root.getAttributeNS(NS.xml, "base") || root.getAttribute("xml:base");

    const model = {
      iri: "",
      label: "",
      comment: "",
      prefixes,
      classes: [],
      objectProperties: [],
      dataProperties: [],
      individuals: [],
    };

    function resolveAbout(el) {
      const about = el.getAttributeNS(NS.rdf, "about") || el.getAttribute("rdf:about");
      const id = el.getAttributeNS(NS.rdf, "ID") || el.getAttribute("rdf:ID");
      if (about) {
        if (about.startsWith("#") && xmlBase) return xmlBase + about;
        return about;
      }
      if (id && xmlBase) return xmlBase + "#" + id;
      return id || "";
    }

    function resolveResource(el) {
      const res =
        el.getAttributeNS(NS.rdf, "resource") || el.getAttribute("rdf:resource");
      if (!res) return "";
      if (res.startsWith("#") && xmlBase) return xmlBase + res;
      return res;
    }

    function isNs(el, ns, localName) {
      return (
        (el.namespaceURI === ns && el.localName === localName) ||
        el.nodeName === localName ||
        (el.nodeName.includes(":") && el.nodeName.split(":")[1] === localName)
      );
    }

    function getLabel(el) {
      const n = el.getElementsByTagNameNS(NS.rdfs, "label")[0];
      if (n) return n.textContent.trim();
      return "";
    }
    function getComment(el) {
      const n = el.getElementsByTagNameNS(NS.rdfs, "comment")[0];
      if (n) return n.textContent.trim();
      return "";
    }

    function collectResources(el, ns, localName) {
      const out = [];
      const nodes = el.getElementsByTagNameNS(ns, localName);
      for (const n of Array.from(nodes)) {
        if (n.parentNode !== el) continue;
        const r = resolveResource(n);
        if (r) out.push(r);
      }
      return out;
    }

    // Ontology declaration
    const ontNodes = root.getElementsByTagNameNS(NS.owl, "Ontology");
    if (ontNodes.length > 0) {
      const ont = ontNodes[0];
      model.iri = resolveAbout(ont) || xmlBase || "";
      model.label = getLabel(ont);
      model.comment = getComment(ont);
    } else if (xmlBase) {
      model.iri = xmlBase;
    }

    // Build a registry of property types by IRI, so we know how to classify them
    // when we see individuals referring to them.
    const propertyType = new Map();

    // Classes
    for (const el of Array.from(root.getElementsByTagNameNS(NS.owl, "Class"))) {
      if (el.parentNode !== root) continue;
      const iri = resolveAbout(el);
      if (!iri) continue;
      model.classes.push({
        iri,
        label: getLabel(el),
        comment: getComment(el),
        subClassOf: collectResources(el, NS.rdfs, "subClassOf"),
        equivalent: collectResources(el, NS.owl, "equivalentClass"),
        disjointWith: collectResources(el, NS.owl, "disjointWith"),
      });
    }

    function readProperty(el, kind) {
      const iri = resolveAbout(el);
      if (!iri) return null;
      const characteristics = [];
      const rdfTypes = el.getElementsByTagNameNS(NS.rdf, "type");
      for (const t of Array.from(rdfTypes)) {
        if (t.parentNode !== el) continue;
        const r = resolveResource(t);
        if (!r || !r.startsWith(NS.owl)) continue;
        const local = r.slice(NS.owl.length);
        const m = local.match(/^(\w+)Property$/);
        if (m) {
          const c = m[1];
          if (
            kind === "object" &&
            OBJECT_PROPERTY_CHARACTERISTICS.includes(c)
          ) {
            characteristics.push(c);
          } else if (
            kind === "data" &&
            DATA_PROPERTY_CHARACTERISTICS.includes(c)
          ) {
            characteristics.push(c);
          }
        }
      }
      const prop = {
        iri,
        label: getLabel(el),
        comment: getComment(el),
        subPropertyOf: collectResources(el, NS.rdfs, "subPropertyOf"),
        domain: collectResources(el, NS.rdfs, "domain"),
        range: collectResources(el, NS.rdfs, "range"),
        characteristics,
      };
      if (kind === "object") {
        const inv = el.getElementsByTagNameNS(NS.owl, "inverseOf")[0];
        if (inv && inv.parentNode === el) prop.inverseOf = resolveResource(inv);
      }
      return prop;
    }

    for (const el of Array.from(
      root.getElementsByTagNameNS(NS.owl, "ObjectProperty")
    )) {
      if (el.parentNode !== root) continue;
      const p = readProperty(el, "object");
      if (p) {
        model.objectProperties.push(p);
        propertyType.set(p.iri, "object");
      }
    }
    for (const el of Array.from(
      root.getElementsByTagNameNS(NS.owl, "DatatypeProperty")
    )) {
      if (el.parentNode !== root) continue;
      const p = readProperty(el, "data");
      if (p) {
        model.dataProperties.push(p);
        propertyType.set(p.iri, "data");
      }
    }

    // Individuals
    function ingestIndividual(el, typeIri) {
      const iri = resolveAbout(el);
      if (!iri) return;
      let existing = model.individuals.find((x) => x.iri === iri);
      if (!existing) {
        existing = {
          iri,
          label: getLabel(el),
          comment: getComment(el),
          types: [],
          objectAssertions: [],
          dataAssertions: [],
        };
        model.individuals.push(existing);
      } else {
        if (!existing.label) existing.label = getLabel(el);
        if (!existing.comment) existing.comment = getComment(el);
      }
      if (typeIri && !existing.types.includes(typeIri)) existing.types.push(typeIri);

      // rdf:type children
      for (const t of Array.from(el.getElementsByTagNameNS(NS.rdf, "type"))) {
        if (t.parentNode !== el) continue;
        const r = resolveResource(t);
        if (r && r !== NS.owl + "NamedIndividual" && !existing.types.includes(r))
          existing.types.push(r);
      }

      // Property assertions – any child that isn't rdf:type, rdfs:label, rdfs:comment
      for (const child of Array.from(el.children)) {
        const ns = child.namespaceURI;
        const ln = child.localName;
        if (ns === NS.rdf && ln === "type") continue;
        if (ns === NS.rdfs && (ln === "label" || ln === "comment")) continue;
        const pIri = ns ? ns + ln : ln;
        const res = resolveResource(child);
        if (res) {
          existing.objectAssertions.push({ property: pIri, target: res });
          if (!propertyType.has(pIri)) propertyType.set(pIri, "object");
        } else {
          const dt =
            child.getAttributeNS(NS.rdf, "datatype") ||
            child.getAttribute("rdf:datatype") ||
            "";
          existing.dataAssertions.push({
            property: pIri,
            value: child.textContent || "",
            datatype: dt || undefined,
          });
          if (!propertyType.has(pIri)) propertyType.set(pIri, "data");
        }
      }
    }

    for (const el of Array.from(
      root.getElementsByTagNameNS(NS.owl, "NamedIndividual")
    )) {
      if (el.parentNode !== root) continue;
      ingestIndividual(el, null);
    }
    // Also accept rdf:Description or class-typed children as individuals if they have rdf:about
    for (const el of Array.from(root.children)) {
      if (el.namespaceURI === NS.owl && el.localName === "NamedIndividual") continue;
      if (el.namespaceURI === NS.owl && el.localName === "Class") continue;
      if (
        el.namespaceURI === NS.owl &&
        (el.localName === "ObjectProperty" || el.localName === "DatatypeProperty")
      )
        continue;
      if (el.namespaceURI === NS.owl && el.localName === "Ontology") continue;
      const iri = resolveAbout(el);
      if (!iri) continue;
      // Classify as individual typed by this element's tag (if not a meta element)
      const typeIri =
        el.namespaceURI === NS.rdf && el.localName === "Description"
          ? null
          : (el.namespaceURI || "") + el.localName;
      ingestIndividual(el, typeIri);
    }

    return model;
  }

  function emptyOntology(iri) {
    iri = iri || "http://example.org/ontology";
    return {
      iri,
      label: "Untitled ontology",
      comment: "",
      prefixes: defaultPrefixes(iri),
      classes: [],
      objectProperties: [],
      dataProperties: [],
      individuals: [],
    };
  }

  global.OWL = {
    NS,
    OBJECT_PROPERTY_CHARACTERISTICS,
    DATA_PROPERTY_CHARACTERISTICS,
    XSD_DATATYPES,
    defaultPrefixes,
    expand,
    shorten,
    serialize,
    parse,
    emptyOntology,
    isAbsoluteIri,
  };
})(typeof window !== "undefined" ? window : globalThis);
