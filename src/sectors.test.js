const test = require("node:test");
const assert = require("node:assert/strict");
const { classifySector } = require("../public/sectors");
const { sectorArchive } = require("./archive");
const { buildStats } = require("../server");

test("software and design roles stay separate regardless of employer or description", () => {
  for (const title of ["Backend Developer", "Yazılım Geliştirici", "AI Solutions Engineer", "Front-end Developer"]) {
    assert.equal(classifySector({ title }), "SOFTWARE", title);
  }
  for (const title of ["Product Designer", "UI/UX Designer", "Grafik Tasarımcı"]) {
    assert.equal(classifySector({ title, company: "Yazılım A.Ş.", description: "Python software development" }), "DESIGN", title);
  }
  assert.equal(classifySector({ title: "Data Analyst" }), "DATA");
  assert.equal(classifySector({ title: "Mechanical Engineer" }), "ENGINEERING");
  assert.equal(classifySector({ title: "Belirsiz pozisyon" }), "OTHER");
  assert.equal(classifySector({ title: "Product Designer", sector: "SOFTWARE" }), "SOFTWARE");
});

test("sector choice isolates repeated jobs, company rankings, stats and submissions", () => {
  function listing(id, title, count, company = "Ortak Şirket") {
    return { id, status: "ACTIVE", company, verifications: count, contributors: 1,
      versions: Array.from({ length: count }, () => ({ title, company, location: "İstanbul", workMode: "REMOTE" })) };
  }
  const software = listing("software", "Backend Developer", 2);
  const design = listing("design", "Product Designer", 7);
  const designOnly = listing("design-only", "Graphic Designer", 4, "Tasarım Şirketi");
  const store = { listings: [software, design, designOnly], submissions: storeSubmissions(), reports: [], corrections: [] };
  function storeSubmissions() { return [{ listingId: "software" }, { listingId: "design" }]; }
  const filtered = sectorArchive(store, "SOFTWARE");
  const stats = buildStats(filtered);
  assert.deepEqual(filtered.listings.map((item) => item.id), ["software"]);
  assert.deepEqual(filtered.submissions, [{ listingId: "software" }]);
  assert.equal(stats.listingCount, 1);
  assert.equal(stats.verificationCount, 2);
  assert.deepEqual(stats.repeatedJobs.map((item) => item.title), ["Backend Developer"]);
  assert.equal(stats.companyRankings.length, 1);
  assert.equal(stats.companyRankings[0].versions, 2);
  assert.equal(sectorArchive(store, "DESIGN").listings.length, 2);
  assert.equal(sectorArchive(store, "ALL"), store);
  assert.equal(store.listings.length, 3);
});
