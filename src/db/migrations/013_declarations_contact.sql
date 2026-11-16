-- A project proves it controls an address by signing a message with it. Verified signatures are
-- queued for a reviewer, who uses them as evidence (declared_by_project) when confirming
-- commitments; nothing changes on a record without review.
create table if not exists wallet_declarations (
  id text primary key,
  project text not null,
  address text not null,
  role text not null,
  message text not null,
  signature text not null,
  contact text,
  evidence_url text,
  requester_hash text not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists wallet_declarations_open on wallet_declarations (created_at) where status = 'open';

-- Pilot and contact requests from the For projects page.
create table if not exists contact_requests (
  id text primary key,
  kind text not null check (kind in ('pilot', 'contact')),
  name text not null,
  organisation text,
  contact text not null,
  message text not null,
  requester_hash text not null,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
