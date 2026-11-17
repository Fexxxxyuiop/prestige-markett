
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Telegram-Init-Data",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

const fail = (message, status = 400) =>
  json({ ok: false, error: message }, status);

const categories = [
  { id: "gifts", name: "NFT Gifts", icon: "🎁" },
  { id: "usernames", name: "Usernames", icon: "👤" },
  { id: "numbers", name: "Numbers", icon: "📱" },
  { id: "stars", name: "Telegram Stars", icon: "⭐" },
  { id: "premium", name: "Telegram Premium", icon: "💎" }
];

const ADMIN_STATUSES = [
  "pending", "processing", "completed", "cancelled"
];

async function verifyTelegram(initData, token) {
  if (!initData || !token) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const dataCheck = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const encoder = new TextEncoder();

    const secretKey = await crypto.subtle.importKey(
      "raw", encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );

    const secret = await crypto.subtle.sign(
      "HMAC", secretKey, encoder.encode(token)
    );

    const key = await crypto.subtle.importKey(
      "raw", secret,
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC", key, encoder.encode(dataCheck)
    );

    const calculated = [...new Uint8Array(signature)]
      .map(x => x.toString(16).padStart(2, "0"))
      .join("");

    if (calculated !== hash) return null;

    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

    const user = JSON.parse(params.get("user") || "null");
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function getUser(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  const telegramUser = await verifyTelegram(initData, env.BOT_TOKEN);

  if (!telegramUser) return null;

  await env.DB.prepare(`
    INSERT INTO users
      (telegram_id, username, first_name, last_name, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    String(telegramUser.id),
    telegramUser.username || null,
    telegramUser.first_name || "",
    telegramUser.last_name || null
  ).run();

  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  ).bind(String(telegramUser.id)).first();

  return user && !user.is_blocked ? user : null;
}

async function requireAdmin(request, env) {
  const user = await getUser(request, env);
  if (!user) return null;

  const admins = String(env.ADMIN_IDS || "")
    .split(",").map(x => x.trim()).filter(Boolean);

  return admins.includes(String(user.telegram_id)) ? user : null;
}

function makePublicId() {
  return "PM-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

async function audit(env, admin, action, type, id, details = {}) {
  await env.DB.prepare(`
    INSERT INTO admin_audit
      (admin_telegram_id, action, entity_type, entity_id, details_json)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    String(admin.telegram_id), action, type,
    String(id || ""), JSON.stringify(details)
  ).run();
}

async function telegramCall(env, method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );
  return response.json();
}

async function handleTelegramUpdate(update, env) {
  const message = update?.message;
  if (!message?.text || !message?.chat?.id) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === "/start" || text.startsWith("/start ")) {
    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "✦ Открыть Prestige Market",
            web_app: {
              url: "https://prestige-markett.rtmzakarin.workers.dev/"
            }
          }
        ],
        [
          {
            text: "✉ Связаться с менеджером",
            url: "https://t.me/PrestigeMarketSupport"
          }
        ]
      ]
    };

    await telegramCall(env, "sendMessage", {
      chat_id: chatId,
      text:
        "✦ PRESTIGE MARKET\n\n" +
        "Добро пожаловать!\n\n" +
        "Здесь представлены цифровые товары и коллекции.\n" +
        "Откройте каталог или свяжитесь с менеджером.",
      reply_markup: keyboard
    });
  }
}

