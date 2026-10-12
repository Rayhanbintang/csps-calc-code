-- Limits for the AI reviewer (api/advise.go). Groq's free plan allows about 1,000
-- requests a day, so the site keeps below that and one visitor cannot use it all up.
-- Rows hold only a salted IP hash and the time, and go after two days.

create table if not exists public.advise_calls (
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

create index if not exists advise_calls_ip_recent on public.advise_calls (ip_hash, created_at);
create index if not exists advise_calls_recent on public.advise_calls (created_at);

alter table public.advise_calls enable row level security;
revoke all on table public.advise_calls from anon, authenticated;

-- Counts one review, or raises the limit the visitor hit.
create or replace function public.advise_allow(p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  per_ip int;
  per_day int;
begin
  delete from advise_calls where created_at < now() - interval '2 days';

  select count(*) into per_ip from advise_calls
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if per_ip >= 10 then
    raise exception 'You asked for 10 reviews in the last hour. Try again later.';
  end if;

  select count(*) into per_day from advise_calls where created_at > now() - interval '1 day';
  if per_day >= 800 then
    raise exception 'The AI reviewer used its free allowance for today. Try again tomorrow.';
  end if;

  insert into advise_calls (ip_hash) values (p_ip_hash);
end;
$$;

revoke all on function public.advise_allow(text) from public, anon, authenticated;
grant execute on function public.advise_allow(text) to service_role;
