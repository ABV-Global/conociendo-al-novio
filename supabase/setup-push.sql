create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  language text not null default 'es' check (language in ('es', 'en', 'pt-BR')),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;

comment on table public.push_subscriptions is
  'Web Push subscriptions. Accessible only through service-role Edge Functions.';

