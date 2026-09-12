const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const Busboy = require("busboy");
const { extractCandidate, findBestMatch, diffVersion } = require("./src/domain");
const { recognizeImage } = require("./src/ocr");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const MAX_BODY_BYTES = 1024 * 1024;
const rateBuckets = new Map();
const pendingPreviews = new Map();
const adminChallenges = new Map();
const adminSessions = new Map();
const adminLoginAttempts = new Map();

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value || "").toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 1000000).padStart(6, "0");
}

function verifyTotp(code) {
  const normalized = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized) || !ADMIN_TOTP_SECRET) return false;
  return [-1, 0, 1].some((offset) => totpCode(ADMIN_TOTP_SECRET, Date.now() + offset * 30000) === normalized);
}

function verifyAdminPassword(password) {
  const [salt, expected] = ADMIN_PASSWORD_HASH.split(":");
  if (!salt || !expected || !password) return false;
  const actual = crypto.pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  const match = cookies.map((cookie) => cookie.trim().split("=")).find(([key]) => key === name);
  return match ? decodeURIComponent(match.slice(1).join("=")) : "";
}

function adminSession(request) {
  const token = cookieValue(request, "cvghost_admin");
  const session = token ? adminSessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
    return null;
  }
  return session;
}

function requireAdmin(request, response) {
  const session = adminSession(request);
  if (!session) {
    sendJson(response, 401, { error: { code: "ADMIN_AUTH_REQUIRED", message: "Admin girişi gerekli." } });
    return null;
  }
  return session;
}

function adminToken(prefix) {
  const random = crypto.randomBytes(32).toString("hex");
  return `${prefix}_${crypto.createHmac("sha256", ADMIN_SESSION_SECRET || "missing-admin-secret").update(random).digest("hex")}`;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function seedStore() {
  const first = {
    id: "listing_acme_backend",
    status: "ACTIVE",
    firstSeenAt: isoDaysAgo(46),
    lastSeenAt: isoDaysAgo(2),
    verifications: 18,
    contributors: 7,
    versions: [
      {
        id: "version_acme_1",
        versionNumber: 1,
        title: "Backend Developer",
        company: "Acme Teknoloji",
        location: "İstanbul",
        workMode: "HYBRID",
        employmentType: "FULL_TIME",
        salaryMin: 70000,
        salaryMax: 90000,
        salaryCurrency: "TRY",
        salaryPeriod: "MONTHLY",
        description: "Node.js, PostgreSQL ve dağıtık sistemler üzerinde çalışan backend ekibine katılacak geliştirici aranıyor.",
        sourceUrl: "https://jobs.acme.example/backend-developer",
        observedAt: isoDaysAgo(46),
        confidenceScore: 0.94,
        evidenceLabel: "Kariyer sayfası ekran görüntüsü"
      },
      {
        id: "version_acme_2",
        versionNumber: 2,
        title: "Backend Developer",
        company: "Acme Teknoloji",
        location: "İstanbul",
        workMode: "HYBRID",
        employmentType: "FULL_TIME",
        salaryMin: 80000,
        salaryMax: 100000,
        salaryCurrency: "TRY",
        salaryPeriod: "MONTHLY",
        description: "Node.js, PostgreSQL ve dağıtık sistemler üzerinde çalışan backend ekibine katılacak geliştirici aranıyor. Esnek hibrit çalışma.",
        sourceUrl: "https://jobs.acme.example/backend-developer",
        observedAt: isoDaysAgo(2),
        confidenceScore: 0.97,
        evidenceLabel: "Kariyer sayfası URL doğrulaması"
      }
    ],
    events: [
      { id: "event_acme_1", type: "FIRST_SEEN", label: "İlk kez görüldü", at: isoDaysAgo(46), detail: "Topluluk kaynağı üzerinden sisteme eklendi." },
      { id: "event_acme_2", type: "VERIFIED", label: "Topluluk tarafından doğrulandı", at: isoDaysAgo(44), detail: "3 farklı katkıcı aynı ilanı doğruladı." },
      { id: "event_acme_3", type: "SALARY_CHANGED", label: "Maaş aralığı güncellendi", at: isoDaysAgo(2), detail: "70.000–90.000 TL → 80.000–100.000 TL" }
    ]
  };
  const second = {
    id: "listing_northstar_product",
    status: "ACTIVE",
    firstSeenAt: isoDaysAgo(19),
    lastSeenAt: isoDaysAgo(5),
    verifications: 9,
    contributors: 4,
    versions: [{
      id: "version_northstar_1",
      versionNumber: 1,
      title: "Product Designer",
      company: "Northstar Labs",
      location: "İzmir",
      workMode: "REMOTE",
      employmentType: "FULL_TIME",
      salaryMin: 55000,
      salaryMax: 75000,
      salaryCurrency: "TRY",
      salaryPeriod: "MONTHLY",
      description: "Ürün ekibine katılacak, araştırma ve prototipleme deneyimi olan Product Designer aranıyor.",
      sourceUrl: "https://northstar.example/careers/product-designer",
      observedAt: isoDaysAgo(19),
      confidenceScore: 0.9,
      evidenceLabel: "Kullanıcı metin gönderimi"
    }],
    events: [
      { id: "event_northstar_1", type: "FIRST_SEEN", label: "İlk kez görüldü", at: isoDaysAgo(19), detail: "İlan, topluluk üyesi tarafından gönderildi." },
      { id: "event_northstar_2", type: "VERIFIED", label: "Topluluk tarafından doğrulandı", at: isoDaysAgo(17), detail: "9 topluluk doğrulaması." }
    ]
  };
  const third = {
    id: "listing_orbit_data",
    status: "UNDER_REVIEW",
    firstSeenAt: isoDaysAgo(7),
    lastSeenAt: isoDaysAgo(7),
    verifications: 2,
    contributors: 2,
    versions: [{
      id: "version_orbit_1",
      versionNumber: 1,
      title: "Data Analyst",
      company: "Orbit Finans",
      location: "Ankara",
      workMode: "ONSITE",
      employmentType: "FULL_TIME",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      description: "Finansal raporlama ve veri kalitesi çalışmalarında görev alacak Data Analyst.",
      sourceUrl: "https://orbit.example/jobs/data-analyst",
      observedAt: isoDaysAgo(7),
      confidenceScore: 0.72,
      evidenceLabel: "OCR sonucu, inceleme bekliyor"
    }],
    events: [
      { id: "event_orbit_1", type: "FIRST_SEEN", label: "İlk kez görüldü", at: isoDaysAgo(7), detail: "OCR sonucu inceleme kuyruğuna alındı." }
    ]
  };
  return { listings: [first, second, third], submissions: [], reports: [], corrections: [] };
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "evidence"), { recursive: true });
  if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, JSON.stringify(seedStore(), null, 2));
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function writeStore(store) {
  const temporaryFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2));
  fs.renameSync(temporaryFile, STORE_FILE);
}

