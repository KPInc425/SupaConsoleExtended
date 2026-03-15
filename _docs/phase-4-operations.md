# Phase 4 Operations, Config, and Secrets

Phase 4 adds incremental operational hardening around four explicit layers:

1. System defaults: file locations and defaults for shared topology settings, local secret storage, backups, and lifecycle logs.
2. Shared topology config: the shared Postgres/admin connection and optional shared service URLs.
3. Per-project config: the non-sensitive configuration persisted for a single generated workspace.
4. Secret references: indirect refs that resolve through a provider instead of persisting the plaintext secret in the control-plane database.

## New Files And Surfaces

- `.supaconsole/shared-topology.json`
- `.supaconsole/secrets.json`
- `.supaconsole/backups/<slug>/<timestamp>/`
- `.supaconsole/logs/lifecycle.jsonl`
- `supabase-projects/<slug>/.supaconsole/config.layers.json`
- `supabase-projects/<slug>/.supaconsole/secret-references.json`

## Secret Provider Model

The initial abstraction intentionally stays local-first but additive:

- `file:<KEY>` resolves from `.supaconsole/secrets.json`
- `env:<NAME>` resolves from the process environment

Later phases can add Vault, Doppler, or other providers behind the same reference model without changing the project env mutation shape.

## Backup / Restore Behavior

- `full_stack_isolated`: workspace/config snapshot backup and restore
- `shared_core_schema_isolated`: workspace/config snapshot plus best-effort schema-level SQL dump/restore when `pg_dump` and `psql` are available
- `db_isolated`: workspace/config snapshot plus best-effort database-level SQL dump/restore when `pg_dump` and `psql` are available

If SQL tooling is absent, backups still succeed as metadata/workspace snapshots and record warnings in the backup manifest.

## Structured Lifecycle Logging

Every create, env update, deploy, inspect, stop, delete, backup, and restore operation now emits JSON lines to `.supaconsole/logs/lifecycle.jsonl` with:

- timestamp
- operation
- start/finish phase
- project id / slug when available
- mode / topology / runtime kind
- duration
- success or failure details

## Health Visibility

`GET /api/health` now reports:

- database reachability for the SupaConsole control plane
- shared topology settings source
- shared Postgres readiness
- shared service endpoint visibility

The route remains additive and keeps compatibility with the existing simple health check behavior.