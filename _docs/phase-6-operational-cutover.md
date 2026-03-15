# Phase 6 Operational Cutover

## Purpose

This runbook defines the operational responsibilities, rollout order, backup drills, and cutover checkpoints for deploying the Phase 6 production packaging.

## Ownership Model

Recommended production ownership split:

| Surface | Primary responsibility |
| --- | --- |
| Control-plane SQLite metadata file | Application operator |
| SupaConsole app image and runtime | Application operator |
| Host reverse proxy and TLS | Platform or edge operator |
| `.supaconsole/` state | Application operator |
| `supabase-projects/` workspaces | Application operator |
| Shared Postgres and shared service endpoints | Platform owner for shared modes |
| Backup validation and restore drills | Application operator with DB support |

## Rollout Order

Recommended order for first production enablement:

1. Provision or verify the persistent control-plane SQLite storage mount.
2. Prepare the production env file or secret set from `.env.production.example`.
3. Stand up the control plane with `deploy/docker-compose.production.yml` in a non-public or maintenance state.
4. Wire the host reverse proxy to the loopback-bound SupaConsole port and verify `/api/health` through that proxy.
5. Confirm `.supaconsole/` persistence is mounted and writable.
6. Confirm `supabase-projects/` persistence is mounted and writable.
7. If `full_stack_isolated` remains supported in production, verify the Docker socket mount and run a lifecycle smoke test on a non-critical project.
8. If shared modes are enabled, validate the shared-topology config and shared Postgres credentials before exposing the control plane to users.
9. Perform one backup creation and one restore drill on a staging or disposable project.
10. Only then route user traffic through the host reverse proxy.

## Backup And Restore Drill

Run this drill before production cutover and after every significant deployment change:

1. Create a disposable project in each supported mode for the environment.
2. Apply a small config change that is easy to verify.
3. Run the backup action and confirm a new directory exists under `.supaconsole/backups/<slug>/`.
4. Inspect the backup manifest for warnings.
5. Run restore from the captured backup.
6. Verify the project config, runtime metadata, and mode-specific assets are restored as expected.
7. For shared modes, verify whether SQL dump and restore actually executed or fell back to metadata-only behavior.

Expected outcomes:

- `full_stack_isolated` should restore workspace/config artifacts.
- `shared_core_schema_isolated` should restore workspace/config artifacts and attempt schema-level SQL restore when tooling and access are present.
- `db_isolated` should restore workspace/config artifacts and attempt database-level SQL restore when tooling and access are present.

## Upgrade Workflow

Use this order for upgrades after initial rollout:

1. Capture a backup of the control-plane SQLite database file inside `.supaconsole/`.
2. Capture or snapshot `.supaconsole/`.
3. Capture or snapshot `supabase-projects/` if the environment still manages active full-stack projects.
4. Build and stage the new image.
5. Run `docker compose config` validation for the chosen deployment file.
6. Deploy the new control-plane container.
7. Re-run health, backup, and restore smoke checks.
8. Re-enable user traffic.

## Cutover Checklist

The environment is ready for cutover only if all of the following are true:

- `APP_URL` matches the public URL exposed by the reverse proxy.
- The control-plane database file is readable, writable, and healthy.
- `.supaconsole/` is persistent across container restarts.
- `supabase-projects/` is persistent across container restarts.
- Operators can read lifecycle logs and backup manifests.
- SMTP is configured or intentionally disabled.
- Shared-topology configuration is either valid or intentionally absent.
- One restore drill has completed successfully in the target environment.

## What Not To Do During Cutover

Do not:

1. auto-migrate existing projects from `full_stack_isolated` to a shared mode,
2. delete `.supaconsole/` to force regeneration,
3. mutate `supabase-core/` inside the production deployment,
4. remove Docker access while continuing to advertise `full_stack_isolated` lifecycle support, or
5. treat a metadata-only backup as equivalent to a verified SQL restore for shared modes.

## Review Focus For The Next Stage

The review stage should inspect these production risks closely:

1. Whether the Docker socket exposure is acceptable for the chosen deployment trust boundary.
2. Whether shared-mode backup drills have the required Postgres network reachability and privileges.
3. Whether `.supaconsole/` persistence is included in infrastructure backup policy.
4. Whether reverse-proxy TLS and forwarded-header policy match the intended public deployment.
5. Whether the operator runbook is strict enough around restore verification instead of backup creation alone.