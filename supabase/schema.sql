-- Run once in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  source_url text not null,
  affiliate_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists products_user_created_idx on public.products (user_id, created_at desc);

create table if not exists public.affiliate_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret_iv text not null,
  secret_ciphertext text not null,
  secret_tag text not null,
  updated_at timestamptz not null default now()
);

grant usage on schema public to authenticated;
alter table public.products enable row level security;
alter table public.affiliate_credentials enable row level security;

revoke all on public.products from anon;
revoke all on public.affiliate_credentials from anon;
grant select, insert, delete on public.products to authenticated;
grant select, insert, update on public.affiliate_credentials to authenticated;

drop policy if exists "Users manage their own products" on public.products;
create policy "Users manage their own products" on public.products
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own affiliate credentials" on public.affiliate_credentials;
create policy "Users manage their own affiliate credentials" on public.affiliate_credentials
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
