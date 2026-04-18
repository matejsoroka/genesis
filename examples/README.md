# Example ontologies

## Loading them in the app

The easiest way (on any device, including iPhone): open OntoMobile → ☰ menu
→ **Load example ontology** → tap the bundled card. The app fetches the
file from this same site — no Files app, no download needed.

If you *do* want to load from your own file, the app's **Import OWL / SHACL…**
sheet gives four options:

1. **Pick file from device** — the regular file picker. On iPhone iOS
   may grey out `.owl`; pick the `.xml` copy below (same content) or
   one of the following options.
2. **Paste RDF/XML** — copy the XML from any preview and paste.
3. **From URL** — fetch any CORS-friendly HTTPS URL, e.g.:
   ```
   https://matejsoroka.github.io/genesis/examples/strategy-ontology.owl
   ```
4. **Bundled examples** — the shortcut mentioned above.

## Files

### `strategy-ontology.owl` / `strategy-ontology.xml`

Same content, two extensions. Use `.xml` if iOS grays out `.owl` in the
Files picker.

Models how an **Organization** carries a **Vision** and **Mission**, pursues
**Goals**, which are executed through **Initiatives**, made concrete by
**Bets**, and delivered via **Projects**.

Includes:

- 4 categories (Organization, Purpose, Strategy, Delivery)
- 9 classes with an abstract `StrategicElement` root and an abstract
  `Purpose` super-class for Vision/Mission
- 13 inverse-paired object properties (`hasVision`/`visionOf`,
  `hasGoal`/`pursuedBy`, `hasInitiative`/`supportsGoal`,
  `hasBet`/`partOfInitiative`, `hasProject`/`realizesBet`, plus `ownedBy`)
- 8 data properties (`orgName`, `title`, `statement`, `description`,
  `targetDate`, `confidence`, `status`, `priority`)
- 6 OWL class restrictions enforcing the core invariants
  ("Organization must have a Vision and a Mission", "every Goal is pursued
  by an Organization", "every Bet belongs to an Initiative", etc.)
- 14 pre-seeded instances (Acme Inc., its vision and mission, two goals,
  two initiatives, three bets, four projects) so the graph view has
  something to show immediately
- 6 SHACL node shapes with 22 property constraints enforcing cardinality,
  datatype, value range, status enumeration
  (`proposed/active/paused/done/cancelled`) and confidence in `[0,1]`

Validation: the seeded model **conforms** to all shapes. Edit any instance
to break a constraint and the header badge will light up red.
