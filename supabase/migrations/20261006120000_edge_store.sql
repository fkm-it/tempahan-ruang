-- Storan untuk backend Apps Script yang dijalankan di Supabase Edge Function (supabase/functions/api).
-- Skema `private` TIDAK didedahkan melalui Data API Supabase: hanya Edge Function (sambungan pangkalan data terus) mengaksesnya.
create schema if not exists private;
revoke all on schema private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema private from anon, authenticated'; end if;
end $$;

-- Satu "sheet" = satu jadual logik. ver dinaikkan pada setiap tulisan (kawalan konkurensi optimistik + cache isolat).
create table if not exists private.sheets (
  name       text primary key,
  header     jsonb not null default '[]'::jsonb,
  ver        bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Satu baris sheet = satu rekod. k = nilai lajur pertama (ID). pos = susunan baris.
create table if not exists private.sheet_rows (
  sheet text not null references private.sheets(name) on delete cascade,
  k     text not null,
  pos   bigint not null,
  vals  jsonb not null,
  primary key (sheet, k)
);
create index if not exists sheet_rows_order_idx on private.sheet_rows (sheet, pos);

-- Ganti CacheService untuk kunci yang mesti dikongsi (had kadar, kunci log masuk, kod set semula, idempotensi).
create table if not exists private.kv (
  k   text primary key,
  v   text not null,
  exp timestamptz not null
);
create index if not exists kv_exp_idx on private.kv (exp);

-- Ganti Script Properties (AUTH_PEPPER, FORM_SECRET, …). Rahsia — skema private sahaja.
create table if not exists private.props (
  k text primary key,
  v text not null
);

create table if not exists private.meta (
  k text primary key,
  v text not null
);
insert into private.meta (k, v) values ('props_ver', '1'), ('import_open', '1') on conflict (k) do nothing;

-- Email yang menunggu dihantar oleh pekerja Apps Script (MailApp).
create table if not exists private.outbox (
  id         bigserial primary key,
  kind       text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz,
  attempts   int not null default 0,
  last_error text
);
create index if not exists outbox_pending_idx on private.outbox (id) where sent_at is null;

-- Pertahanan berlapis: RLS dihidupkan tanpa polisi (anon/authenticated tidak boleh membaca walaupun skema terdedah).
alter table private.sheets enable row level security;
alter table private.sheet_rows enable row level security;
alter table private.kv enable row level security;
alter table private.props enable row level security;
alter table private.meta enable row level security;
alter table private.outbox enable row level security;
