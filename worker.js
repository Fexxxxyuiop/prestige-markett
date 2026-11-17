const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders });

const now = () => new Date().toISOString();
const parseIds = (s = "") => s.split(",").map(x => x.trim()).filter(Boolean);

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
function hex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) throw new Error("Telegram authorization required");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Invalid Telegram initData");
  params.delete("hash");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheck = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calculated = hex(await hmac(secret, dataCheck));
  if (!safeEqual(calculated, hash)) throw new Error("Telegram signature mismatch");
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) throw new Error("Telegram authorization expired");
  const user = JSON.parse(params.get("user") || "{}");
  if (!user.id) throw new Error("Telegram user missing");
  return user;
}

async function auth(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data") || "";
  const user = await verifyInitData(initData, env.BOT_TOKEN);
  const result = await env.DB.prepare(
    "INSERT INTO users(telegram_id,username,first_name,last_name,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name,updated_at=excluded.updated_at RETURNING id,telegram_id,is_blocked"
  ).bind(String(user.id), user.username || null, user.first_name || "", user.last_name || "", now()).first();
  if (result.is_blocked) throw new Error("Account restricted");
  return { user, dbUser: result };
}
async function requireAdmin(request, env) {
  const ctx = await auth(request, env);
  if (!parseIds(env.ADMIN_IDS).includes(String(ctx.user.id))) throw new Error("Admin access denied");
  return ctx;
}
async function telegram(method, body, env) {
  if (!env.BOT_TOKEN) throw new Error("Bot is not configured");
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}
async function notifyAdmins(text, env) {
  for (const id of parseIds(env.ADMIN_IDS)) {
    try { await telegram("sendMessage", { chat_id: id, text }, env); } catch (_) {}
  }
}
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (path === "/health") return json({ ok: true, service: "Prestige Market API", time: now() });

  if (path === "/telegram/webhook" && request.method === "POST") {
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret || "", env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: "Unauthorized webhook" }, 401);
    const update = await request.json();
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const payload = payment.invoice_payload || "";
      const orderId = Number(payload.replace("pm_order_", ""));
      if (orderId) {
        const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first();
        if (order && order.status === "awaiting_payment") {
          const eventId = payment.telegram_payment_charge_id;
          await env.DB.batch([
            env.DB.prepare("INSERT OR IGNORE INTO payment_events(provider,event_id,order_id,payload_json) VALUES('telegram_stars',?,?,?)")
              .bind(eventId, orderId, JSON.stringify({ currency: payment.currency, total_amount: payment.total_amount })),
            env.DB.prepare("UPDATE orders SET status='paid',payment_charge_id=?,updated_at=? WHERE id=? AND status='awaiting_payment'")
              .bind(eventId, now(), orderId)
          ]);
          await notifyAdmins(`Prestige Market: заказ ${order.public_id} оплачен через Telegram Stars.`, env);
        }
      }
    } else if (update.message?.text === "/start") {
      const chatId = update.message.chat.id;
      const webapp = env.WEBAPP_URL || "https://example.com";
      await telegram("sendMessage", {
        chat_id: chatId,
        text: "Добро пожаловать в Prestige Market. Откройте маркетплейс кнопкой ниже.",
        reply_markup: { inline_keyboard: [[{ text: "Открыть Prestige Market", web_app: { url: webapp } }]] }
      }, env);
    }
    return json({ ok: true });
  }

  if (path === "/api/categories") return json({ categories: [
    { id: "gifts", name: "NFT Gifts", icon: "🎁" },
    { id: "usernames", name: "Usernames", icon: "👤" },
    { id: "numbers", name: "Numbers", icon: "📱" },
    { id: "stars", name: "Telegram Stars", icon: "⭐" },
    { id: "premium", name: "Telegram Premium", icon: "💎" }
  ]});

  if (path === "/api/listings" && request.method === "GET") {
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q");
    let sql = "SELECT * FROM listings WHERE is_active=1";
    const args = [];
    if (category) { sql += " AND category=?"; args.push(category); }
    if (q) { sql += " AND (title LIKE ? OR description LIKE ?)"; args.push(`%${q}%`, `%${q}%`); }
    sql += " ORDER BY is_featured DESC, id DESC LIMIT 100";
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json({ listings: results.map(x => ({ ...x, media: JSON.parse(x.media_json || "[]") })) });
  }

  if (path.startsWith("/api/") && path === "/api/me" && request.method === "GET") {
    const ctx = await auth(request, env);
    return json({ user: ctx.user, telegramId: String(ctx.user.id) });
  }

  if (path === "/api/orders" && request.method === "GET") {
    const ctx = await auth(request, env);
    const { results } = await env.DB.prepare(
      "SELECT o.*,l.title AS listing_title FROM orders o JOIN users u ON u.id=o.user_id JOIN listings l ON l.id=o.listing_id WHERE u.telegram_id=? ORDER BY o.id DESC LIMIT 100"
    ).bind(String(ctx.user.id)).all();
    return json({ orders: results });
  }

  if (path === "/api/favorites" && request.method === "POST") {
    const ctx = await auth(request, env);
    const body = await request.json();
    const id = Number(body.listingId);
    if (!Number.isInteger(id) || id < 1) return json({ error: "Invalid listing" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO favorites(user_id,listing_id) VALUES(?,?)").bind(ctx.dbUser.id, id).run();
    return json({ ok: true });
  }

  if (path === "/api/orders" && request.method === "POST") {
    const ctx = await auth(request, env);
    const body = await request.json();
    const listingId = Number(body.listingId);
    const termDays = body.termDays == null ? null : Number(body.termDays);
    const idem = String(body.idempotencyKey || "");
    if (!idem || idem.length > 100) return json({ error: "Invalid idempotency key" }, 400);
    const listing = await env.DB.prepare("SELECT * FROM listings WHERE id=? AND is_active=1").bind(listingId).first();
    if (!listing) return json({ error: "Listing unavailable" }, 404);
    let amount;
    if (["gifts","usernames","numbers"].includes(listing.category)) {
      if (!Number.isInteger(termDays) || termDays < listing.min_days || termDays > listing.max_days) return json({ error: "Invalid rental term" }, 400);
      const rate = termDays >= 30 ? listing.price_month / 30 : termDays >= 7 ? listing.price_week / 7 : listing.price_day;
      if (!Number.isFinite(rate) || rate <= 0) return json({ error: "Rental price is not configured" }, 400);
      amount = Math.round(rate * termDays * 100) / 100;
    } else {
      amount = Number(listing.fixed_price);
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Price not configured" }, 400);
    }
    const publicId = `PM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const status = listing.currency === "XTR" && listing.fulfillment_mode === "official" ? "awaiting_payment" : "pending_admin";
    const inserted = await env.DB.prepare(
      "INSERT INTO orders(public_id,user_id,listing_id,category,term_days,amount,currency,status,fulfillment_mode,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *"
    ).bind(publicId, ctx.dbUser.id, listing.id, listing.category, termDays, amount, listing.currency, status, listing.fulfillment_mode, idem, now(), now()).first();
    const order = inserted || await env.DB.prepare("SELECT * FROM orders WHERE idempotency_key=?").bind(idem).first();
    await notifyAdmins(`Новый заказ Prestige Market ${order.public_id}\nТовар: ${listing.title}\nСумма: ${order.amount} ${order.currency}\nСтатус: ${order.status}`, env);
    if (order.status === "awaiting_payment") {
      const invoice = await telegram("createInvoiceLink", {
        title: listing.title.slice(0, 32),
        description: (listing.description || "Prestige Market order").slice(0, 255),
        payload: `pm_order_${order.id}`,
        provider_token: "",
        currency: "XTR",
        prices: [{ label: listing.title.slice(0, 32), amount: Math.round(amount) }]
      }, env);
      return json({ order, paymentUrl: invoice });
    }
    return json({ order, message: "Заказ передан администратору и ожидает обработки." }, 201);
  }

  if (path === "/api/admin/stats" && request.method === "GET") {
    await requireAdmin(request, env);
    const [users, orders, active, turnover] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM orders").first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='active'").first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM orders WHERE status IN ('paid','active','completed')").first()
    ]);
    return json({ users: users.n, orders: orders.n, activeRentals: active.n, turnover: turnover.n });
  }

  if (path === "/api/admin/listings" && request.method === "POST") {
    const ctx = await requireAdmin(request, env);
    const b = await request.json();
    const categories = ["gifts","usernames","numbers","stars","premium"];
    if (!categories.includes(b.category) || !String(b.title || "").trim()) return json({ error: "Invalid listing" }, 400);
    const result = await env.DB.prepare(
      "INSERT INTO listings(category,title,description,price_day,price_week,price_month,fixed_price,min_days,max_days,currency,fulfillment_mode,is_active,is_featured,public_identifier) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(b.category,b.title,b.description || "",b.priceDay || null,b.priceWeek || null,b.priceMonth || null,b.fixedPrice || null,b.minDays || 1,b.maxDays || 365,b.currency || "XTR",b.fulfillmentMode || "manual",b.isActive === false ? 0 : 1,b.featured ? 1 : 0,b.publicIdentifier || null).run();
    await env.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?)")
      .bind(String(ctx.user.id),"create","listing",String(result.meta.last_row_id),JSON.stringify({ title: b.title })).run();
    return json({ ok: true, id: result.meta.last_row_id }, 201);
  }

  if (path === "/api/admin/orders" && request.method === "GET") {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare("SELECT o.*,u.telegram_id,u.username,l.title AS listing_title FROM orders o JOIN users u ON u.id=o.user_id JOIN listings l ON l.id=o.listing_id ORDER BY o.id DESC LIMIT 200").all();
    return json({ orders: results });
  }

  const statusMatch = path.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
  if (statusMatch && request.method === "PATCH") {
    const ctx = await requireAdmin(request, env);
    const b = await request.json();
    const allowed = ["new","awaiting_payment","paid","processing","active","expiring","completed","cancelled","refund","dispute","pending_admin"];
    if (!allowed.includes(b.status)) return json({ error: "Invalid status" }, 400);
    const id = Number(statusMatch[1]);
    await env.DB.prepare("UPDATE orders SET status=?,admin_note=?,updated_at=? WHERE id=?")
      .bind(b.status, b.adminNote || null, now(), id).run();
    await env.DB.prepare("INSERT INTO admin_audit(admin_telegram_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?)")
      .bind(String(ctx.user.id),"change_status","order",String(id),JSON.stringify({ status: b.status })).run();
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) { return json({ error: e.message || "Internal error" }, e.message === "Admin access denied" ? 403 : 400); }
  }
};
