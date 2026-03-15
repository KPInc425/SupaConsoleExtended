<div align="center">
  <img src="public/logo.png" alt="SupaConsole Logo" height="50">
  <br />
  <br />
  A modern, self-hosted dashboard for managing multiple Supabase projects with Docker. Built with Next.js, TypeScript, and Tailwind CSS.
  <br />
  <br />
  
  ![SupaConsole Demo](public/demo.png)
  
  *SupaConsole Dashboard - Manage multiple Supabase projects with ease*
</div>

## Current Status

SupaConsole currently supports three provisioning modes:

- `full_stack_isolated`: the existing per-project local Supabase CLI stack
- `shared_core_schema_isolated`: tenant schemas inside a configured shared Postgres database, with shared service endpoints represented explicitly
- `db_isolated`: dedicated tenant databases inside a configured shared Postgres cluster, with shared service endpoints represented explicitly

The Phase 0 baseline and compatibility guarantees for later rollout work are documented here:

- [_docs/repo-audit.md](_docs/repo-audit.md)
- [_docs/phase-0-baseline.md](_docs/phase-0-baseline.md)
- [_docs/compatibility-contract.md](_docs/compatibility-contract.md)
- [_docs/mode-decision-matrix.md](_docs/mode-decision-matrix.md)
- [_docs/architecture-index.md](_docs/architecture-index.md)
- [_docs/phase-4-operations.md](_docs/phase-4-operations.md)
- [_docs/phase-6-production-blueprint.md](_docs/phase-6-production-blueprint.md)
- [_docs/phase-6-operational-cutover.md](_docs/phase-6-operational-cutover.md)

## ✨ Features

- Create, configure, deploy, pause, inspect, and delete multiple project topologies
- Persist control-plane metadata in PostgreSQL through Prisma
- Generate inspectable per-project runtime env files, topology manifests, and reversible SQL/bootstrap artifacts
- Start full-stack project runtimes through `supabase start` and shared-topology projects through shared Postgres bootstrap operations
- Surface project URLs, topology choice, and runtime status in the dashboard and APIs
- Layer system defaults, shared topology config, per-project config, and secret references into inspectable operational artifacts
- Store lifecycle logs, backup snapshots, and config health data under `.supaconsole/`
- Manage app users, sessions, and email-based flows from the SupaConsole control plane

## 🛠️ Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui
- Control plane backend: Next.js route handlers and Prisma ORM
- Control plane database: PostgreSQL
- App authentication: custom Prisma-backed session records
- Project runtime: Supabase CLI local stack backed by Docker
- Email: Nodemailer with SMTP

## Runtime Model

The repository has two separate concerns:

- SupaConsole itself is the control plane app.
- Each managed project is its own local Supabase runtime workspace under `supabase-projects/<slug>/`.

Current behavior is:

1. Workspace initialization ensures `supabase-projects/` exists and that `supabase-core/` exists.
2. New projects get generated env files plus a rendered topology-specific `supabase/config.toml` or reference config.
3. Full-stack deploy uses `supabase start` from the project workdir.
4. Shared-core and db-isolated deploy paths create or reactivate tenant schemas/databases inside a configured shared Postgres cluster.
5. Pause and delete remain mode-aware and reversible: full-stack uses `supabase stop`, while shared-topology modes disable or drop tenant database assets.

Important: `supabase-core/` is no longer cloned as part of runtime initialization. In this repository it is checked in as reference code only and should be treated as read-only.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker with `docker compose`
- Supabase CLI available on `PATH`
- A PostgreSQL database for SupaConsole metadata

### Installation

1. Clone the repository and install dependencies.

   ```bash
   git clone https://github.com/your-username/supaconsole.git
   cd supaconsole
   npm install
   ```

2. Copy the development env template.

   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and keep the control plane on its default SQLite file unless you are intentionally reworking the app for a different Prisma provider.

   ```env
   DATABASE_URL="file:./dev.db"
   APP_NAME="SupaConsole"
   APP_URL="http://localhost:3000"

   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER="your-email@gmail.com"
   SMTP_PASS="your-app-password"
   ```

4. Generate the Prisma client and initialize the local control plane database.

   ```bash
   npm run db:generate
   npm run db:push
   ```

