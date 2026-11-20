-- Trang "Đăng TikTok": hàng đợi bài đăng và mẫu nội dung.
-- Chạy file này trong Supabase: SQL Editor → New query → dán vào → Run (chạy lại nhiều lần vẫn an toàn)
-- File video/ảnh nằm trên Cloudflare R2; bảng chỉ lưu đường dẫn (key) của file.

create table if not exists public.tiktok_posts (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  media_type    text not null default 'video' check (media_type in ('video', 'images')),
  media_keys    jsonb not null default '[]'::jsonb,   -- key trên R2, đúng thứ tự đăng
  original_name text,
  description   text,
  title         text,
  caption       text,
  hashtags      text,
  cover_ms      integer,                              -- khung hình làm ảnh bìa video (ms)
  privacy       text check (privacy in ('PUBLIC_TO_EVERYONE', 'SELF_ONLY')),
  scheduled_at  timestamptz not null,
  status        text not null default 'pending'
                check (status in ('pending', 'posting', 'submitted', 'posted', 'failed')),
  qpost_post_id text,
  post_url      text,
  error         text,
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  posted_at     timestamptz
);

create index if not exists tiktok_posts_user_time on public.tiktok_posts (user_id, scheduled_at desc);

alter table public.tiktok_posts enable row level security;

drop policy if exists "tiktok_posts: của mình" on public.tiktok_posts;
create policy "tiktok_posts: của mình" on public.tiktok_posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.tiktok_templates (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.tiktok_templates enable row level security;

drop policy if exists "tiktok_templates: của mình" on public.tiktok_templates;
create policy "tiktok_templates: của mình" on public.tiktok_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cài đặt đăng TikTok của từng người: key QPost riêng + tuỳ chọn mặc định khi đăng
create table if not exists public.tiktok_settings (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  qpost_api_key    text,                                  -- trống = dùng key trên server
  privacy          text not null default 'PUBLIC_TO_EVERYONE'
                   check (privacy in ('PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY')),
  allow_comment    boolean not null default true,
  allow_duet       boolean not null default false,
  allow_stitch     boolean not null default false,
  auto_music       boolean not null default false,        -- video: tự thêm nhạc
  photo_auto_music boolean not null default true,         -- bài ảnh: TikTok tự chọn nhạc
  cover_ms         integer not null default 1000 check (cover_ms between 0 and 600000),
  is_aigc          boolean not null default false,        -- gắn nhãn nội dung AI
  commercial       text[]  not null default '{}',         -- YOUR_BRAND, BRANDED_CONTENT
  updated_at       timestamptz not null default now()
);

alter table public.tiktok_settings enable row level security;

drop policy if exists "tiktok_settings: của mình" on public.tiktok_settings;
create policy "tiktok_settings: của mình" on public.tiktok_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Chia sẻ kênh: chủ kênh (A) thêm email người khác (B) để B cùng đăng lên kênh TikTok của A.
-- B không đọc được key QPost của A: server đọc bằng khoá service role, trình duyệt không bao giờ nhận key.
create table if not exists public.tiktok_members (
  owner_id     uuid not null references auth.users (id) on delete cascade,
  member_email text not null check (member_email = lower(member_email) and member_email like '%_@_%'),
  created_at   timestamptz not null default now(),
  primary key (owner_id, member_email)
);

alter table public.tiktok_members enable row level security;

drop policy if exists "tiktok_members: chủ kênh quản lý" on public.tiktok_members;
create policy "tiktok_members: chủ kênh quản lý" on public.tiktok_members
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Bài đăng thuộc kênh nào (để đồng bộ trạng thái bằng đúng key của kênh đó)
alter table public.tiktok_posts add column if not exists channel_owner_id uuid references auth.users (id) on delete set null;

-- Bài đăng thuộc dự án nào trong Forest (id dự án trong mục Project), để tính KPI video/tháng
alter table public.tiktok_posts add column if not exists project_id text check (char_length(project_id) <= 64);
create index if not exists tiktok_posts_user_project on public.tiktok_posts (user_id, project_id, scheduled_at);

-- Quyền xem từng bài: thêm "Bạn bè" (MUTUAL_FOLLOW_FRIENDS)
alter table public.tiktok_posts drop constraint if exists tiktok_posts_privacy_check;
alter table public.tiktok_posts add constraint tiktok_posts_privacy_check
  check (privacy in ('PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'));
