-- Following one commitment: a public webhook scoped to that commitment. It stays inactive until the
-- follower proves they control the endpoint (a code sent to it), and is managed with a token whose
-- hash only is stored. Admin-registered webhooks are unaffected (commitment_id null, follower false).
alter table webhooks add column if not exists commitment_id text;
alter table webhooks add column if not exists follower boolean not null default false;
alter table webhooks add column if not exists manage_token_hash text;
alter table webhooks add column if not exists verify_code_hash text;
alter table webhooks add column if not exists verified_at timestamptz;
create index if not exists webhooks_commitment on webhooks (commitment_id) where commitment_id is not null;