5. Start the app.

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`, register an account, and initialize the workspace from the dashboard.

### First-Time Workspace Initialization

Initialization is intentionally lightweight. It:

- creates `supabase-projects/` if it does not exist
- ensures `supabase-core/` exists
- does not clone the Supabase monorepo

### Creating and Deploying a Project

When you create a project today, SupaConsole:

1. allocates a unique slug and port range,
2. writes generated env values and inspectable topology artifacts into the project workspace,
3. renders `supabase/config.toml` or shared-topology reference config into `supabase-projects/<slug>/supabase/config.toml`, and
4. persists the instance metadata in the control plane SQLite database.

Deploying that project either runs `supabase start` in the project workdir for `full_stack_isolated`, or provisions tenant schema/database assets into the configured shared Postgres cluster for shared-topology modes and stores discovered runtime topology back into project metadata.

### Shared Topology Configuration

Shared-topology modes require a shared Postgres admin connection plus optional shared service endpoints. Configure them through environment variables or a persisted JSON file at `.supaconsole/shared-topology.json`.

Phase 4 adds a clear layering model:

1. System defaults define file locations for shared topology settings, local secret storage, backups, and lifecycle logs.
2. Shared topology config defines the shared Postgres/admin settings and optional shared service URLs.
3. Per-project config remains inspectable in each generated workspace.
4. Secret references can now be stored separately from non-sensitive config through indirect refs such as `file:projects/<slug>/JWT_SECRET` or `env:SUPACONSOLE_PROJECT_JWT_SECRET`.

Environment variables:

```env
SUPACONSOLE_SHARED_PG_ADMIN_URL="postgresql://postgres:postgres@localhost:5432/postgres"
SUPACONSOLE_SHARED_PG_SCHEMA_DATABASE="shared_core"
SUPACONSOLE_DEFAULT_INSTANCE_MODE="full_stack_isolated"

SUPACONSOLE_SHARED_SERVICE_API_URL="http://localhost:54321"
SUPACONSOLE_SHARED_SERVICE_STUDIO_URL="http://localhost:54323"
SUPACONSOLE_SHARED_SERVICE_AUTH_URL="http://localhost:54321/auth/v1"
SUPACONSOLE_SHARED_SERVICE_STORAGE_URL="http://localhost:54321/storage/v1"
SUPACONSOLE_SHARED_SERVICE_REALTIME_URL="ws://localhost:54321/realtime/v1"
SUPACONSOLE_TOPOLOGY_SETTINGS_FILE=".supaconsole/shared-topology.json"
SUPACONSOLE_SECRET_FILE=".supaconsole/secrets.json"
SUPACONSOLE_BACKUP_DIR=".supaconsole/backups"
SUPACONSOLE_LIFECYCLE_LOG_FILE=".supaconsole/logs/lifecycle.jsonl"
```

### Secret References

Per-project env updates can now keep sensitive values out of the control-plane database where practical by using an indirect input shape:

```json
{
   "JWT_SECRET": {
      "valueSource": "indirect",
      "secretReference": "env:SUPACONSOLE_PROJECT_JWT_SECRET"
   }
}
```

The initial built-in providers are:

- `env:<NAME>` for process environment secrets
- `file:<KEY>` for the local JSON secret store at `.supaconsole/secrets.json`

Generated workspaces remain inspectable. Phase 4 writes `.supaconsole/config.layers.json` and `.supaconsole/secret-references.json` inside each project workspace, while the runtime `.env` files are still materialized for compatibility.
### Backups, Restore, and Health

Phase 4 adds operational surfaces without changing the existing lifecycle routes:

- `GET /api/health` now reports control-plane database and shared-topology config health.
- `GET /api/projects/:id/backup` lists known backups for a project.
- `POST /api/projects/:id/backup` creates a backup snapshot under `.supaconsole/backups/<slug>/<timestamp>/`.
- `POST /api/projects/:id/restore` restores from the most recent backup or a requested `backupId`.

Backups capture inspectable workspace/config artifacts for all modes. Shared-schema and db-isolated modes also attempt a `pg_dump` / `psql` SQL dump/restore when the host tooling is available.

Optional persisted settings file:

```json
{
   "name": "local-shared",
   "defaultMode": "shared_core_schema_isolated",
   "sharedPostgres": {
      "adminUrl": "postgresql://postgres:postgres@localhost:5432/postgres",
      "schemaDatabase": "shared_core"
   },
   "sharedServices": {
      "apiUrl": "http://localhost:54321",
      "studioUrl": "http://localhost:54323"
   }
}
```

If shared-topology settings are absent, SupaConsole keeps the existing compatibility behavior and defaults to `full_stack_isolated`.

## 🏗️ Project Structure

```text
supaconsole/
├── prisma/                   # Prisma schema for SupaConsole metadata
├── src/
│   ├── app/                  # Next.js App Router pages and API routes
│   ├── components/           # UI components
│   ├── lib/
│   │   ├── auth.ts           # Session and password helpers
│   │   ├── db.ts             # Prisma client wiring
│   │   ├── email.ts          # SMTP email helpers
│   │   ├── instances/        # Mode-aware provisioning, runtime inspection, and repository helpers
│   │   └── project.ts        # Compatibility facade over instance orchestration
├── config.toml               # Supabase config template copied into each project
├── supabase-core/            # Read-only embedded reference code
└── supabase-projects/        # Generated project workspaces and runtime files
```

## 🔧 Development

### Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run type-check
npm run db:generate
npm run db:push
npm run db:studio
npm run db:reset
```

