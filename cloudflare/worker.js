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
  
// PUBLIC TELEGRAM MEDIA

if (path === "/api/media" && method === "GET") {
  if (!env.BOT_TOKEN) {
    return fail("Media service unavailable", 500);
  }

  const fileId = url.searchParams.get("file_id");

  if (!fileId || fileId.length > 2048) {
    return fail("Invalid file_id", 400);
  }

  const tgResponse = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );

  const tg = await tgResponse.json();

  if (!tg.ok || !tg.result?.file_path) {
    return fail("Media not found", 404);
  }

  const filePath = tg.result.file_path;

  const fileResponse = await fetch(
    `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`
  );

  if (!fileResponse.ok) {
    return fail("Cannot load media", 502);
  }

  const headers = new Headers(CORS);

  let contentType = fileResponse.headers.get("Content-Type") || "";

  if (filePath.toLowerCase().endsWith(".mp4")) {
    contentType = "video/mp4";
  } else if (filePath.toLowerCase().endsWith(".gif")) {
    contentType = "image/gif";
  } else if (filePath.toLowerCase().endsWith(".webp")) {
    contentType = "image/webp";
  } else if (filePath.toLowerCase().endsWith(".jpg") ||
             filePath.toLowerCase().endsWith(".jpeg")) {
    contentType = "image/jpeg";
  } else if (filePath.toLowerCase().endsWith(".png")) {
    contentType = "image/png";
  }

  headers.set("Content-Type", contentType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Content-Disposition", "inline");

  return new Response(fileResponse.body, {
    status: 200,
    headers
  });
}
  // NFT MARKETPLACE — PUBLIC API

  // GET MARKETPLACE LISTINGS
  if (path === "/api/marketplace/listings" && method === "GET") {
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("q");

    let sql = `
      SELECT
        l.*,
        s.display_name AS seller_name,
        s.status AS seller_status
      FROM nft_market_listings l
      JOIN seller_profiles s ON s.id = l.seller_id
      WHERE l.status = 'active'
        AND s.status = 'approved'
    `;

    const values = [];

    if (category) {
      sql += " AND (l.collection = ? OR l.gift_model = ?)";
      values.push(category, category);
    }

    if (search) {
      sql += " AND (l.title LIKE ? OR l.description LIKE ? OR l.collection LIKE ?)";
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += " ORDER BY l.id DESC LIMIT 100";

    const result = await env.DB.prepare(sql).bind(...values).all();

    return json({ ok: true, listings: result.results || [] });
  }

  // SELLER APPLICATION
  if (path === "/api/seller/apply" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Telegram authorization required", 401);

    const body = await request.json();

    const displayName = String(body.display_name || "").trim();
    const description = String(body.description || "").trim();
    const contact = String(body.contact || "").trim();

    if (!displayName || displayName.length > 80) {
      return fail("Введите название профиля продавца");
    }

    if (description.length > 1000 || contact.length > 150) {
      return fail("Слишком длинное описание или контакт");
    }

    await env.DB.prepare(`
      INSERT INTO seller_profiles
        (user_id, status, display_name, description, contact)
      VALUES (?, 'pending', ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        contact = excluded.contact,
        updated_at = CURRENT_TIMESTAMP
    `).bind(user.id, displayName, description, contact).run();

    return json({
      ok: true,
      status: "pending",
      message: "Заявка продавца отправлена администрации"
    }, 201);
  }

  // SELLER PROFILE
  if (path === "/api/seller/me" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const seller = await env.DB.prepare(`
      SELECT * FROM seller_profiles WHERE user_id = ?
    `).bind(user.id).first();

    if (!seller) {
      return json({ ok: true, seller: null });
    }

    const deposit = await env.DB.prepare(`
      SELECT required_amount_usd, recorded_amount_usd, status, updated_at
      FROM seller_deposits WHERE seller_id = ?
    `).bind(seller.id).first();

    return json({
      ok: true,
      seller,
      deposit: deposit || {
        required_amount_usd: 100,
        recorded_amount_usd: 0,
        status: "not_recorded"
      }
    });
  }

  // SELLER'S LISTINGS
  if (path === "/api/seller/listings" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const seller = await env.DB.prepare(`
      SELECT id FROM seller_profiles WHERE user_id = ?
    `).bind(user.id).first();

    if (!seller) return fail("Seller profile not found", 404);

    const result = await env.DB.prepare(`
      SELECT * FROM nft_market_listings
      WHERE seller_id = ?
      ORDER BY id DESC
    `).bind(seller.id).all();

    return json({ ok: true, listings: result.results || [] });
  }

  // CREATE NFT LISTING
  if (path === "/api/seller/listings" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const seller = await env.DB.prepare(`
      SELECT * FROM seller_profiles WHERE user_id = ?
    `).bind(user.id).first();

    if (!seller || seller.status !== "approved") {
      return fail("Профиль продавца ещё не одобрен", 403);
    }

    const deposit = await env.DB.prepare(`
      SELECT * FROM seller_deposits WHERE seller_id = ?
    `).bind(seller.id).first();

    if (
      !deposit ||
      deposit.status !== "recorded" ||
      Number(deposit.recorded_amount_usd) < 100
    ) {
      return fail("Не пройдена административная проверка депозита от $100", 403);
    }

    const body = await request.json();
    const title = String(body.title || "").trim();
    const collection = String(body.collection || "").trim();
    const giftModel = String(body.gift_model || "").trim();
    const description = String(body.description || "").trim();
    const price = Number(body.price);

    if (!title || title.length > 150) return fail("Некорректное название");
    if (!Number.isFinite(price) || price <= 0) return fail("Некорректная цена");
    if (description.length > 2000) return fail("Описание слишком длинное");

    const media = Array.isArray(body.media) ? body.media.slice(0, 10) : [];

    const result = await env.DB.prepare(`
      INSERT INTO nft_market_listings (
        seller_id, title, collection, gift_model,
        description, price, currency, media_json,
        gift_link, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      seller.id,
      title,
      collection,
      giftModel,
      description,
      price,
      String(body.currency || "USD"),
      JSON.stringify(media),
      String(body.gift_link || "").slice(0, 500)
    ).run();

    return json({
      ok: true,
      listing_id: result.meta?.last_row_id,
      status: "pending",
      message: "Объявление отправлено на проверку"
    }, 201);
  }

  // CREATE PURCHASE REQUEST — NO PAYMENT
  if (path === "/api/marketplace/orders" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const body = await request.json();
    const listingId = Number(body.listing_id);

    if (!Number.isInteger(listingId) || listingId < 1) {
      return fail("Некорректный товар");
    }

    const listing = await env.DB.prepare(`
      SELECT l.*, s.user_id AS seller_user_id
      FROM nft_market_listings l
      JOIN seller_profiles s ON s.id = l.seller_id
      WHERE l.id = ?
        AND l.status = 'active'
        AND s.status = 'approved'
    `).bind(listingId).first();

    if (!listing) return fail("Объявление недоступно", 404);

    if (String(listing.seller_user_id) === String(user.id)) {
      return fail("Нельзя заказать собственное объявление");
    }

    const publicId = makePublicId();

    const result = await env.DB.prepare(`
      INSERT INTO nft_market_orders (
        public_id, listing_id, buyer_user_id,
        seller_user_id, status, buyer_note
      )
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).bind(
      publicId,
      listingId,
      user.id,
      listing.seller_user_id,
      String(body.note || "").slice(0, 1000)
    ).run();

    return json({
      ok: true,
      order_id: result.meta?.last_row_id,
      public_id: publicId,
      status: "pending",
      message: "Запрос продавцу создан. Оплата через площадку не производится."
    }, 201);
  }

  // USER MARKETPLACE ORDERS
  if (path === "/api/marketplace/orders" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const result = await env.DB.prepare(`
      SELECT o.*, l.title AS listing_title,
             l.price, l.currency, l.media_json
      FROM nft_market_orders o
      LEFT JOIN nft_market_listings l ON l.id = o.listing_id
      WHERE o.buyer_user_id = ? OR o.seller_user_id = ?
      ORDER BY o.id DESC
    `).bind(user.id, user.id).all();

    return json({ ok: true, orders: result.results || [] });
  }

  // OPEN DISPUTE
  if (path === "/api/marketplace/disputes" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return fail("Unauthorized", 401);

    const body = await request.json();
    const orderId = Number(body.order_id);
    const reason = String(body.reason || "").trim();
    const description = String(body.description || "").trim();

    if (!Number.isInteger(orderId) || orderId < 1) {
      return fail("Некорректный номер заказа");
    }

    if (!reason || reason.length > 150 || description.length > 2000) {
      return fail("Проверьте причину и описание обращения");
    }

    const order = await env.DB.prepare(`
      SELECT * FROM nft_market_orders
      WHERE id = ? AND (buyer_user_id = ? OR seller_user_id = ?)
    `).bind(orderId, user.id, user.id).first();

    if (!order) return fail("Заказ не найден", 404);

    const existing = await env.DB.prepare(`
      SELECT id FROM marketplace_disputes
      WHERE order_id = ? AND status = 'open'
    `).bind(orderId).first();

    if (existing) return fail("По этому заказу уже открыт спор");

    const result = await env.DB.prepare(`
      INSERT INTO marketplace_disputes
        (order_id, opened_by, reason, description)
      VALUES (?, ?, ?, ?)
    `).bind(orderId, user.id, reason, description).run();

    return json({
      ok: true,
      dispute_id: result.meta?.last_row_id,
      status: "open"
    }, 201);
  }
  
  // ADMIN AUTHORIZATION

  if (path.startsWith("/api/admin/")) {
    const admin = await requireAdmin(request, env);
    if (!admin) return fail("Admin access required", 403);
        // MARKETPLACE SELLERS
    if (path === "/api/admin/sellers" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          s.*,
          u.telegram_id,
          u.username,
          u.first_name,
          d.required_amount_usd,
          d.recorded_amount_usd,
          d.status AS deposit_status
        FROM seller_profiles s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN seller_deposits d ON d.seller_id = s.id
        ORDER BY s.id DESC
      `).all();

      return json({ ok: true, sellers: result.results || [] });
    }

    // APPROVE OR REJECT SELLER
    const sellerStatusMatch =
      path.match(/^\/api\/admin\/sellers\/(\d+)\/status$/);

    if (sellerStatusMatch && method === "PATCH") {
      const id = Number(sellerStatusMatch[1]);
      const body = await request.json();
      const status = String(body.status || "");

      if (!["approved", "rejected", "pending", "suspended"].includes(status)) {
        return fail("Invalid seller status");
      }

      const seller = await env.DB.prepare(
        "SELECT id FROM seller_profiles WHERE id = ?"
      ).bind(id).first();

      if (!seller) return fail("Seller not found", 404);

      await env.DB.prepare(`
        UPDATE seller_profiles
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(status, id).run();

      await audit(env, admin, "seller_status", "seller", id, { status });

      return json({ ok: true, status });
    }

    // DEPOSIT ACCOUNTING — ADMINISTRATIVE RECORD ONLY
    if (path === "/api/admin/deposits" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          d.*,
          s.display_name,
          s.user_id,
          u.telegram_id,
          u.username
        FROM seller_deposits d
        JOIN seller_profiles s ON s.id = d.seller_id
        JOIN users u ON u.id = s.user_id
        ORDER BY d.id DESC
      `).all();

      return json({ ok: true, deposits: result.results || [] });
    }

    // RECORD DEPOSIT VERIFICATION
    if (path === "/api/admin/deposits" && method === "POST") {
      const body = await request.json();
      const sellerId = Number(body.seller_id);
      const amount = Number(body.amount_usd);
      const note = String(body.note || "").trim();

      if (!Number.isInteger(sellerId) || sellerId < 1) {
        return fail("Invalid seller_id");
      }

      if (!Number.isFinite(amount) || amount < 100 || amount > 1000000) {
        return fail("Укажите проверенную сумму не менее $100");
      }

      const seller = await env.DB.prepare(
        "SELECT id FROM seller_profiles WHERE id = ?"
      ).bind(sellerId).first();

      if (!seller) return fail("Seller not found", 404);

      await env.DB.prepare(`
        INSERT INTO seller_deposits (
          seller_id, required_amount_usd,
          recorded_amount_usd, status, admin_note, updated_at
        )
        VALUES (?, 100, ?, 'recorded', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(seller_id) DO UPDATE SET
          required_amount_usd = 100,
          recorded_amount_usd = excluded.recorded_amount_usd,
          status = 'recorded',
          admin_note = excluded.admin_note,
          updated_at = CURRENT_TIMESTAMP
      `).bind(sellerId, amount, note).run();

      await env.DB.prepare(`
        INSERT INTO seller_deposit_events (
          seller_id, action, amount_usd, note, admin_telegram_id
        )
        VALUES (?, 'verification_recorded', ?, ?, ?)
      `).bind(
        sellerId,
        amount,
        note,
        String(admin.telegram_id)
      ).run();

      await audit(env, admin, "deposit_verification", "seller", sellerId, {
        amount_usd: amount,
        note
      });

      return json({
        ok: true,
        status: "recorded",
        recorded_amount_usd: amount,
        accounting_only: true
      });
    }

    // DEPOSIT HISTORY
    if (path === "/api/admin/deposit-events" && method === "GET") {
      const sellerId = Number(url.searchParams.get("seller_id"));

      let sql = `
        SELECT e.*, s.display_name
        FROM seller_deposit_events e
        LEFT JOIN seller_profiles s ON s.id = e.seller_id
      `;

      const values = [];

      if (Number.isInteger(sellerId) && sellerId > 0) {
        sql += " WHERE e.seller_id = ?";
        values.push(sellerId);
      }

      sql += " ORDER BY e.id DESC LIMIT 500";

      const result = await env.DB.prepare(sql).bind(...values).all();

      return json({ ok: true, events: result.results || [] });
    }

    // ALL MARKETPLACE LISTINGS
    if (path === "/api/admin/marketplace/listings" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          l.*,
          s.display_name AS seller_name,
          u.telegram_id,
          u.username
        FROM nft_market_listings l
        LEFT JOIN seller_profiles s ON s.id = l.seller_id
        LEFT JOIN users u ON u.id = s.user_id
        ORDER BY l.id DESC
        LIMIT 300
      `).all();

      return json({ ok: true, listings: result.results || [] });
    }

    // MODERATE MARKETPLACE LISTING
    const marketListingMatch =
      path.match(/^\/api\/admin\/marketplace\/listings\/(\d+)$/);

    if (marketListingMatch && method === "PATCH") {
      const id = Number(marketListingMatch[1]);
      const body = await request.json();
      const status = String(body.status || "");

      if (!["active", "rejected", "suspended"].includes(status)) {
        return fail("Invalid listing status");
      }

      await env.DB.prepare(`
        UPDATE nft_market_listings
        SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(status, String(body.admin_note || ""), id).run();

      await audit(env, admin, "market_listing_status", "market_listing", id, {
        status,
        admin_note: body.admin_note || ""
      });

      return json({ ok: true, status });
    }

    // MARKETPLACE ORDERS FOR ADMIN
    if (path === "/api/admin/marketplace/orders" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          o.*,
          l.title AS listing_title,
          b.username AS buyer_username,
          b.telegram_id AS buyer_telegram_id,
          s.username AS seller_username,
          s.telegram_id AS seller_telegram_id
        FROM nft_market_orders o
        LEFT JOIN nft_market_listings l ON l.id = o.listing_id
        LEFT JOIN users b ON b.id = o.buyer_user_id
        LEFT JOIN users s ON s.id = o.seller_user_id
        ORDER BY o.id DESC
        LIMIT 300
      `).all();

      return json({ ok: true, orders: result.results || [] });
    }

    // UPDATE MARKETPLACE ORDER STATUS
    const marketOrderMatch =
      path.match(/^\/api\/admin\/marketplace\/orders\/(\d+)\/status$/);

    if (marketOrderMatch && method === "PATCH") {
      const id = Number(marketOrderMatch[1]);
      const body = await request.json();
      const status = String(body.status || "");

      if (!["pending", "accepted", "rejected", "completed", "cancelled"].includes(status)) {
        return fail("Invalid order status");
      }

      await env.DB.prepare(`
        UPDATE nft_market_orders
        SET status = ?, seller_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(status, String(body.note || ""), id).run();

      await audit(env, admin, "market_order_status", "market_order", id, {
        status
      });

      return json({ ok: true, status });
    }

    // MARKETPLACE DISPUTES
    if (path === "/api/admin/marketplace/disputes" && method === "GET") {
      const result = await env.DB.prepare(`
        SELECT
          d.*,
          o.public_id,
          o.buyer_user_id,
          o.seller_user_id
        FROM marketplace_disputes d
        JOIN nft_market_orders o ON o.id = d.order_id
        ORDER BY d.id DESC
        LIMIT 300
      `).all();

      return json({ ok: true, disputes: result.results || [] });
    }

    // RESOLVE DISPUTE
    const disputeMatch =
      path.match(/^\/api\/admin\/marketplace\/disputes\/(\d+)$/);

    if (disputeMatch && method === "PATCH") {
      const id = Number(disputeMatch[1]);
      const body = await request.json();
      const status = String(body.status || "");

      if (!["resolved", "rejected", "open"].includes(status)) {
        return fail("Invalid dispute status");
      }

      await env.DB.prepare(`
        UPDATE marketplace_disputes
        SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(status, String(body.admin_note || ""), id).run();

      await audit(env, admin, "resolve_dispute", "dispute", id, {
        status,
        admin_note: body.admin_note || ""
      });

      return json({ ok: true, status });
    }
    // ADMIN MEDIA UPLOAD
    if (path === "/api/admin/upload" && method === "POST") {
      if (!env.BOT_TOKEN) {
        return fail("BOT_TOKEN is missing", 500);
      }

      const form = await request.formData();
      const file = form.get("file");

      if (!file || typeof file === "string") {
        return fail("Файл не выбран", 400);
      }

      if (file.size > 20 * 1024 * 1024) {
        return fail("Максимальный размер файла — 20 МБ", 400);
      }

      const type = file.type || "";
      let telegramMethod;
      let fieldName;

      if (type === "image/gif") {
        telegramMethod = "sendAnimation";
        fieldName = "animation";
      } else if (type.startsWith("video/")) {
        telegramMethod = "sendVideo";
        fieldName = "video";
      } else if (type.startsWith("image/")) {
        telegramMethod = "sendPhoto";
        fieldName = "photo";
      } else {
        return fail("Поддерживаются фото, видео и GIF", 400);
      }

      const telegramForm = new FormData();
      telegramForm.append("chat_id", String(admin.telegram_id));
      telegramForm.append(fieldName, file, file.name || "upload");

      const tgResponse = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/${telegramMethod}`,
        { method: "POST", body: telegramForm }
      );

      const tg = await tgResponse.json();

      if (!tg.ok) {
        return fail("Telegram не принял файл: " + (tg.description || "ошибка"), 400);
      }

      const media = tg.result[fieldName];
      const fileId = Array.isArray(media)
        ? media[media.length - 1].file_id
        : media.file_id;

      return json({
        ok: true,
        media: {
          file_id: fileId,
          kind: type === "image/gif" ? "animation" :
                type.startsWith("video/") ? "video" : "photo"
        }
      });
    }
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
