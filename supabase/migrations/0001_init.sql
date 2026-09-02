-- =============================================================================
-- Splitwise clone - initial schema
-- Money is stored as numeric(18,4) in the currency it was entered in, plus a
-- denormalised *_base column converted with the per-group manual rate table.
-- =============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------
do $$ begin
  create type split_type as enum ('equal', 'exact', 'percent', 'shares', 'items');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role as enum ('owner', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invite_status as enum ('pending', 'accepted', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type settlement_method as enum ('in_app', 'outside');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- Users (mirror of auth.users, upserted on first authenticated request)
-- --------------------------------------------------------------------------
create table if not exists app_users (
  id           uuid primary key,
  email        text        not null unique,
  display_name text        not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create index if not exists app_users_email_idx on app_users (lower(email));

-- --------------------------------------------------------------------------
-- Groups
-- --------------------------------------------------------------------------
create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  description   text        not null default '',
  base_currency char(3)     not null default 'USD',
  created_by    uuid        not null references app_users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists group_members (
  group_id  uuid        not null references groups (id) on delete cascade,
  user_id   uuid        not null references app_users (id) on delete cascade,
  role      member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on group_members (user_id);

create table if not exists group_invites (
  id          uuid          primary key default gen_random_uuid(),
  group_id    uuid          not null references groups (id) on delete cascade,
  email       text          not null,
  invited_by  uuid          not null references app_users (id),
  status      invite_status not null default 'pending',
  created_at  timestamptz   not null default now(),
  accepted_at timestamptz,
  accepted_by uuid          references app_users (id)
);

create unique index if not exists group_invites_pending_idx
  on group_invites (group_id, lower(email))
  where status = 'pending';

create index if not exists group_invites_email_idx
  on group_invites (lower(email))
  where status = 'pending';

-- --------------------------------------------------------------------------
-- Manual per-group exchange rates: 1 unit of `currency` equals rate_to_base
-- units of the base currency. The base currency itself is always 1.
-- --------------------------------------------------------------------------
create table if not exists exchange_rates (
  id           uuid           primary key default gen_random_uuid(),
  group_id     uuid           not null references groups (id) on delete cascade,
  currency     char(3)        not null,
  rate_to_base numeric(18, 8) not null check (rate_to_base > 0),
  updated_at   timestamptz    not null default now(),
  updated_by   uuid           references app_users (id),
  unique (group_id, currency)
);

-- --------------------------------------------------------------------------
-- Expenses. group_id is null for personal (non-shared) expenses.
-- --------------------------------------------------------------------------
create table if not exists expenses (
  id           uuid           primary key default gen_random_uuid(),
  group_id     uuid           references groups (id) on delete cascade,
  owner_id     uuid           references app_users (id),
  description  text           not null,
  notes        text           not null default '',
  category     text           not null default 'general',
  currency     char(3)        not null,
  amount       numeric(18, 4) not null check (amount > 0),
  rate_to_base numeric(18, 8) not null default 1,
  amount_base  numeric(18, 4) not null,
  expense_date date           not null default current_date,
  split_type   split_type     not null default 'equal',
  created_by   uuid           not null references app_users (id),
  created_at   timestamptz    not null default now(),
  updated_at   timestamptz    not null default now(),
  deleted_at   timestamptz,
  constraint expenses_scope_ck check (
    (group_id is not null and owner_id is null) or
    (group_id is null and owner_id is not null)
  )
);

create index if not exists expenses_group_idx
  on expenses (group_id, expense_date desc) where deleted_at is null;
create index if not exists expenses_owner_idx
  on expenses (owner_id, expense_date desc) where deleted_at is null;

-- Who actually paid. Multiple payers per expense are supported.
create table if not exists expense_payers (
  expense_id  uuid           not null references expenses (id) on delete cascade,
  user_id     uuid           not null references app_users (id),
  amount      numeric(18, 4) not null check (amount > 0),
  amount_base numeric(18, 4) not null,
  primary key (expense_id, user_id)
);

-- Who owes what.
create table if not exists expense_splits (
  expense_id  uuid           not null references expenses (id) on delete cascade,
  user_id     uuid           not null references app_users (id),
  amount      numeric(18, 4) not null,
  amount_base numeric(18, 4) not null,
  share_units numeric(12, 4),
  percent     numeric(9, 4),
  primary key (expense_id, user_id)
);

-- Itemised receipts (Pro). Each item is consumed by one or more members.
create table if not exists expense_items (
  id         uuid           primary key default gen_random_uuid(),
  expense_id uuid           not null references expenses (id) on delete cascade,
  name       text           not null,
  amount     numeric(18, 4) not null check (amount >= 0),
  quantity   numeric(12, 3) not null default 1,
  position   integer        not null default 0
);

create index if not exists expense_items_expense_idx on expense_items (expense_id, position);

create table if not exists expense_item_shares (
  item_id uuid not null references expense_items (id) on delete cascade,
  user_id uuid not null references app_users (id),
  primary key (item_id, user_id)
);

-- --------------------------------------------------------------------------
-- Repayments, including payments made outside the app.
-- --------------------------------------------------------------------------
create table if not exists settlements (
  id           uuid              primary key default gen_random_uuid(),
  group_id     uuid              not null references groups (id) on delete cascade,
  from_user_id uuid              not null references app_users (id),
  to_user_id   uuid              not null references app_users (id),
  currency     char(3)           not null,
  amount       numeric(18, 4)    not null check (amount > 0),
  rate_to_base numeric(18, 8)    not null default 1,
  amount_base  numeric(18, 4)    not null,
  method       settlement_method not null default 'in_app',
  note         text              not null default '',
  settled_on   date              not null default current_date,
  created_by   uuid              not null references app_users (id),
  created_at   timestamptz       not null default now(),
  updated_at   timestamptz       not null default now(),
  deleted_at   timestamptz,
  constraint settlements_distinct_parties_ck check (from_user_id <> to_user_id)
);

create index if not exists settlements_group_idx
  on settlements (group_id, settled_on desc) where deleted_at is null;

-- --------------------------------------------------------------------------
-- Activity log
-- --------------------------------------------------------------------------
create table if not exists activity_log (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        references groups (id) on delete cascade,
  actor_id    uuid        not null references app_users (id),
  entity_type text        not null,
  entity_id   uuid,
  action      text        not null,
  summary     text        not null,
  details     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_group_idx on activity_log (group_id, created_at desc);

-- --------------------------------------------------------------------------
-- RLS: every table is locked down. The API connects with the Postgres role
-- (which bypasses RLS) and does its own authorisation; the anon/authenticated
-- keys must never reach these tables directly.
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'app_users', 'groups', 'group_members', 'group_invites', 'exchange_rates',
    'expenses', 'expense_payers', 'expense_splits', 'expense_items',
    'expense_item_shares', 'settlements', 'activity_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
