const { Pool } = require("pg");

function unavailable(cause) {
  const error = new Error("İlan arşivine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.", { cause });
  error.code = "DATA_UNAVAILABLE";
  return error;
}

function createDatabase(connectionString, PoolClass = Pool) {
  if (!connectionString) return null;
  const pool = new PoolClass({ connectionString, max: 3, connectionTimeoutMillis: 10000, query_timeout: 15000, ssl: { rejectUnauthorized: false } });
  pool.on("error", (error) => console.error("Database idle connection error:", error.code || "UNKNOWN"));
  let ready = null;
  return {
    async query(text, values) {
      try {
        if (!ready) {
          ready = pool.query("CREATE TABLE IF NOT EXISTS cvghost_app_state (id text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())").catch((error) => {
            // A failed startup must not poison this server instance forever.
            ready = null;
            throw error;
          });
        }
        await ready;
        return await pool.query(text, values);
      } catch (error) {
        throw unavailable(error);
      }
    }
  };
}

module.exports = { createDatabase };
