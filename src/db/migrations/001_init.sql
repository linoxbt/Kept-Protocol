-- Kept Protocol schema v1.
-- Conventions: prefixed ULID text ids; token amounts numeric(78,0) (full uint256);
-- addresses lowercase hex text; timestamps timestamptz (UTC).
-- Evidential tables are append-only, enforced by triggers below, not only by application code.

create table projects (
  id text primary key,
  slug text not null unique,
  name text not null,
  chain_id integer not null,
  token_address text,
  token_symbol text,
  token_decimals integer,
  registration_level text not null default 'unregistered' check (registration_level in ('unregistered', 'self', 'launchpad')),
  is_demo boolean not null default false,
  description text,
  created_at timestamptz not null default now()
);

create table sources (
  id text primary key,
  project_id text not null references projects(id),
  url text,
  kind text not null default 'docs' check (kind in ('docs', 'blog', 'governance', 'social', 'manual', 'demo')),
  watch_interval_s integer not null default 21600,
  status text not null default 'active' check (status in ('active', 'unavailable', 'paused')),
  consecutive_failures integer not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table source_snapshots (
  id text primary key,
  source_id text references sources(id),
  content_sha256 text not null,
  text text not null,
  http_status integer,
  final_url text,
  captured_at timestamptz not null default now()
);
create index source_snapshots_source on source_snapshots (source_id, captured_at desc);

create table extractions (
  id text primary key,
  project_id text references projects(id),
  source_id text references sources(id),
  -- Confirmable extractions point at an immutable snapshot. Try-it previews keep their text here
  -- instead, so they can expire without touching append-only tables.
  snapshot_id text references source_snapshots(id),
  preview_text text,
  preview_url text,
  content_sha256 text not null,
  preview boolean not null default false,
  status text not null check (status in ('running', 'done', 'failed')),
  result jsonb,
  error text,
  requester_hash text,
  target_commitment_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check (preview or snapshot_id is not null)
);
create index extractions_expiry on extractions (expires_at) where preview;

create table commitments (
  id text primary key,
  project_id text not null references projects(id),
  current_version_id text,
  status text not null default 'pending',
  final boolean not null default false,
  status_reason text,
  check_interval_s integer not null default 900,
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  checking_since timestamptz,
  created_at timestamptz not null default now()
);
create index commitments_due on commitments (next_check_at) where final = false;

create table commitment_versions (
  id text primary key,
  commitment_id text not null references commitments(id),
  version integer not null,
  parent_version_id text references commitment_versions(id),
  snapshot_id text not null references source_snapshots(id),
  extraction_id text references extractions(id),
  draft_index integer,
  spec jsonb not null,
  change_kind text not null check (change_kind in ('initial', 'policy_change', 'correction', 'supersede')),
  change_reason text,
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),
  published_at timestamptz not null,
  unique (commitment_id, version)
);
alter table commitments add constraint commitments_current_version_fk foreign key (current_version_id) references commitment_versions(id) deferrable initially deferred;

-- Editorial changes: same structured fields, new snapshot. Not a new version.
create table version_snapshots (
  commitment_version_id text not null references commitment_versions(id),
  snapshot_id text not null references source_snapshots(id),
  note text,
  attached_at timestamptz not null default now(),
  primary key (commitment_version_id, snapshot_id)
);

create table receipts (
  id text primary key,
  kind text not null check (kind in ('verification', 'hindcast', 'extraction')),
  commitment_id text references commitments(id),
  version integer,
  body jsonb not null,
  canonical text not null,
  sha256 text not null unique,
  prev_sha256 text,
  signature text not null,
  signer text not null,
  anchor_id text,
  leaf_index integer,
  created_at timestamptz not null default now()
);
create index receipts_commitment on receipts (commitment_id, created_at desc);
create index receipts_unanchored on receipts (created_at) where anchor_id is null;

