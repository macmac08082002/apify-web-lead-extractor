import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLeadSeoExtractor } from "../src/main.js";
import { isValidCleanEmail } from "../src/extractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function main() {
  // 1. Unit sanity checks on email asset filter
  assert(isValidCleanEmail("hello@vektorzero.io") === true, "valid email rejected");
  assert(isValidCleanEmail("logo@2x.png") === false, ".png image asset falsely accepted as email");
  assert(isValidCleanEmail("icon@3x.svg") === false, ".svg image asset falsely accepted as email");
  assert(isValidCleanEmail("hero@retina.webp") === false, ".webp asset falsely accepted as email");

  // 2. Live HTTP extraction test against 2 real production URLs
  const liveUrls = [
    "https://vektorzero-labs.vektorscan-x402.workers.dev/",
    "https://vektorbiz-vn.vektorscan-x402.workers.dev/",
  ];

  const { summary, records } = await runLeadSeoExtractor({
    urls: liveUrls,
    checkContactPage: true,
    timeoutMs: 15000,
    concurrency: 2,
  });

  assert(records.length === 2, `Expected 2 records, got ${records.length}`);

  for (const rec of records) {
    assert(typeof rec.url === "string" && rec.url.startsWith("https://"), "Invalid url field");
    assert(rec.httpStatus === 200, `Expected HTTP 200 for ${rec.url}, got ${rec.httpStatus} (error=${rec.error})`);
    assert(typeof rec.responseTimeMs === "number" && rec.responseTimeMs >= 0, "Invalid responseTimeMs");
    assert(typeof rec.title === "string" && rec.title.length > 0, `Missing <title> for ${rec.url}`);
    assert(Array.isArray(rec.emails), "emails must be an array");
    assert(Array.isArray(rec.phones), "phones must be an array");
    assert(rec.socialLinks && typeof rec.socialLinks === "object", "socialLinks must be an object");
    for (const key of ["twitter", "linkedin", "github", "facebook", "telegram", "youtube"]) {
      assert(key in rec.socialLinks, `socialLinks missing key ${key}`);
    }
    assert(typeof rec.hasRobotsTxt === "boolean", "hasRobotsTxt must be boolean");
    assert(typeof rec.hasSitemap === "boolean", "hasSitemap must be boolean");
    assert(Array.isArray(rec.techHints), "techHints must be an array");
  }

  const outPath = path.join(root, "test_output.json");
  await fs.writeFile(
    outPath,
    JSON.stringify({ summary, items: records }, null, 2),
    "utf8",
  );

  console.log(`PASS: Live extraction verified on ${records.length} URLs. Saved output to ${outPath}`);
  for (const rec of records) {
    console.log(
      ` - ${rec.url} | HTTP ${rec.httpStatus} | ${rec.responseTimeMs}ms | title="${rec.title}" | emails=${JSON.stringify(rec.emails)} | phones=${JSON.stringify(rec.phones)} | techHints=${JSON.stringify(rec.techHints)} | robots=${rec.hasRobotsTxt} | sitemap=${rec.hasSitemap}`,
    );
  }
}

main().catch((err) => {
  console.error("LIVE TEST FAILED:", err);
  process.exit(1);
});
