import * as cheerio from "cheerio";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; VektorWebLeadSEOExtractor/0.1; +https://github.com/macmac08082002/apify-web-lead-extractor)";

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB cap to protect memory

const IGNORED_EMAIL_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "avif", "tif", "tiff",
  "css", "js", "mjs", "cjs", "json", "map", "xml", "yaml", "yml",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp4", "mp3", "wav", "ogg", "webm", "avi", "mov",
  "pdf", "zip", "gz", "tar", "rar", "7z", "exe", "dmg",
  "html", "htm", "php", "asp", "aspx", "jsp", "txt",
]);

const IGNORED_EMAIL_DOMAINS = new Set([
  "sentry.io",
  "sentry-next.wixpress.com",
  "sentry.wixpress.com",
  "wixpress.com",
]);

const EMAIL_REGEX = /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,190}\.[a-zA-Z]{2,24}\b/g;

// Strict formatted phone regexes (avoiding raw dates, IPs, CSS metrics, random integers)
const INTL_PHONE_REGEX =
  /(?<![\w/.])(?:\+|00)[1-9]\d{0,2}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?(?:\d[\s.-]?){6,12}\d(?![\w/.])/g;
const LOCAL_PHONE_REGEX =
  /(?<![\w/.])(?:\(\d{2,4}\)|\b0\d{2,3})[\s.-]\d{3,4}[\s.-]\d{3,4}(?![\w/.])/g;

function collapseWhitespace(str) {
  if (typeof str !== "string") return null;
  const cleaned = str.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeTargetUrl(raw) {
  let candidate = "";
  if (typeof raw === "string") {
    candidate = raw.trim();
  } else if (raw && typeof raw === "object" && typeof raw.url === "string") {
    candidate = raw.url.trim();
  }
  if (!candidate) return null;

  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/.test(candidate)) {
      candidate = `https://${candidate}`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Decode Cloudflare data-cfemail hex-obfuscated emails.
 */
function decodeCfEmail(hex) {
  if (!hex || typeof hex !== "string" || hex.length < 4 || hex.length % 2 !== 0) {
    return null;
  }
  try {
    const key = Number.parseInt(hex.slice(0, 2), 16);
    if (Number.isNaN(key)) return null;
    let out = "";
    for (let i = 2; i < hex.length; i += 2) {
      const byte = Number.parseInt(hex.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) return null;
      out += String.fromCharCode(byte ^ key);
    }
    return out;
  } catch {
    return null;
  }
}

export function isValidCleanEmail(rawEmail) {
  if (typeof rawEmail !== "string") return false;
  let email = rawEmail.trim().toLowerCase();
  if (!email || email.length > 120) return false;
  if (email.includes("..") || email.startsWith(".") || email.endsWith(".")) return false;

  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || local.length > 64 || domain.length > 190) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (domain.startsWith("-") || domain.endsWith("-") || !domain.includes(".")) return false;

  const domainLabels = domain.split(".");
  const tld = domainLabels[domainLabels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) return false;
  if (IGNORED_EMAIL_EXTENSIONS.has(tld)) return false;

  // Reject image-retina patterns like logo@2x.png or banner@3x.webp
  if (/^\d+x\./.test(domain)) return false;
  if (IGNORED_EMAIL_DOMAINS.has(domain)) return false;

  // Reject hex-like sentry hashes (32 hex chars @ domain)
  if (/^[a-f0-9]{32}$/.test(local)) return false;

  return true;
}

export function extractEmails($, visibleText) {
  const found = new Set();

  const addEmail = (candidate) => {
    if (!candidate) return;
    let cleaned = candidate.trim();
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // keep raw
    }
    cleaned = cleaned.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    // Strip wrapping punctuation if any
    cleaned = cleaned.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (isValidCleanEmail(cleaned)) {
      found.add(cleaned);
    }
  };

  // 1. Explicit mailto: links
  $('a[href^="mailto:"], a[href^="MAILTO:"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const list = href.replace(/^mailto:/i, "").split("?")[0].split(/[,;]/);
    for (const item of list) addEmail(item);
  });

  // 2. Cloudflare obfuscated emails
  $("[data-cfemail]").each((_, el) => {
    const decoded = decodeCfEmail($(el).attr("data-cfemail"));
    if (decoded) addEmail(decoded);
  });

  // 3. Visible text matches
  if (visibleText) {
    const matches = visibleText.match(EMAIL_REGEX) || [];
    for (const m of matches) addEmail(m);
  }

  return Array.from(found);
}

