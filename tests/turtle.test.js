const test = require("node:test");
const assert = require("node:assert/strict");

global.N3 = require("../js/n3.min.js");
require("../js/owl.js");

const DATASOURCE_NS =
  "https://knowledge.bloomreach.com/ontology/semantic-layer/datasource/";

const turtle = `
@prefix ds: <${DATASOURCE_NS}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ds:banner a ds:DataSource ;
  rdfs:label "Banner" ;
  ds:hasSourceProperty ds:banner_action_prop,
    ds:banner_timestamp_prop ;
  ds:sourceName "warehouse.banner" .

ds:banner_action_prop a ds:SourceProperty ;
  ds:sourceDataType "STRING" ;
  ds:sourcePropertyName "action" .

ds:banner_timestamp_prop a ds:SourceProperty ;
  ds:sourceDataType "TIMESTAMP" ;
  ds:sourcePropertyName "timestamp" .
`;

test("imports a pure Turtle datasource graph", () => {
  const model = global.OWL.parseDocument(turtle);
  const dataSource = DATASOURCE_NS + "DataSource";
  const sourceProperty = DATASOURCE_NS + "SourceProperty";
  const hasSourceProperty = DATASOURCE_NS + "hasSourceProperty";

  assert.equal(model.label, "Imported Turtle graph");
  assert.deepEqual(
    new Set(model.classes.map((item) => item.iri)),
    new Set([dataSource, sourceProperty])
  );
  assert.equal(model.individuals.length, 3);

  const banner = model.individuals.find((item) => item.iri === DATASOURCE_NS + "banner");
  assert.equal(banner.label, "Banner");
  assert.equal(banner.objectAssertions.length, 2);

  const action = model.individuals.find(
    (item) => item.iri === DATASOURCE_NS + "banner_action_prop"
  );
  assert.deepEqual(
    action.dataAssertions.map(({ property, value }) => ({ property, value })),
    [
      { property: DATASOURCE_NS + "sourceDataType", value: "STRING" },
      { property: DATASOURCE_NS + "sourcePropertyName", value: "action" },
    ]
  );

  const relation = model.objectProperties.find((item) => item.iri === hasSourceProperty);
  assert.deepEqual(relation.domain, [dataSource]);
  assert.deepEqual(relation.range, [sourceProperty]);
});

test("retains blank nodes as connected resources", () => {
  const model = global.OWL.parseDocument(`
    @prefix ex: <https://example.com/> .
    ex:source a ex:DataSource ;
      ex:property [ a ex:SourceProperty ; ex:name "anonymous" ] .
  `);

  const source = model.individuals.find((item) => item.iri === "https://example.com/source");
  assert.match(source.objectAssertions[0].target, /^_:/);
  assert.ok(
    model.individuals.some(
      (item) => item.iri === source.objectAssertions[0].target && item.types[0].endsWith("SourceProperty")
    )
  );
});

test("reports Turtle syntax errors clearly", () => {
  assert.throws(
    () => global.OWL.parseDocument("@prefix ex: <https://example.com/> . ex:a ex:p"),
    /Invalid Turtle/
  );
});

test("recognizes Turtle that begins with a full IRI", () => {
  const model = global.OWL.parseDocument(
    "<https://example.com/a> <https://example.com/name> \"A\" ."
  );
  assert.equal(model.individuals[0].iri, "https://example.com/a");
});