async function handle(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  // TELEGRAM BOT WEBHOOK
  if (path === "/telegram/webhook" && method === "POST") {
    if (!env.BOT_TOKEN) {
      return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
    }

    if (env.WEBHOOK_SECRET) {
      const secret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token"
      );

      if (secret !== env.WEBHOOK_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
    }

    try {
      const update = await request.json();
      await handleTelegramUpdate(update, env);
      return json({ ok: true });
    } catch (error) {
      return json({ ok: false, error: "Telegram update failed" }, 500);
    }
  }


  if (!env.DB) return fail("D1 binding DB is missing", 500);

  if (path === "/" || path === "/health") {
    return json({
      ok: true,
      service: "Prestige Market API",
      time: new Date().toISOString()
    });
  }

  // PUBLIC CATALOG

  if (path === "/api/categories" && method === "GET") {
    return json({ ok: true, categories });
  }

  if (path === "/api/listings" && method === "GET") {
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("q");

    let sql = `
      SELECT id, category, category_id, title, description,
        price, currency, image_url, media_json,
        price_day, price_week, price_month, fixed_price,
        min_days, max_days, fulfillment_mode,
        public_identifier, is_featured, created_at
      FROM listings
      WHERE is_active = 1 AND status = 'active'
    `;

    const values = [];

    if (category) {
      sql += " AND (category = ? OR category_id = ?)";
      values.push(category, category);
    }

    if (search) {
      sql += " AND (title LIKE ? OR description LIKE ?)";
      values.push(`%${search}%`, `%${search}%`);
    }

    sql += " ORDER BY is_featured DESC, id DESC LIMIT 100";

    const result = await env.DB.prepare(sql).bind(...values).all();

    return json({ ok: true, listings: result.results || [] });
  }

  // STARS AND PREMIUM PRICES

  if (path === "/api/prices/stars" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT * FROM stars_prices
      WHERE is_active = 1
      ORDER BY stars_amount ASC
    `).all();

    return json({ ok: true, prices: result.results || [] });
  }

  if (path === "/api/prices/premium" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT * FROM premium_prices
      WHERE is_active = 1
      ORDER BY duration_months ASC
    `).all();

    return json({ ok: true, prices: result.results || [] });
  }

  // USER PROFILE

  if (path === "/api/me" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Telegram authorization required", 401);

    const admins = String(env.ADMIN_IDS || "")
      .split(",").map(x => x.trim());

    return json({
      ok: true,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        is_admin: admins.includes(String(user.telegram_id))
      }
    });
  }

  // FAVORITES

  if (path === "/api/favorites" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const result = await env.DB.prepare(`
      SELECT l.*
      FROM favorites f
      JOIN listings l ON l.id = f.listing_id
      WHERE (f.user_id = ? OR f.telegram_id = ?)
        AND l.is_active = 1
      ORDER BY f.id DESC
    `).bind(user.id, user.telegram_id).all();

    return json({ ok: true, favorites: result.results || [] });
  }

  if (path === "/api/favorites" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const body = await request.json();
    const id = Number(body.listing_id);

    if (!Number.isInteger(id) || id < 1) {
      return fail("Invalid listing_id");
    }

    const listing = await env.DB.prepare(
      "SELECT id FROM listings WHERE id = ? AND is_active = 1"
    ).bind(id).first();

    if (!listing) return fail("Listing not found", 404);

    await env.DB.prepare(`
      INSERT OR IGNORE INTO favorites (telegram_id, user_id, listing_id)
      VALUES (?, ?, ?)
    `).bind(user.telegram_id, user.id, id).run();

    return json({ ok: true });
  }

  if (path === "/api/favorites" && method === "DELETE") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const id = Number(url.searchParams.get("listing_id"));
    if (!Number.isInteger(id) || id < 1) return fail("Invalid listing_id");

    await env.DB.prepare(`
      DELETE FROM favorites
      WHERE listing_id = ? AND (user_id = ? OR telegram_id = ?)
    `).bind(id, user.id, user.telegram_id).run();

    return json({ ok: true });
  }

  // USER ORDERS

  if (path === "/api/orders" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const result = await env.DB.prepare(`
      SELECT o.*, l.title AS listing_title, l.image_url
      FROM orders o
      LEFT JOIN listings l ON l.id = o.listing_id
      WHERE o.user_id = ? OR o.telegram_id = ?
      ORDER BY o.id DESC
    `).bind(user.id, user.telegram_id).all();

    return json({ ok: true, orders: result.results || [] });
  }

  if (path === "/api/orders" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const body = await request.json();
    const id = Number(body.listing_id);
    const term = Math.max(1, Math.min(365, Number(body.term_days || 1)));

    if (!Number.isInteger(id) || id < 1) {
      return fail("Invalid listing_id");
    }

    const listing = await env.DB.prepare(`
      SELECT * FROM listings
      WHERE id = ? AND is_active = 1 AND status = 'active'
    `).bind(id).first();

    if (!listing) return fail("Listing unavailable", 404);

    if (term < Number(listing.min_days || 1) ||
        term > Number(listing.max_days || 365)) {
      return fail("Invalid rental term");
    }

    let amount = Number(listing.fixed_price ?? listing.price ?? 0);

    if (listing.price_day != null) {
      amount = Number(listing.price_day) * term;
    } else if (listing.price_week != null && term >= 7) {
      amount = Number(listing.price_week) * Math.ceil(term / 7);
    } else if (listing.price_month != null && term >= 30) {
      amount = Number(listing.price_month) * Math.ceil(term / 30);
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return fail("Invalid listing price");
    }

    const publicId = makePublicId();

    const result = await env.DB.prepare(`
      INSERT INTO orders (
        public_id, user_id, telegram_id, listing_id,
        category, term_days, amount, currency, status,
        fulfillment_mode, idempotency_key, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      publicId, user.id, user.telegram_id, id,
      listing.category || listing.category_id, term,
      amount, listing.currency || "USD",
      listing.fulfillment_mode || "manual",
      String(body.idempotency_key || crypto.randomUUID())
    ).run();

    return json({
      ok: true,
      order_id: result.meta?.last_row_id,
      public_id: publicId,
      amount,
      currency: listing.currency || "USD",
      status: "pending"
    }, 201);
  }

  // ADMIN AUTHORIZATION

  if (path.startsWith("/api/admin/")) {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);

    // DASHBOARD STATS

    if (path === "/api/admin/stats" && method === "GET") {
      const [users, listings, orders, pending] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM listings").first(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first(),
        env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").first()
      ]);

      return json({
        ok: true,
        stats: {
          users: users?.n || 0,
          listings: listings?.n || 0,
          orders: orders?.n || 0,
          pending_orders: pending?.n || 0
        }
      });
    }

    // ALL LISTINGS FOR ADMIN

    if (path === "/api/admin/listings" && method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM listings ORDER BY id DESC LIMIT 300"
      ).all();

      return json({ ok: true, listings: result.results || [] });
    }

    // CREATE LISTING

    if (path === "/api/admin/listings" && method === "POST") {
      const body = await request.json();
      const category = String(body.category || body.category_id || "");
      const title = String(body.title || "").trim();

      if (!categories.some(x => x.id === category)) {
        return fail("Invalid category");
      }

      if (!title || title.length > 150) return fail("Invalid title");

      const price = Number(body.price || 0);
      if (!Number.isFinite(price) || price < 0) return fail("Invalid price");

      const result = await env.DB.prepare(`
        INSERT INTO listings (
          category_id, category, title, description, price,
          currency, image_url, status, is_active, is_featured,
          media_json, price_day, price_week, price_month,
          fixed_price, min_days, max_days, fulfillment_mode,
          public_identifier
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        category, category, title,
        String(body.description || ""),
        price,
        String(body.currency || "USD"),
        String(body.image_url || ""),
        body.is_featured ? 1 : 0,
        JSON.stringify(Array.isArray(body.media) ? body.media : []),
        body.price_day == null ? null : Number(body.price_day),
        body.price_week == null ? null : Number(body.price_week),
        body.price_month == null ? null : Number(body.price_month),
        body.fixed_price == null ? null : Number(body.fixed_price),
        Math.max(1, Number(body.min_days || 1)),
        Math.max(1, Number(body.max_days || 365)),
        String(body.fulfillment_mode || "manual"),
        body.public_identifier ? String(body.public_identifier) : null
      ).run();

      const id = result.meta?.last_row_id;

      await audit(env, admin, "create", "listing", id, { title, category });

      return json({ ok: true, listing_id: id }, 201);
    }

    // UPDATE LISTING

    const listingMatch = path.match(/^\/api\/admin\/listings\/(\d+)$/);

    if (listingMatch && method === "PATCH") {
      const id = Number(listingMatch[1]);
      const body = await request.json();

      const fields = {
        title: body.title,
        description: body.description,
        price: body.price,
        currency: body.currency,
        image_url: body.image_url,
        is_active: body.is_active == null ? null : (body.is_active ? 1 : 0),
        is_featured: body.is_featured == null ? null : (body.is_featured ? 1 : 0),
        status: body.status,
        public_identifier: body.public_identifier
      };

      const allowedFields = Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null);

      if (!allowedFields.length) return fail("No fields to update");

      const assignments = allowedFields.map(([key]) => `${key} = ?`).join(", ");
      const values = allowedFields.map(([, value]) => value);

      await env.DB.prepare(
        `UPDATE listings SET ${assignments} WHERE id = ?`
      ).bind(...values, id).run();

      await audit(env, admin, "update", "listing", id, body);

      return json({ ok: true });
    }

    // DELETE LISTING (SOFT DELETE)

    if (listingMatch && method === "DELETE") {
      const id = Number(listingMatch[1]);

      await env.DB.prepare(`
        UPDATE listings
        SET is_active = 0, status = 'deleted'
        WHERE id = ?
      `).bind(id).run();

      await audit(env, admin, "delete", "listing", id);

      return json({ ok: true });
    }

    // ADMIN ORDERS

    if (path === "/api/admin/orders" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT o.*, u.username, u.first_name,
               l.title AS listing_title
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN listings l ON l.id = o.listing_id
        ORDER BY o.id DESC LIMIT 300
      `).all();

      return json({ ok: true, orders: result.results || [] });
    }

    const orderMatch = path.match(/^\/api\/admin\/orders\/(\d+)\/status$/);

    if (orderMatch && method === "PATCH") {
      const id = Number(orderMatch[1]);
      const body = await request.json();

      if (!ADMIN_STATUSES.includes(body.status)) {
        return fail("Invalid status");
      }

      await env.DB.prepare(`
        UPDATE orders
        SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        body.status,
        String(body.admin_note || ""),
        id
      ).run();

      await audit(env, admin, "update_status", "order", id, {
        status: body.status
      });

      return json({ ok: true });
    }

    // UPDATE STARS PRICE

    const starsMatch = path.match(/^\/api\/admin\/prices\/stars\/(\d+)$/);

    if (starsMatch && method === "PATCH") {
      const id = Number(starsMatch[1]);
      const body = await request.json();

      const price = Number(body.price_usd);
      if (!Number.isFinite(price) || price < 0) return fail("Invalid price");

      await env.DB.prepare(`
        UPDATE stars_prices
        SET price_usd = ?, is_active = ?
        WHERE id = ?
      `).bind(
        price,
        body.is_active === false ? 0 : 1,
        id
      ).run();

      await audit(env, admin, "update_price", "stars", id, body);

      return json({ ok: true });
    }

    // UPDATE PREMIUM PRICE

    const premiumMatch = path.match(/^\/api\/admin\/prices\/premium\/(\d+)$/);

    if (premiumMatch && method === "PATCH") {
      const id = Number(premiumMatch[1]);
      const body = await request.json();

      const price = Number(body.price_usd);
      if (!Number.isFinite(price) || price < 0) return fail("Invalid price");

      await env.DB.prepare(`
        UPDATE premium_prices
        SET price_usd = ?, is_active = ?
        WHERE id = ?
      `).bind(
        price,
        body.is_active === false ? 0 : 1,
        id
      ).run();

      await audit(env, admin, "update_price", "premium", id, body);

      return json({ ok: true });
    }

    return fail("Admin route not found", 404);
  }

  return fail("Not found", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      return fail(error?.message || "Internal server error", 500);
    }
  }
};
