/**
 * `lib/metrics` — every number on the HR / CEO dashboards, as pure functions
 * (CLAUDE.md §7 指標定義, §8; PLAN T19 / T23). Pages load rows, take `now`
 * once, call these, render. Nothing here imports `lib/db` at runtime (row
 * types only) or reads a clock.
 */
export * from "./rates";
export * from "./department";
export * from "./newcomer";
export * from "./summary";
export * from "./dashboard";
