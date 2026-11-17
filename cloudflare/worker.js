
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
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const secret = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      encoder.encode(token)
    );

    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(dataCheck)
    );

    const calculated = [...new Uint8Array(signature)]
      .map(x => x.toString(16).padStart(2, "0"))
      .join("");

    if (calculated !== hash) return null;

    const user = JSON.parse(params.get("user") || "null");
    if (!user?.id) return null;

    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

    return user;
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

  if (!user || user.is_blocked) return null;

  return user;
}

async function requireAdmin(request, env) {
  const user = await getUser(request, env);
  if (!user) return null;

  const admins = (env.ADMIN_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  return admins.includes(String(user.telegram_id)) ? user : null;
}

function makePublicId() {
  return "PM-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

async function handle(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (!env.DB) return fail("D1 binding DB is missing", 500);

  if (path === "/" || path === "/health") {
    return json({
      ok: true,
      service: "Prestige Market API",
      time: new Date().toISOString()
    });
  }

  if (path === "/api/categories" && method === "GET") {
    return json({ ok: true, categories });
  }

  if (path === "/api/listings" && method === "GET") {
    try {
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

      return json({
        ok: true,
        listings: result.results || []
      });
    } catch (e) {
      return fail("Could not load listings: " + e.message, 500);
    }
  }

  if (path === "/api/prices/stars" && method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT * FROM stars_prices ORDER BY stars_amount ASC"
      ).all();

      return json({ ok: true, prices: result.results || [] });
    } catch (e) {
      return fail("Stars prices unavailable: " + e.message, 500);
    }
  }

  if (path === "/api/prices/premium" && method === "GET") {
    try {
      const result = await env.DB.prepare(
        SELECT * FROM premium_prices ORDER BY duration_months ASC
      ).all();

      return json({ ok: true, prices: result.results || [] });
    } catch (e) {
      return fail("Premium prices unavailable: " + e.message, 500);
    }
  }

  if (path === "/api/me" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Telegram authorization required", 401);

    return json({
      ok: true,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name
      }
    });
  }

  if (path === "/api/favorites" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const result = await env.DB.prepare(`
      SELECT l.*
      FROM favorites f
      JOIN listings l ON l.id = f.listing_id
      WHERE f.user_id = ? OR f.telegram_id = ?
      ORDER BY f.id DESC
    `).bind(user.id, user.telegram_id).all();

    return json({ ok: true, favorites: result.results || [] });
  }

  if (path === "/api/favorites" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const body = await request.json();
    const listingId = Number(body.listing_id);

    if (!Number.isInteger(listingId) || listingId < 1) {
      return fail("Invalid listing_id");
    }

    const listing = await env.DB.prepare(
      "SELECT id FROM listings WHERE id = ? AND is_active = 1"
    ).bind(listingId).first();

    if (!listing) return fail("Listing not found", 404);

    await env.DB.prepare(`
      INSERT OR IGNORE INTO favorites (telegram_id, user_id, listing_id)
      VALUES (?, ?, ?)
    `).bind(user.telegram_id, user.id, listingId).run();

    return json({ ok: true });
  }

  if (path === "/api/favorites" && method === "DELETE") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const listingId = Number(url.searchParams.get("listing_id"));
    if (!Number.isInteger(listingId)) return fail("Invalid listing_id");

    await env.DB.prepare(`
      DELETE FROM favorites
      WHERE listing_id = ? AND (user_id = ? OR telegram_id = ?)
    `).bind(listingId, user.id, user.telegram_id).run();

    return json({ ok: true });
  }

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
    const listingId = Number(body.listing_id);
    const termDays = Math.max(1, Math.min(365, Number(body.term_days || 1)));

    if (!Number.isInteger(listingId) || listingId < 1) {
      return fail("Invalid listing_id");
    }

    const listing = await env.DB.prepare(`
      SELECT * FROM listings
      WHERE id = ? AND is_active = 1 AND status = 'active'
    `).bind(listingId).first();

    if (!listing) return fail("Listing unavailable", 404);

    if (termDays < Number(listing.min_days || 1) ||
        termDays > Number(listing.max_days || 365)) {
      return fail("Invalid rental term");
    }

    let amount = Number(listing.fixed_price ?? listing.price ?? 0);

    if (listing.price_day != null) {
      amount = Number(listing.price_day) * termDays;
    } else if (listing.price_week != null && termDays >= 7) {
      amount = Number(listing.price_week) * Math.ceil(termDays / 7);
    } else if (listing.price_month != null && termDays >= 30) {
      amount = Number(listing.price_month) * Math.ceil(termDays / 30);
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return fail("Invalid listing price", 400);
    }

    const publicId = makePublicId();
    const idempotency = String(body.idempotency_key || crypto.randomUUID());

    try {
      const result = await env.DB.prepare(`
        INSERT INTO orders (
          public_id, user_id, telegram_id, listing_id,
          category, term_days, amount, currency, status,
          fulfillment_mode, idempotency_key, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        publicId,
        user.id,
        user.telegram_id,
        listingId,
        listing.category || listing.category_id,
        termDays,
        amount,
        listing.currency || "USD",
        listing.fulfillment_mode || "manual",
        idempotency
      ).run();

      return json({
        ok: true,
        order_id: result.meta?.last_row_id,
        public_id: publicId,
        amount,
        currency: listing.currency || "USD",
        status: "pending"
      }, 201);
    } catch (e) {
      return fail("Could not create order: " + e.message, 500);
    }
  }

  if (path === "/api/admin/stats" && method === "GET") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);

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

  if (path === "/api/admin/listings" && method === "POST") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);

    const body = await request.json();
    const allowed = categories.map(x => x.id);

    const category = String(body.category || "");
    const title = String(body.title || "").trim();

    if (!allowed.includes(category)) return fail("Invalid category");
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
      category,
      category,
      title,
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

    await env.DB.prepare(`
      INSERT INTO admin_audit
        (admin_telegram_id, action, entity_type, entity_id, details_json)
      VALUES (?, 'create', 'listing', ?, ?)
    `).bind(
      admin.telegram_id,
      String(result.meta?.last_row_id || ""),
      JSON.stringify({ title, category })
    ).run();

    return json({
      ok: true,
      listing_id: result.meta?.last_row_id
    }, 201);
  }

  if (path.startsWith("/api/admin/listings/") && method === "PATCH") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);

    const id = Number(path.split("/").pop());
    if (!Number.isInteger(id)) return fail("Invalid listing ID");

    const body = await request.json();

    const result = await env.DB.prepare(`
      UPDATE listings SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        image_url = COALESCE(?, image_url),
        is_active = COALESCE(?, is_active),
        is_featured = COALESCE(?, is_featured),
        status = COALESCE(?, status)
      WHERE id = ?
    `).bind(
      body.title ?? null,
      body.description ?? null,
      body.price == null ? null : Number(body.price),
      body.image_url ?? null,
      body.is_active == null ? null : (body.is_active ? 1 : 0),
      body.is_featured == null ? null : (body.is_featured ? 1 : 0),
      body.status ?? null,
      id
    ).run();

    return json({ ok: true, changes: result.meta?.changes || 0 });
  }

  if (path === "/api/admin/orders" && method === "GET") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);

    const result = await env.DB.prepare(`
      SELECT o.*, u.username, u.first_name,
             l.title AS listing_title
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN listings l ON l.id = o.listing_id
      ORDER BY o.id DESC
      LIMIT 200
    `).all();

    return json({ ok: true, orders: result.results || [] });
  }

  if (path.startsWith("/api/admin/orders/") && path.endsWith("/status") && method === "PATCH") {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);

    const parts = path.split("/");
    const id = Number(parts[4]);
    const body = await request.json();

    const allowed = ["pending", "processing", "completed", "cancelled"];
    if (!Number.isInteger(id) || !allowed.includes(body.status)) {
      return fail("Invalid order or status");
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

    await env.DB.prepare(`
      INSERT INTO admin_audit
        (admin_telegram_id, action, entity_type, entity_id, details_json)
      VALUES (?, 'update_status', 'order', ?, ?)
    `).bind(
      admin.telegram_id,
      String(id),
      JSON.stringify({ status: body.status })
    ).run();

    return json({ ok: true });
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
