-- Independent recounts on the confirmation provider, resumable across checks. A shortfall (for
-- example a burn below target) is only a breach once a second provider has recounted the whole
-- period; long periods are recounted a few million blocks per check.
create table confirm_recounts (
  spec_sha256 text primary key,
  chain_id integer not null,
  from_block numeric(78,0) not null,
  to_block numeric(78,0) not null,
  scanned_to numeric(78,0) not null,
  transfers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Disputes. Anyone may open one; the admin accepts it for review (the commitment then shows
-- Disputed until it is resolved) or rejects it. Every decision is kept.
create table disputes (
  id text primary key,
  commitment_id text not null references commitments(id),
  reason text not null,
  evidence_url text,
  contact text,
  requester_hash text,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'resolved')),
  resolution text,
  opened_at timestamptz not null default now(),
  decided_at timestamptz,
  resolved_at timestamptz
);
create index disputes_by_commitment on disputes (commitment_id, status);
create index disputes_open on disputes (status, opened_at) where status in ('open', 'accepted');
