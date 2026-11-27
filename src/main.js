import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWebsiteIntel, normalizeTargetUrl } from "./extractor.js";

export const MAX_URLS_PER_RUN = 100;

const DEFAULT_PREFILL_URLS = [
  "https://vektorzero-labs.vektorscan-x402.workers.dev/",
  "https://vektorbiz-vn.vektorscan-x402.workers.dev/",
];

/**
 * Bounded concurrency async mapper.
 */
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Core actor pipeline. Runs identically on Apify Cloud or standalone Node.js.
 */
export async function runLeadSeoExtractor(rawInput = {}, hooks = {}) {
  const log = hooks.log ?? console;
  const onRecord = hooks.onRecord ?? (async () => {});

  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const checkContactPage = input.checkContactPage !== false;
  const timeoutMs = Math.max(
    1000,
    Math.min(60000, Number.parseInt(String(input.timeoutMs ?? 10000), 10) || 10000),
  );
  const concurrency = Math.max(
    1,
    Math.min(20, Number.parseInt(String(input.concurrency ?? 5), 10) || 5),
  );

  const rawUrls = Array.isArray(input.urls) ? input.urls : [];
  const queue = [];
  const seenNormalized = new Set();

  const enqueue = (item) => {
    if (queue.length >= MAX_URLS_PER_RUN) return;
    const normalized = normalizeTargetUrl(item);
    if (normalized) {
      const dedupeKey = normalized.toLowerCase();
      if (seenNormalized.has(dedupeKey)) return;
      seenNormalized.add(dedupeKey);
      queue.push(normalized);
    } else if (typeof item === "string" && item.trim()) {
      queue.push(item.trim());
    }
  };

  for (const item of rawUrls) {
    enqueue(item);
  }

  if (queue.length === 0) {
    log.info(
      "[WebLeadSEO] No URLs provided in input; falling back to default live verification URLs.",
    );
    for (const defUrl of DEFAULT_PREFILL_URLS) {
      enqueue(defUrl);
    }
  }

  log.info(
    `[WebLeadSEO] Extracting ${queue.length} website(s) (checkContactPage=${checkContactPage}, timeoutMs=${timeoutMs}, concurrency=${concurrency})...`,
  );

  const startedAt = new Date().toISOString();
  const records = await mapWithConcurrency(queue, concurrency, async (targetUrl) => {
    const record = await extractWebsiteIntel(targetUrl, {
      checkContactPage,
      timeoutMs,
    });
    await onRecord(record);
    return record;
  });

  const finishedAt = new Date().toISOString();
  const succeeded = records.filter((r) => r.httpStatus && r.httpStatus < 400).length;
  const emailsFound = records.reduce((acc, r) => acc + (r.emails?.length || 0), 0);
  const phonesFound = records.reduce((acc, r) => acc + (r.phones?.length || 0), 0);

  const summary = {
    actor: "vektor-web-lead-seo-extractor",
    startedAt,
    finishedAt,
    totalUrls: records.length,
    succeeded,
    failed: records.length - succeeded,
    totalEmailsFound: emailsFound,
    totalPhonesFound: phonesFound,
    checkContactPage,
    timeoutMs,
  };

  return { summary, records };
}

function parseCliArgs(argv) {
  const args = { inputPath: null, outputPath: null, standalone: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--input" && argv[i + 1]) {
      args.inputPath = argv[++i];
    } else if (token === "--output" && argv[i + 1]) {
      args.outputPath = argv[++i];
    } else if (token === "--standalone") {
      args.standalone = true;
    }
  }
  return args;
}

async function tryLoadApifySdk() {
  try {
    const mod = await import("apify");
    if (!mod.Actor) return null;
    return {
      Actor: mod.Actor,
      log: mod.log ?? console,
    };
  } catch {
    return null;
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const sdk = cli.standalone ? null : await tryLoadApifySdk();

  if (sdk) {
    const { Actor, log } = sdk;
    await Actor.init();
    try {
      let input = await Actor.getInput();
      if (!input && cli.inputPath) {
        const raw = await fs.readFile(path.resolve(cli.inputPath), "utf8");
        input = JSON.parse(raw);
      } else if (!input && process.env.LOCAL_INPUT_JSON) {
        input = JSON.parse(process.env.LOCAL_INPUT_JSON);
      }

      const { summary, records } = await runLeadSeoExtractor(input ?? {}, {
        log,
        onRecord: async (record) => {
          await Actor.pushData(record);
          // Apify Store Pay-Per-Event (PPE) hook
          if (typeof Actor.charge === "function" && Actor.isAtHome()) {
            try {
              await Actor.charge({ eventName: "website-extracted", count: 1 });
            } catch (chargeErr) {
              log.debug(
                `PPE charge skipped: ${chargeErr instanceof Error ? chargeErr.message : String(chargeErr)}`,
              );
            }
          }
        },
      });

      await Actor.setValue("OUTPUT", summary);

      const outputPath = cli.outputPath ?? process.env.LOCAL_OUTPUT_PATH;
      if (outputPath) {
        await fs.writeFile(
          path.resolve(outputPath),
          JSON.stringify({ summary, items: records }, null, 2),
          "utf8",
        );
      }

      log.info(
        `[WebLeadSEO] Finished ${summary.totalUrls} website(s): ok=${summary.succeeded}, failed=${summary.failed}, emails=${summary.totalEmailsFound}, phones=${summary.totalPhonesFound}.`,
      );
      await Actor.exit();
    } catch (err) {
      log.error(
        `[WebLeadSEO] Fatal error: ${err instanceof Error ? err.message : String(err)}`,
      );
      await Actor.fail(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  // Standalone local fallback when --standalone is passed or SDK is absent
  let input = {};
  if (cli.inputPath) {
    const raw = await fs.readFile(path.resolve(cli.inputPath), "utf8");
    input = JSON.parse(raw);
  } else if (process.env.LOCAL_INPUT_JSON) {
    input = JSON.parse(process.env.LOCAL_INPUT_JSON);
  }

  const { summary, records } = await runLeadSeoExtractor(input, { log: console });
  const payload = { summary, items: records };

  const outputPath = cli.outputPath ?? process.env.LOCAL_OUTPUT_PATH;
  if (outputPath) {
    await fs.writeFile(
      path.resolve(outputPath),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    console.log(`[WebLeadSEO] Wrote ${records.length} record(s) to ${outputPath}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch((err) => {
    console.error("[WebLeadSEO] Unhandled error:", err);
    process.exit(1);
  });
}
