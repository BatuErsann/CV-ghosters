const test = require("node:test");
const assert = require("node:assert/strict");
const { extractCandidate, findBestMatch, parseSalary } = require("./domain");

test("maaş aralığını Türkçe biçimden ayrıştırır", () => {
  assert.deepEqual(parseSalary("80.000 - 100.000 TL / ay"), {
    min: 80000,
    max: 100000,
    currency: "TRY",
    period: "MONTHLY"
  });
});

test("ilan metninden temel alanları çıkarır", () => {
  const candidate = extractCandidate({
    rawText: "Backend Developer\nŞirket: Acme Teknoloji\nLokasyon: İstanbul\nMaaş: 80.000 - 100.000 TL\nHibrit çalışma"
  });
  assert.equal(candidate.title, "Backend Developer");
  assert.equal(candidate.company, "Acme Teknoloji");
  assert.equal(candidate.workMode, "HYBRID");
  assert.equal(candidate.salaryMin, 80000);
});

test("benzer ilanı açıklanabilir skorla bulur", () => {
  const candidate = extractCandidate({
    rawText: "Backend Developer\nŞirket: Acme Teknoloji\nLokasyon: İstanbul\nHibrit çalışma"
  });
  const result = findBestMatch(candidate, [{
    id: "listing-1",
    versions: [{
      title: "Backend Developer",
      company: "Acme Teknoloji",
      location: "İstanbul",
      description: "Backend Developer İstanbul hibrit çalışma",
      salaryMin: 80000,
      salaryMax: 100000
    }]
  }]);
  assert.equal(result.type, "MATCH");
  assert.ok(result.score > 0.75);
  assert.ok(result.reasons.length > 0);
});

test("koyu kariyer ekranı OCR çıktısından ilan alanlarını çıkarır", () => {
  const candidate = extractCandidate({
    rawText: "7° Freya (YC S25)\nAl Solutions Engineer\nIstanbul, Türkiye - 2 days ago - Over 100 applicants\nApplication status\nApplication submitted\n1 day ago\nView resume"
  });
  assert.equal(candidate.title, "AI Solutions Engineer");
  assert.equal(candidate.company, "Freya (YC S25)");
  assert.equal(candidate.location, "Istanbul, Türkiye");
  assert.ok(candidate.appliedAt);
  assert.ok(candidate.repostedAt);
});

test("mobil ilan ekranı ülke lokasyonunu ve hafta tarihini çıkarır", () => {
  const candidate = extractCandidate({
    rawText: "NVI NativeMinds ...\nMobile App Developer\nTürkiye - Reposted 3 days ago - Over 100 applicants\nApplication status\nApplication submitted\n1 week ago"
  });
  assert.equal(candidate.company, "NativeMinds");
  assert.equal(candidate.title, "Mobile App Developer");
  assert.equal(candidate.location, "Türkiye");
  assert.ok(candidate.appliedAt);
  assert.ok(candidate.repostedAt);
});

test("mobil OCR artığını şirket veya maaş sanmaz", () => {
  const candidate = extractCandidate({
    rawText: "Ma #. 20 20\nNVI NativeMinds ...\nMobile App Developer\nTürkiye - Reposted 3 days ago - Over 100 applicants"
  });
  assert.equal(candidate.company, "NativeMinds");
  assert.equal(candidate.salaryMin, null);
});
