# SupaConsoleExtended — Agent Evaluation & Implementation Plan

## GOAL
Evaluate the SupaConsoleExtended repository and produce recommendations, refactors, and implementation steps that support:
- Shared Supabase services where possible
- Optional isolated Postgres or auth instances when needed
- Optional full-stack Supabase instances only when justified
- A production-ready deployment path
- Modular, maintainable, future-proof architecture

Your output should be:
- Specific
- Code-aware
- Aligned with Supabase architecture
- Safe to implement incrementally

---

# PHASE 1 — REPO ANALYSIS
Analyze the repository and produce a structured report covering:

## 1. Folder Structure
- Identify core modules, scripts, and orchestration logic.
- Flag unclear, redundant, or tightly coupled areas.
- Suggest a clean modular layout (e.g., /core, /services, /instances, /templates).

## 2. Docker & Supabase Integration
- Inspect docker-compose files.
- Identify which services are duplicated unnecessarily.
- Determine which services can be shared globally.
- Identify where environment variables or secrets need consolidation.

## 3. Instance Provisioning Logic
- Review how new Supabase stacks are created.
- Identify opportunities for:
  - schema-based isolation
  - database-per-tenant isolation
  - full-stack isolation
- Suggest a unified provisioning API.

## 4. Configuration & Secrets
- Identify hardcoded values.
- Suggest a centralized secrets pattern.
- Recommend .env templates and environment layering.

## 5. Production Deployment Readiness
- Evaluate:
  - logging
  - health checks
  - backups
  - migrations
  - monitoring
- Suggest improvements for production stability.

---

# PHASE 2 — ARCHITECTURE RECOMMENDATIONS
Produce a plan that supports the following modes:

## MODE A — Shared Core Services
Shared:
- Auth
- Storage
- Realtime
- Edge Runtime
- Kong
- Studio (optional)

Isolated:
- Postgres schemas per tenant

## MODE B — Semi-Isolated Services
Shared:
- Auth
- Storage
- Realtime

Isolated:
- Dedicated Postgres instance per tenant

## MODE C — Full Stack Instances (Only When Needed)
Each instance includes:
- Postgres
- Auth
- Storage
- Realtime
- Kong
- Edge Runtime

Agent should:
- Define when each mode is appropriate
- Provide a decision tree for provisioning
- Suggest code changes to support all modes cleanly

---

# PHASE 3 — IMPLEMENTATION PLAN
For each recommendation, provide:

## 1. File-level changes
- Which files to create, modify, or delete
- Proposed folder structure
- Example code blocks

## 2. Docker improvements
- Compose templates for shared vs isolated stacks
- Resource optimization
- Optional service toggles

## 3. Provisioning API
Design or refine:
- `createInstance()`
- `createSchema()`
- `createDatabase()`
- `createFullStackInstance()`

## 4. Environment & Secrets
- Generate `.env.example`
- Recommend secret injection strategy
- Suggest Doppler/Vault/Supabase Secrets integration

## 5. Production Deployment
Provide:
- A recommended deployment layout
- Reverse proxy config (NGINX or Traefik)
- Backup strategy
- Migration workflow
- Monitoring/logging setup

---

# PHASE 4 — OUTPUT FORMAT
Your final output should include:

## 1. A full repo audit
## 2. A proposed architecture diagram (text-based)
## 3. A recommended folder structure
## 4. A provisioning flow diagram
## 5. A step-by-step implementation plan
## 6. Code snippets for all recommended changes
## 7. A production deployment guide

---

# PHASE 5 — SAFETY & CONSTRAINTS
- Do not remove or break existing functionality unless explicitly justified.
- All changes must be incremental and reversible.
- Prefer modular additions over rewrites.
- Maintain compatibility with upstream Supabase where possible.

---

# PHASE 6 — DELIVERABLES
Produce the following:

1. **Repo Audit Report**
2. **Architecture Recommendation**
3. **Implementation Roadmap**
4. **Refactored Folder Structure**
5. **Updated Compose Templates**
6. **Provisioning API Spec**
7. **Production Deployment Blueprint**
8. **Migration & Backup Strategy**
9. **Secrets Management Plan**
