-- =============================================
-- MochiShop Database Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- PRODUCTS
create table if not exists products (
  id          serial primary key,
  name        text not null,
  name_th     text,
  type        text not null check (type in ('physical','digital','preorder')),
  emoji       text default '📦',
  price       numeric(10,2) not null,
  stock       integer,           -- null = unlimited
  status      text default 'active' check (status in ('active','hidden')),
  badge       text,
  description text,
  file_url    text,              -- for digital products
  created_at  timestamptz default now()
);

-- DISCOUNT CODES
create table if not exists discounts (
  id         serial primary key,
  code       text unique not null,
  type       text not null check (type in ('percent','fixed')),
  value      numeric(10,2) not null,
  max_uses   integer,           -- null = unlimited
  used_count integer default 0,
  expires_at date,
  status     text default 'active' check (status in ('active','hidden')),
  created_at timestamptz default now()
);

-- MEMBERS
create table if not exists members (
  id         serial primary key,
  username   text unique not null,
  email      text unique not null,
  password   text not null,      -- hashed
  role       text default 'member' check (role in ('member','admin')),
  created_at timestamptz default now()
);

-- ORDERS
create table if not exists orders (
  id          serial primary key,
  member_id   integer references members(id),
  total       numeric(10,2) not null,
  discount_id integer references discounts(id),
  status      text default 'pending' check (status in ('pending','paid','shipped','cancelled')),
  note        text,
  created_at  timestamptz default now()
);

-- ORDER ITEMS
create table if not exists order_items (
  id         serial primary key,
  order_id   integer references orders(id) on delete cascade,
  product_id integer references products(id),
  quantity   integer default 1,
  price      numeric(10,2) not null
);

-- DOWNLOAD LINKS (for digital products after payment)
create table if not exists download_links (
  id         uuid primary key default gen_random_uuid(),
  order_item_id integer references order_items(id),
  expires_at timestamptz not null,
  used       boolean default false,
  created_at timestamptz default now()
);

-- =============================================
-- SEED: default admin account
-- password = mochi123 (bcrypt hashed)
-- =============================================
insert into members (username, email, password, role)
values (
  'admin',
  'admin@mochishop.com',
  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'admin'
) on conflict do nothing;

-- =============================================
-- SEED: sample products
-- =============================================
insert into products (name, name_th, type, emoji, price, stock, status, badge, description) values
  ('Ribbon Acrylic Keychain', 'พวงกุญแจอะคริลิก',  'physical', '🎀', 290, 50,   'active', 'NEW',       'Limited run acrylic keychain.'),
  ('Art Process Ebook Vol.1', 'อีบุ๊คกระบวนการวาด', 'digital',  '📚', 199, null, 'active', 'DIGITAL',   'PDF instant download.'),
  ('Sakura Print A4',         'โปสเตอร์ซากุระ A4',  'preorder', '🌸', 350, 30,   'active', 'PRE-ORDER', 'Ships March 2025.'),
  ('Brush Pack Vol.2',        'แปรงดิจิทัล Vol.2',  'digital',  '🖍️', 149, null, 'active', 'DIGITAL',   '30 Procreate brushes.'),
  ('Bunny Sticker Sheet',     'สติกเกอร์กระต่าย',   'physical', '🐰', 120, 8,    'active', 'NEW',       'A5 sticker sheet, 20 pcs.'),
  ('OC Art Zine Vol.3',       'อาร์ตซีน OC Vol.3',  'preorder', '🎨', 450, 20,   'hidden', 'PRE-ORDER', '32 pages full color zine.')
on conflict do nothing;

-- =============================================
-- SEED: sample discount codes
-- =============================================
insert into discounts (code, type, value, max_uses, status) values
  ('MOCHI10', 'percent', 10, 100, 'active'),
  ('ZINE10',  'percent', 10, 50,  'active'),
  ('FLAT50',  'fixed',   50, null,'hidden')
on conflict do nothing;
