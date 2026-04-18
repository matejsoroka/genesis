# OntoMobile – Mobile-first Ontology + Knowledge Graph + SHACL editor

A self-contained, mobile-first PWA for building ontologies, knowledge graphs
and SHACL validation rules, all in a single file format (**RDF/XML**). No
build step, no backend — open `index.html` in any browser.

## What you can do

### Classes (the "ontology")

- Organize classes with **colored categories** (stored as `skos:Concept`
  taxonomies + `dcterms:subject` memberships so they round-trip to other
  tools).
- Declare `rdfs:subClassOf`, `owl:equivalentClass`, `owl:disjointWith`.
- Define **OWL class restrictions** — the primary way to describe what a
  class _must_ or _may_ relate to:
  - `someValuesFrom` (existential: at least one)
  - `allValuesFrom` (universal: only values of a class)
  - `hasValue` (must have a particular individual or literal)
  - `minCardinality` / `maxCardinality` / `cardinality` (exact count)
  - Qualified variants (`min/max/qualifiedCardinality` + `onClass`)

### Relations (properties)

- **Object properties** with domain/range/inverse/sub-properties and all
  characteristics: *Functional, InverseFunctional, Transitive, Symmetric,
  Asymmetric, Reflexive, Irreflexive*.
- **Data properties** over XSD datatypes (`string`, `integer`, `decimal`,
  `boolean`, `date`, `dateTime`, `anyURI`, …) with functional support.

### Data (instances / knowledge graph nodes)

- Declare **named individuals** typed by one or more classes.
- Assert facts: object-property edges and data-property literals with
  XSD datatypes.
- Everything you enter is part of a single RDF knowledge graph.

### Graph tab

- Interactive **force-directed graph** with pan, pinch-zoom, and drag.
  Tap a node to edit it.
- Two modes:
  - **Schema** — classes as nodes; subclass, restriction and
    domain→range edges.
  - **Instances** — individuals as nodes; object-assertion edges.
- Category colors bleed into the schema visualization so you can see
  communities at a glance.

### Shapes (SHACL)

- Create `sh:NodeShape` objects targeting classes, specific nodes, or
  property-subject/object sets.
- Attach `sh:PropertyShape` constraints with a full constraint palette:
  `minCount`, `maxCount`, `datatype`, `class`, `nodeKind`, `pattern` +
  `flags`, `minLength`, `maxLength`, `minInclusive`, `maxInclusive`,
  `hasValue`, `in`, plus `closed` at the node level.
- Choose severity per shape/constraint: `Violation`, `Warning`, `Info`.
- **Run validation in-browser**; a structured report lists every failure
  with its focus node, path and suggested message. The header gets a red
  badge whenever your data doesn't conform.

### Import / export

- **Single-file RDF/XML output** containing the ontology, SHACL shapes
  and category taxonomy — importable into Protégé, RDF4J, etc.
- Importing any RDF/XML file (OWL or SHACL or both) rebuilds the editor
  state. The Import sheet supports four paths so iOS never gets stuck:
  1. **Pick file** (the iOS Files picker sometimes greys out `.owl`,
     so there's a `.xml` copy of the bundled example next to it),
  2. **Paste RDF/XML** straight from the clipboard,
  3. **From URL** — fetch any CORS-friendly HTTPS URL,
  4. **Load bundled example** — one tap to pull `examples/*.owl` from
     the hosted site itself.
- A **raw view** lets you copy, download or hand-edit the XML and
  re-parse it back into the model.

## Getting started

No dependencies, no build. Just serve the folder:

```bash
python3 -m http.server 8080
# open http://localhost:8080/ on your phone or a mobile emulator
```

An **example ontology** (Agent/Person/City + one SHACL shape) is seeded on
first launch so you immediately have something to play with.

## Hosting on GitHub Pages

A workflow at `.github/workflows/pages.yml` publishes the site to GitHub
Pages on every push to `main` (and via manual dispatch). One-time repo
setup: **Settings → Pages → Source → GitHub Actions**. Then the app is
live at `https://<user>.github.io/<repo>/` — for this repo,
<https://matejsoroka.github.io/genesis/>.

## File layout

```
index.html              Mobile-first UI shell (5 tabs + sheet editors)
css/style.css           Styling (dark/light, safe-area aware)
js/owl.js               RDF/XML + OWL + SHACL serializer & parser
js/shacl.js             In-browser SHACL validator
js/graph.js             SVG force-directed graph (pan/pinch/drag)
js/app.js               App state, editors, validation UI
manifest.webmanifest    PWA manifest
sw.js                   Service worker (offline caching)
icons/                  SVG + PNG app icons
.github/workflows/      GitHub Pages deploy workflow
```

## Model reference (for `js/owl.js` imports/exports)

Each entity you create is mapped to standards-compliant RDF/XML:

| UI concept          | RDF/XML serialization                                            |
| ------------------- | ---------------------------------------------------------------- |
| Ontology header     | `owl:Ontology` with `rdfs:label`, `rdfs:comment`                 |
| Category            | `skos:Concept` with `skos:prefLabel`, `ontomobile:color`         |
| Class → category    | `<dcterms:subject rdf:resource="…concept…"/>` on the class       |
| Class               | `owl:Class`                                                      |
| Class restriction   | `rdfs:subClassOf → owl:Restriction / owl:onProperty / owl:…`     |
| Object property     | `owl:ObjectProperty` (+ `rdf:type owl:SymmetricProperty` etc.)   |
| Data property       | `owl:DatatypeProperty`                                           |
| Individual          | `owl:NamedIndividual` + property-assertion children              |
| SHACL shape         | `sh:NodeShape` with `sh:property → sh:PropertyShape` children    |

## Notes / limitations

- Anonymous class expressions beyond restrictions (complex unions,
  intersections, property chains) aren't modeled visually. The raw-OWL
  editor lets you hand-edit any XML, but round-tripping through the
  visual editor drops unsupported constructs.
- The SHACL validator covers the commonly-used core constraint
  components listed above. Advanced features (SPARQL-based constraints,
  node-shape logical operators `and/or/xone/not`) are not yet
  implemented.
- Data is stored in the browser's `localStorage`; clearing site data
  erases the model. Use **Export** to persist ontologies externally.
