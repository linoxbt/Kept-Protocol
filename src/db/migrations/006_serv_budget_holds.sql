-- Worst-case cost reserved before each SERV call and released when the call is metered, so
-- concurrent extractions cannot all pass the daily budget check before any cost is recorded.
create table if not exists serv_budget_holds (
  id text primary key,
  amount_usd numeric(12, 6) not null,
  created_at timestamptz not null default now()
);
create index if not exists serv_budget_holds_created on serv_budget_holds (created_at);