function normalizePhoneCandidate(raw) {
  if (typeof raw !== "string") return null;
  let cleaned = raw.trim().replace(/^tel:/i, "");
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // keep raw
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Reject date patterns like 2026-11-27 or 11/27/2026
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(cleaned)) return null;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(cleaned)) return null;
  // Reject IPv4 or semantic versions like 1.2.3.4
  if (/^\d{1,3}(\.\d{1,3}){2,3}$/.test(cleaned)) return null;

  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  // Reject repeated single digit strings like 00000000
  if (/^(\d)\1+$/.test(digits)) return null;

  return { formatted: cleaned, digits };
}

export function extractPhones($, visibleText) {
  const byDigits = new Map();

  const addPhone = (raw) => {
    const parsed = normalizePhoneCandidate(raw);
    if (!parsed) return;
    if (!byDigits.has(parsed.digits)) {
      byDigits.set(parsed.digits, parsed.formatted);
    }
  };

  // 1. Explicit tel: links
  $('a[href^="tel:"], a[href^="TEL:"]').each((_, el) => {
    addPhone($(el).attr("href") || "");
  });

  // 2. Visible page text
  if (visibleText) {
    const intlMatches = visibleText.match(INTL_PHONE_REGEX) || [];
    for (const m of intlMatches) addPhone(m);

    const localMatches = visibleText.match(LOCAL_PHONE_REGEX) || [];
    for (const m of localMatches) addPhone(m);
  }

  return Array.from(byDigits.values());
}

export function extractSocialLinks($, baseUrl) {
  const socialLinks = {
    twitter: null,
    linkedin: null,
    github: null,
    facebook: null,
    telegram: null,
    youtube: null,
  };

  const trySet = (key, urlStr) => {
    if (!socialLinks[key]) {
      socialLinks[key] = urlStr;
    }
  };

  $("a[href]").each((_, el) => {
    const rawHref = ($(el).attr("href") || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) {
      return;
    }

    let parsed;
    try {
      parsed = new URL(rawHref, baseUrl);
    } catch {
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    const lowerPath = pathname.toLowerCase();
    const canonical = `${parsed.origin}${pathname || ""}`;

    if (host === "twitter.com" || host === "x.com") {
      if (
        pathname.length > 1 &&
        !lowerPath.startsWith("/intent") &&
        !lowerPath.startsWith("/share") &&
        !lowerPath.startsWith("/home") &&
        !lowerPath.startsWith("/search") &&
        !lowerPath.startsWith("/hashtag") &&
        !lowerPath.startsWith("/i/")
      ) {
        trySet("twitter", canonical);
      }
    } else if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      if (
        (lowerPath.startsWith("/company/") ||
          lowerPath.startsWith("/in/") ||
          lowerPath.startsWith("/school/") ||
          lowerPath.startsWith("/showcase/")) &&
        !lowerPath.includes("sharearticle")
      ) {
        trySet("linkedin", canonical);
      }
    } else if (host === "github.com") {
      if (
        pathname.length > 1 &&
        !lowerPath.startsWith("/login") &&
        !lowerPath.startsWith("/signup") &&
        !lowerPath.startsWith("/features") &&
        !lowerPath.startsWith("/pricing") &&
        !lowerPath.startsWith("/topics") &&
        !lowerPath.startsWith("/about") &&
        !lowerPath.startsWith("/site")
      ) {
        trySet("github", canonical);
      }
    } else if (host === "facebook.com" || host === "fb.com" || host === "m.facebook.com") {
      if (
        pathname.length > 1 &&
        !lowerPath.startsWith("/sharer") &&
        !lowerPath.startsWith("/share") &&
        !lowerPath.startsWith("/dialog") &&
        !lowerPath.startsWith("/plugins") &&
        lowerPath !== "/tr"
      ) {
        trySet("facebook", canonical);
      }
    } else if (host === "t.me" || host === "telegram.me" || host === "telegram.dog") {
      if (pathname.length > 1 && !lowerPath.startsWith("/share")) {
        trySet("telegram", canonical);
      }
    } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      if (
        pathname.length > 1 &&
        !lowerPath.startsWith("/embed") &&
        !lowerPath.startsWith("/iframe_api")
      ) {
        trySet("youtube", canonical);
      }
    }
  });

  return socialLinks;
}

