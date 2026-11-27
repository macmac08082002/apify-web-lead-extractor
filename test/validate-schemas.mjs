import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function readJson(relPath) {
  const full = path.join(root, relPath);
  const raw = await fs.readFile(full, "utf8");
  return JSON.parse(raw);
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Schema validation failed: ${msg}`);
  }
}

async function main() {
  const actorJson = await readJson(".actor/actor.json");
  const inputSchema = await readJson(".actor/input_schema.json");
  const outputSchema = await readJson(".actor/output_schema.json");
  const datasetSchema = await readJson(".actor/dataset_schema.json");
  const pkg = await readJson("package.json");

  assert(actorJson.actorSpecification === 1, "actor.json actorSpecification must be 1");
  assert(actorJson.name === "vektor-web-lead-seo-extractor", "actor.json name mismatch");
  assert(actorJson.input === "./input_schema.json", "actor.json input path mismatch");
  assert(actorJson.output === "./output_schema.json", "actor.json output path mismatch");
  assert(actorJson.storages?.dataset === "./dataset_schema.json", "actor.json dataset path mismatch");

  assert(outputSchema.actorOutputSchemaVersion === 1, "output_schema.json actorOutputSchemaVersion must be 1");
  assert(typeof outputSchema.title === "string" && outputSchema.title.length > 0, "output_schema.json title required");
  assert(outputSchema.type === undefined, "output_schema.json root must not set disallowed 'type'");
  assert(outputSchema.properties?.results?.type === "string", "output_schema.json results.type must be 'string'");
  assert(outputSchema.properties?.results?.template === "{{links.apiDefaultDatasetUrl}}/items", "output_schema.json results.template mismatch");
  assert(outputSchema.properties?.summary?.type === "string", "output_schema.json summary.type must be 'string'");
  assert(outputSchema.properties?.summary?.template === "{{links.apiDefaultKeyValueStoreUrl}}/records/OUTPUT", "output_schema.json summary.template mismatch");

  assert(inputSchema.schemaVersion === 1, "input_schema.json schemaVersion must be 1");
  assert(inputSchema.type === "object", "input_schema.json type must be object");
  assert(inputSchema.properties?.urls?.maxItems === 100, "input_schema.json urls.maxItems must be 100");
  assert(inputSchema.properties?.checkContactPage?.default === true, "checkContactPage default must be true");
  assert(typeof inputSchema.properties?.timeoutMs?.default === "number", "timeoutMs must have numeric default");

  assert(datasetSchema.actorSpecification === 1, "dataset_schema.json actorSpecification must be 1");
  const requiredFields = [
    "url",
    "httpStatus",
    "responseTimeMs",
    "title",
    "metaDescription",
    "h1",
    "emails",
    "phones",
    "socialLinks",
    "hasRobotsTxt",
    "hasSitemap",
    "techHints",
  ];
  for (const field of requiredFields) {
    assert(
      datasetSchema.fields?.properties?.[field],
      `dataset_schema.json missing property "${field}"`,
    );
  }

  for (const socialKey of ["twitter", "linkedin", "github", "facebook", "telegram", "youtube"]) {
    assert(
      datasetSchema.fields?.properties?.socialLinks?.properties?.[socialKey],
      `dataset_schema.json missing socialLinks.${socialKey}`,
    );
  }

  assert(pkg.name === "vektor-web-lead-seo-extractor", "package.json name mismatch");
  assert(pkg.dependencies?.apify, "package.json must depend on apify");
  assert(pkg.dependencies?.cheerio, "package.json must depend on cheerio");

  console.log("PASS: .actor/actor.json, input_schema.json, dataset_schema.json, and package.json validated.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
