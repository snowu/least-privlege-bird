-- Add a nullable avatar column to scores: tracks which avatar/theme key the
-- player's current high score was achieved with. NULL for pre-existing rows
-- (no backfill — the leaderboard falls back to a default avatar for those).
alter table public.scores add column if not exists avatar text;

-- Leaderboard reads (anon) need the new column too — extends the existing
-- least-privilege grant from (name, score) to (name, score, avatar).
grant select (name, score, avatar) on public.scores to anon;
