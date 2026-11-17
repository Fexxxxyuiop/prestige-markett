PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(category IN ('gifts','usernames','numbers','stars','premium')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  media_json TEXT NOT NULL DEFAULT '[]',
  collection_name TEXT,
  item_number TEXT,
  model TEXT,
  background TEXT,
  public_identifier TEXT,
  price_day REAL,
  price_week REAL,
  price_month REAL,
  fixed_price REAL,
  min_days INTEGER NOT NULL DEFAULT 1,
  max_days INTEGER NOT NULL DEFAULT 365,
  quantity INTEGER NOT NULL DEFAULT 1,
  currency TEXT NOT NULL DEFAULT 'XTR',
  fulfillment_mode TEXT NOT NULL DEFAULT 'manual' CHECK(fulfillment_mode IN ('manual','official')),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  category TEXT NOT NULL,
  term_days INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  fulfillment_mode TEXT NOT NULL DEFAULT 'manual',
  payment_charge_id TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_note TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  order_id INTEGER REFERENCES orders(id),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_telegram_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_listings_category_active ON listings(category, is_active);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);


INSERT OR IGNORE INTO listings
(category,title,description,quantity,fixed_price,min_days,max_days,currency,fulfillment_mode,is_active,is_featured)
VALUES
('stars','50 Telegram Stars','Official Telegram Stars request for 50 Stars. Price: $1.10 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',50,1.10,1,1,'USD','manual',1,1),
('stars','75 Telegram Stars','Official Telegram Stars request for 75 Stars. Price: $1.50 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',75,1.50,1,1,'USD','manual',1,0),
('stars','100 Telegram Stars','Official Telegram Stars request for 100 Stars. Price: $2.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',100,2.00,1,1,'USD','manual',1,0),
('stars','150 Telegram Stars','Official Telegram Stars request for 150 Stars. Price: $2.75 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',150,2.75,1,1,'USD','manual',1,0),
('stars','250 Telegram Stars','Official Telegram Stars request for 250 Stars. Price: $4.10 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',250,4.10,1,1,'USD','manual',1,0),
('stars','350 Telegram Stars','Official Telegram Stars request for 350 Stars. Price: $5.75 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',350,5.75,1,1,'USD','manual',1,0),
('stars','500 Telegram Stars','Official Telegram Stars request for 500 Stars. Price: $8.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',500,8.00,1,1,'USD','manual',1,0),
('stars','750 Telegram Stars','Official Telegram Stars request for 750 Stars. Price: $11.75 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',750,11.75,1,1,'USD','manual',1,0),
('stars','1 000 Telegram Stars','Official Telegram Stars request for 1,000 Stars. Price: $17.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',1000,17.00,1,1,'USD','manual',1,0),
('stars','1 500 Telegram Stars','Official Telegram Stars request for 1,500 Stars. Price: $23.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',1500,23.00,1,1,'USD','manual',1,0),
('stars','2 500 Telegram Stars','Official Telegram Stars request for 2,500 Stars. Price: $40.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',2500,40.00,1,1,'USD','manual',1,0),
('stars','5 000 Telegram Stars','Official Telegram Stars request for 5,000 Stars. Price: $85.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',5000,85.00,1,1,'USD','manual',1,0),
('stars','10 000 Telegram Stars','Official Telegram Stars request for 10,000 Stars. Price: $170.00 USD. Fulfillment is handled manually until an approved official delivery flow is configured.',10000,170.00,1,1,'USD','manual',1,0),
('premium','Telegram Premium — 3 months','Telegram Premium for 3 months. Price: $15.00 USD. Request is processed manually.',3,15.00,1,1,'USD','manual',1,0),
('premium','Telegram Premium — 6 months','Telegram Premium for 6 months. Price: $18.00 USD. Request is processed manually.',6,18.00,1,1,'USD','manual',1,0),
('premium','Telegram Premium — 1 year','Telegram Premium for 12 months. Price: $32.00 USD. Request is processed manually.',12,32.00,1,1,'USD','manual',1,0);