create table checks (
  id text primary key,
  commitment_id text not null references commitments(id),
  commitment_version_id text not null references commitment_versions(id),
  method_id text not null,
  method_version integer not null,
  from_block numeric(78, 0),
  to_block numeric(78, 0),
  outcome text,
  status text,
  final boolean,
  computed_value numeric(78, 0),
  providers jsonb,
  receipt_id text references receipts(id),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index checks_commitment on checks (commitment_id, started_at desc);

create table evidence_events (
  id text primary key,
  check_id text not null references checks(id),
  chain_id integer not null,
  tx_hash text not null,
  log_index integer not null,
  block_number numeric(78, 0) not null,
  block_time timestamptz not null,
  from_addr text not null,
  to_addr text not null,
  amount numeric(78, 0) not null,
  kind text not null,
  unique (chain_id, tx_hash, log_index, check_id)
);

create table status_changes (
  id text primary key,
  commitment_id text not null references commitments(id),
  from_status text,
  to_status text not null,
  final boolean not null,
  receipt_id text references receipts(id),
  reason text not null,
  at timestamptz not null default now()
);
create index status_changes_recent on status_changes (at desc);

create table anchors (
  id text primary key,
  merkle_root text not null,
  receipt_count integer not null,
  chain_id integer not null,
  eas_uid text,
  tx_hash text,
  anchored_at timestamptz not null default now()
);

-- Chain log cache: content-addressed by (chain, tx, log index), so repeat scans and replays are free.
create table transfer_cache (
  chain_id integer not null,
  tx_hash text not null,
  log_index integer not null,
  token text not null,
  from_addr text not null,
  to_addr text not null,
  amount numeric(78, 0) not null,
  block_number numeric(78, 0) not null,
  block_time bigint not null,
  primary key (chain_id, tx_hash, log_index)
);
create index transfer_cache_lookup on transfer_cache (chain_id, token, from_addr, block_number);

create table scan_cursors (
  chain_id integer not null,
  token text not null,
  from_addr text not null,
  scanned_from numeric(78, 0) not null,
  scanned_to numeric(78, 0) not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, token, from_addr)
);

create table serv_calls (
  id text primary key,
  extraction_id text,
  call_site text not null,
  model_id text not null,
  prompt_version text not null,
  prompt_sha256 text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  retries integer,
  outcome text not null,
  error text,
  est_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index serv_calls_day on serv_calls (created_at);

create table outbox (
  id bigserial primary key,
  event_type text not null,
  commitment_id text references commitments(id),
  payload jsonb not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index outbox_pending on outbox (created_at) where delivered_at is null;

create table webhooks (
  id text primary key,
  url text not null,
  secret text not null,
  events text[] not null,
  project_id text references projects(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  webhook_id text not null references webhooks(id),
  outbox_id bigint not null references outbox(id),
  status text not null check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  response_code integer,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  primary key (webhook_id, outbox_id)
);

create table hindcast_runs (
  id text primary key,
  commitment_id text not null references commitments(id),
  params jsonb not null,
  result jsonb not null,
  receipt_id text references receipts(id),
  created_at timestamptz not null default now()
);

create table grifter_runs (
  id text primary key,
  mode text not null check (mode in ('offline', 'live')),
  prompt_versions jsonb not null,
  method_versions jsonb not null,
  summary jsonb not null,
  results jsonb not null,
  created_at timestamptz not null default now()
);

create table agent_payments (
  id text primary key,
  payer text,
  network text not null,
  amount text,
  tx_hash text,
  endpoint text not null,
  created_at timestamptz not null default now()
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create table admin_log (
  id bigserial primary key,
  action text not null,
  target text,
  detail jsonb,
  at timestamptz not null default now()
);

-- Demo source pages Kept hosts for clearly labelled demo projects. They are editable on purpose:
-- they stand in for a project's own docs page, so Precedent can show a real change.
create table demo_pages (
  slug text primary key,
  title text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

-- Append-only enforcement ----------------------------------------------------------------------

create or replace function kept_forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP using errcode = 'P0001';
end $$;

create trigger source_snapshots_append_only before update or delete on source_snapshots for each row execute function kept_forbid_change();
create trigger commitment_versions_append_only before update or delete on commitment_versions for each row execute function kept_forbid_change();
create trigger evidence_events_append_only before update or delete on evidence_events for each row execute function kept_forbid_change();
create trigger status_changes_append_only before update or delete on status_changes for each row execute function kept_forbid_change();
create trigger anchors_append_only before update or delete on anchors for each row execute function kept_forbid_change();
create trigger version_snapshots_append_only before update or delete on version_snapshots for each row execute function kept_forbid_change();

-- Receipts allow exactly one change: anchor_id and leaf_index going from null to a value.
create or replace function kept_receipts_guard() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'append-only table receipts: DELETE is not allowed' using errcode = 'P0001';
  end if;
  if OLD.anchor_id is null and NEW.anchor_id is not null
     and (NEW.id, NEW.kind, NEW.commitment_id, NEW.version, NEW.body, NEW.canonical, NEW.sha256, NEW.prev_sha256, NEW.signature, NEW.signer, NEW.created_at)
         is not distinct from
         (OLD.id, OLD.kind, OLD.commitment_id, OLD.version, OLD.body, OLD.canonical, OLD.sha256, OLD.prev_sha256, OLD.signature, OLD.signer, OLD.created_at) then
    return NEW;
  end if;
  raise exception 'append-only table receipts: only a one-time anchor assignment is allowed' using errcode = 'P0001';
end $$;
create trigger receipts_append_only before update or delete on receipts for each row execute function kept_receipts_guard();
