/* A small, self-contained SHACL validator that runs against the ontology
 * model used by OntoMobile (classes + individuals). It is not a complete
 * SHACL implementation but it covers the core constraint components that
 * the UI exposes and produces a standard-looking validation report.
 *
 * Supported targets:
 *   sh:targetClass, sh:targetNode, sh:targetSubjectsOf, sh:targetObjectsOf
 *
 * Supported property-shape constraints:
 *   sh:minCount, sh:maxCount
 *   sh:datatype, sh:class, sh:nodeKind
 *   sh:pattern (+ sh:flags), sh:minLength, sh:maxLength
 *   sh:minInclusive, sh:maxInclusive
 *   sh:hasValue, sh:in
 *
 * Supported node-shape constraints:
 *   sh:closed (checked against the configured object/data properties)
 */
(function (global) {
  "use strict";

  const { NS, expand, shorten } = global.OWL;

  function getSubclasses(model) {
    const children = new Map();
    for (const c of model.classes || []) {
      for (const p of c.subClassOf || []) {
        if (!children.has(p)) children.set(p, new Set());
        children.get(p).add(c.iri);
      }
    }
    return children;
  }

  function classClosure(model, iri) {
    const children = getSubclasses(model);
    const out = new Set([iri]);
    const stack = [iri];
    while (stack.length) {
      const cur = stack.pop();
      const kids = children.get(cur);
      if (!kids) continue;
      for (const k of kids) if (!out.has(k)) { out.add(k); stack.push(k); }
    }
    return out;
  }

  function individualOfClass(model, ind, classIri) {
    const closure = classClosure(model, classIri);
    return (ind.types || []).some((t) => closure.has(t));
  }

  function collectObjects(ind, propIri) {
    const out = [];
    for (const a of ind.objectAssertions || []) {
      if (a.property === propIri) out.push({ kind: "iri", value: a.target });
    }
    for (const a of ind.dataAssertions || []) {
      if (a.property === propIri)
        out.push({ kind: "literal", value: a.value, datatype: a.datatype || "" });
    }
    return out;
  }

  function xsdIsValid(dt, val) {
    const v = String(val);
    switch (dt) {
      case NS.xsd + "integer":
      case NS.xsd + "int":
      case NS.xsd + "long":
      case NS.xsd + "short":
        return /^-?\d+$/.test(v);
      case NS.xsd + "nonNegativeInteger":
        return /^\d+$/.test(v);
      case NS.xsd + "decimal":
      case NS.xsd + "float":
      case NS.xsd + "double":
        return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v);
      case NS.xsd + "boolean":
        return /^(true|false|0|1)$/.test(v);
      case NS.xsd + "date":
        return /^\d{4}-\d{2}-\d{2}$/.test(v);
      case NS.xsd + "dateTime":
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+\-]\d{2}:\d{2})?$/.test(v);
      case NS.xsd + "time":
        return /^\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+\-]\d{2}:\d{2})?$/.test(v);
      case NS.xsd + "anyURI":
        return /^[A-Za-z][A-Za-z0-9+.\-]*:/.test(v);
      case NS.xsd + "string":
      default:
        return true;
    }
  }

  function asNumber(v) {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function targetFocusNodes(model, shape) {
    const set = new Map();
    const add = (ind) => {
      if (!ind) return;
      if (!set.has(ind.iri)) set.set(ind.iri, ind);
    };
    if (shape.targetClass) {
      for (const ind of model.individuals || []) {
        if (individualOfClass(model, ind, shape.targetClass)) add(ind);
      }
    }
    if (shape.targetNode) {
      const ind = (model.individuals || []).find((x) => x.iri === shape.targetNode);
      add(ind || { iri: shape.targetNode, types: [], objectAssertions: [], dataAssertions: [] });
    }
    if (shape.targetSubjectsOf) {
      for (const ind of model.individuals || []) {
        const hasIt =
          (ind.objectAssertions || []).some((a) => a.property === shape.targetSubjectsOf) ||
          (ind.dataAssertions || []).some((a) => a.property === shape.targetSubjectsOf);
        if (hasIt) add(ind);
      }
    }
    if (shape.targetObjectsOf) {
      for (const ind of model.individuals || []) {
        for (const a of ind.objectAssertions || []) {
          if (a.property === shape.targetObjectsOf) {
            const target = (model.individuals || []).find((x) => x.iri === a.target);
            add(
              target || {
                iri: a.target,
                types: [],
                objectAssertions: [],
                dataAssertions: [],
              }
            );
          }
        }
      }
    }
    return Array.from(set.values());
  }

  function validate(model) {
    const report = {
      conforms: true,
      results: [],
    };
    for (const shape of model.shapes || []) {
      const focus = targetFocusNodes(model, shape);
      if (!focus.length) continue;
      for (const node of focus) {
        validateNode(model, shape, node, report);
      }
    }
    report.conforms = report.results.every((r) => r.severity === "sh:Info");
    // "conforms" more precisely: no Violation results.
    report.conforms = !report.results.some(
      (r) => r.severity === "sh:Violation" || !r.severity
    );
    return report;
  }

  function defaultSeverity(shape, ps) {
    return (ps && ps.severity) || shape.severity || "sh:Violation";
  }

  function validateNode(model, shape, node, report) {
    // sh:closed
    if (shape.closed) {
      const allowed = new Set(
        (shape.properties || [])
          .map((p) => p.path)
          .filter(Boolean)
      );
      const seen = new Set();
      for (const a of node.objectAssertions || []) seen.add(a.property);
      for (const a of node.dataAssertions || []) seen.add(a.property);
      for (const p of seen) {
        if (!allowed.has(p)) {
          report.results.push({
            focusNode: node.iri,
            resultPath: p,
            sourceShape: shape.iri,
            severity: defaultSeverity(shape, null),
            sourceConstraintComponent: "sh:ClosedConstraintComponent",
            message:
              shape.message || `Node has disallowed property (sh:closed): ${p}`,
          });
        }
      }
    }
    for (const ps of shape.properties || []) {
      if (!ps.path) continue;
      const values = collectObjects(node, ps.path);
      validateProperty(model, shape, ps, node, values, report);
    }
  }

  function validateProperty(model, shape, ps, node, values, report) {
    const push = (msg, comp, value) => {
      report.results.push({
        focusNode: node.iri,
        resultPath: ps.path,
        value,
        sourceShape: shape.iri,
        sourceConstraintComponent: comp,
        severity: defaultSeverity(shape, ps),
        message: ps.message || shape.message || msg,
      });
    };

    // Cardinality
    if (ps.minCount != null && values.length < ps.minCount)
      push(
        `Expected at least ${ps.minCount} value(s), got ${values.length}`,
        "sh:MinCountConstraintComponent"
      );
    if (ps.maxCount != null && values.length > ps.maxCount)
      push(
        `Expected at most ${ps.maxCount} value(s), got ${values.length}`,
        "sh:MaxCountConstraintComponent"
      );

    for (const v of values) {
      const val = v.value;

      if (ps.datatype) {
        if (v.kind !== "literal" || (v.datatype && v.datatype !== ps.datatype)) {
          push(
            `Value "${val}" is not of datatype ${shortenLocal(ps.datatype)}`,
            "sh:DatatypeConstraintComponent",
            val
          );
        } else if (!xsdIsValid(ps.datatype, val)) {
          push(
            `Value "${val}" is not a valid ${shortenLocal(ps.datatype)}`,
            "sh:DatatypeConstraintComponent",
            val
          );
        }
      }

      if (ps.class) {
        if (v.kind !== "iri") {
          push(
            `Value must be an IRI typed as ${shortenLocal(ps.class)}`,
            "sh:ClassConstraintComponent",
            val
          );
        } else {
          const ind = (model.individuals || []).find((x) => x.iri === val);
          if (!ind || !individualOfClass(model, ind, ps.class)) {
            push(
              `Value ${shortenLocal(val)} is not an instance of ${shortenLocal(ps.class)}`,
              "sh:ClassConstraintComponent",
              val
            );
          }
        }
      }

      if (ps.nodeKind) {
        const kind = ps.nodeKind;
        if (kind === "sh:IRI" && v.kind !== "iri")
          push(`Expected IRI`, "sh:NodeKindConstraintComponent", val);
        if (kind === "sh:Literal" && v.kind !== "literal")
          push(`Expected literal`, "sh:NodeKindConstraintComponent", val);
        if (kind === "sh:BlankNode")
          push(`Blank nodes are not used in this editor`, "sh:NodeKindConstraintComponent", val);
        if (kind === "sh:IRIOrLiteral" && v.kind !== "iri" && v.kind !== "literal")
          push(`Expected IRI or literal`, "sh:NodeKindConstraintComponent", val);
      }

      if (ps.pattern && v.kind === "literal") {
        let re;
        try { re = new RegExp(ps.pattern, ps.flags || ""); } catch (_) { re = null; }
        if (re && !re.test(String(val)))
          push(
            `Value "${val}" does not match pattern /${ps.pattern}/${ps.flags || ""}`,
            "sh:PatternConstraintComponent",
            val
          );
      }

      if (ps.minLength != null && v.kind === "literal" && String(val).length < ps.minLength)
        push(
          `Value "${val}" has length < ${ps.minLength}`,
          "sh:MinLengthConstraintComponent",
          val
        );
      if (ps.maxLength != null && v.kind === "literal" && String(val).length > ps.maxLength)
        push(
          `Value "${val}" has length > ${ps.maxLength}`,
          "sh:MaxLengthConstraintComponent",
          val
        );
      if (ps.minInclusive != null && v.kind === "literal") {
        const n = asNumber(val);
        const b = asNumber(ps.minInclusive);
        if (n != null && b != null && n < b)
          push(
            `Value ${val} is less than minInclusive ${ps.minInclusive}`,
            "sh:MinInclusiveConstraintComponent",
            val
          );
      }
      if (ps.maxInclusive != null && v.kind === "literal") {
        const n = asNumber(val);
        const b = asNumber(ps.maxInclusive);
        if (n != null && b != null && n > b)
          push(
            `Value ${val} is greater than maxInclusive ${ps.maxInclusive}`,
            "sh:MaxInclusiveConstraintComponent",
            val
          );
      }

      if (ps.in && ps.in.length) {
        const match = ps.in.some((entry) => {
          if (entry.iri) return v.kind === "iri" && v.value === entry.iri;
          return v.kind === "literal" && String(v.value) === String(entry.literal);
        });
        if (!match)
          push(
            `Value "${val}" is not in the allowed set`,
            "sh:InConstraintComponent",
            val
          );
      }
    }

    if (ps.hasValueIri || (ps.hasValueLiteral != null && ps.hasValueLiteral !== "")) {
      const ok = values.some((v) => {
        if (ps.hasValueIri) return v.kind === "iri" && v.value === ps.hasValueIri;
        return v.kind === "literal" && String(v.value) === String(ps.hasValueLiteral);
      });
      if (!ok)
        push(
          `Property must have value ${ps.hasValueIri || ps.hasValueLiteral}`,
          "sh:HasValueConstraintComponent"
        );
    }
  }

  function shortenLocal(iri) {
    if (!iri) return "";
    const idx = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
    return idx >= 0 ? iri.slice(idx + 1) : iri;
  }

  global.SHACL = { validate };
})(typeof window !== "undefined" ? window : globalThis);