function latestVersion(listing) {
  return listing.versions[listing.versions.length - 1];
}

function serializeListing(listing) {
  const latest = latestVersion(listing);
  return {
    ...latest,
    id: listing.id,
    status: listing.status,
    firstSeenAt: listing.firstSeenAt,
    lastSeenAt: listing.lastSeenAt,
    verifications: listing.verifications,
    contributors: listing.contributors,
    versionCount: listing.versions.length,
    latestVersionId: latest.id
  };
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, code, message, fields) {
  sendJson(response, status, { error: { code, message, ...(fields ? { fields } : {}) } });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("İstek gövdesi çok büyük."), { code: "FILE_TOO_LARGE" }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error("Geçersiz JSON gövdesi."), { code: "VALIDATION_ERROR" })); }
    });
    request.on("error", reject);
  });
}

function readMultipart(request) {
  return new Promise((resolve, reject) => {
    const parser = Busboy({
      headers: request.headers,
      limits: { files: 1, fileSize: 8 * 1024 * 1024, fields: 10 }
    });
    const fields = {};
    let file = null;
    let fileTooLarge = false;
    parser.on("field", (name, value) => { fields[name] = value; });
    parser.on("file", (name, stream, info) => {
      const chunks = [];
      stream.on("limit", () => { fileTooLarge = true; });
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => { file = { fieldName: name, filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) }; });
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      if (fileTooLarge) return reject(Object.assign(new Error("Görsel 8 MB sınırını aşamaz."), { code: "FILE_TOO_LARGE" }));
      resolve({ fields, file });
    });
    request.pipe(parser);
  });
}

