const test = require("node:test");
const assert = require("node:assert/strict");
const { publicArchive, emptyArchive } = require("./archive");

test("public archive excludes fixtures without deleting data or real records", () => {
  const demo = { id: "listing_acme_backend" };
  const real = { id: "listing_real" };
  const store = { listings: [demo, real], submissions: [{ listingId: demo.id }, { listingId: real.id }], reports: [], corrections: [] };
  const original = JSON.stringify(store);
  const archive = publicArchive(store);
  assert.deepEqual(archive.listings, [real]);
  assert.equal(archive.listings[0], real);
  assert.deepEqual(archive.submissions, [{ listingId: real.id }]);
  assert.equal(JSON.stringify(store), original);
});

test("new production archives have no fake listings or verifications", () => {
  assert.deepEqual(emptyArchive(), { listings: [], submissions: [], reports: [], corrections: [] });
});
