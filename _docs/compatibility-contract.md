# Compatibility Contract

## Purpose

This document defines the compatibility guarantees for the current full-stack project model and the rules for any future multi-mode rollout.

## Current Supported Contract

An existing SupaConsole project is considered compatible when it can be resolved to this effective instance profile:

- `provisioningMode = full_stack_isolated`
- `topologyKind = isolated_stack`
- `runtimeKind = supabase_cli_local`

If stored values are missing or invalid, the application must continue to normalize to those defaults for legacy compatibility.

## Stable Persistence Fields

Later phases may add new values, but they must preserve the meaning of these existing fields:

| Field | Current meaning | Compatibility rule |
| --- | --- | --- |
| `projects.provisioningMode` | High-level provisioning mode | Existing `full_stack_isolated` rows remain supported without migration |
| `projects.topologyKind` | Runtime isolation shape | Existing `isolated_stack` rows keep current behavior |
| `projects.runtimeKind` | Runtime provider | Existing `supabase_cli_local` rows keep CLI-driven lifecycle management |
| `projects.topologyMetadata.projectRootRelative` | Relative project workspace path | Existing paths remain valid and must not be rewritten implicitly |
| `projects.topologyMetadata.dockerDirRelative` | Relative Docker workdir | Existing stop/down flows continue to resolve from this path |
| `projects.topologyMetadata.composeProjectName` | Compose project identity | Existing names remain stable for fallback Docker operations |
| `projects.runtimeMetadata.workdirRelative` | Runtime working directory | Existing projects continue to use the project root workdir |
| `projects.runtimeMetadata.lastKnownUrls` | Last discovered service URLs | Future rollouts may extend, but must not break existing keys |
| `projects.secretMetadata.strategy` | Secret materialization strategy | Existing `inline_env` projects remain readable and deployable |

## Stable Filesystem Contract

The current full-stack project layout is part of the compatibility baseline:

- `supabase-projects/<slug>/`
- `supabase-projects/<slug>/.env`
- `supabase-projects/<slug>/docker/.env`
- `supabase-projects/<slug>/supabase/config.toml`

Future modes may use additional files or directories, but they must not break the lifecycle of existing full-stack projects that already depend on this layout.

## Stable Runtime Contract

For existing full-stack projects:

- Create persists metadata and writes the generated env files.
- Deploy runs `supabase start` from the project workdir.
- Pause runs `supabase stop` with Docker Compose fallback.
- Delete runs `supabase stop` or `docker compose down`, then removes the project directory and metadata.

Later phases may add new orchestrators, but they must not silently reroute existing full-stack projects to a different runtime path.

## Multi-Mode Rollout Rules

Any rollout beyond `full_stack_isolated` must follow these rules:

1. New modes are additive.
2. Existing projects are not auto-migrated just because the code understands new modes.
3. Mode selection must be explicit at project creation time or via a deliberate migration path.
4. Existing projects keep their current mode, topology, filesystem layout, and runtime commands.
5. Unknown or partially populated mode fields must continue to fail safe to the current full-stack defaults.

## `supabase-core` Contract

`supabase-core/` has two distinct meanings that later phases must keep separate:

- In this repository, it is a checked-in read-only reference tree used for source inspection.
- In runtime code, initialization only guarantees that the directory exists; provisioning does not depend on cloning or mutating the monorepo.

Future work must not reintroduce an implicit clone step for existing projects.

## Non-Goals For Phase 0

This phase does not:

- introduce shared-core provisioning
- introduce dedicated database mode
- move secrets to an external manager
- change the runtime engine for existing projects
- rewrite existing project folders

## Exit Criteria For Future Phases

A future phase is compatible only if an unchanged `full_stack_isolated` project created before the rollout can still:

1. appear correctly in the dashboard,
2. update env vars,
3. deploy successfully,
4. pause successfully, and
5. delete cleanly.