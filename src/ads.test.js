const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function browser(config) {
  const events = {};
  const scripts = [];
  const placement = { hidden: true, children: [], append(node) { this.children.push(node); } };
  const page = { ready: "loading", viewHidden: false, modalHidden: true, hasListings: false };
  const window = { addEventListener(name, callback) { events[name] = callback; } };
  const document = {
    body: {},
    documentElement: { dataset: {} },
    head: { append(node) { scripts.push(node); } },
    querySelector(selector) {
      if (selector === "#content-ad") return placement;
      if (selector === "#discover-view") return {
        classList: { contains() { return page.viewHidden; } },
        querySelector() { return page.hasListings ? {} : null; }
      };
      if (selector === "#submit-modal") return { classList: { contains() { return page.modalHidden; } } };
    },
    createElement(tag) {
      return { tag, style: {}, dataset: {}, events: {}, addEventListener(name, callback) { this.events[name] = callback; } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/ads.js"), "utf8"), {
    document, window,
    MutationObserver: class { observe() {} },
    fetch: async () => ({ ok: true, json: async () => config })
  });
  await new Promise(setImmediate);
  function update(values) {
    Object.assign(page, values);
    document.documentElement.dataset.archiveState = page.ready;
    events["cvghost:content-ready"]();
  }
  return { page, window, scripts, placement, update };
}

test("no ad script is requested without an explicitly configured manual unit", async () => {
  const app = await browser({ enabled: false, client: "ca-pub-123", slot: null });
  app.update({ ready: "ready", hasListings: true });
  assert.equal(app.scripts.length, 0);
  assert.equal(app.placement.hidden, true);
});

test("ads require loaded content and stay hidden on errors, empty results, other views and OCR", async () => {
  const app = await browser({ enabled: true, client: "ca-pub-123", slot: "1234567890" });
  for (const ready of ["loading", "error"]) {
    app.update({ ready, hasListings: true });
    assert.equal(app.scripts.length, 0);
  }
  app.update({ ready: "ready", hasListings: false });
  assert.equal(app.scripts.length, 0);
  app.update({ hasListings: true, modalHidden: false });
  assert.equal(app.scripts.length, 0);
  app.update({ modalHidden: true, viewHidden: true });
  assert.equal(app.scripts.length, 0);
  app.update({ viewHidden: false });
  assert.equal(app.scripts.length, 1);
  assert.equal(app.placement.children.length, 1);
  app.update({ modalHidden: false });
  app.scripts[0].events.load();
  assert.equal(app.placement.hidden, true);
  assert.equal(app.window.adsbygoogle, undefined);
  app.update({ modalHidden: true });
  assert.equal(app.window.adsbygoogle.length, 1);
  app.update({ ready: "error" });
  assert.equal(app.placement.hidden, true);
  app.update({ ready: "ready" });
  assert.equal(app.scripts.length, 1);
  assert.equal(app.window.adsbygoogle.length, 1);
});
