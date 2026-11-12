-- Secrets the deployment generates for itself on first start (signing key, session secret, cron
-- secret, admin password hash). Values never leave the server; environment variables override them.
create table if not exists kept_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
