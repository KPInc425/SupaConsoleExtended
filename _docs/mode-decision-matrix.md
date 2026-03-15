# Mode Decision Matrix

This matrix describes the currently supported Phase 3 topology choices while keeping the compatibility contract for legacy full-stack projects explicit.

| Mode | Intended shape | Current status | Current code evidence | Phase 1 rule |
| --- | --- | --- | --- | --- |
| Shared Core | Shared control-plane service endpoints plus schema-level isolation in a configured shared Postgres database | Implemented for local/developer baseline | `src/lib/instances/sharedPostgres.ts` provisions schema and role assets; templates render env/config/sql artifacts into `supabase-projects/<slug>/` | Additive only. Shared auth/storage/realtime remain externally configured during this phase |
| DB-Isolated | Shared control-plane service endpoints plus dedicated database per project or tenant in a configured shared Postgres cluster | Implemented for local/developer baseline | `src/lib/instances/sharedPostgres.ts` provisions database and role assets; templates render env/config/sql artifacts into `supabase-projects/<slug>/` | Additive only. Shared service endpoints remain externally configured during this phase |
| Full Stack | Per-project isolated local Supabase stack under `supabase-projects/<slug>/` | Implemented baseline | `src/lib/project.ts` creates workdirs, writes env files, copies `config.toml`, and deploys via `supabase start` | Must remain supported throughout later phases |

## Current Decision

All three modes are now implemented, but they do not offer equal service breadth yet.

## Why Full Stack Is The Baseline

- It matches the actual checked-in orchestration code and remains the fallback/default compatibility mode.
- It matches the current project workspace layout used by existing projects.
- It is the mode existing projects already depend on.

## Future Mode Adoption Rules

1. Shared Core and DB-Isolated require explicit shared Postgres configuration before they can be selected successfully.
2. Full Stack remains the fallback when no explicit shared-topology constraint is requested and shared configuration is absent.
3. Existing full-stack projects must continue to resolve and run unchanged.