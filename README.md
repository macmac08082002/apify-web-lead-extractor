# Website Contact, Social & SEO Intelligence Extractor (`vektor-web-lead-seo-extractor`)

Ultra-fast, browserless Apify Actor for **B2B Lead Generation, Contact Discovery & Technical SEO Auditing** powered by native Node.js `fetch` + `Cheerio` (zero headless Chromium overhead — saves Apify Compute Units and runs at high concurrency).

## Key Features

- **Browserless Speed & Low Compute Cost:** Pure HTTP `fetch` + Cheerio DOM parsing (runs smoothly in lightweight `apify/actor-node:20` containers without Chrome/Playwright RAM overhead).
- **Smart Contact & Email Recovery:** Extracts `mailto:` links, Cloudflare `data-cfemail` obfuscated addresses, and body-text emails while automatically filtering out false-positive asset filenames (`.png`, `.jpg`, `.svg`, `.webp`, `@2x`, Sentry hashes).
- **Automatic `/contact` & `/about` Fallback:** When `checkContactPage` is enabled (default `true`) and no email is found on the homepage, automatically discovers and inspects internal Contact/About pages (`/contact`, `/about`, or linked contact URLs).
- **Clean Phone & Social Extraction:** Captures `tel:` links and formatted international/local phone numbers alongside canonical social profiles (`twitter`, `linkedin`, `github`, `facebook`, `telegram`, `youtube`).
- **On-Page & Technical SEO Signals:** Returns `httpStatus`, `responseTimeMs`, `title`, `metaDescription`, primary `h1`, real `/robots.txt` check (`hasRobotsTxt`), and `/sitemap.xml` / robots Sitemap detection (`hasSitemap`).
- **Evidence-Based Tech Stack Hints:** Identifies hosting, CDN, CMS, frameworks, and analytics signatures (`Cloudflare`, `Cloudflare Workers`, `Next.js`, `WordPress`, `Shopify`, `React`, `Tailwind CSS`, `Google Analytics`, `Vercel`, etc.) from live HTTP headers and HTML.

## Input Schema

```json
{
  "urls": [
    "https://vektorzero-labs.vektorscan-x402.workers.dev/",
    "https://vektorbiz-vn.vektorscan-x402.workers.dev/"
  ],
  "checkContactPage": true,
  "timeoutMs": 10000,
  "concurrency": 5
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `urls` | `string[]` | Required (max 100) | Website URLs or domains to analyze. |
| `checkContactPage` | `boolean` | `true` | Auto-fetch `/contact`, `/about`, or linked contact pages when no email is found on the homepage. |
| `timeoutMs` | `integer` | `10000` | Per-request timeout in milliseconds (`1000`–`60000`). |
| `concurrency` | `integer` | `5` | Number of websites scanned in parallel (`1`–`20`). |

## Output Dataset Example

Each processed website produces a structured JSON/CSV row matching `.actor/dataset_schema.json`:

```json
{
  "url": "https://example.com/",
  "finalUrl": "https://example.com/",
  "httpStatus": 200,
  "responseTimeMs": 245,
  "title": "Example Company",
  "metaDescription": "B2B software and automation platform.",
  "h1": "Build Faster with Example",
  "emails": ["hello@example.com"],
  "phones": ["+1 415 555 0199"],
  "socialLinks": {
    "twitter": "https://x.com/example",
    "linkedin": "https://linkedin.com/company/example",
    "github": "https://github.com/example",
    "facebook": null,
    "telegram": null,
    "youtube": null
  },
  "hasRobotsTxt": true,
  "hasSitemap": true,
  "techHints": ["Cloudflare", "Next.js", "Tailwind CSS"],
  "checkedPages": ["https://example.com/"],
  "error": null,
  "extractedAt": "2026-11-27T15:30:00.000Z"
}
```

## Local Development & Verification

```bash
npm install
npm run validate:schemas
npm test
```

Standalone CLI usage:

```bash
node src/main.js --standalone --output test_output.json
```

Built by **VektorZero Labs**.
