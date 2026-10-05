-- Saved estimates behind share links. Visitors never touch this table: the Go function
-- on Vercel holds the secret key and calls save_estimate() or reads one row by slug.

create table if not exists public.estimates (
  slug       text primary key check (slug ~ '^[A-Za-z0-9]{12}$'),
  body       jsonb not null,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

create index if not exists estimates_ip_recent on public.estimates (ip_hash, created_at);
create index if not exists estimates_recent on public.estimates (created_at);

-- Supabase grants new tables to anon and authenticated by default; take that back.
alter table public.estimates enable row level security;
revoke all on table public.estimates from anon, authenticated;

-- Saves one estimate. The limits live here, next to the data, because a serverless
-- function cannot keep a counter between requests.
create or replace function public.save_estimate(p_slug text, p_body jsonb, p_ip_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  per_ip int;
  per_day int;
begin
  if octet_length(p_body::text) > 262144 then
    raise exception 'The estimate is larger than 256 KB.';
  end if;

  select count(*) into per_ip from estimates
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if per_ip >= 30 then
    raise exception 'Too many saves from this network in the last hour. Try again later.';
  end if;

  select count(*) into per_day from estimates where created_at > now() - interval '1 day';
  if per_day >= 5000 then
    raise exception 'The daily save limit for the site is reached. Try again tomorrow.';
  end if;

  insert into estimates (slug, body, ip_hash) values (p_slug, p_body, p_ip_hash);
  return p_slug;
end;
$$;

revoke all on function public.save_estimate(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_estimate(text, jsonb, text) to service_role;
