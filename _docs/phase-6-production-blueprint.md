# Phase 6 Production Blueprint

## Scope

Phase 6 packages the SupaConsole control plane for production deployment without changing the provisioning contract for existing managed projects.

The goals are:

- make the control-plane deployment path explicit,
- persist the operational state added in Phase 4,
- provide a minimal host-level reverse-proxy template,
- keep the wrapper-first architecture intact, and
- avoid any rewrite of the vendored `supabase-core/` reference tree.

## Recommended Topology

Single-host baseline:

1. Internet or private network clients reach your existing host reverse proxy.
2. The host reverse proxy forwards traffic to the SupaConsole Next.js app on a loopback-bound port.
3. The app reads and writes control-plane metadata in a persisted SQLite file under `.supaconsole/`.
4. The app persists generated project workspaces under `supabase-projects/`.
5. The app persists shared topology config, secrets, backups, and lifecycle logs under `.supaconsole/`.
6. Full-stack managed projects still use the host Docker engine through the mounted Docker socket.
7. Shared-schema and db-isolated projects use the configured shared Postgres and shared service endpoints; they are not replaced by the control-plane compose stack.

Text diagram:

```text
clients
  -> host reverse proxy
  -> SupaConsole app
    -> SQLite control-plane metadata in .supaconsole/
     -> Docker socket for full_stack_isolated lifecycle
     -> .supaconsole persistent state
     -> supabase-projects persistent workspaces
     -> optional shared Postgres / shared service endpoints for shared modes
```

## Deployment Artifacts

The repo now ships two deployment entrypoints:

| Artifact | Use |
| --- | --- |
| `docker-compose.yml` | Basic control-plane deployment without bundled proxy |
| `deploy/docker-compose.production.yml` | Recommended production stack that publishes the app on loopback for a host-managed reverse proxy |
| `deploy/nginx/supaconsole.conf` | Minimal host NGINX example for HTTP forwarding, websocket upgrades, and forwarded headers |
| `Dockerfile` | Standalone Next.js image with Docker CLI, Supabase CLI, and PostgreSQL client tools |

## Packaging Decisions

### Persist `.supaconsole`

Phase 4 made `.supaconsole/` operationally significant. Production packaging now treats it as first-class persistent state because it contains:

- shared topology settings,
- local secret references,
- backup artifacts, and
- lifecycle logs.

Persisting only `supabase-projects/` is insufficient for reliable backup/restore drills or shared-topology operations.

### Keep `supabase-core/` Read-Only

The production image builds from the current repo but does not introduce any new mutation path for `supabase-core/`.

That remains the boundary:

- `supabase-core/` is reference code only.
- Generated project workspaces live under `supabase-projects/`.
- Control-plane state lives under `.supaconsole/`.

### Add PostgreSQL Client Tooling

The runner image now includes PostgreSQL client tooling so shared-schema and db-isolated backup or restore drills can execute `pg_dump` and `psql` from inside the deployed control plane.

This does not change the best-effort contract from Phase 4. If external network policy, credentials, or shared-database privileges are missing, the drills still fail in a bounded way and the manifest should capture warnings.

## Runtime Boundaries

Production rollout must preserve these boundaries:

1. Existing `full_stack_isolated` projects are not auto-migrated.
2. Existing project folders under `supabase-projects/<slug>/` are not rewritten just because production packaging changed.
3. Shared-schema and db-isolated modes remain opt-in and depend on explicit shared-topology configuration.
4. The root compose and production compose deploy the control plane only, not the per-project Supabase runtime graph.
5. The Docker socket mount remains required if the control plane is expected to manage `full_stack_isolated` projects from inside the container.

## Recommended Environment Strategy

Use `.env.production.example` as the source template for:

- control-plane SQLite path,
- public app origin,
- SMTP configuration,
- shared-topology settings, and
- Phase 4 operational file locations.

Recommended practice:

1. Keep secrets in your deployment secret store or orchestrator, not committed env files.
2. Keep `APP_URL` set to the public HTTPS origin presented by the reverse proxy.
3. Keep `DOCKER_SOCKET_PATH` mounted only for environments that must manage full-stack runtimes.
4. Treat shared-topology values as deployment-scoped configuration, not per-project mutations.

## Recommended Production Path

For an internet-facing single-host deployment:

1. Populate production secrets from `.env.production.example`.
2. Use `deploy/docker-compose.production.yml`.
3. Point your host reverse proxy at `127.0.0.1:${APP_PORT}` and terminate TLS there.
4. Persist both SupaConsole state volumes: `.supaconsole/` and `supabase-projects/`.
5. Verify `/api/health` through the host reverse proxy before enabling operator traffic.

## Upgrade Boundaries

Packaging changes alone must not be used as a migration trigger. An upgrade is in bounds only when it:

- rebuilds the control-plane image,
- preserves the control-plane SQLite database,
- preserves `.supaconsole/`,
- preserves `supabase-projects/`, and
- keeps the same mode-specific lifecycle semantics for existing projects.

The review stage should reject any future deployment change that implicitly:

- rewrites mode metadata for existing projects,
- mutates `supabase-core/`,
- drops `.supaconsole/` state, or
- removes Docker access while still claiming support for `full_stack_isolated` lifecycle operations.