const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("./database");

test("paused database can recover in the same server instance", async () => {
  let attempts = 0;
  class RecoveringPool {
    on() {}
    async query(text) {
      if (text.startsWith("CREATE TABLE") && ++attempts === 1) {
        throw Object.assign(new Error("tenant not found"), { code: "XX000" });
      }
      return { rows: [{ ok: 1 }] };
    }
  }
  const database = createDatabase("test", RecoveringPool);
  await assert.rejects(database.query("SELECT 1"), { code: "DATA_UNAVAILABLE" });
  assert.deepEqual((await database.query("SELECT 1")).rows, [{ ok: 1 }]);
  assert.equal(attempts, 2);
});

test("concurrent requests share database setup and query failures stay recoverable", async () => {
  let setups = 0;
  let paused = false;
  class CountingPool {
    on() {}
    async query(text) {
      if (text.startsWith("CREATE TABLE")) { setups += 1; return { rows: [] }; }
      if (paused) throw Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
      return { rows: [{ ok: 1 }] };
    }
  }
  const database = createDatabase("test", CountingPool);
  await Promise.all([database.query("SELECT 1"), database.query("SELECT 1")]);
  assert.equal(setups, 1);
  paused = true;
  await assert.rejects(database.query("SELECT 1"), { code: "DATA_UNAVAILABLE" });
  paused = false;
  assert.equal((await database.query("SELECT 1")).rows[0].ok, 1);
});
