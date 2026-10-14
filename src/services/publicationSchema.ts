import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../data/suite.schema.json";

// Exact upstream schema pinned at SafeAI4Humanity/ai4h-test-suites
// e0fffafc96d42c0026a1fdfacb5f76868b2292d4, schema/suite.schema.json.
// Update the snapshot deliberately when the publication contract changes.
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
export const validatePublicationObject = ajv.compile(schema);

export function publicationSchemaErrors(value: unknown): string[] {
  if (validatePublicationObject(value)) return [];
  return (validatePublicationObject.errors ?? []).map((error) =>
    `${error.instancePath || "suite"}: ${error.message}`
  );
}