function buildStats(store) {
  const records = store.listings.map(serializeListing);
  const salaryValues = records.flatMap((item) => [item.salaryMin, item.salaryMax]).filter(Boolean);
  const activeCount = records.filter((item) => item.status === "ACTIVE").length;
  const verifiedCount = records.reduce((sum, item) => sum + item.verifications, 0);
  const companies = new Set(records.map((item) => item.company)).size;
  const jobGroups = new Map();
  const companyGroups = new Map();
  for (const record of records) {
    const titleKey = record.title.toLocaleLowerCase("tr-TR").trim();
    const job = jobGroups.get(titleKey) || { title: record.title, mentions: 0, versions: 0, companies: new Set(), activeCount: 0 };
    job.mentions += 1;
    job.versions += record.versionCount;
    job.companies.add(record.company);
    if (record.status === "ACTIVE") job.activeCount += 1;
    jobGroups.set(titleKey, job);

    const company = companyGroups.get(record.company) || { company: record.company, listings: 0, versions: 0, verifications: 0, activeCount: 0 };
    company.listings += 1;
    company.versions += record.versionCount;
    company.verifications += record.verifications;
    if (record.status === "ACTIVE") company.activeCount += 1;
    companyGroups.set(record.company, company);
  }
  return {
    listingCount: records.length,
    activeCount,
    companyCount: companies,
    verificationCount: verifiedCount,
    salaryMedian: salaryValues.length ? Math.round([...salaryValues].sort((a, b) => a - b)[Math.floor(salaryValues.length / 2)]) : null,
    changeRate: records.filter((item) => item.versionCount > 1).length / Math.max(records.length, 1),
    repeatedJobs: [...jobGroups.values()]
      .map((item) => ({ ...item, companies: item.companies.size }))
      .sort((a, b) => b.versions - a.versions || b.mentions - a.mentions)
      .slice(0, 5),
    companyRankings: [...companyGroups.values()]
      .sort((a, b) => b.listings - a.listings || b.verifications - a.verifications)
      .slice(0, 5)
  };
}

