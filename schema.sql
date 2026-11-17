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
(category,title,description,collection_name,item_number,model,background,price_day,price_week,price_month,fixed_price,min_days,max_days,quantity,currency,fulfillment_mode,is_active,is_featured)
VALUES
('gifts','Demo collectible gift','Example catalog item. Replace with an actually available item and authorized listing.','Demo Collection','#001','Classic','Midnight',1.5,8,25,NULL,1,30,1,'USD','manual',1,1),
('usernames','@example_collectible','Example username listing. Availability and rental rights must be verified by the operator.','','','','',3,15,45,NULL,1,30,1,'USD','manual',1,0),
('numbers','Number lot PM-001','Safe listing reference only. No SMS, calls, verification or account access.','','','','',2,10,30,NULL,1,30,1,'USD','manual',1,0),
('stars','50 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,50,'USD','manual',1,1),
('stars','100 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,100,'USD','manual',1,0),
('stars','250 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,250,'USD','manual',1,0),
('stars','500 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,500,'USD','manual',1,0),
('stars','1 000 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,1000,'USD','manual',1,0),
('stars','2 500 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,2500,'USD','manual',1,0),
('stars','5 000 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,5000,'USD','manual',1,0),
('stars','10 000 Telegram Stars','Official Stars purchase request. Price and fulfillment must be configured with an approved provider.','','','','',NULL,NULL,NULL,NULL,1,1,10000,'USD','manual',1,0),
('premium','Telegram Premium — 1 month','Manual request. Never provide account credentials or login codes.','','','','',NULL,NULL,NULL,NULL,1,1,1,'USD','manual',1,0),
('premium','Telegram Premium — 3 months','Manual request. Never provide account credentials or login codes.','','','','',NULL,NULL,NULL,NULL,1,1,3,'USD','manual',1,0),
('premium','Telegram Premium — 6 months','Manual request. Never provide account credentials or login codes.','','','','',NULL,NULL,NULL,NULL,1,1,6,'USD','manual',1,0),
('premium','Telegram Premium — 12 months','Manual request. Never provide account credentials or login codes.','','','','',NULL,NULL,NULL,NULL,1,1,12,'USD','manual',1,0);
