# Example ontologies

Drop these `.owl` files into OntoMobile via **menu → Import OWL / SHACL**.

## `strategy-ontology.owl`

Models how an **Organization** carries a **Vision** and **Mission**, pursues
**Goals**, which are executed through **Initiatives**, made concrete by
**Bets**, and delivered via **Projects**.

Includes:

- 4 categories (Organization, Purpose, Strategy, Delivery)
- 9 classes with an abstract `StrategicElement` root and an abstract `Purpose`
  super-class for Vision/Mission
- 13 inverse-paired object properties (`hasVision`/`visionOf`,
  `hasGoal`/`pursuedBy`, `hasInitiative`/`supportsGoal`, `hasBet`/
  `partOfInitiative`, `hasProject`/`realizesBet`, plus `ownedBy`)
- 8 data properties (`orgName`, `title`, `statement`, `description`,
  `targetDate`, `confidence`, `status`, `priority`)
- OWL class restrictions enforcing the core invariants
  ("Organization must have a Vision and a Mission", "every Goal is pursued
  by an Organization", "every Bet belongs to an Initiative", etc.)
- 14 pre-seeded instances (Acme Inc., its vision and mission, two goals,
  two initiatives, three bets, four projects) so the graph view has
  something to show immediately
- 6 SHACL node shapes enforcing cardinality, datatype, value range,
  status enumeration (`proposed/active/paused/done/cancelled`), and
  confidence between 0 and 1

Validation: the seeded model **conforms** to all shapes. Edit any instance
to break a constraint and the header badge will light up.

### Loading from the live site

```
https://matejsoroka.github.io/genesis/examples/strategy-ontology.owl
```

Download the file, then in the app: menu (☰) → **Import OWL / SHACL** →
pick the file. The app replaces whatever is in your local store, so
export first if you have unsaved work.