function validateSubmission(body) {
  const fields = {};
  if (!body.rawText || String(body.rawText).trim().length < 20) fields.rawText = "En az 20 karakterlik ilan metni gerekli.";
  if (body.sourceUrl && !/^https?:\/\//i.test(body.sourceUrl)) fields.sourceUrl = "URL http:// veya https:// ile başlamalı.";
  return fields;
}

function checkRateLimit(request, pathname) {
  if (request.method !== "POST") return true;
  const key = `${request.socket.remoteAddress || "unknown"}:${pathname}`;
  const now = Date.now();
  const current = rateBuckets.get(key) || { count: 0, startedAt: now };
  if (now - current.startedAt > 60000) { current.count = 0; current.startedAt = now; }
  current.count += 1;
  rateBuckets.set(key, current);
  const limit = pathname === "/api/submissions" ? 2 : 30;
  return current.count <= limit;
}

function createVersion(candidate, sourceSubmissionId, number) {
  return {
    id: id("version"),
    versionNumber: number,
    ...candidate,
    observedAt: new Date().toISOString(),
    confidenceScore: candidate.salaryMin ? 0.91 : 0.78,
    evidenceLabel: sourceSubmissionId ? "Topluluk metin gönderimi" : "Topluluk düzeltmesi"
  };
}

function calculateApplicationInsight({ appliedAt, repostedAt, cvViewedStatus }) {
  const cvLabel = cvViewedStatus === "NOT_VIEWED" ? "CV görüntülenmedi" : cvViewedStatus === "VIEWED" ? "CV görüntülendi" : "CV durumu bilinmiyor";
  if (!repostedAt || cvViewedStatus !== "NOT_VIEWED") return { type: "TRACKING", label: "Takipte", tone: "neutral", detail: `Başvuru kaydı oluşturuldu; ${cvLabel}.` };
  const applied = appliedAt ? new Date(appliedAt) : null;
  const reposted = new Date(repostedAt);
  const gap = applied && !Number.isNaN(applied.getTime()) ? Math.round((reposted - applied) / 86400000) : null;
  if (gap !== null && gap >= 0 && gap <= 30) return { type: "POOL_SIGNAL", label: "Aday havuzu sinyali", tone: "warning", detail: `İlan başvurudan ${gap} gün sonra yeniden yayınlandı; CV hâlâ görüntülenmemiş.` };
  return { type: "REPOSTED", label: "Yeniden yayınlandı", tone: "neutral", detail: "İlan yeniden görülmüş; CV görüntülenme durumu değişmemiş." };
}

function missingCandidateFields(candidate) {
  const missing = [];
  if (!candidate.title || candidate.title === "Belirsiz pozisyon") missing.push("title");
  if (!candidate.company || candidate.company === "Topluluk kaynağı") missing.push("company");
  if (!candidate.location || candidate.location === "Belirtilmemiş") missing.push("location");
  return missing;
}

async function verifySourceUrl(sourceUrl) {
  if (!sourceUrl) return null;
  const checkedAt = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response = await fetch(sourceUrl, { method: "HEAD", redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    if (response.status === 405 || response.status === 403) {
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 5000);
      response = await fetch(sourceUrl, { method: "GET", redirect: "follow", signal: fallbackController.signal });
      clearTimeout(fallbackTimeout);
    }
    return { checkedAt, reachable: response.ok, status: response.status, finalUrl: response.url || sourceUrl };
  } catch (error) {
    return { checkedAt, reachable: false, status: null, finalUrl: sourceUrl, reason: error.name === "AbortError" ? "TIMEOUT" : "UNREACHABLE" };
  }
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function sourceText(details) {
  if (!details) return "";
  return [
    details.title ? `Pozisyon: ${details.title}` : "",
    details.company ? `Şirket: ${details.company}` : "",
    details.location ? `Lokasyon: ${details.location}` : "",
    details.description ? `Açıklama: ${details.description}` : ""
  ].filter(Boolean).join("\n");
}

async function extractPublicJobDetails(sourceUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(sourceUrl, { headers: { "user-agent": "IlanIzBot/0.1 (public job verification)" }, redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { reachable: false, status: response.status, details: null };
    const html = (await response.text()).slice(0, 3000000);
    const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const structured = [];
    for (const match of scripts) {
      try {
        const value = JSON.parse(match[1].trim());
        structured.push(...(Array.isArray(value) ? value : [value]));
      } catch { /* Some sites ship invalid JSON-LD; fall back to meta tags. */ }
    }
    const job = structured.find((item) => String(item?.["@type"] || "").toLowerCase().includes("jobposting")) || {};
    const organization = typeof job.hiringOrganization === "object" ? job.hiringOrganization.name : job.hiringOrganization;
    const locationValue = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
    const address = locationValue?.address || {};
    const metaTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
    const details = {
      title: job.title || stripHtml(metaTitle),
      company: organization || html.match(/<meta[^>]+(?:name|property)=["'](?:company|og:site_name)["'][^>]+content=["']([^"']+)/i)?.[1] || "",
      location: address.addressLocality || address.addressRegion || "",
      description: stripHtml(job.description || "").slice(0, 1000)
    };
    const hasDetails = Boolean(details.title || details.company || details.location);
    return { reachable: true, status: response.status, details: hasDetails ? details : null };
  } catch (error) {
    return { reachable: false, status: null, details: null, reason: error.name === "AbortError" ? "TIMEOUT" : "UNREACHABLE" };
  }
}

function saveEvidence(evidence) {
  if (!evidence?.buffer?.length) return null;
  const extension = evidence.mimeType === "image/png" ? "png" : evidence.mimeType === "image/webp" ? "webp" : "jpg";
  const storageKey = `${id("evidence")}.${extension}`;
  fs.writeFileSync(path.join(DATA_DIR, "evidence", storageKey), evidence.buffer);
  return { storageKey, filename: evidence.filename, mimeType: evidence.mimeType, size: evidence.buffer.length };
}

function handleSubmission(store, body) {
  const submissionId = id("submission");
  const candidate = extractCandidate({ rawText: body.rawText, sourceUrl: body.sourceUrl || "" });
  const match = findBestMatch(candidate, store.listings);
  const applicationInsight = calculateApplicationInsight({ appliedAt: body.appliedAt || candidate.appliedAt, repostedAt: body.repostedAt || candidate.repostedAt, cvViewedStatus: body.cvViewedStatus });
  const evidence = body.evidence?.buffer ? saveEvidence(body.evidence) : body.evidence || null;
  const submission = {
    id: submissionId,
    inputType: body.inputType || "TEXT",
    sourceUrl: body.sourceUrl || "",
    status: "ACCEPTED",
    ocrStatus: body.ocrStatus || (body.inputType === "IMAGE" || body.inputType === "PDF" ? "QUEUED" : "NOT_REQUIRED"),
    createdAt: new Date().toISOString(),
    submittedBy: body.deviceId || body.submittedBy || "demo-user",
    appliedAt: body.appliedAt || candidate.appliedAt || null,
    repostedAt: body.repostedAt || candidate.repostedAt || null,
    cvViewedStatus: body.cvViewedStatus || "UNKNOWN",
    cvViewedAt: body.cvViewedAt || null,
    applicationInsight,
    evidence,
    sourceVerification: body.sourceVerification || null
  };

  if (match.type === "MATCH" || match.type === "REVIEW") {
    const listing = match.listing;
    const previous = latestVersion(listing);
    const version = createVersion(candidate, submissionId, listing.versions.length + 1);
    listing.versions.push(version);
    listing.lastSeenAt = version.observedAt;
    listing.contributors += 1;
    const changes = diffVersion(previous, version);
    if (changes.length) {
      listing.events.unshift({
        id: id("event"),
        type: "VERSION_ADDED",
        label: "Yeni ilan sürümü eklendi",
        at: version.observedAt,
        detail: changes.map((change) => `${change.label}: ${change.oldValue ?? "—"} → ${change.newValue ?? "—"}`).join(" · ")
      });
    }
    listing.events.unshift({ id: id("event"), type: "APPLICATION_RECORDED", label: applicationInsight.label, at: submission.createdAt, detail: applicationInsight.detail });
    store.submissions.push({ ...submission, listingId: listing.id, versionId: version.id, matchScore: match.score });
    return { submission, listing: serializeListing(listing), match: { ...match, listing: undefined }, changes, applicationInsight };
  }

  const listing = {
    id: id("listing"),
    status: "UNDER_REVIEW",
    firstSeenAt: submission.createdAt,
    lastSeenAt: submission.createdAt,
    verifications: 0,
    contributors: 1,
    versions: [createVersion(candidate, submissionId, 1)],
    events: [{ id: id("event"), type: "FIRST_SEEN", label: "İlk kez görüldü", at: submission.createdAt, detail: "Yeni topluluk gönderimi." }]
  };
  store.listings.unshift(listing);
  listing.events.unshift({ id: id("event"), type: "APPLICATION_RECORDED", label: applicationInsight.label, at: submission.createdAt, detail: applicationInsight.detail });
  store.submissions.push({ ...submission, listingId: listing.id, versionId: listing.versions[0].id, matchScore: match.score });
  return { submission, listing: serializeListing(listing), match: { ...match, listing: undefined }, changes: [], applicationInsight };
}

function recentSubmissions(store, deviceId) {
  return store.submissions
    .map((submission) => {
      const listing = store.listings.find((item) => item.id === submission.listingId);
      if (!listing) return null;
      const version = listing.versions.find((item) => item.id === submission.versionId) || latestVersion(listing);
      return {
        id: submission.id,
        listingId: listing.id,
        title: version.title,
        company: version.company,
        location: version.location,
        createdAt: submission.createdAt,
        appliedAt: submission.appliedAt,
        repostedAt: submission.repostedAt,
        cvViewedStatus: submission.cvViewedStatus,
        applicationInsight: submission.applicationInsight,
        ocrStatus: submission.ocrStatus,
        hasEvidence: Boolean(submission.evidence),
        isMine: Boolean(deviceId && submission.submittedBy === deviceId)
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function previewCandidate(candidate) {
  return {
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    workMode: candidate.workMode,
    employmentType: candidate.employmentType,
    appliedAt: candidate.appliedAt,
    repostedAt: candidate.repostedAt
  };
}

function buildCompanyDirectory(store) {
  const groups = new Map();
  for (const listing of store.listings) {
    const latest = latestVersion(listing);
    const key = latest.company.toLocaleLowerCase("tr-TR").trim();
    const group = groups.get(key) || { key: encodeURIComponent(latest.company), name: latest.company, listings: [], verifications: 0, activeCount: 0, poolSignals: 0 };
    const listingSignals = store.submissions.filter((submission) => submission.listingId === listing.id && submission.applicationInsight?.type === "POOL_SIGNAL").length;
    group.listings.push({
      id: listing.id,
      title: latest.title,
      location: latest.location,
      workMode: latest.workMode,
      status: listing.status,
      versionCount: listing.versions.length,
      repeatCount: Math.max(0, listing.versions.length - 1),
      firstSeenAt: listing.firstSeenAt,
      lastSeenAt: listing.lastSeenAt,
      verifications: listing.verifications,
      poolSignals: listingSignals
    });
    group.verifications += listing.verifications;
    group.poolSignals += listingSignals;
    if (listing.status === "ACTIVE") group.activeCount += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, listingCount: group.listings.length, repeatedCount: group.listings.filter((listing) => listing.repeatCount > 0).length, totalVersions: group.listings.reduce((sum, listing) => sum + listing.versionCount, 0), listings: group.listings.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)) }))
    .sort((a, b) => b.repeatedCount - a.repeatedCount || b.listingCount - a.listingCount);
}

function buildAdminListings(store) {
  return store.listings
    .map((listing) => {
      const item = serializeListing(listing);
      const reports = store.reports.filter((report) => report.listingId === listing.id);
      const submissions = store.submissions.filter((submission) => submission.listingId === listing.id);
      return {
        ...item,
        reportCount: reports.length,
        reports: reports.slice(-5).reverse(),
        submissionCount: submissions.length,
        evidenceCount: submissions.filter((submission) => submission.evidence).length
      };
    })
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
}

async function route(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;
  if (pathname === "/api/health") return sendJson(response, 200, { ok: true, service: "ilan-iz", now: new Date().toISOString() });

  if (pathname.startsWith("/api/")) {
    if (!checkRateLimit(request, pathname)) return sendError(response, 429, "RATE_LIMITED", "Bu işlem için kısa süreli istek sınırına ulaşıldı.");
    if (request.method === "GET" && pathname === "/api/admin/session") {
      const session = adminSession(request);
      if (!session) return sendError(response, 401, "ADMIN_AUTH_REQUIRED", "Admin girişi gerekli.");
      return sendJson(response, 200, { authenticated: true, username: ADMIN_USERNAME, email: ADMIN_EMAIL });
    }
    if (request.method === "POST" && pathname === "/api/admin/login") {
      if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !ADMIN_TOTP_SECRET || !ADMIN_SESSION_SECRET) return sendError(response, 503, "ADMIN_NOT_CONFIGURED", "Admin güvenlik ayarları eksik.");
      const ip = request.socket.remoteAddress || "unknown";
      const now = Date.now();
      const attempts = adminLoginAttempts.get(ip) || { count: 0, startedAt: now };
      if (now - attempts.startedAt > 15 * 60000) { attempts.count = 0; attempts.startedAt = now; }
      if (attempts.count >= 5) return sendError(response, 429, "ADMIN_LOGIN_BLOCKED", "Çok fazla başarısız giriş. 15 dakika sonra tekrar deneyin.");
      const body = await readBody(request);
      if (String(body.username || "") !== ADMIN_USERNAME || !verifyAdminPassword(body.password)) {
        attempts.count += 1;
        adminLoginAttempts.set(ip, attempts);
        return sendError(response, 401, "ADMIN_LOGIN_FAILED", "Kullanıcı adı veya şifre hatalı.");
      }
      adminLoginAttempts.delete(ip);
      const challengeToken = adminToken("challenge");
      adminChallenges.set(challengeToken, { createdAt: now, attempts: 0 });
      return sendJson(response, 200, { requires2fa: true, challengeToken, message: "Authenticator kodunu girin." });
    }
    if (request.method === "POST" && pathname === "/api/admin/2fa") {
      const body = await readBody(request);
      const challenge = adminChallenges.get(String(body.challengeToken || ""));
      if (!challenge || Date.now() - challenge.createdAt > 5 * 60000) return sendError(response, 401, "ADMIN_CHALLENGE_EXPIRED", "2FA oturumu süresi doldu. Yeniden giriş yapın.");
      if (!verifyTotp(body.code)) {
        challenge.attempts += 1;
        if (challenge.attempts >= 5) adminChallenges.delete(body.challengeToken);
        return sendError(response, 401, "ADMIN_2FA_FAILED", "2FA kodu geçersiz.");
      }
      adminChallenges.delete(body.challengeToken);
      const token = adminToken("session");
      adminSessions.set(token, { username: ADMIN_USERNAME, email: ADMIN_EMAIL, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
      return sendJson(response, 200, { authenticated: true, username: ADMIN_USERNAME, email: ADMIN_EMAIL }, { "Set-Cookie": `cvghost_admin=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800` });
    }
    if (request.method === "POST" && pathname === "/api/admin/logout") {
      const token = cookieValue(request, "cvghost_admin");
      if (token) adminSessions.delete(token);
      return sendJson(response, 200, { loggedOut: true }, { "Set-Cookie": "cvghost_admin=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0" });
    }
    if (pathname.startsWith("/api/admin/")) {
      if (!requireAdmin(request, response)) return;
    }
    const store = readStore();
    if (request.method === "GET" && pathname === "/api/stats") return sendJson(response, 200, buildStats(store));
    if (request.method === "GET" && pathname === "/api/admin/listings") return sendJson(response, 200, { items: buildAdminListings(store), reportCount: store.reports.length });
    const adminDeleteMatch = pathname.match(/^\/api\/admin\/listings\/([^/]+)$/);
    if (request.method === "DELETE" && adminDeleteMatch) {
      const listingIndex = store.listings.findIndex((item) => item.id === adminDeleteMatch[1]);
      if (listingIndex < 0) return sendError(response, 404, "NOT_FOUND", "İlan bulunamadı.");
      const [removed] = store.listings.splice(listingIndex, 1);
      const removedSubmissions = store.submissions.filter((submission) => submission.listingId === removed.id);
      store.submissions = store.submissions.filter((submission) => submission.listingId !== removed.id);
      store.reports = store.reports.filter((report) => report.listingId !== removed.id);
      store.corrections = (store.corrections || []).filter((correction) => correction.listingId !== removed.id);
      for (const submission of removedSubmissions) {
        const storageKey = submission.evidence?.storageKey;
        if (!storageKey || path.basename(storageKey) !== storageKey) continue;
        const evidencePath = path.join(DATA_DIR, "evidence", storageKey);
        if (fs.existsSync(evidencePath)) fs.unlinkSync(evidencePath);
      }
      writeStore(store);
      return sendJson(response, 200, { deleted: true, listingId: removed.id });
    }
    if (request.method === "GET" && pathname === "/api/companies") return sendJson(response, 200, { items: buildCompanyDirectory(store) });
    const companyRoute = pathname.match(/^\/api\/companies\/([^/]+)$/);
    if (request.method === "GET" && companyRoute) {
      const companyKey = decodeURIComponent(companyRoute[1]).toLocaleLowerCase("tr-TR").trim();
      const company = buildCompanyDirectory(store).find((item) => item.name.toLocaleLowerCase("tr-TR").trim() === companyKey);
      if (!company) return sendError(response, 404, "NOT_FOUND", "Şirket bulunamadı.");
      return sendJson(response, 200, { company });
    }
    if (request.method === "GET" && pathname === "/api/recent") {
      const deviceId = requestUrl.searchParams.get("deviceId") || "";
      const items = recentSubmissions(store, deviceId);
      return sendJson(response, 200, { items, total: items.length, mineCount: items.filter((item) => item.isMine).length });
    }

    const confirmMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const pending = pendingPreviews.get(confirmMatch[1]);
      if (!pending) return sendError(response, 404, "PREVIEW_EXPIRED", "Onay bekleyen OCR sonucu bulunamadı. Görseli yeniden yükleyin.");
      const confirmation = await readBody(request);
      const finalBody = { ...pending.body, ...confirmation, deviceId: confirmation.deviceId || pending.body.deviceId, cvViewedStatus: confirmation.cvViewedStatus || pending.body.cvViewedStatus || "UNKNOWN" };
      const result = handleSubmission(store, finalBody);
      writeStore(store);
      pendingPreviews.delete(confirmMatch[1]);
      return sendJson(response, 201, { status: "CONFIRMED", ...result });
    }

    if (request.method === "GET" && pathname === "/api/listings") {
      const query = (requestUrl.searchParams.get("q") || "").toLocaleLowerCase("tr-TR");
      const mode = requestUrl.searchParams.get("mode") || "ALL";
      const items = store.listings
        .map(serializeListing)
        .filter((item) => mode === "ALL" || item.workMode === mode)
        .filter((item) => !query || [item.title, item.company, item.location, item.description].join(" ").toLocaleLowerCase("tr-TR").includes(query))
        .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
      return sendJson(response, 200, { items, total: items.length });
    }

    const listingMatch = pathname.match(/^\/api\/listings\/([^/]+)(?:\/(timeline|verify|corrections|statistics|report))?$/);
    if (listingMatch) {
      const listing = store.listings.find((item) => item.id === listingMatch[1]);
      if (!listing) return sendError(response, 404, "NOT_FOUND", "İlan bulunamadı.");
      const action = listingMatch[2];
      if (request.method === "GET" && !action) return sendJson(response, 200, { listing: serializeListing(listing), timeline: listing.events });
      if (request.method === "GET" && action === "timeline") return sendJson(response, 200, { timeline: listing.events, versions: listing.versions });
      if (request.method === "GET" && action === "statistics") {
        const records = listing.versions.filter((item) => item.salaryMin).map((item) => item.salaryMin);
        return sendJson(response, 200, { versionCount: listing.versions.length, verificationCount: listing.verifications, salaryHistory: records, activeDays: Math.max(1, Math.ceil((Date.now() - new Date(listing.firstSeenAt).getTime()) / 86400000)) });
      }
      if (request.method === "POST" && action === "verify") {
        listing.verifications += 1;
        listing.events.unshift({ id: id("event"), type: "VERIFIED", label: "Topluluk doğrulaması eklendi", at: new Date().toISOString(), detail: "Bir topluluk üyesi mevcut ilan sürümünü doğruladı." });
        writeStore(store);
        return sendJson(response, 200, { listing: serializeListing(listing) });
      }
      if (request.method === "POST" && action === "corrections") {
        const body = await readBody(request);
        const previous = latestVersion(listing);
        const candidate = { ...previous, ...body, description: body.description || previous.description, sourceUrl: body.sourceUrl || previous.sourceUrl };
        const version = createVersion(candidate, null, listing.versions.length + 1);
        const changes = diffVersion(previous, version);
        if (!changes.length) return sendError(response, 409, "CONFLICT", "Yeni bir değişiklik bulunamadı.");
        listing.versions.push(version);
        listing.lastSeenAt = version.observedAt;
        listing.events.unshift({ id: id("event"), type: "CORRECTION", label: "Topluluk düzeltmesi eklendi", at: version.observedAt, detail: changes.map((change) => `${change.label}: ${change.oldValue ?? "—"} → ${change.newValue ?? "—"}`).join(" · ") });
        writeStore(store);
        return sendJson(response, 200, { listing: serializeListing(listing), changes });
      }
      if (request.method === "POST" && action === "report") {
        const body = await readBody(request);
        if (!body.reason || String(body.reason).trim().length < 3) return sendError(response, 422, "VALIDATION_ERROR", "Rapor nedeni gerekli.", { reason: "En az 3 karakter girin." });
        store.reports.push({ id: id("report"), listingId: listing.id, reason: String(body.reason).trim(), details: String(body.details || "").trim(), status: "OPEN", createdAt: new Date().toISOString() });
        writeStore(store);
        return sendJson(response, 201, { accepted: true, message: "Rapor moderasyon kuyruğuna alındı." });
      }
    }

    if (request.method === "POST" && pathname === "/api/submissions") {
      let body;
      try {
        if ((request.headers["content-type"] || "").startsWith("multipart/form-data")) {
          const multipart = await readMultipart(request);
          body = { ...multipart.fields, inputType: multipart.file ? "IMAGE" : "TEXT" };
          if (multipart.file) {
            if (!["image/png", "image/jpeg", "image/webp"].includes(multipart.file.mimeType)) return sendError(response, 415, "UNSUPPORTED_FILE_TYPE", "Şimdilik PNG, JPG ve WEBP görselleri destekleniyor.");
            try {
              body.rawText = await recognizeImage(multipart.file.buffer);
              body.ocrStatus = "COMPLETED";
              body.evidence = multipart.file;
            } catch (error) {
              return sendError(response, 422, "OCR_FAILED", error.message || "Görsel okunamadı.");
            }
          }
        } else {
          body = await readBody(request);
        }
        let extractedCandidate = extractCandidate({ rawText: body.rawText || "", sourceUrl: body.sourceUrl || "" });
        let missingFields = missingCandidateFields(extractedCandidate);
        let sourceDetails = null;
        if (missingFields.length && body.sourceUrl) {
          sourceDetails = await extractPublicJobDetails(body.sourceUrl);
          if (sourceDetails.details) {
            body.rawText = `${body.rawText || ""}\n${sourceText(sourceDetails.details)}`;
            extractedCandidate = extractCandidate({ rawText: body.rawText, sourceUrl: body.sourceUrl });
            missingFields = missingCandidateFields(extractedCandidate);
            body.ocrStatus = "COMPLETED_WITH_LINK_FALLBACK";
          }
        }
        const hasManualFallback = Boolean(body.manualTitle || body.manualCompany || body.manualLocation);
        if (missingFields.length && !hasManualFallback) {
          return sendJson(response, 422, { error: { code: "OCR_INCOMPLETE", message: "OCR ilanı tam okuyamadı. Eksik alanları girip kaynak linkiyle doğrulayın.", missingFields, extracted: { title: extractedCandidate.title, company: extractedCandidate.company, location: extractedCandidate.location } } });
        }
        if (hasManualFallback) {
          if (!body.sourceUrl || !/^https?:\/\//i.test(body.sourceUrl)) return sendError(response, 422, "SOURCE_REQUIRED", "OCR tamamlanamadığında ilanı doğrulamak için kaynak linki gerekli.", { sourceUrl: "Geçerli bir ilan linki girin." });
          body.rawText = `${body.rawText || ""}\nPozisyon: ${body.manualTitle || extractedCandidate.title}\nŞirket: ${body.manualCompany || extractedCandidate.company}\nLokasyon: ${body.manualLocation || extractedCandidate.location}${body.manualSalary ? `\nMaaş: ${body.manualSalary}` : ""}`;
          body.ocrStatus = "COMPLETED_WITH_MANUAL_FALLBACK";
        }
        if (body.sourceUrl) {
          const sourceVerification = await verifySourceUrl(body.sourceUrl);
          body.sourceVerification = { ...sourceVerification, extractedFields: sourceDetails?.details || null };
        }
      } catch (error) { return sendError(response, 413, error.code || "VALIDATION_ERROR", error.message); }
      const fields = validateSubmission(body);
      if (Object.keys(fields).length) return sendError(response, 422, "VALIDATION_ERROR", "Gönderilen veriler geçersiz.", fields);
      const candidate = extractCandidate({ rawText: body.rawText, sourceUrl: body.sourceUrl || "" });
      const match = findBestMatch(candidate, store.listings);
      const applicationInsight = calculateApplicationInsight({ appliedAt: body.appliedAt || candidate.appliedAt, repostedAt: body.repostedAt || candidate.repostedAt, cvViewedStatus: body.cvViewedStatus });
      const previewToken = id("preview");
      pendingPreviews.set(previewToken, { body, createdAt: Date.now() });
      return sendJson(response, 202, { status: "PREVIEW", previewToken, preview: previewCandidate(candidate), applicationInsight, sourceVerification: body.sourceVerification || null, match: { type: match.type, score: match.score, reasons: match.reasons } });
    }
    return sendError(response, 404, "NOT_FOUND", "API endpoint bulunamadı.");
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(response, 403, "FORBIDDEN", "Erişim reddedildi.");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendError(response, 404, "NOT_FOUND", "Sayfa bulunamadı.");
  const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
  response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(error);
    sendError(response, 500, "INTERNAL_ERROR", "Beklenmeyen bir hata oluştu.");
  });
});

if (require.main === module) {
  ensureStore();
  server.listen(PORT, () => console.log(`CV ghostlayanlar http://localhost:${PORT}`));
}

module.exports = { server, seedStore, buildStats };
