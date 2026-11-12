-- Idempotency-Key support for POST endpoints: the first response for a key is replayed.
create table idempotency_keys (
  key text not null,
  route text not null,
  status integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (key, route)
);
