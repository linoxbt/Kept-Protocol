-- Background jobs for work that can outlast an HTTP proxy timeout (checks, Hindcast runs, preview
-- checks). The request returns 202 with the job id; the client polls GET /api/v1/jobs/{id}.
create table jobs (
  id text primary key,
  kind text not null,
  target text,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_running on jobs (created_at) where status = 'running';
