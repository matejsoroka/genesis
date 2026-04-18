/* OntoMobile OWL / RDF-XML + SHACL serializer & parser.
 *
 * Produces a single RDF/XML document that contains:
 *   - owl:Ontology metadata
 *   - owl:Class / owl:ObjectProperty / owl:DatatypeProperty / owl:NamedIndividual
 *   - OWL class restrictions (someValuesFrom, allValuesFrom, hasValue,
 *     minCardinality, maxCardinality, cardinality, and the qualified variants)
 *   - skos:Concept category taxonomy + dcterms:subject memberships
 *   - SHACL NodeShape / PropertyShape definitions
 *
 * The model shape is documented in the README and mirrored by js/app.js. */
(function (global) {
  "use strict";

  const NS = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    owl: "http://www.w3.org/2002/07/owl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    xml: "http://www.w3.org/XML/1998/namespace",
    sh: "http://www.w3.org/ns/shacl#",
    skos: "http://www.w3.org/2004/02/skos/core#",
    dcterms: "http://purl.org/dc/terms/",
    ontomobile: "http://ontomobile.app/ns#",
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

  // OWL restriction kinds (UI-facing).
  const RESTRICTION_KINDS = [
    { id: "someValuesFrom", label: "some (∃ exists)", needs: "class" },
    { id: "allValuesFrom", label: "only (∀ all)", needs: "class" },
    { id: "hasValue", label: "has value", needs: "value" },
    { id: "minCardinality", label: "min cardinality", needs: "count" },
    { id: "maxCardinality", label: "max cardinality", needs: "count" },
    { id: "cardinality", label: "exactly", needs: "count" },
    {
      id: "minQualifiedCardinality",
      label: "min qualified",
      needs: "count+class",
    },
    {
      id: "maxQualifiedCardinality",
      label: "max qualified",
      needs: "count+class",
    },
    {
      id: "qualifiedCardinality",
      label: "exactly qualified",
      needs: "count+class",
    },
  ];

  const SH_NODE_KINDS = [
    "sh:IRI",
    "sh:Literal",
    "sh:BlankNode",
    "sh:BlankNodeOrIRI",
    "sh:BlankNodeOrLiteral",
    "sh:IRIOrLiteral",
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
      sh: NS.sh,
      skos: NS.skos,
      dcterms: NS.dcterms,
      ontomobile: NS.ontomobile,
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

  /* ================================================================
   * Serialization
   * ================================================================ */

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

    const indent = (n) => " ".repeat(n);
    function aboutIri(iri) {
      return escapeXml(expand(prefixes, iri));
    }
    function literal(tag, text, opts) {
      if (text == null || text === "") return null;
      const attrs = [];
      if (opts && opts.lang) attrs.push(` xml:lang="${escapeXml(opts.lang)}"`);
      if (opts && opts.datatype)
        attrs.push(` rdf:datatype="${escapeXml(expand(prefixes, opts.datatype))}"`);
      return `<${tag}${attrs.join("")}>${escapeXml(text)}</${tag}>`;
    }
    function resourceRefs(tag, list, level) {
      const out = [];
      for (const iri of list || []) {
        if (!iri) continue;
        out.push(`${indent(level)}<${tag} rdf:resource="${aboutIri(iri)}"/>`);
      }
      return out;
    }
    function commonChildren(ent, level) {
      const out = [];
      const lab = literal("rdfs:label", ent.label, { lang: "en" });
      if (lab) out.push(indent(level) + lab);
      const com = literal("rdfs:comment", ent.comment, { lang: "en" });
      if (com) out.push(indent(level) + com);
      return out;
    }

    // Ontology declaration
    lines.push("");
    lines.push(`  <owl:Ontology rdf:about="${escapeXml(model.iri || "")}">`);
    for (const l of commonChildren(model, 4)) lines.push(l);
    lines.push(`  </owl:Ontology>`);

    // ontomobile:color as an annotation property declaration (once) so that
    // tools round-tripping our file know it is legal.
    lines.push("");
    lines.push(
      `  <owl:AnnotationProperty rdf:about="${escapeXml(NS.ontomobile + "color")}"/>`
    );

    // Categories as skos:Concept nodes
    for (const cat of model.categories || []) {
      const catIri = expand(prefixes, categoryIri(cat, prefixes));
      lines.push("");
      lines.push(`  <skos:Concept rdf:about="${escapeXml(catIri)}">`);
      if (cat.name)
        lines.push(
          `    <skos:prefLabel xml:lang="en">${escapeXml(cat.name)}</skos:prefLabel>`
        );
      if (cat.description)
        lines.push(
          `    <skos:definition xml:lang="en">${escapeXml(cat.description)}</skos:definition>`
        );
      if (cat.color)
        lines.push(
          `    <ontomobile:color>${escapeXml(cat.color)}</ontomobile:color>`
        );
      lines.push(`  </skos:Concept>`);
    }

    // Classes
    for (const c of model.classes || []) {
      lines.push("");
      lines.push(`  <owl:Class rdf:about="${aboutIri(c.iri)}">`);
      for (const l of commonChildren(c, 4)) lines.push(l);
      for (const catId of c.categories || []) {
        const cat = (model.categories || []).find((x) => x.id === catId);
        if (!cat) continue;
        const catIri = expand(prefixes, categoryIri(cat, prefixes));
        lines.push(
          `    <dcterms:subject rdf:resource="${escapeXml(catIri)}"/>`
        );
      }
      lines.push(...resourceRefs("rdfs:subClassOf", c.subClassOf, 4));
      for (const r of c.restrictions || []) {
        lines.push(`    <rdfs:subClassOf>`);
        lines.push(...serializeRestriction(r, prefixes, 6));
        lines.push(`    </rdfs:subClassOf>`);
      }
      lines.push(...resourceRefs("owl:equivalentClass", c.equivalent, 4));
      lines.push(...resourceRefs("owl:disjointWith", c.disjointWith, 4));
      lines.push(`  </owl:Class>`);
    }

    // Object properties
    for (const p of model.objectProperties || []) {
      lines.push("");
      lines.push(`  <owl:ObjectProperty rdf:about="${aboutIri(p.iri)}">`);
      for (const l of commonChildren(p, 4)) lines.push(l);
      lines.push(...resourceRefs("rdfs:subPropertyOf", p.subPropertyOf, 4));
      lines.push(...resourceRefs("rdfs:domain", p.domain, 4));
      lines.push(...resourceRefs("rdfs:range", p.range, 4));
      if (p.inverseOf)
        lines.push(`    <owl:inverseOf rdf:resource="${aboutIri(p.inverseOf)}"/>`);
      for (const ch of p.characteristics || [])
        lines.push(
          `    <rdf:type rdf:resource="${escapeXml(NS.owl + ch + "Property")}"/>`
        );
      lines.push(`  </owl:ObjectProperty>`);
    }

    // Data properties
    for (const p of model.dataProperties || []) {
      lines.push("");
      lines.push(`  <owl:DatatypeProperty rdf:about="${aboutIri(p.iri)}">`);
      for (const l of commonChildren(p, 4)) lines.push(l);
      lines.push(...resourceRefs("rdfs:subPropertyOf", p.subPropertyOf, 4));
      lines.push(...resourceRefs("rdfs:domain", p.domain, 4));
      lines.push(...resourceRefs("rdfs:range", p.range, 4));
      for (const ch of p.characteristics || [])
        lines.push(
          `    <rdf:type rdf:resource="${escapeXml(NS.owl + ch + "Property")}"/>`
        );
      lines.push(`  </owl:DatatypeProperty>`);
    }

    // Individuals
    for (const i of model.individuals || []) {
      lines.push("");
      lines.push(`  <owl:NamedIndividual rdf:about="${aboutIri(i.iri)}">`);
      for (const l of commonChildren(i, 4)) lines.push(l);
      for (const t of i.types || [])
        lines.push(`    <rdf:type rdf:resource="${aboutIri(t)}"/>`);
      for (const a of i.objectAssertions || []) {
        if (!a || !a.property || !a.target) continue;
        const tag = shortenTag(prefixes, a.property);
        lines.push(`    <${tag} rdf:resource="${aboutIri(a.target)}"/>`);
      }
      for (const a of i.dataAssertions || []) {
        if (!a || !a.property) continue;
        const tag = shortenTag(prefixes, a.property);
        const dt = a.datatype
          ? ` rdf:datatype="${escapeXml(expand(prefixes, a.datatype))}"`
          : "";
        lines.push(`    <${tag}${dt}>${escapeXml(a.value || "")}</${tag}>`);
      }
      lines.push(`  </owl:NamedIndividual>`);
    }

    // SHACL shapes
    for (const s of model.shapes || []) {
      lines.push("");
      lines.push(`  <sh:NodeShape rdf:about="${aboutIri(s.iri)}">`);
      for (const l of commonChildren(s, 4)) lines.push(l);
      if (s.targetClass)
        lines.push(`    <sh:targetClass rdf:resource="${aboutIri(s.targetClass)}"/>`);
      if (s.targetNode)
        lines.push(`    <sh:targetNode rdf:resource="${aboutIri(s.targetNode)}"/>`);
      if (s.targetSubjectsOf)
        lines.push(
          `    <sh:targetSubjectsOf rdf:resource="${aboutIri(s.targetSubjectsOf)}"/>`
        );
      if (s.targetObjectsOf)
        lines.push(
          `    <sh:targetObjectsOf rdf:resource="${aboutIri(s.targetObjectsOf)}"/>`
        );
      if (s.closed) lines.push(`    <sh:closed rdf:datatype="${escapeXml(NS.xsd + "boolean")}">true</sh:closed>`);
      if (s.severity) {
        const sev = (s.severity || "").replace(/^sh:/, "");
        if (sev)
          lines.push(`    <sh:severity rdf:resource="${escapeXml(NS.sh + sev)}"/>`);
      }
      if (s.message)
        lines.push(
          `    <sh:message xml:lang="en">${escapeXml(s.message)}</sh:message>`
        );
      for (const ps of s.properties || []) {
        lines.push(`    <sh:property>`);
        lines.push(...serializePropertyShape(ps, prefixes, 6));
        lines.push(`    </sh:property>`);
      }
      lines.push(`  </sh:NodeShape>`);
    }

    lines.push("");
    lines.push("</rdf:RDF>");
    return lines.join("\n");
  }

  function shortenTag(prefixes, iri) {
    const s = shorten(prefixes, expand(prefixes, iri));
    if (s && s.includes(":") && !isAbsoluteIri(s)) return s;
    return escapeXml(s || iri);
  }

  function categoryIri(cat, prefixes) {
    if (cat.iri) return cat.iri;
    const base = prefixes[""] || "";
    const slug = (cat.name || cat.id || "category")
      .toLowerCase()
      .replace(/[^\w]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return base + "category-" + slug;
  }

  function serializeRestriction(r, prefixes, level) {
    const ind = " ".repeat(level);
    const lines = [`${ind}<owl:Restriction>`];
    if (r.property)
      lines.push(
        `${ind}  <owl:onProperty rdf:resource="${escapeXml(
          expand(prefixes, r.property)
        )}"/>`
      );
    const xsdNNI = NS.xsd + "nonNegativeInteger";
    switch (r.kind) {
      case "someValuesFrom":
      case "allValuesFrom": {
        const resIri = r.classIri || r.datatypeIri;
        if (resIri)
          lines.push(
            `${ind}  <owl:${r.kind} rdf:resource="${escapeXml(
              expand(prefixes, resIri)
            )}"/>`
          );
        break;
      }
      case "hasValue": {
        if (r.valueIri)
          lines.push(
            `${ind}  <owl:hasValue rdf:resource="${escapeXml(
              expand(prefixes, r.valueIri)
            )}"/>`
          );
        else if (r.valueLiteral != null)
          lines.push(
            `${ind}  <owl:hasValue>${escapeXml(r.valueLiteral)}</owl:hasValue>`
          );
        break;
      }
      case "minCardinality":
      case "maxCardinality":
      case "cardinality": {
        lines.push(
          `${ind}  <owl:${r.kind} rdf:datatype="${escapeXml(xsdNNI)}">${
            r.count || 0
          }</owl:${r.kind}>`
        );
        break;
      }
      case "minQualifiedCardinality":
      case "maxQualifiedCardinality":
      case "qualifiedCardinality": {
        lines.push(
          `${ind}  <owl:${r.kind} rdf:datatype="${escapeXml(xsdNNI)}">${
            r.count || 0
          }</owl:${r.kind}>`
        );
        const onClass = r.qualifiedClassIri || r.classIri;
        if (onClass)
          lines.push(
            `${ind}  <owl:onClass rdf:resource="${escapeXml(
              expand(prefixes, onClass)
            )}"/>`
          );
        break;
      }
    }
    lines.push(`${ind}</owl:Restriction>`);
    return lines;
  }

  function serializePropertyShape(ps, prefixes, level) {
    const ind = " ".repeat(level);
    const out = [`${ind}<sh:PropertyShape>`];
    if (ps.path)
      out.push(
        `${ind}  <sh:path rdf:resource="${escapeXml(expand(prefixes, ps.path))}"/>`
      );
    if (ps.name)
      out.push(`${ind}  <sh:name xml:lang="en">${escapeXml(ps.name)}</sh:name>`);
    if (ps.description)
      out.push(
        `${ind}  <sh:description xml:lang="en">${escapeXml(ps.description)}</sh:description>`
      );
    if (ps.minCount != null && ps.minCount !== "")
      out.push(
        `${ind}  <sh:minCount rdf:datatype="${escapeXml(
          NS.xsd + "integer"
        )}">${Number(ps.minCount)}</sh:minCount>`
      );
    if (ps.maxCount != null && ps.maxCount !== "")
      out.push(
        `${ind}  <sh:maxCount rdf:datatype="${escapeXml(
          NS.xsd + "integer"
        )}">${Number(ps.maxCount)}</sh:maxCount>`
      );
    if (ps.datatype)
      out.push(
        `${ind}  <sh:datatype rdf:resource="${escapeXml(
          expand(prefixes, ps.datatype)
        )}"/>`
      );
    if (ps.class)
      out.push(
        `${ind}  <sh:class rdf:resource="${escapeXml(expand(prefixes, ps.class))}"/>`
      );
    if (ps.nodeKind) {
      const nk = ps.nodeKind.replace(/^sh:/, "");
      out.push(`${ind}  <sh:nodeKind rdf:resource="${escapeXml(NS.sh + nk)}"/>`);
    }
    if (ps.pattern != null && ps.pattern !== "")
      out.push(`${ind}  <sh:pattern>${escapeXml(ps.pattern)}</sh:pattern>`);
    if (ps.flags) out.push(`${ind}  <sh:flags>${escapeXml(ps.flags)}</sh:flags>`);
    if (ps.minInclusive != null && ps.minInclusive !== "")
      out.push(
        `${ind}  <sh:minInclusive>${escapeXml(ps.minInclusive)}</sh:minInclusive>`
      );
    if (ps.maxInclusive != null && ps.maxInclusive !== "")
      out.push(
        `${ind}  <sh:maxInclusive>${escapeXml(ps.maxInclusive)}</sh:maxInclusive>`
      );
    if (ps.minLength != null && ps.minLength !== "")
      out.push(
        `${ind}  <sh:minLength rdf:datatype="${escapeXml(
          NS.xsd + "integer"
        )}">${Number(ps.minLength)}</sh:minLength>`
      );
    if (ps.maxLength != null && ps.maxLength !== "")
      out.push(
        `${ind}  <sh:maxLength rdf:datatype="${escapeXml(
          NS.xsd + "integer"
        )}">${Number(ps.maxLength)}</sh:maxLength>`
      );
    if (ps.hasValueIri)
      out.push(
        `${ind}  <sh:hasValue rdf:resource="${escapeXml(
          expand(prefixes, ps.hasValueIri)
        )}"/>`
      );
    else if (ps.hasValueLiteral != null && ps.hasValueLiteral !== "")
      out.push(`${ind}  <sh:hasValue>${escapeXml(ps.hasValueLiteral)}</sh:hasValue>`);
    if ((ps.in || []).length) {
      // rdf:List serialization
      out.push(`${ind}  <sh:in rdf:parseType="Collection">`);
      for (const v of ps.in) {
        if (v && v.iri)
          out.push(`${ind}    <rdf:Description rdf:about="${escapeXml(expand(prefixes, v.iri))}"/>`);
        else if (v && v.literal != null) {
          const dt = v.datatype
            ? ` rdf:datatype="${escapeXml(expand(prefixes, v.datatype))}"`
            : "";
          out.push(`${ind}    <rdf:Description><rdf:value${dt}>${escapeXml(v.literal)}</rdf:value></rdf:Description>`);
        }
      }
      out.push(`${ind}  </sh:in>`);
    }
    if (ps.message)
      out.push(`${ind}  <sh:message xml:lang="en">${escapeXml(ps.message)}</sh:message>`);
    if (ps.severity) {
      const sev = ps.severity.replace(/^sh:/, "");
      out.push(`${ind}  <sh:severity rdf:resource="${escapeXml(NS.sh + sev)}"/>`);
    }
    out.push(`${ind}</sh:PropertyShape>`);
    return out;
  }

  /* ================================================================
   * Parsing
   * ================================================================ */

  function parse(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parseError = doc.getElementsByTagName("parsererror")[0];
    if (parseError) {
      throw new Error("Invalid XML: " + parseError.textContent.slice(0, 200));
    }
    const root = doc.documentElement;
    if (!root) throw new Error("Empty document");

    const prefixes = {};
    for (const attr of Array.from(root.attributes)) {
      if (attr.name === "xmlns") prefixes[""] = attr.value;
      else if (attr.name.startsWith("xmlns:")) prefixes[attr.name.slice(6)] = attr.value;
    }
    for (const p of ["owl", "rdf", "rdfs", "xsd", "sh", "skos", "dcterms", "ontomobile"]) {
      if (!prefixes[p]) prefixes[p] = NS[p];
    }

    const xmlBase =
      root.getAttributeNS(NS.xml, "base") || root.getAttribute("xml:base");

    const model = {
      iri: "",
      label: "",
      comment: "",
      prefixes,
      categories: [],
      classes: [],
      objectProperties: [],
      dataProperties: [],
      individuals: [],
      shapes: [],
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
      if (!el || typeof el.getAttributeNS !== "function") return "";
      const res =
        el.getAttributeNS(NS.rdf, "resource") || el.getAttribute("rdf:resource");
      if (!res) return "";
      if (res.startsWith("#") && xmlBase) return xmlBase + res;
      return res;
    }
    const rootChildren = (parent) => Array.from(parent.children);
    function childrenByNs(parent, ns, localName) {
      return rootChildren(parent).filter(
        (c) =>
          (c.namespaceURI === ns && c.localName === localName) ||
          c.nodeName === `${Object.keys(prefixes).find((p) => prefixes[p] === ns) || ""}:${localName}`
      );
    }
    function getLabel(el) {
      const n = childrenByNs(el, NS.rdfs, "label")[0];
      return n ? n.textContent.trim() : "";
    }
    function getComment(el) {
      const n = childrenByNs(el, NS.rdfs, "comment")[0];
      return n ? n.textContent.trim() : "";
    }
    function collectResources(el, ns, localName) {
      return childrenByNs(el, ns, localName)
        .map(resolveResource)
        .filter(Boolean);
    }

    // Ontology declaration
    const ontNodes = Array.from(root.getElementsByTagNameNS(NS.owl, "Ontology"));
    if (ontNodes.length) {
      const ont = ontNodes[0];
      model.iri = resolveAbout(ont) || xmlBase || "";
      model.label = getLabel(ont);
      model.comment = getComment(ont);
    } else if (xmlBase) {
      model.iri = xmlBase;
    }

    // Categories (skos:Concept)
    const catByIri = new Map();
    for (const el of Array.from(root.getElementsByTagNameNS(NS.skos, "Concept"))) {
      if (el.parentNode !== root) continue;
      const iri = resolveAbout(el);
      if (!iri) continue;
      const prefLabel = childrenByNs(el, NS.skos, "prefLabel")[0];
      const def = childrenByNs(el, NS.skos, "definition")[0];
      const color = childrenByNs(el, NS.ontomobile, "color")[0];
      const cat = {
        id: "cat_" + makeId(),
        iri,
        name: prefLabel ? prefLabel.textContent.trim() : iri,
        description: def ? def.textContent.trim() : "",
        color: color ? color.textContent.trim() : "",
      };
      model.categories.push(cat);
      catByIri.set(iri, cat);
    }

    // Classes
    for (const el of Array.from(root.getElementsByTagNameNS(NS.owl, "Class"))) {
      if (el.parentNode !== root) continue;
      const iri = resolveAbout(el);
      if (!iri) continue;
      const subClassOf = [];
      const restrictions = [];
      for (const sc of childrenByNs(el, NS.rdfs, "subClassOf")) {
        const res = resolveResource(sc);
        if (res) {
          subClassOf.push(res);
          continue;
        }
        const inner = Array.from(sc.children).find(
          (c) => c.namespaceURI === NS.owl && c.localName === "Restriction"
        );
        if (inner) {
          const r = parseRestriction(inner);
          if (r) restrictions.push(r);
        }
      }
      const categories = [];
      for (const dc of childrenByNs(el, NS.dcterms, "subject")) {
        const res = resolveResource(dc);
        const c = catByIri.get(res);
        if (c) categories.push(c.id);
      }
      model.classes.push({
        iri,
        label: getLabel(el),
        comment: getComment(el),
        categories,
        subClassOf,
        equivalent: collectResources(el, NS.owl, "equivalentClass"),
        disjointWith: collectResources(el, NS.owl, "disjointWith"),
        restrictions,
      });
    }

    function parseRestriction(el) {
      const onProp = childrenByNs(el, NS.owl, "onProperty")[0];
      if (!onProp) return null;
      const property = resolveResource(onProp);
      const out = { property };
      const kinds = [
        "someValuesFrom",
        "allValuesFrom",
        "hasValue",
        "minCardinality",
        "maxCardinality",
        "cardinality",
        "minQualifiedCardinality",
        "maxQualifiedCardinality",
        "qualifiedCardinality",
      ];
      for (const k of kinds) {
        const n = childrenByNs(el, NS.owl, k)[0];
        if (!n) continue;
        out.kind = k;
        if (k === "someValuesFrom" || k === "allValuesFrom") {
          const r = resolveResource(n);
          if (r) out.classIri = r;
        } else if (k === "hasValue") {
          const r = resolveResource(n);
          if (r) out.valueIri = r;
          else out.valueLiteral = n.textContent;
        } else {
          out.count = Number(n.textContent || "0");
          if (k.includes("Qualified")) {
            const oc = childrenByNs(el, NS.owl, "onClass")[0];
            if (oc) out.qualifiedClassIri = resolveResource(oc);
          }
        }
        break;
      }
      return out.kind ? out : null;
    }

    function readProperty(el, kind) {
      const iri = resolveAbout(el);
      if (!iri) return null;
      const characteristics = [];
      for (const t of childrenByNs(el, NS.rdf, "type")) {
        const r = resolveResource(t);
        if (!r || !r.startsWith(NS.owl)) continue;
        const local = r.slice(NS.owl.length);
        const m = local.match(/^(\w+)Property$/);
        if (!m) continue;
        const c = m[1];
        if (kind === "object" && OBJECT_PROPERTY_CHARACTERISTICS.includes(c))
          characteristics.push(c);
        else if (kind === "data" && DATA_PROPERTY_CHARACTERISTICS.includes(c))
          characteristics.push(c);
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
        const inv = childrenByNs(el, NS.owl, "inverseOf")[0];
        if (inv) prop.inverseOf = resolveResource(inv);
        else prop.inverseOf = "";
      }
      return prop;
    }

    for (const el of Array.from(root.getElementsByTagNameNS(NS.owl, "ObjectProperty"))) {
      if (el.parentNode !== root) continue;
      const p = readProperty(el, "object");
      if (p) model.objectProperties.push(p);
    }
    for (const el of Array.from(root.getElementsByTagNameNS(NS.owl, "DatatypeProperty"))) {
      if (el.parentNode !== root) continue;
      const p = readProperty(el, "data");
      if (p) model.dataProperties.push(p);
    }

    // Individuals (owl:NamedIndividual + typed descriptions)
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
      for (const t of childrenByNs(el, NS.rdf, "type")) {
        const r = resolveResource(t);
        if (r && r !== NS.owl + "NamedIndividual" && !existing.types.includes(r))
          existing.types.push(r);
      }
      for (const child of Array.from(el.children)) {
        const ns = child.namespaceURI;
        const ln = child.localName;
        if (ns === NS.rdf && ln === "type") continue;
        if (ns === NS.rdfs && (ln === "label" || ln === "comment")) continue;
        if (ns === NS.dcterms && ln === "subject") continue;
        const pIri = ns ? ns + ln : ln;
        const res = resolveResource(child);
        if (res) {
          existing.objectAssertions.push({ property: pIri, target: res });
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
        }
      }
    }
    for (const el of Array.from(root.getElementsByTagNameNS(NS.owl, "NamedIndividual"))) {
      if (el.parentNode !== root) continue;
      ingestIndividual(el, null);
    }
    for (const el of rootChildren(root)) {
      if (el.namespaceURI === NS.owl) continue;
      if (el.namespaceURI === NS.skos && el.localName === "Concept") continue;
      if (el.namespaceURI === NS.sh) continue;
      const iri = resolveAbout(el);
      if (!iri) continue;
      const typeIri =
        el.namespaceURI === NS.rdf && el.localName === "Description"
          ? null
          : (el.namespaceURI || "") + el.localName;
      ingestIndividual(el, typeIri);
    }

    // SHACL NodeShapes
    for (const el of Array.from(root.getElementsByTagNameNS(NS.sh, "NodeShape"))) {
      if (el.parentNode !== root) continue;
      const iri = resolveAbout(el);
      if (!iri) continue;
      const shape = {
        iri,
        label: getLabel(el),
        comment: getComment(el),
        targetClass: resolveResource(childrenByNs(el, NS.sh, "targetClass")[0] || {}) || "",
        targetNode: resolveResource(childrenByNs(el, NS.sh, "targetNode")[0] || {}) || "",
        targetSubjectsOf: resolveResource(childrenByNs(el, NS.sh, "targetSubjectsOf")[0] || {}) || "",
        targetObjectsOf: resolveResource(childrenByNs(el, NS.sh, "targetObjectsOf")[0] || {}) || "",
        closed: false,
        severity: "",
        message: "",
        properties: [],
      };
      const closedEl = childrenByNs(el, NS.sh, "closed")[0];
      if (closedEl && /^true$/i.test((closedEl.textContent || "").trim()))
        shape.closed = true;
      const sevEl = childrenByNs(el, NS.sh, "severity")[0];
      if (sevEl) {
        const r = resolveResource(sevEl);
        if (r && r.startsWith(NS.sh)) shape.severity = "sh:" + r.slice(NS.sh.length);
      }
      const msgEl = childrenByNs(el, NS.sh, "message")[0];
      if (msgEl) shape.message = msgEl.textContent.trim();
      for (const pr of childrenByNs(el, NS.sh, "property")) {
        const psEl = Array.from(pr.children).find(
          (c) => c.namespaceURI === NS.sh && c.localName === "PropertyShape"
        );
        const ps = parsePropertyShape(psEl || pr);
        if (ps) shape.properties.push(ps);
      }
      model.shapes.push(shape);
    }

    function parsePropertyShape(el) {
      if (!el) return null;
      const ps = { path: "" };
      const get = (ns, ln) => childrenByNs(el, ns, ln)[0];
      const pathEl = get(NS.sh, "path");
      if (pathEl) ps.path = resolveResource(pathEl) || pathEl.textContent.trim();
      const name = get(NS.sh, "name");
      if (name) ps.name = name.textContent.trim();
      const desc = get(NS.sh, "description");
      if (desc) ps.description = desc.textContent.trim();
      const msg = get(NS.sh, "message");
      if (msg) ps.message = msg.textContent.trim();
      const sev = get(NS.sh, "severity");
      if (sev) {
        const r = resolveResource(sev);
        if (r && r.startsWith(NS.sh)) ps.severity = "sh:" + r.slice(NS.sh.length);
      }
      const num = (ln) => {
        const n = get(NS.sh, ln);
        if (!n) return undefined;
        const v = Number(n.textContent);
        return isNaN(v) ? undefined : v;
      };
      ps.minCount = num("minCount");
      ps.maxCount = num("maxCount");
      ps.minLength = num("minLength");
      ps.maxLength = num("maxLength");
      const mini = get(NS.sh, "minInclusive");
      if (mini) ps.minInclusive = mini.textContent.trim();
      const maxi = get(NS.sh, "maxInclusive");
      if (maxi) ps.maxInclusive = maxi.textContent.trim();
      const dt = get(NS.sh, "datatype");
      if (dt) ps.datatype = resolveResource(dt);
      const cls = get(NS.sh, "class");
      if (cls) ps.class = resolveResource(cls);
      const nk = get(NS.sh, "nodeKind");
      if (nk) {
        const r = resolveResource(nk);
        if (r && r.startsWith(NS.sh)) ps.nodeKind = "sh:" + r.slice(NS.sh.length);
      }
      const pat = get(NS.sh, "pattern");
      if (pat) ps.pattern = pat.textContent;
      const fl = get(NS.sh, "flags");
      if (fl) ps.flags = fl.textContent.trim();
      const hv = get(NS.sh, "hasValue");
      if (hv) {
        const r = resolveResource(hv);
        if (r) ps.hasValueIri = r;
        else ps.hasValueLiteral = hv.textContent;
      }
      const inEl = get(NS.sh, "in");
      if (inEl) {
        ps.in = [];
        for (const item of Array.from(inEl.children)) {
          const r = resolveResource(item);
          if (r) ps.in.push({ iri: r });
          else {
            const v = Array.from(item.children).find(
              (c) => c.namespaceURI === NS.rdf && c.localName === "value"
            );
            const dt2 =
              (v && (v.getAttributeNS(NS.rdf, "datatype") || v.getAttribute("rdf:datatype"))) ||
              (item.getAttributeNS(NS.rdf, "datatype") || item.getAttribute("rdf:datatype")) ||
              "";
            ps.in.push({
              literal: (v ? v.textContent : item.textContent) || "",
              datatype: dt2 || undefined,
            });
          }
        }
      }
      return ps;
    }

    return model;
  }

  function makeId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function emptyOntology(iri) {
    iri = iri || "http://example.org/ontology";
    return {
      iri,
      label: "Untitled ontology",
      comment: "",
      prefixes: defaultPrefixes(iri),
      categories: [],
      classes: [],
      objectProperties: [],
      dataProperties: [],
      individuals: [],
      shapes: [],
    };
  }

  global.OWL = {
    NS,
    OBJECT_PROPERTY_CHARACTERISTICS,
    DATA_PROPERTY_CHARACTERISTICS,
    XSD_DATATYPES,
    RESTRICTION_KINDS,
    SH_NODE_KINDS,
    defaultPrefixes,
    expand,
    shorten,
    serialize,
    parse,
    emptyOntology,
    isAbsoluteIri,
    makeId,
  };
})(typeof window !== "undefined" ? window : globalThis);
