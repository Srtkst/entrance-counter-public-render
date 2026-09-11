const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

const CATEGORIES = [
  "未就学児",
  "小学生",
  "中学生",
  "高校生",
  "在校生1年",
  "在校生2年",
  "在校生3,4年",
  "保護者",
  "地域の人",
  "その他"
];

const RECEPTIONS = ["A", "B"];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entrance_counts (
      visit_date DATE NOT NULL,
      reception TEXT NOT NULL CHECK (reception IN ('A', 'B')),
      category TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (visit_date, reception, category)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entrance_counts_date
    ON entrance_counts (visit_date DESC);
  `);

  console.log("Database ready.");
}

function blankCounts() {
  return Object.fromEntries(CATEGORIES.map(c => [c, 0]));
}

function totalOf(counts) {
  return CATEGORIES.reduce((sum, c) => sum + Number(counts[c] || 0), 0);
}

function combinedCounts(a, b) {
  return Object.fromEntries(
    CATEGORIES.map(c => [c, Number(a[c] || 0) + Number(b[c] || 0)])
  );
}

async function getDay(date) {
  const result = await pool.query(
    `SELECT reception, category, count
     FROM entrance_counts
     WHERE visit_date = $1`,
    [date]
  );

  const A = blankCounts();
  const B = blankCounts();

  for (const row of result.rows) {
    if (!RECEPTIONS.includes(row.reception)) continue;
    if (!CATEGORIES.includes(row.category)) continue;
    if (row.reception === "A") A[row.category] = Number(row.count);
    if (row.reception === "B") B[row.category] = Number(row.count);
  }

  return {
    date,
    A,
    B,
    totals: {
      A: totalOf(A),
      B: totalOf(B),
      all: totalOf(A) + totalOf(B)
    },
    combined: combinedCounts(A, B)
  };
}

async function changeCount(date, reception, category, amount) {
  if (amount === 1) {
    await pool.query(
      `INSERT INTO entrance_counts
        (visit_date, reception, category, count, updated_at)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (visit_date, reception, category)
       DO UPDATE SET
         count = entrance_counts.count + 1,
         updated_at = NOW()`,
      [date, reception, category]
    );
  } else {
    await pool.query(
      `INSERT INTO entrance_counts
        (visit_date, reception, category, count, updated_at)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT (visit_date, reception, category)
       DO UPDATE SET
         count = GREATEST(entrance_counts.count - 1, 0),
         updated_at = NOW()`,
      [date, reception, category]
    );
  }
}

async function getHistory() {
  const result = await pool.query(`
    SELECT
      visit_date::text AS date,
      COALESCE(SUM(count) FILTER (WHERE reception = 'A'), 0)::int AS "A",
      COALESCE(SUM(count) FILTER (WHERE reception = 'B'), 0)::int AS "B",
      COALESCE(SUM(count), 0)::int AS "all"
    FROM entrance_counts
    GROUP BY visit_date
    ORDER BY visit_date DESC
  `);

  return result.rows;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requested);

  if (!filePath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not Found" : "Server Error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": filePath.endsWith(".html") ? "no-store" : "public, max-age=300"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/api/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/day") {
      const date = url.searchParams.get("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
        return sendJson(res, 400, { error: "Invalid date" });
      }
      return sendJson(res, 200, await getDay(date));
    }

    if (req.method === "GET" && pathname === "/api/history") {
      return sendJson(res, 200, { history: await getHistory() });
    }

    if (req.method === "POST" && pathname === "/api/change") {
      const body = await readJson(req);
      const { date, reception, category, amount } = body;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
        return sendJson(res, 400, { error: "Invalid date" });
      }
      if (!RECEPTIONS.includes(reception)) {
        return sendJson(res, 400, { error: "Invalid reception" });
      }
      if (!CATEGORIES.includes(category)) {
        return sendJson(res, 400, { error: "Invalid category" });
      }
      if (![1, -1].includes(amount)) {
        return sendJson(res, 400, { error: "Invalid amount" });
      }

      await changeCount(date, reception, category, amount);
      return sendJson(res, 200, await getDay(date));
    }

    serveStatic(res, pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

initDb()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on 0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
