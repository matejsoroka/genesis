# OntoMobile – Mobile-first OWL Ontology Creator & Editor

A lightweight, mobile-first web app for creating and editing OWL ontologies,
serialized as OWL / RDF‑XML. Works offline as an installable PWA — no server,
no build step.

> Everything is a single folder of static files. Open `index.html` in a browser
> (or serve the folder) and start modeling.

## Features

- **Mobile-first UI** with tabbed navigation, floating action button,
  bottom-sheet editors, swipe-free gestures and dark-mode support.
- **Editors for all core OWL entities**:
  - Classes (with `rdfs:subClassOf`, `owl:equivalentClass`,
    `owl:disjointWith`).
  - Object properties (domain, range, sub-property, inverse, characteristics
    `Functional/InverseFunctional/Transitive/Symmetric/Asymmetric/Reflexive/Irreflexive`).
  - Data properties (domain, range — XSD datatypes, sub-property, functional).
  - Named individuals (types, object-property assertions, data-property
    assertions with XSD datatypes).
- **Ontology metadata**: IRI, label, comment and custom prefix declarations.
- **Import/Export** OWL in RDF/XML form (`.owl` / `.rdf` / `.xml`).
- **Raw OWL view** – inspect, copy, download or edit the XML directly and
  re-parse it back into the model.
- **Autocomplete** for references (classes, properties, individuals, XSD
  datatypes) using the current ontology's vocabulary and prefixes.
- **Local persistence** via `localStorage` — your work survives page reloads.
- **Offline-ready PWA** with a manifest, service worker and installable icons.

## Getting started

No dependencies, no build. Just serve the folder:

```bash
# any static server works; for example
python3 -m http.server 8080
# then open http://localhost:8080/ on your phone or in a mobile emulator
```

To install as a PWA on a mobile device, visit the site over HTTPS (or
`localhost`) and use the browser's "Add to Home screen" option.

## Files

```
index.html              Mobile-first UI shell
css/style.css           Styling (dark / light auto, safe-area aware)
js/owl.js               OWL / RDF-XML serializer and parser
js/app.js               Application logic, state management, editors
manifest.webmanifest    PWA manifest
sw.js                   Service worker for offline caching
icons/                  App icons (SVG + PNG)
```

## OWL format

The app reads and writes the standard **OWL RDF/XML** syntax, e.g.:

```xml
<owl:Class rdf:about="http://example.org/ontology#Person">
  <rdfs:label xml:lang="en">Person</rdfs:label>
  <rdfs:subClassOf rdf:resource="http://example.org/ontology#Agent"/>
</owl:Class>
```

It understands:

- `owl:Ontology` (IRI, `rdfs:label`, `rdfs:comment`).
- `owl:Class` with `rdfs:subClassOf`, `owl:equivalentClass`, `owl:disjointWith`.
- `owl:ObjectProperty` and `owl:DatatypeProperty` with `rdfs:domain`,
  `rdfs:range`, `rdfs:subPropertyOf`, `owl:inverseOf` and characteristic types
  (`owl:FunctionalProperty` etc.).
- `owl:NamedIndividual` declarations and arbitrary property-assertion children,
  with `rdf:resource` for object properties and `rdf:datatype` for data
  properties.

Generated files can be opened directly by Protégé and other OWL tools.

## Notes / limitations

- Anonymous class expressions (restrictions, unions, intersections) are not
  modelled in the UI. The raw-OWL editor lets you hand-edit any XML, but
  round-tripping through the visual editor will drop unsupported constructs.
- Multiple ontologies cannot be held in memory simultaneously — use Export /
  Import to move between projects.
- The app stores data in your browser's `localStorage`; clearing site data
  erases the ontology.
