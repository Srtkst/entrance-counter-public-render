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

const RECEPTIONS = ["A", "B", "C", "D"];

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entrance_counts (
      visit_date DATE NOT NULL,
      reception TEXT NOT NULL,
      category TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (visit_date, reception, category)
    );
  `);

  await pool.query(`
    ALTER TABLE entrance_counts
    DROP CONSTRAINT IF EXISTS entrance_reception_check;
  `);

  await pool.query(`
    ALTER TABLE entrance_counts
    ADD CONSTRAINT entrance_reception_check
    CHECK (reception IN ('A', 'B', 'C', 'D'));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entrance_counts_date
    ON entrance_counts (visit_date DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entrance_reception_settings (
      visit_date DATE NOT NULL,
      reception TEXT NOT NULL CHECK (
        reception IN ('A', 'B', 'C', 'D')
      ),
      include_in_hq BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (visit_date, reception)
    );
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
  // 人数取得
  const result = await pool.query(
    `SELECT reception, category, count
    FROM entrance_counts
    WHERE visit_date = $1`,
    [date]
  );

  // 本部集計設定取得
  const settingsResult = await pool.query(
    `SELECT reception, include_in_hq
    FROM entrance_reception_settings
    WHERE visit_date = $1`,
    [date]
  );

  // A～Dの人数データ
  const receptions = {};

  for (const reception of RECEPTIONS) {
    receptions[reception] = {
      counts: blankCounts(),
      total: 0,
      includeInHQ: true
    };
  }

  // 人数を格納
  for (const row of result.rows) {
    if (!RECEPTIONS.includes(row.reception)) continue;
    if (!CATEGORIES.includes(row.category)) continue;

    receptions[row.reception].counts[row.category] =
      Number(row.count);
  }

  // 本部集計設定を格納
  for (const row of settingsResult.rows) {
    if (!RECEPTIONS.includes(row.reception)) continue;

    receptions[row.reception].includeInHQ =
      row.include_in_hq;
  }

  // 各受付の合計
  for (const reception of RECEPTIONS) {
    receptions[reception].total =
      totalOf(receptions[reception].counts);
  }

  // 本部集計
  const hqCombined = blankCounts();
  let hqTotal = 0;

  for (const reception of RECEPTIONS) {
    const data = receptions[reception];

    if (!data.includeInHQ) {
      continue;
    }

    hqTotal += data.total;

    for (const category of CATEGORIES) {
      hqCombined[category] +=
        Number(data.counts[category] || 0);
    }
  }

  return {
    date,

    receptions,

    hq: {
      total: hqTotal,
      combined: hqCombined
    }
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

async function changeReceptionSetting(date, reception, includeInHQ) {
  await pool.query(
    `INSERT INTO entrance_reception_settings
      (visit_date, reception, include_in_hq, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (visit_date, reception)
      DO UPDATE SET
        include_in_hq = EXCLUDED.include_in_hq,
        updated_at = NOW()`,
    [date, reception, includeInHQ]
  );
}

async function getHistory() {
  const result = await pool.query(`
    SELECT DISTINCT visit_date::text AS date
    FROM entrance_counts
    ORDER BY date DESC
  `);

  const history = [];

  for (const row of result.rows) {
    const day = await getDay(row.date);

    history.push({
      date: row.date,

      receptions: {
        A: {
          total: day.receptions.A.total,
          includeInHQ: day.receptions.A.includeInHQ
        },
        B: {
          total: day.receptions.B.total,
          includeInHQ: day.receptions.B.includeInHQ
        },
        C: {
          total: day.receptions.C.total,
          includeInHQ: day.receptions.C.includeInHQ
        },
        D: {
          total: day.receptions.D.total,
          includeInHQ: day.receptions.D.includeInHQ
        }
      },

      hqTotal: day.hq.total
    });
  }

  return history;
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

    if (req.method === "POST" && pathname === "/api/reception-setting") {
      const body = await readJson(req);
      const {
        date,
        reception,
        includeInHQ
      } = body;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
        return sendJson(res, 400, {
          error: "Invalid date"
        });
      }

      if (!RECEPTIONS.includes(reception)) {
        return sendJson(res, 400, {
          error: "Invalid reception"
        });
      }

      if (typeof includeInHQ !== "boolean") {
        return sendJson(res, 400, {
          error: "Invalid includeInHQ"
        });
      }

      await changeReceptionSetting(
        date,
        reception,
        includeInHQ
      );

      return sendJson(
        res,
        200,
        await getDay(date)
      );
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
