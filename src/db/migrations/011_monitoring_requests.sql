-- A visitor who finds a real promise in a preview can ask for it to be monitored. The reviewer
-- promotes the request (project + source + normal extraction and review) or declines it. Requests
-- outlive previews (no foreign key: previews are purged after their listing period).
create table if not exists monitoring_requests (
  id text primary key,
  extraction_id text not null,
  url text not null,
  draft_index integer,
  note text,
  contact text,
  requester_hash text not null,
  status text not null default 'open' check (status in ('open', 'promoted', 'declined')),
  resolution text,
  project_id text,
  source_id text,
  promoted_extraction_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists monitoring_requests_open on monitoring_requests (created_at) where status = 'open';
create unique index if not exists monitoring_requests_one_open on monitoring_requests (extraction_id) where status = 'open';

-- A reviewer's decision not to confirm a draft, with the reason. Shown on the review page.
create table if not exists draft_rejections (
  extraction_id text not null,
  draft_index integer not null,
  reason text not null,
  rejected_by text not null,
  rejected_at timestamptz not null default now(),
  primary key (extraction_id, draft_index)
);
