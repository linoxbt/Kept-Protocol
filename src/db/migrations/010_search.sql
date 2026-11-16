-- Search: projects by token address (exact) and name; commitment subjects are matched through the
-- current version's spec (a small set; no index needed at this size).
create index if not exists projects_token_address on projects (lower(token_address));
create index if not exists projects_name_lower on projects (lower(name));
