-- Background work (jobs, extractions) records a heartbeat while its process is alive, so work
-- orphaned by a restart is failed within minutes instead of staying "running" forever.
alter table jobs add column if not exists heartbeat_at timestamptz not null default now();
alter table extractions add column if not exists heartbeat_at timestamptz not null default now();
create index if not exists extractions_running on extractions (heartbeat_at) where status = 'running';