### Key App Environment Variables

| Variable | Description | Example |
| --- | --- | --- |
| `DATABASE_URL` | SQLite file path for SupaConsole metadata | `file:./dev.db` |
| `APP_NAME` | Branding used in emails and UI copy | `SupaConsole` |
| `APP_URL` | Base URL used in links and email flows | `http://localhost:3000` |
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Whether SMTP should use TLS immediately | `false` |
| `SMTP_USER` | SMTP username or sender address | `your-email@gmail.com` |
| `SMTP_PASS` | SMTP password or app password | `your-app-password` |

Per-project runtime variables such as `POSTGRES_PORT`, `KONG_HTTP_PORT`, `STUDIO_PORT`, `DATABASE_URL`, `TENANT_SCHEMA`, and `TENANT_DATABASE_NAME` are generated and stored by SupaConsole when a project is created.

Phase 4 operational files are written to:

- `.supaconsole/shared-topology.json`
- `.supaconsole/secrets.json`
- `.supaconsole/backups/`
- `.supaconsole/logs/lifecycle.jsonl`
- `supabase-projects/<slug>/.supaconsole/config.layers.json`
- `supabase-projects/<slug>/.supaconsole/secret-references.json`

## 🐳 Docker Notes

- Full-stack managed runtimes rely on the Supabase CLI, which in turn uses Docker.
- Shared-core and db-isolated runtimes rely on the configured shared Postgres cluster; shared auth/storage/realtime are represented as shared external endpoints during this phase.
- The root `docker-compose.yml` is for deploying SupaConsole itself, not for defining each managed project's runtime stack.
- Existing project lifecycle compatibility is based on `supabase start` and `supabase stop`, with Docker Compose used only as fallback support.

## ⚠️ Resource Usage

Each managed project starts its own local Supabase stack. Resource usage scales with the number of active projects, so host CPU, memory, and port availability matter.

## 🚀 Deployment

For containerized deployment of the SupaConsole app itself, use one of these paths:

- `docker-compose.yml` for the basic control-plane stack without a bundled edge proxy.
- `deploy/docker-compose.production.yml` for the recommended single-host production blueprint when your host already runs the reverse proxy for the subdomain.

That deployment is separate from the per-project local Supabase runtimes managed by the dashboard. The production compose file binds the app to loopback so a host-level NGINX, Caddy, Traefik, or similar proxy can own the public subdomain and TLS.

Phase 6 operational guidance lives here:

- [_docs/phase-6-production-blueprint.md](_docs/phase-6-production-blueprint.md)
- [_docs/phase-6-operational-cutover.md](_docs/phase-6-operational-cutover.md)

The Phase 6 packaging keeps the wrapper-first architecture intact: `supabase-core/` stays read-only, existing full-stack projects are not auto-migrated, and `.supaconsole/` is now treated as persistent control-plane state alongside `supabase-projects/`.

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Commit changes: `git commit -m 'Add amazing feature'`
5. Push to branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

<div align="center">
  <strong>Built with ❤️ for the Supabase community</strong>
</div>
