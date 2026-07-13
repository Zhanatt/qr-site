const express = require("express");
const path = require("path");

// Пароль для страницы Джипар. Можно переопределить через переменную окружения.
const JIPAR_PASSWORD = process.env.JIPAR_PASSWORD || "jipar2026";

// Создаём таблицу при старте
async function initDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      sizes TEXT,
      color TEXT,
      note TEXT,
      photo TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
  `);
  console.log("DB готова");
}

// Собираем Express-приложение с переданным пулом БД
function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  // Проверка пароля Джипар
  function checkAuth(req, res, next) {
    const pass = req.headers["x-jipar-pass"] || req.query.pass;
    if (pass === JIPAR_PASSWORD) return next();
    return res.status(401).json({ error: "Неверный пароль" });
  }

  // --- API ---

  // Фронтмен подаёт заявку
  app.post("/api/orders", async (req, res) => {
    try {
      const { type, name, sizes, color, note, photo } = req.body;
      if (!type || !name || !name.trim()) {
        return res.status(400).json({ error: "Укажите тип и название товара" });
      }
      const result = await pool.query(
        `INSERT INTO orders (type, name, sizes, color, note, photo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [type, name.trim(), sizes || null, color || null, note || null, photo || null]
      );
      res.json({ ok: true, id: result.rows[0].id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Ошибка сервера" });
    }
  });

  // Джипар входит (проверка пароля)
  app.post("/api/login", (req, res) => {
    if (req.body.pass === JIPAR_PASSWORD) return res.json({ ok: true });
    return res.status(401).json({ error: "Неверный пароль" });
  });

  // Джипар смотрит заказы (активные / выполненные)
  app.get("/api/orders", checkAuth, async (req, res) => {
    try {
      const status = req.query.status === "done" ? "done" : "active";
      const result = await pool.query(
        `SELECT id, type, name, sizes, color, note, photo, status, created_at, completed_at
         FROM orders WHERE status = $1 ORDER BY created_at DESC`,
        [status]
      );
      res.json(result.rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Ошибка сервера" });
    }
  });

  // Джипар отмечает заказ выполненным
  app.post("/api/orders/:id/complete", checkAuth, async (req, res) => {
    try {
      await pool.query(
        `UPDATE orders SET status = 'done', completed_at = now() WHERE id = $1`,
        [req.params.id]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Ошибка сервера" });
    }
  });

  return app;
}

module.exports = { createApp, initDb };

// Запуск в продакшене (не при импорте для тестов)
if (require.main === module) {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
  });

  const PORT = process.env.PORT || 3000;
  initDb(pool)
    .then(() => {
      const app = createApp(pool);
      app.listen(PORT, () => console.log("Сервер запущен на порту " + PORT));
    })
    .catch((e) => {
      console.error("Не удалось инициализировать БД:", e);
      process.exit(1);
    });
}
