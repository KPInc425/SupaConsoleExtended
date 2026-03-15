# Architecture Index

This is a concise file-level index for the current control-plane implementation.

## Control Plane API

| Path | Purpose |
| --- | --- |
| `src/app/api/projects/route.ts` | List projects and create projects |
| `src/app/api/projects/initialize/route.ts` | Initialize workspace directories |
| `src/app/api/projects/[id]/deploy/route.ts` | Start a project runtime |
| `src/app/api/projects/[id]/env/route.ts` | Read and update project env vars |
| `src/app/api/projects/[id]/status/route.ts` | Read runtime status from the Supabase CLI |
| `src/app/api/projects/[id]/route.ts` | Delete a project |
| `src/app/api/projects/[id]/backup/route.ts` | List and create project backups |
| `src/app/api/projects/[id]/restore/route.ts` | Restore project artifacts from a backup |
| `src/app/api/projects/stream-logs/route.ts` | Stream deploy logs |
| `src/app/api/health/route.ts` | Control-plane health plus shared-topology config readiness |

## Core Orchestration And Persistence

| Path | Purpose |
| --- | --- |
| `src/lib/project.ts` | Compatibility facade exposing the legacy project service API |
| `src/lib/instances/orchestrator.ts` | Mode-aware lifecycle dispatch for create, deploy, stop, inspect, and delete |
| `src/lib/instances/fullStack.ts` | Concrete full-stack isolated lifecycle implementation |
| `src/lib/instances/localRuntime.ts` | Docker and container-runtime environment preparation |
| `src/lib/instances/ports.ts` | Port probing and base-port allocation |
| `src/lib/instances/metadata.ts` | Instance profile resolution, runtime metadata, and filesystem layout |
| `src/lib/instances/repository.ts` | Prisma-backed project persistence helpers |
| `src/lib/instances/service.ts` | Provisioning service facade used by exported project functions |
| `src/lib/instances/workspace.ts` | Project workspace path resolution, env writing, config copy |
| `src/lib/instances/env.ts` | Generated runtime env defaults and port allocation metadata |
| `src/lib/config/defaults.ts` | System-default file locations for topology, secrets, backups, and lifecycle logs |
| `src/lib/config/project.ts` | Project config layer snapshots and shared-topology health evaluation |
| `src/lib/backup/service.ts` | Backup creation, restore, and listing helpers |
| `src/lib/observability/lifecycle.ts` | Structured lifecycle logging |
| `src/lib/secrets/project-env.ts` | Env materialization and merge logic |
| `src/lib/secrets/provider.ts` | Secret provider abstraction with local-file and process-env implementations |
| `src/lib/secrets/normalization.ts` | Env alias normalization |
| `src/lib/db.ts` | Prisma client wiring |
| `src/lib/auth.ts` | Password hashing and custom session validation |
| `src/lib/email.ts` | SMTP email flows |

## Contract And Config Surfaces

| Path | Purpose |
| --- | --- |
| `prisma/schema.prisma` | Control-plane schema and compatibility fields |
| `config.toml` | Template copied into each generated project workspace |
| `.env.example` | Development env example for the control plane |
| `.env.production.example` | Production-oriented env example and template notes |
| `docker-compose.yml` | SupaConsole deployment template |
| `Dockerfile` | SupaConsole production image build |
| `deploy/docker-compose.production.yml` | Recommended single-host production stack with bundled NGINX reverse proxy |
| `deploy/nginx/supaconsole.conf` | NGINX reverse-proxy example aligned with the control-plane app |
| `_docs/phase-6-production-blueprint.md` | Production packaging, persistence, and deployment blueprint |
| `_docs/phase-6-operational-cutover.md` | Upgrade boundaries, backup drills, rollout order, and cutover guidance |

## Read-Only Reference Tree

| Path | Purpose |
| --- | --- |
| `supabase-core/` | Embedded reference copy of upstream Supabase code; not a mutable runtime source of truth |

## Generated Runtime Area

| Path | Purpose |
| --- | --- |
| `supabase-projects/<slug>/` | Generated per-project runtime workspace |
| `supabase-projects/<slug>/.env` | Project runtime env file |
| `supabase-projects/<slug>/docker/.env` | Docker-facing env file for the project runtime |
| `supabase-projects/<slug>/supabase/config.toml` | Copied per-project Supabase config template |
| `supabase-projects/<slug>/.supaconsole/config.layers.json` | Inspectable configuration layering snapshot |
| `supabase-projects/<slug>/.supaconsole/secret-references.json` | Inspectable secret reference manifest |