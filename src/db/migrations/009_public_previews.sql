-- Previews of public URLs are listed on the public Explore page and kept for 30 days; previews of
-- pasted text stay reachable only by their own link and still expire after 24 hours.
update extractions set expires_at = created_at + interval '30 days'
  where preview and preview_url is not null and expires_at is not null;
create index if not exists extractions_public_previews on extractions (created_at desc) where preview and preview_url is not null;