export function detectTechHints(headersObj, html, $, finalUrl) {
  const hints = new Set();
  const h = headersObj || {};
  const rawHtml = html || "";
  const lowerHtml = rawHtml.toLowerCase();

  const server = (h["server"] || "").toLowerCase();
  const poweredBy = (h["x-powered-by"] || "").toLowerCase();
  const generator = ($('meta[name="generator"]').attr("content") || "").toLowerCase();

  // Hosting / CDN / Infrastructure
  if (server.includes("cloudflare") || h["cf-ray"]) {
    hints.add("Cloudflare");
  }
  if (
    h["cf-worker"] ||
    (finalUrl && /\.workers\.dev(?:\/|$)/i.test(finalUrl))
  ) {
    hints.add("Cloudflare Workers");
  }
  if (server.includes("vercel") || h["x-vercel-id"]) {
    hints.add("Vercel");
  }
  if (server.includes("netlify") || h["x-nf-request-id"]) {
    hints.add("Netlify");
  }
  if (h["x-amz-cf-id"] || (h["via"] || "").toLowerCase().includes("cloudfront")) {
    hints.add("AWS CloudFront");
  }
  if (server.includes("nginx")) hints.add("Nginx");
  if (server.includes("apache")) hints.add("Apache");
  if (server.includes("github.com")) hints.add("GitHub Pages");

  // Frameworks & CMS
  if (
    poweredBy.includes("next.js") ||
    h["x-nextjs-cache"] ||
    rawHtml.includes("__NEXT_DATA__") ||
    lowerHtml.includes("/_next/static/")
  ) {
    hints.add("Next.js");
  }
  if (rawHtml.includes("__NUXT__") || lowerHtml.includes("/_nuxt/")) {
    hints.add("Nuxt.js");
  }
  if (generator.includes("astro") || lowerHtml.includes("astro-island")) {
    hints.add("Astro");
  }
  if (
    generator.includes("wordpress") ||
    lowerHtml.includes("/wp-content/") ||
    lowerHtml.includes("/wp-includes/")
  ) {
    hints.add("WordPress");
  }
  if (
    h["x-shopify-stage"] ||
    h["x-shopid"] ||
    lowerHtml.includes("cdn.shopify.com") ||
    lowerHtml.includes("shopify.theme")
  ) {
    hints.add("Shopify");
  }
  if (generator.includes("webflow") || lowerHtml.includes("data-wf-site")) {
    hints.add("Webflow");
  }
  if (generator.includes("wix.com") || lowerHtml.includes("static.wixstatic.com")) {
    hints.add("Wix");
  }
  if (lowerHtml.includes("static1.squarespace.com")) {
    hints.add("Squarespace");
  }
  if (generator.includes("ghost")) hints.add("Ghost");
  if (generator.includes("drupal")) hints.add("Drupal");

  // Frontend libraries / CSS
  if (
    rawHtml.includes("data-reactroot") ||
    rawHtml.includes("__REACT_DEVTOOLS_GLOBAL_HOOK__") ||
    /react(?:\.production\.min)?\.js/i.test(rawHtml)
  ) {
    hints.add("React");
  }
  if (
    rawHtml.includes("__VUE__") ||
    /vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.js/i.test(rawHtml)
  ) {
    hints.add("Vue.js");
  }
  if (/ng-version=["']\d/i.test(rawHtml)) {
    hints.add("Angular");
  }
  if (lowerHtml.includes("__svelte") || lowerHtml.includes("svelte-")) {
    hints.add("Svelte");
  }
  if (
    lowerHtml.includes("cdn.tailwindcss.com") ||
    lowerHtml.includes("tailwindcss") ||
    /--tw-ring-inset|--tw-translate-x/.test(rawHtml)
  ) {
    hints.add("Tailwind CSS");
  }
  if (
    /bootstrap(?:\.min)?\.(?:css|js)/i.test(rawHtml) ||
    lowerHtml.includes("getbootstrap.com")
  ) {
    hints.add("Bootstrap");
  }
  if (/jquery(?:[-.]\d+(?:\.\d+)*)?(?:\.min)?\.js/i.test(rawHtml)) {
    hints.add("jQuery");
  }
  if (lowerHtml.includes("font-awesome") || lowerHtml.includes("fontawesome")) {
    hints.add("Font Awesome");
  }

  // Analytics / Marketing / Payments
  if (
    lowerHtml.includes("googletagmanager.com/gtag/js") ||
    lowerHtml.includes("google-analytics.com/analytics.js") ||
    /\bgtag\s*\(\s*['"]config['"]/.test(rawHtml)
  ) {
    hints.add("Google Analytics");
  }
  if (lowerHtml.includes("googletagmanager.com/gtm.js")) {
    hints.add("Google Tag Manager");
  }
  if (lowerHtml.includes("connect.facebook.net") && lowerHtml.includes("fbq(")) {
    hints.add("Meta Pixel");
  }
  if (lowerHtml.includes("static.cloudflareinsights.com/beacon.min.js")) {
    hints.add("Cloudflare Web Analytics");
  }
  if (lowerHtml.includes("plausible.io/js/")) {
    hints.add("Plausible Analytics");
  }
  if (lowerHtml.includes("js.hs-scripts.com") || lowerHtml.includes("hs-analytics")) {
    hints.add("HubSpot");
  }
  if (lowerHtml.includes("widget.intercom.io")) {
    hints.add("Intercom");
  }
  if (lowerHtml.includes("js.stripe.com")) {
    hints.add("Stripe");
  }

  return Array.from(hints);
}

async function fetchWithTimeout(url, timeoutMs, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      },
    });

    const responseTimeMs = Date.now() - started;
    const headersObj = {};
    res.headers.forEach((value, key) => {
      headersObj[key.toLowerCase()] = value;
    });

    const contentType = (headersObj["content-type"] || "").toLowerCase();
    const isTextLike =
      !contentType ||
      contentType.includes("text/") ||
      contentType.includes("html") ||
      contentType.includes("xml") ||
      contentType.includes("json") ||
      contentType.includes("javascript");

    let text = "";
    if (isTextLike) {
      const rawText = await res.text();
      text = rawText.length > MAX_HTML_BYTES ? rawText.slice(0, MAX_HTML_BYTES) : rawText;
    }

    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      responseTimeMs,
      headers: headersObj,
      contentType,
      text,
      error: null,
    };
  } catch (err) {
    const responseTimeMs = Date.now() - started;
    const msg =
      err && err.name === "AbortError"
        ? `Request timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      ok: false,
      status: null,
      finalUrl: null,
      responseTimeMs,
      headers: {},
      contentType: "",
      text: "",
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

function getVisibleText($) {
  const clone = cheerio.load($.html());
  clone("script, style, noscript, svg, template").remove();
  return clone("body").text() || clone.root().text() || "";
}

function discoverContactAboutLinks($, baseUrl) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const prioritized = [];
  const seen = new Set([baseUrl.replace(/\/+$/, "")]);

  $("a[href]").each((_, el) => {
    const rawHref = ($(el).attr("href") || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:") || rawHref.startsWith("javascript:")) {
      return;
    }
    let resolved;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      return;
    }
    if (resolved.origin !== origin) return;
    resolved.hash = "";
    const normalized = resolved.href.replace(/\/+$/, "");
    if (seen.has(normalized)) return;

    const pathLower = resolved.pathname.toLowerCase();
    const anchorText = ($(el).text() || "").toLowerCase();
    const isContact =
      /\/(contact|contact-us|lien-he|support|get-in-touch)(?:\/|$)/i.test(pathLower) ||
      /\b(contact|liên hệ)\b/i.test(anchorText);
    const isAbout =
      /\/(about|about-us|gioi-thieu|company|team)(?:\/|$)/i.test(pathLower) ||
      /\b(about|giới thiệu)\b/i.test(anchorText);

    if (isContact) {
      seen.add(normalized);
      prioritized.unshift(resolved.href);
    } else if (isAbout) {
      seen.add(normalized);
      prioritized.push(resolved.href);
    }
  });

  // Always ensure standard /contact and /about fallbacks are available
  for (const fallbackPath of ["/contact", "/about"]) {
    const fallbackUrl = `${origin}${fallbackPath}`;
    const norm = fallbackUrl.replace(/\/+$/, "");
    if (!seen.has(norm)) {
      seen.add(norm);
      prioritized.push(fallbackUrl);
    }
  }

  return prioritized.slice(0, 3);
}

async function checkRobotsAndSitemap(origin, timeoutMs) {
  const probeTimeout = Math.min(timeoutMs, 6000);
  const [robotsRes, sitemapRes] = await Promise.all([
    fetchWithTimeout(`${origin}/robots.txt`, probeTimeout, "text/plain,*/*;q=0.5"),
    fetchWithTimeout(`${origin}/sitemap.xml`, probeTimeout, "application/xml,text/xml,*/*;q=0.5"),
  ]);

  const robotsBody = (robotsRes.text || "").trim();
  const robotsIsHtml = /^<!doctype\s+html|^<html[\s>]/i.test(robotsBody);
  const hasRobotsTxt =
    robotsRes.status === 200 &&
    robotsBody.length > 0 &&
    !robotsIsHtml &&
    (robotsRes.contentType.includes("text/plain") ||
      /^\s*(user-agent|disallow|allow|sitemap)\s*:/im.test(robotsBody));

  const robotsDeclaresSitemap =
    hasRobotsTxt && /^\s*sitemap\s*:\s*https?:\/\//im.test(robotsBody);

  const sitemapBody = (sitemapRes.text || "").trim();
  const sitemapIsHtml = /^<!doctype\s+html|^<html[\s>]/i.test(sitemapBody);
  const sitemapXmlValid =
    sitemapRes.status === 200 &&
    sitemapBody.length > 0 &&
    !sitemapIsHtml &&
    (sitemapRes.contentType.includes("xml") ||
      /<(urlset|sitemapindex)\b/i.test(sitemapBody));

  return {
    hasRobotsTxt,
    hasSitemap: sitemapXmlValid || robotsDeclaresSitemap,
  };
}

function mergeSocialLinks(target, incoming) {
  for (const key of Object.keys(target)) {
    if (!target[key] && incoming[key]) {
      target[key] = incoming[key];
    }
  }
}

export async function extractWebsiteIntel(rawUrl, options = {}) {
  const checkContactPage = options.checkContactPage !== false;
  const timeoutMs = Math.max(
    1000,
    Math.min(60000, Number.parseInt(String(options.timeoutMs ?? 10000), 10) || 10000),
  );

  const normalizedUrl = normalizeTargetUrl(rawUrl);
  if (!normalizedUrl) {
    return {
      url: typeof rawUrl === "string" ? rawUrl : String(rawUrl ?? ""),
      finalUrl: null,
      httpStatus: null,
      responseTimeMs: 0,
      title: null,
      metaDescription: null,
      h1: null,
      emails: [],
      phones: [],
      socialLinks: {
        twitter: null,
        linkedin: null,
        github: null,
        facebook: null,
        telegram: null,
        youtube: null,
      },
      hasRobotsTxt: false,
      hasSitemap: false,
      techHints: [],
      checkedPages: [],
      error: "Invalid HTTP/HTTPS URL format.",
      extractedAt: new Date().toISOString(),
    };
  }

  const origin = new URL(normalizedUrl).origin;
  const [homeRes, crawlSignals] = await Promise.all([
    fetchWithTimeout(normalizedUrl, timeoutMs),
    checkRobotsAndSitemap(origin, timeoutMs),
  ]);

  const checkedPages = [homeRes.finalUrl || normalizedUrl];

  if (homeRes.error || !homeRes.text) {
    return {
      url: normalizedUrl,
      finalUrl: homeRes.finalUrl,
      httpStatus: homeRes.status,
      responseTimeMs: homeRes.responseTimeMs,
      title: null,
      metaDescription: null,
      h1: null,
      emails: [],
      phones: [],
      socialLinks: {
        twitter: null,
        linkedin: null,
        github: null,
        facebook: null,
        telegram: null,
        youtube: null,
      },
      hasRobotsTxt: crawlSignals.hasRobotsTxt,
      hasSitemap: crawlSignals.hasSitemap,
      techHints: detectTechHints(homeRes.headers, "", cheerio.load(""), homeRes.finalUrl || normalizedUrl),
      checkedPages,
      error: homeRes.error || `Empty or non-text response (HTTP ${homeRes.status ?? "unknown"}).`,
      extractedAt: new Date().toISOString(),
    };
  }

  const $ = cheerio.load(homeRes.text);
  const visibleText = getVisibleText($);

  const title =
    collapseWhitespace($("title").first().text()) ||
    collapseWhitespace($('meta[property="og:title"]').attr("content"));

  let metaDescription = null;
  $("meta").each((_, el) => {
    if (metaDescription) return;
    const name = ($(el).attr("name") || "").toLowerCase();
    const prop = ($(el).attr("property") || "").toLowerCase();
    if (name === "description" || prop === "og:description" || name === "twitter:description") {
      metaDescription = collapseWhitespace($(el).attr("content"));
    }
  });

  let h1 = null;
  $("h1").each((_, el) => {
    if (h1) return;
    h1 = collapseWhitespace($(el).text());
  });

  const emailsSet = new Set(extractEmails($, visibleText));
  const phonesSet = new Set(extractPhones($, visibleText));
  const socialLinks = extractSocialLinks($, homeRes.finalUrl || normalizedUrl);
  const techHintsSet = new Set(
    detectTechHints(homeRes.headers, homeRes.text, $, homeRes.finalUrl || normalizedUrl),
  );

  // Automatic /contact & /about fallback if homepage had no emails
  if (checkContactPage && emailsSet.size === 0 && homeRes.status && homeRes.status < 400) {
    const candidates = discoverContactAboutLinks($, homeRes.finalUrl || normalizedUrl);
    const subTimeout = Math.min(timeoutMs, 7000);
    for (const subUrl of candidates) {
      const subRes = await fetchWithTimeout(subUrl, subTimeout);
      checkedPages.push(subRes.finalUrl || subUrl);
      if (subRes.ok && subRes.text && subRes.contentType.includes("html")) {
        const $sub = cheerio.load(subRes.text);
        const subText = getVisibleText($sub);
        for (const e of extractEmails($sub, subText)) emailsSet.add(e);
        for (const p of extractPhones($sub, subText)) phonesSet.add(p);
        mergeSocialLinks(socialLinks, extractSocialLinks($sub, subRes.finalUrl || subUrl));
        for (const t of detectTechHints(subRes.headers, subRes.text, $sub, subRes.finalUrl || subUrl)) {
          techHintsSet.add(t);
        }
        if (emailsSet.size > 0) break;
      }
    }
  }

  return {
    url: normalizedUrl,
    finalUrl: homeRes.finalUrl || normalizedUrl,
    httpStatus: homeRes.status,
    responseTimeMs: homeRes.responseTimeMs,
    title,
    metaDescription,
    h1,
    emails: Array.from(emailsSet),
    phones: Array.from(phonesSet),
    socialLinks,
    hasRobotsTxt: crawlSignals.hasRobotsTxt,
    hasSitemap: crawlSignals.hasSitemap,
    techHints: Array.from(techHintsSet),
    checkedPages,
    error: homeRes.status && homeRes.status >= 400 ? `HTTP ${homeRes.status}` : null,
    extractedAt: new Date().toISOString(),
  };
}
