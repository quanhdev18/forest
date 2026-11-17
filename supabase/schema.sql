-- Chạy file này trong Supabase: SQL Editor → New query → Run

-- 1) Toàn bộ dữ liệu Forest của mỗi người dùng (một dòng / người dùng)
create table if not exists public.forest_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.forest_state enable row level security;

create policy "forest_state: đọc của mình" on public.forest_state
  for select using (auth.uid() = user_id);
create policy "forest_state: tạo của mình" on public.forest_state
  for insert with check (auth.uid() = user_id);
create policy "forest_state: sửa của mình" on public.forest_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Thiết bị đã bật thông báo (dùng cho Web Push ở bước sau)
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "push: quản lý của mình" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
