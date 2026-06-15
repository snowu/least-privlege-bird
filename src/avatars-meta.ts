// ─── AVATAR KEYS ────────────────────────────────────────────────────────────
// The avatar/theme keys players can select (mirrors the non-hidden keys of
// THEMES in game.ts — 'wizard' is excluded, it's hidden/WIP). Shared between
// the browser bundle and the submit-score edge function so both validate
// against the same whitelist, same pattern as physics-core.ts.
export const AVATAR_KEYS = [
  'bird', 'penguin', 'monkey', 'rocket', 'bee', 'dragon', 'airplane', 'robot', 'horse',
] as const;

export type AvatarKey = typeof AVATAR_KEYS[number];
