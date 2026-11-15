-- Anchoring writes its intent (receipt set + signed transaction hash) here BEFORE broadcasting, so a
-- crash or RPC timeout is reconciled by hash instead of attesting the same receipts twice. Rows are
-- deleted once the attestation is final (anchors/receipts are append-only and written only then).
create table if not exists anchor_attempts (
  id text primary key,
  chain_id integer not null,
  merkle_root text not null,
  receipt_ids text[] not null,
  tx_hash text not null,
  created_at timestamptz not null default now()
);

-- One draft becomes at most one commitment version: a double submit cannot create two monitored
-- commitments. Guarded so a database that already holds a duplicate still migrates (the app-level
-- check in confirmDraft covers it there).
do $$
begin
  if not exists (
    select 1 from commitment_versions where extraction_id is not null and draft_index is not null
    group by extraction_id, draft_index having count(*) > 1
  ) then
    create unique index if not exists commitment_versions_one_per_draft
      on commitment_versions (extraction_id, draft_index) where extraction_id is not null and draft_index is not null;
  end if;
end $$;
