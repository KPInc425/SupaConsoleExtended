# Repo Audit Report

## Scope

This Phase 0 audit is grounded in the checked-in implementation and documents the current compatibility baseline without introducing new provisioning behavior.

## Current System Summary

SupaConsole is a Next.js control plane that:

- stores users, sessions, project records, and environment variables in PostgreSQL via Prisma,
- creates per-project local workspaces under `supabase-projects/<slug>/`,
- writes generated `.env` files for each project,
- starts project runtimes through the Supabase CLI, and
- persists discovered runtime URLs and metadata back into the control-plane database.

Only one provisioning mode is implemented today: `full_stack_isolated`.

## Primary Implementation Entrypoints

| Path | Current responsibility |
| --- | --- |
| `src/lib/project.ts` | Main lifecycle orchestration for initialize, create, update env, deploy, pause, and delete |
| `src/app/api/projects/route.ts` | List projects and create a project through the control-plane API |
| `src/app/api/projects/[id]/deploy/route.ts` | Deploy a project by invoking the orchestration layer |
| `src/app/api/projects/initialize/route.ts` | Initialize the workspace directories |
| `src/app/api/projects/[id]/env/route.ts` | Read and update persisted per-project env vars |
| `src/app/api/projects/[id]/status/route.ts` | Query `supabase status -o json` for a project |
| `src/app/api/projects/stream-logs/route.ts` | Stream `supabase start` logs to the UI over SSE |
| `prisma/schema.prisma` | Control-plane persistence model and future-mode contract fields |
| `config.toml` | Repo-root Supabase config template copied into each project workspace |
| `docker-compose.yml` | Deployment template for the SupaConsole control plane itself |
| `Dockerfile` | Container build for the SupaConsole control plane app |

## Lifecycle Baseline Verified In Code

### Initialize

`initializeSupabaseCore()` in `src/lib/project.ts` ensures:

- `supabase-projects/` exists,
- `supabase-core/` exists, and
- no upstream Supabase repo clone is performed.

If `supabase-core/` is missing, the app creates the directory and a placeholder README. In this repository, the embedded `supabase-core/` tree is reference material and should be treated as read-only.

### Create

Project creation currently:

1. requires the Supabase CLI to be available on `PATH`,
2. resolves an instance profile through the metadata layer,
3. defaults legacy or incomplete mode input back to `full_stack_isolated`, `isolated_stack`, and `supabase_cli_local`,
4. allocates a unique slug and an available base port range,
5. creates `supabase-projects/<slug>/`,
6. writes `supabase-projects/<slug>/.env` and `supabase-projects/<slug>/docker/.env`,
7. persists the project plus env vars in PostgreSQL, and
8. copies repo-root `config.toml` into `supabase-projects/<slug>/supabase/config.toml`.

### Deploy

Project deploy is CLI-first:

1. load the stored project layout,
2. run Docker and connectivity checks,
3. rebase ports if local conflicts are detected,
4. run `supabase start` in the project workdir,
5. best-effort verify container state,
6. run `supabase status -o json`, and
7. persist discovered URLs and runtime metadata.

The deploy path updates the project status to `active` even if the final status query fails after a successful start.

### Pause and Delete

- Pause runs `supabase stop --workdir .`, with `docker compose stop` fallback.
- Delete runs `supabase stop --workdir .`, falls back to `docker compose down --volumes --remove-orphans`, removes the project directory, and then removes project records and env vars from PostgreSQL.

## Persistence Model

`prisma/schema.prisma` confirms that the control plane uses SQLite for portable local metadata storage.

The `Project` model already includes future-rollout fields:

- `provisioningMode`
- `topologyKind`
- `runtimeKind`
- `topologyMetadata`
- `runtimeMetadata`
- `secretMetadata`

Those fields expand the metadata contract but do not mean multiple provisioning modes are implemented today.

## Current Runtime And Config Surfaces

### Control Plane App

- `DATABASE_URL` defaults to a local SQLite file.
- App email flows use `APP_NAME`, `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS`.
- Session management is custom Prisma-backed session storage in `src/lib/auth.ts`.

### Managed Project Runtime

- Project runtimes are local Supabase CLI stacks.
- Runtime env values are generated and persisted both in the database and project `.env` files.
- Repo-root `config.toml` uses `env(...)` placeholders so copied project config resolves values from the per-project env file.

### Deployment Template For SupaConsole Itself

- Root `docker-compose.yml` and `Dockerfile` are for deploying SupaConsole, not for defining each managed project's runtime topology.
- The compose template still contains legacy or optional variables such as `NEXTAUTH_SECRET`, `SMTP_PASSWORD`, `SMTP_FROM`, and commented Authentik/OIDC sections.

## Documentation Drift Resolved In Phase 0

This phase aligns repository docs with the current code by making these points explicit:

- SQLite is the live control-plane database provider for the app itself.
- The implemented provisioning baseline is full-stack isolated local Supabase via the Supabase CLI.
- `supabase-core/` is checked in as read-only reference code, not cloned or mutated during initialization.
- Root deployment assets are for the SupaConsole control plane, not for per-project runtime provisioning.

## Architecture Gaps And Constraints

These gaps are real and should constrain later phases:

1. Multi-mode metadata exists, but orchestration still only implements `full_stack_isolated`.
2. Secret persistence remains inline env-value storage even though `secretMetadata` allows future indirection.
3. Deploy success is partially best-effort because status persistence can fail after a successful start.
4. The production deployment template still exposes some env naming drift relative to the current app runtime.
5. Embedded `supabase-core/` must remain a read-only reference tree unless a later phase introduces a deliberate and documented migration strategy.

## Phase 1 Guardrails

Phase 1 must preserve these assumptions:

1. Existing `full_stack_isolated` projects remain deployable without migration.
2. `supabase start` remains the authoritative start path for existing projects.
3. Existing project workspaces remain valid under `supabase-projects/<slug>/`.
4. New provisioning modes are additive and opt-in.
5. Unknown or incomplete mode metadata must continue to normalize safely to the current full-stack defaults.