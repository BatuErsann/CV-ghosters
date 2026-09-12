const FIELD_LABELS = {
  title: "Pozisyon",
  company: "Şirket",
  location: "Lokasyon",
  workMode: "Çalışma modeli",
  employmentType: "İstihdam tipi",
  salary: "Maaş"
};

function normalizeText(value = "") {
  return String(value)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 1));
}

function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / new Set([...left, ...right]).size;
}

function canonicalCompany(value = "") {
  return value
    .replace(/\b(inc|ltd|limited|a\.s\.|aş|anonim şirketi|şirketi)\b/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function parseSalary(value = "") {
  const text = String(value).replace(/\s/g, "");
  const matches = [...text.matchAll(/(\d[\d.,]*)(k|bin)?/gi)]
    .map((match) => {
      let raw = match[1].replace(/\./g, "").replace(/,/g, "");
      let amount = Number(raw);
      if (match[2]?.toLocaleLowerCase("tr-TR") === "k") amount *= 1000;
      if (match[2]?.toLocaleLowerCase("tr-TR") === "bin") amount *= 1000;
      return amount;
    })
    .filter((amount) => amount >= 1000 && amount <= 10000000);

  if (!matches.length) return null;
  return {
    min: matches[0],
    max: matches[1] || matches[0],
    currency: /eur|€/.test(text.toLocaleLowerCase("tr-TR")) ? "EUR" : /usd|\$/.test(text.toLocaleLowerCase("tr-TR")) ? "USD" : "TRY",
    period: /ay|month/i.test(value) ? "MONTHLY" : "YEARLY"
  };
}

function inferWorkMode(text) {
  const normalized = normalizeText(text);
  if (/remote|uzaktan|tamamen evden/.test(normalized)) return "REMOTE";
  if (/hibrit|hybrid/.test(normalized)) return "HYBRID";
  if (/ofis|onsite|yerinde/.test(normalized)) return "ONSITE";
  return "UNSPECIFIED";
}

function inferEmploymentType(text) {
  const normalized = normalizeText(text);
  if (/part time|yari zamanli/.test(normalized)) return "PART_TIME";
  if (/freelance|serbest/.test(normalized)) return "CONTRACT";
  if (/staj|intern/.test(normalized)) return "INTERN";
  return "FULL_TIME";
}

function findLabeledValue(text, labels) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)`, "i");
  return text.match(pattern)?.[1]?.split(/\r?\n/)[0].trim() || "";
}

function parseDateValue(value) {
  const text = String(value || "").trim();
  const iso = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const local = text.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : local ? [Number(local[3]), Number(local[2]), Number(local[1])] : null;
  if (!parts) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRelativeDate(value) {
  const match = String(value || "").match(/(\d+)\s+(days?|weeks?)\s+ago/i);
  if (!match) return null;
  const days = match[2].toLocaleLowerCase("en-US").startsWith("week") ? Number(match[1]) * 7 : Number(match[1]);
  return new Date(Date.now() - days * 86400000).toISOString();
}

function extractScreenshotSignals(lines) {
  const cleaned = lines.map((line) => /^\d+\s+(days?|weeks?)\s+ago/i.test(line) ? line.trim() : line.replace(/^[^\p{L}]+/u, "").trim()).filter(Boolean);
  const titleIndex = cleaned.findIndex((line) => /\b(engineer|developer|designer|analyst|manager|architect|scientist|specialist|intern)\b/i.test(line));
  const title = titleIndex >= 0 ? cleaned[titleIndex].replace(/^Al\b/i, "AI") : "";
  const company = titleIndex > 0 ? (cleaned.slice(0, titleIndex).find((line) => looksLikeCompanyLine(line) && !/premium|practice|application|promoted/i.test(line)) || "").replace(/\.{2,}$/g, "").replace(/^[A-Z]{2,3}\s+(?=[A-Z][a-z])/i, "").trim() : "";
  const locationLine = cleaned.find((line) => /^(istanbul|ankara|izmir|türkiye|turkiye|london|berlin|paris)\b/i.test(line) || /,\s*(turkiye|türkiye|uk|usa|germany|almanya|france|fransa)\b/i.test(line));
  const location = locationLine ? locationLine.split(/\s+-\s+/)[0].trim() : "";
  const applicationIndex = cleaned.findIndex((line) => /application submitted/i.test(line));
  const applicationLine = applicationIndex >= 0 ? cleaned.slice(applicationIndex, applicationIndex + 3).join(" ") : "";
  return {
    title,
    company,
    location,
    appliedAt: parseRelativeDate(applicationLine),
    repostedAt: parseRelativeDate(locationLine || cleaned.find((line) => /posted|reposted/i.test(line)) || "")
  };
}

function looksLikeCompanyLine(line) {
  const letters = (line.match(/\p{L}/gu) || []).length;
  const digits = (line.match(/\d/g) || []).length;
  return letters >= 4 && digits <= letters;
}

function extractCandidate({ rawText = "", sourceUrl = "" }) {
  const cleanText = String(rawText).trim();
  const lines = cleanText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const visual = extractScreenshotSignals(lines);
  const title = findLabeledValue(cleanText, ["pozisyon", "position", "title"]) || visual.title || lines[0] || "Belirsiz pozisyon";
  const company = findLabeledValue(cleanText, ["şirket", "sirket", "company", "firma"]) || visual.company || "Topluluk kaynağı";
  const location = findLabeledValue(cleanText, ["lokasyon", "location", "şehir", "sehir"]) || visual.location || "Belirtilmemiş";
  const salaryText = findLabeledValue(cleanText, ["maaş", "maas", "salary", "ücret", "ucret"]);
  const salary = parseSalary(salaryText || (/\b(?:TL|TRY|USD|EUR|GBP|dolar|euro|€|\$)\b/i.test(cleanText) ? cleanText : ""));
  const appliedAt = parseDateValue(findLabeledValue(cleanText, ["başvuru tarihi", "basvuru tarihi", "applied at", "application date"])) || visual.appliedAt;
  const repostedAt = parseDateValue(findLabeledValue(cleanText, ["yeniden yayınlandı", "yeniden yayinlandi", "yeniden yayın", "yeniden yayin", "repost tarihi", "reposted", "ilan tarihi", "posted"])) || visual.repostedAt;

  return {
    title,
    company,
    location,
    workMode: inferWorkMode(cleanText),
    employmentType: inferEmploymentType(cleanText),
    salaryMin: salary?.min || null,
    salaryMax: salary?.max || null,
    salaryCurrency: salary?.currency || null,
    salaryPeriod: salary?.period || null,
    appliedAt,
    repostedAt,
    description: cleanText,
    sourceUrl: sourceUrl.trim(),
    normalizedTitle: normalizeText(title),
    normalizedCompany: normalizeText(canonicalCompany(company))
  };
}

function scoreMatch(candidate, listing) {
  const latest = listing.versions?.[listing.versions.length - 1] || listing;
  const companyScore = similarity(candidate.company, latest.company);
  const titleScore = similarity(candidate.title, latest.title);
  const locationScore = similarity(candidate.location, latest.location);
  const descriptionScore = similarity(candidate.description, latest.description);
  const score = companyScore * 0.35 + titleScore * 0.3 + locationScore * 0.1 + descriptionScore * 0.25;
  const reasons = [];
  if (companyScore >= 0.99) reasons.push({ label: "Şirket adı aynı", points: 0.35 });
  else if (companyScore >= 0.5) reasons.push({ label: "Şirket adı benzer", points: companyScore * 0.35 });
  if (titleScore >= 0.7) reasons.push({ label: "Pozisyon başlığı yüksek benzerlikte", points: titleScore * 0.3 });
  if (locationScore >= 0.5) reasons.push({ label: "Lokasyon eşleşiyor", points: locationScore * 0.1 });
  if (descriptionScore >= 0.35) reasons.push({ label: "İlan metninin ana bölümleri benzer", points: descriptionScore * 0.2 });
  if (candidate.salaryMin !== latest.salaryMin || candidate.salaryMax !== latest.salaryMax) {
    reasons.push({ label: "Maaş bilgisi farklı olabilir", points: -0.04 });
  }
  return { score: Number(score.toFixed(3)), reasons };
}

function findBestMatch(candidate, listings) {
  const ranked = listings
    .map((listing) => ({ listing, ...scoreMatch(candidate, listing) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.45) return { type: "NEW", score: best?.score || 0, reasons: best?.reasons || [] };
  return {
    type: best.score >= 0.75 ? "MATCH" : "REVIEW",
    listing: best.listing,
    score: best.score,
    reasons: best.reasons
  };
}

function diffVersion(previous, next) {
  const fields = ["title", "company", "location", "workMode", "employmentType", "salaryMin", "salaryMax", "salaryCurrency"];
  return fields
    .filter((field) => previous[field] !== next[field])
    .map((field) => ({ field, label: FIELD_LABELS[field] || field, oldValue: previous[field] ?? null, newValue: next[field] ?? null }));
}

module.exports = {
  FIELD_LABELS,
  normalizeText,
  canonicalCompany,
  parseSalary,
  parseDateValue,
  extractCandidate,
  scoreMatch,
  findBestMatch,
  diffVersion
};
