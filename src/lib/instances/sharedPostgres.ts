import { promises as fs } from 'fs'
import path from 'path'
import { Client } from 'pg'
import { createProjectBackup, restoreProjectBackup } from '../backup/service'
import { writeProjectConfigArtifacts } from '../config/project'
import { applyProjectEnvAliases } from '../secrets/normalization'
import { mergeProjectEnvVarWrites } from '../secrets/project-env'
import {
  deleteStoredSecretReferences,
  externalizeProjectSecrets,
  materializeProjectEnvRows,
} from '../secrets/provider'
import type { ProjectEnvVarMutationMap } from '../secrets/types'
import { renderProjectTemplatePlan } from '../templates'
import type { ProjectEnvRecord } from './env'
import {
  createProjectRecord,
  deleteProjectEnvVars,
  deleteProjectRecord,
  getProjectById,
  listProjectEnvVarRecords,
  updateProjectInstanceState,
  upsertProjectEnvVarRecords,
} from './repository'
import type { CreateProjectInstanceInput, ProjectInstanceProfile } from './types'
import type {
  BackupProjectResult,
  CreateProjectResult,
  DeployProjectResult,
  InspectProjectResult,
  InstanceRuntimeContext,
  MutationResult,
  RestoreProjectResult,
} from './service'
import { resolveProjectInstanceProfile, resolveStoredProjectInstanceProfile } from './metadata'
import { loadSharedTopologyConfig } from './topology'
import { resolveProjectWorkspacePaths, writeProjectTemplateArtifacts } from './workspace'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function slugifyProjectName(name: string, timestamp: number): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`
}

function sanitizeIdentifier(input: string, prefix: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tenant'
  const combined = `${prefix}_${normalized}`
  return combined.slice(0, 48)
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function buildConnectionUrl(
  adminUrl: string,
  database: string,
  username: string,
  password: string,
  schema?: string,
): string {
  const url = new URL(adminUrl)
  url.username = encodeURIComponent(username)
  url.password = encodeURIComponent(password)
  url.pathname = `/${database}`

  if (schema) {
    url.searchParams.set('options', `-c search_path=${schema},public`)
  } else {
    url.searchParams.delete('options')
  }

  return url.toString()
}

interface SharedTenantDescriptor {
  roleName: string
  password: string
  databaseName: string
  schemaName?: string
  databaseUrl: string
}

function buildSharedTenantDescriptor(
  slug: string,
  profile: ProjectInstanceProfile,
  adminUrl: string,
  schemaDatabase: string,
  generateSecret: (length: number) => string,
): SharedTenantDescriptor {
  const roleName = sanitizeIdentifier(slug, 'tenant')
  const password = generateSecret(32)

  if (profile.mode.key === 'shared_core_schema_isolated') {
    const schemaName = sanitizeIdentifier(slug, 'tenant')
    return {
      roleName,
      password,
      databaseName: schemaDatabase,
      schemaName,
      databaseUrl: buildConnectionUrl(adminUrl, schemaDatabase, roleName, password, schemaName),
    }
  }

  const databaseName = sanitizeIdentifier(slug, 'db')
  return {
    roleName,
    password,
    databaseName,
    databaseUrl: buildConnectionUrl(adminUrl, databaseName, roleName, password),
  }
}

function buildSharedEnv(
  slug: string,
  profile: ProjectInstanceProfile,
  tenant: SharedTenantDescriptor,
  host: string | undefined,
  port: number | undefined,
): ProjectEnvRecord {
  const sharedUrls = profile.topologyMetadata.sharedServiceUrls ?? {}
  const env: ProjectEnvRecord = {
    PROJECT_ID: slug,
    PROVISIONING_MODE: profile.mode.key,
    TOPOLOGY_KIND: profile.topology.key,
    RUNTIME_KIND: profile.runtime.key,
    POSTGRES_HOST: host ?? 'localhost',
    POSTGRES_PORT: String(port ?? 5432),
    POSTGRES_DB: tenant.databaseName,
    POSTGRES_USER: tenant.roleName,
    POSTGRES_PASSWORD: tenant.password,
    DATABASE_URL: tenant.databaseUrl,
    TENANT_DATABASE_URL: tenant.databaseUrl,
    TENANT_DATABASE_NAME: tenant.databaseName,
  }

  if (tenant.schemaName) {
    env.TENANT_SCHEMA = tenant.schemaName
  }

  if (sharedUrls.api) {
    env.SHARED_SERVICE_API_URL = sharedUrls.api
    env.SUPABASE_PUBLIC_URL = sharedUrls.api
    env.API_EXTERNAL_URL = sharedUrls.api
  }
  if (sharedUrls.studio) env.SHARED_SERVICE_STUDIO_URL = sharedUrls.studio
  if (sharedUrls.database) env.SHARED_SERVICE_DATABASE_URL = sharedUrls.database
  if (sharedUrls.auth) env.SHARED_SERVICE_AUTH_URL = sharedUrls.auth
  if (sharedUrls.storage) env.SHARED_SERVICE_STORAGE_URL = sharedUrls.storage
  if (sharedUrls.realtime) env.SHARED_SERVICE_REALTIME_URL = sharedUrls.realtime
  if (sharedUrls.mail) env.SHARED_SERVICE_MAIL_URL = sharedUrls.mail

  return env
}

async function withSharedClient<T>(adminUrl: string, database: string, action: (client: Client) => Promise<T>): Promise<T> {
  const url = new URL(adminUrl)
  url.pathname = `/${database}`

  const client = new Client({ connectionString: url.toString() })
  await client.connect()

  try {
    return await action(client)
  } finally {
    await client.end()
  }
}

async function ensureRole(client: Client, roleName: string, password: string, login: boolean): Promise<void> {
  const existing = await client.query<{ rolname: string }>('SELECT rolname FROM pg_roles WHERE rolname = $1', [roleName])
  const loginState = login ? 'LOGIN' : 'NOLOGIN'

  if (existing.rowCount === 0) {
    await client.query(`CREATE ROLE ${quoteIdentifier(roleName)} ${loginState} PASSWORD $1`, [password])
    return
  }

  await client.query(`ALTER ROLE ${quoteIdentifier(roleName)} ${loginState} PASSWORD $1`, [password])
}

async function ensureSchemaTenant(client: Client, tenant: SharedTenantDescriptor): Promise<void> {
  if (!tenant.schemaName) {
    throw new Error('Schema-isolated deployment is missing the tenant schema name.')
  }

  await ensureRole(client, tenant.roleName, tenant.password, true)
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(tenant.schemaName)} AUTHORIZATION ${quoteIdentifier(tenant.roleName)}`)
  await client.query(`ALTER SCHEMA ${quoteIdentifier(tenant.schemaName)} OWNER TO ${quoteIdentifier(tenant.roleName)}`)
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(tenant.databaseName)} TO ${quoteIdentifier(tenant.roleName)}`)
  await client.query(`GRANT USAGE, CREATE ON SCHEMA ${quoteIdentifier(tenant.schemaName)} TO ${quoteIdentifier(tenant.roleName)}`)
  await client.query(`ALTER ROLE ${quoteIdentifier(tenant.roleName)} IN DATABASE ${quoteIdentifier(tenant.databaseName)} SET search_path = ${tenant.schemaName}, public`)
}

async function pauseSchemaTenant(client: Client, tenant: SharedTenantDescriptor): Promise<void> {
  await ensureRole(client, tenant.roleName, tenant.password, false)
}

async function deleteSchemaTenant(client: Client, tenant: SharedTenantDescriptor): Promise<void> {
  if (tenant.schemaName) {
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(tenant.schemaName)} CASCADE`)
  }
  await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(tenant.roleName)}`)
}

async function ensureDatabaseTenant(
  adminUrl: string,
  client: Client,
  adminDatabase: string,
  tenant: SharedTenantDescriptor,
): Promise<void> {
  await ensureRole(client, tenant.roleName, tenant.password, true)
  const existing = await client.query<{ datname: string }>('SELECT datname FROM pg_database WHERE datname = $1', [tenant.databaseName])

  if (existing.rowCount === 0) {
    await client.query(`CREATE DATABASE ${quoteIdentifier(tenant.databaseName)} OWNER ${quoteIdentifier(tenant.roleName)}`)
  }

  await client.query(`ALTER DATABASE ${quoteIdentifier(tenant.databaseName)} OWNER TO ${quoteIdentifier(tenant.roleName)}`)
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(tenant.databaseName)} TO ${quoteIdentifier(tenant.roleName)}`)
  await client.query(`ALTER DATABASE ${quoteIdentifier(tenant.databaseName)} WITH ALLOW_CONNECTIONS true`)

  await withSharedClient(adminUrl, tenant.databaseName, async (dbClient) => {
    await dbClient.query(`ALTER SCHEMA public OWNER TO ${quoteIdentifier(tenant.roleName)}`)
    await dbClient.query(`GRANT ALL ON SCHEMA public TO ${quoteIdentifier(tenant.roleName)}`)
  })

  await client.query(`ALTER ROLE ${quoteIdentifier(tenant.roleName)} IN DATABASE ${quoteIdentifier(tenant.databaseName)} RESET ALL`)
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(adminDatabase)} TO ${quoteIdentifier(tenant.roleName)}`)
}

async function pauseDatabaseTenant(client: Client, tenant: SharedTenantDescriptor): Promise<void> {
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [tenant.databaseName],
  )
  await client.query(`ALTER DATABASE ${quoteIdentifier(tenant.databaseName)} WITH ALLOW_CONNECTIONS false`)
  await ensureRole(client, tenant.roleName, tenant.password, false)
}

async function deleteDatabaseTenant(client: Client, tenant: SharedTenantDescriptor): Promise<void> {
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [tenant.databaseName],
  )
  await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tenant.databaseName)}`)
  await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(tenant.roleName)}`)
}

function buildTopologyStatus(profile: ProjectInstanceProfile, env: ProjectEnvRecord, details: Record<string, unknown>) {
  return {
    topology: {
      mode: profile.mode.key,
      topology: profile.topology.key,
      runtimeKind: profile.runtime.key,
      networkScope: profile.topology.networkScope,
      tenantDatabase: env.TENANT_DATABASE_NAME ?? env.POSTGRES_DB,
      tenantSchema: env.TENANT_SCHEMA,
      databaseRole: env.POSTGRES_USER,
      sharedServices: profile.topologyMetadata.sharedServiceUrls ?? {},
    },
    ...details,
  }
}

async function loadSharedProjectEnv(workspaceRoot: string, projectId: string): Promise<ProjectEnvRecord> {
  const existingEnvRows = await listProjectEnvVarRecords(projectId)
  const normalizedRows = mergeProjectEnvVarWrites(existingEnvRows, {})
  const materialized = await materializeProjectEnvRows(workspaceRoot, normalizedRows)
  return applyProjectEnvAliases(materialized.env)
}

async function persistSharedProjectArtifacts(
  context: InstanceRuntimeContext,
  profile: ProjectInstanceProfile,
  project: { id: string; slug: string; name: string },
  env: ProjectEnvRecord,
  envRows: ReturnType<typeof mergeProjectEnvVarWrites>,
): Promise<void> {
  const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, profile.topologyMetadata)
  const templatePlan = await renderProjectTemplatePlan({
    workspaceRoot: context.workspaceRoot,
    profile,
    env,
  })

  await writeProjectTemplateArtifacts(workspacePaths, templatePlan)
  await upsertProjectEnvVarRecords(project.id, envRows)
  await updateProjectInstanceState(project.id, {
    secretMetadata: {
      strategy: envRows.some((row) => row.valueSource === 'indirect') ? 'reference_ready' : 'inline_env',
      managedKeys: envRows.map((row) => row.key),
    },
  })
  await writeProjectConfigArtifacts({
    workspaceRoot: context.workspaceRoot,
    projectRoot: workspacePaths.projectRoot,
    project,
    profile,
    envRows,
    materializedEnv: env,
    secretReferences: (await materializeProjectEnvRows(context.workspaceRoot, envRows)).secretReferences,
    sharedTopology: await loadSharedTopologyConfig(context.workspaceRoot),
  })
}

export async function createSharedPostgresInstance(
  context: InstanceRuntimeContext,
  name: string,
  userId: string,
  description?: string,
  instanceInput?: CreateProjectInstanceInput,
): Promise<CreateProjectResult> {
  try {
    const topologyConfig = await loadSharedTopologyConfig(context.workspaceRoot)
    if (!topologyConfig.sharedPostgres.ready || !topologyConfig.sharedPostgres.adminUrl) {
      return {
        success: false,
        code: 'validation_error',
        error:
          'Shared-topology provisioning requires SUPACONSOLE_SHARED_PG_ADMIN_URL and a schema database configuration.',
      }
    }

    const timestamp = Date.now()
    const slug = slugifyProjectName(name, timestamp)
    const provisionalProfile = resolveProjectInstanceProfile(
      {
        ...instanceInput,
        runtimeMetadata: {
          provider: 'shared_postgres_local',
          status: 'created',
          workdirRelative: path.posix.join('supabase-projects', slug),
          deployCommand: 'shared-topology deploy',
          statusCommand: 'shared-topology inspect',
          ...instanceInput?.runtimeMetadata,
        },
      },
      slug,
    )

    const tenant = buildSharedTenantDescriptor(
      slug,
      provisionalProfile,
      topologyConfig.sharedPostgres.adminUrl,
      topologyConfig.sharedPostgres.schemaDatabase,
      context.generateSecret,
    )

    const instanceProfile = resolveProjectInstanceProfile(
      {
        ...instanceInput,
        topologyMetadata: {
          ...instanceInput?.topologyMetadata,
          sharedTopologyName: topologyConfig.name,
          selectorReason: instanceInput?.topologyMetadata?.selectorReason,
          settingsSource: [...topologyConfig.settingsSource],
          tenantSchema: tenant.schemaName,
          tenantDatabase: tenant.databaseName,
          databaseRole: tenant.roleName,
          databaseHost: topologyConfig.sharedPostgres.host,
          databasePort: topologyConfig.sharedPostgres.port,
          sharedServiceUrls: {
            api: topologyConfig.sharedServices.apiUrl,
            studio: topologyConfig.sharedServices.studioUrl,
            database: topologyConfig.sharedServices.databaseUrl,
            auth: topologyConfig.sharedServices.authUrl,
            storage: topologyConfig.sharedServices.storageUrl,
            realtime: topologyConfig.sharedServices.realtimeUrl,
            mail: topologyConfig.sharedServices.mailUrl,
          },
        },
        runtimeMetadata: {
          provider: 'shared_postgres_local',
          status: 'created',
          workdirRelative: path.posix.join('supabase-projects', slug),
          deployCommand: 'shared-topology deploy',
          statusCommand: 'shared-topology inspect',
          lastKnownUrls: {
            api: topologyConfig.sharedServices.apiUrl,
            studio: topologyConfig.sharedServices.studioUrl,
            database: tenant.databaseUrl,
            mail: topologyConfig.sharedServices.mailUrl,
          },
          ...instanceInput?.runtimeMetadata,
        },
      },
      slug,
    )

    const env = buildSharedEnv(
      slug,
      instanceProfile,
      tenant,
      topologyConfig.sharedPostgres.host,
      topologyConfig.sharedPostgres.port,
    )
    const externalized = await externalizeProjectSecrets(context.workspaceRoot, slug, env)
    const materialized = await materializeProjectEnvRows(context.workspaceRoot, externalized.writes)

    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, instanceProfile.topologyMetadata)
    await fs.mkdir(workspacePaths.projectRoot, { recursive: true })

    const project = await createProjectRecord({
      name,
      slug,
      description,
      ownerId: userId,
      runtimeStatus: 'created',
      portAllocation: null,
      instance: {
        ...instanceProfile,
        secretMetadata: {
          strategy: externalized.writes.some((row) => row.valueSource === 'indirect') ? 'reference_ready' : 'inline_env',
          managedKeys: externalized.writes.map((row) => row.key),
        },
      },
    })

    await persistSharedProjectArtifacts(context, instanceProfile, project, materialized.env, externalized.writes)
    return { success: true, project }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function updateSharedPostgresInstanceEnvVars(
  context: InstanceRuntimeContext,
  projectId: string,
  envVars: ProjectEnvVarMutationMap,
): Promise<MutationResult> {
  try {
    const project = await getProjectById(projectId)
    if (!project) {
      return { success: false, code: 'project_not_found', error: 'Project not found' }
    }

    const profile = resolveStoredProjectInstanceProfile(project)
    const existingEnvRows = await listProjectEnvVarRecords(projectId)
    const mergedWrites = mergeProjectEnvVarWrites(existingEnvRows, envVars)
    const materialized = await materializeProjectEnvRows(context.workspaceRoot, mergedWrites)
    if (materialized.unresolvedKeys.length > 0) {
      return {
        success: false,
        code: 'validation_error',
        error: `Unable to resolve secret references for: ${materialized.unresolvedKeys.join(', ')}`,
      }
    }

    const mergedEnv = applyProjectEnvAliases(materialized.env)

    await upsertProjectEnvVarRecords(projectId, mergedWrites)
    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, profile.topologyMetadata)
    const templatePlan = await renderProjectTemplatePlan({
      workspaceRoot: context.workspaceRoot,
      profile,
      env: mergedEnv,
    })

    await writeProjectTemplateArtifacts(workspacePaths, templatePlan)
    await updateProjectInstanceState(projectId, {
      secretMetadata: {
        strategy: mergedWrites.some((row) => row.valueSource === 'indirect') ? 'reference_ready' : 'inline_env',
        managedKeys: mergedWrites.map((row) => row.key),
      },
    })
    await writeProjectConfigArtifacts({
      workspaceRoot: context.workspaceRoot,
      projectRoot: workspacePaths.projectRoot,
      project,
      profile,
      envRows: mergedWrites,
      materializedEnv: mergedEnv,
      secretReferences: materialized.secretReferences,
      sharedTopology: await loadSharedTopologyConfig(context.workspaceRoot),
    })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function deploySharedPostgresInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<DeployProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const profile = resolveStoredProjectInstanceProfile(project)
  const topologyConfig = await loadSharedTopologyConfig(context.workspaceRoot)
  const adminUrl = topologyConfig.sharedPostgres.adminUrl

  if (!adminUrl) {
    return {
      success: false,
      code: 'validation_error',
      error: 'Shared-topology provisioning requires SUPACONSOLE_SHARED_PG_ADMIN_URL to deploy tenant database assets.',
    }
  }

  const env = await loadSharedProjectEnv(context.workspaceRoot, projectId)
  const tenant: SharedTenantDescriptor = {
    roleName: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    databaseName: env.TENANT_DATABASE_NAME ?? env.POSTGRES_DB,
    schemaName: env.TENANT_SCHEMA,
    databaseUrl: env.TENANT_DATABASE_URL ?? env.DATABASE_URL,
  }

  try {
    await updateProjectInstanceState(projectId, {
      runtimeStatus: 'deploying',
      runtimeMetadata: {
        ...asRecord(project.runtimeMetadata),
        status: 'deploying',
        lastError: undefined,
        lastStatusSyncAt: new Date().toISOString(),
      },
    })

    await withSharedClient(adminUrl, topologyConfig.sharedPostgres.adminDatabase, async (client) => {
      if (profile.mode.key === 'shared_core_schema_isolated') {
        await withSharedClient(adminUrl, topologyConfig.sharedPostgres.schemaDatabase, async (schemaClient) => {
          await ensureSchemaTenant(schemaClient, tenant)
        })
        return
      }

      await ensureDatabaseTenant(adminUrl, client, topologyConfig.sharedPostgres.adminDatabase, tenant)
    })

    const inspection = await inspectSharedPostgresInstance(context, projectId, true)
    if (!inspection.success) {
      return { success: true, note: 'Tenant database assets were created but runtime inspection failed.' }
    }

    return { success: true, status: inspection.status, note: inspection.note }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy shared-topology instance'
    await updateProjectInstanceState(projectId, {
      runtimeStatus: 'failed',
      runtimeMetadata: {
        ...asRecord(project.runtimeMetadata),
        status: 'failed',
        lastError: message,
        lastStatusSyncAt: new Date().toISOString(),
      },
    })

    return { success: false, code: 'runtime_error', error: message }
  }
}

export async function inspectSharedPostgresInstance(
  context: InstanceRuntimeContext,
  projectId: string,
  persist = false,
): Promise<InspectProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const profile = resolveStoredProjectInstanceProfile(project)
  const topologyConfig = await loadSharedTopologyConfig(context.workspaceRoot)
  const adminUrl = topologyConfig.sharedPostgres.adminUrl
  if (!adminUrl) {
    return {
      success: false,
      code: 'validation_error',
      error: 'Shared-topology provisioning requires SUPACONSOLE_SHARED_PG_ADMIN_URL to inspect tenant database assets.',
      runtimeStatus: profile.runtimeMetadata.status ?? 'created',
    }
  }

  const env = await loadSharedProjectEnv(context.workspaceRoot, projectId)
  const roleName = env.POSTGRES_USER
  const databaseName = env.TENANT_DATABASE_NAME ?? env.POSTGRES_DB
  const schemaName = env.TENANT_SCHEMA

  try {
    let statusPayload: Record<string, unknown>
    let runtimeStatus: 'active' | 'paused' | 'failed'

    if (profile.mode.key === 'shared_core_schema_isolated') {
      const details = await withSharedClient(adminUrl, topologyConfig.sharedPostgres.schemaDatabase, async (client) => {
        const schemaResult = await client.query<{ exists: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists',
          [schemaName],
        )
        const roleResult = await client.query<{ rolcanlogin: boolean }>(
          'SELECT rolcanlogin FROM pg_roles WHERE rolname = $1',
          [roleName],
        )

        return {
          schemaExists: Boolean(schemaResult.rows[0]?.exists),
          roleCanLogin: Boolean(roleResult.rows[0]?.rolcanlogin),
          database: databaseName,
          schema: schemaName,
        }
      })

      runtimeStatus = details.schemaExists ? (details.roleCanLogin ? 'active' : 'paused') : 'failed'
      statusPayload = buildTopologyStatus(profile, env, details)
    } else {
      const details = await withSharedClient(adminUrl, topologyConfig.sharedPostgres.adminDatabase, async (client) => {
        const dbResult = await client.query<{ datallowconn: boolean }>(
          'SELECT datallowconn FROM pg_database WHERE datname = $1',
          [databaseName],
        )
        const roleResult = await client.query<{ rolcanlogin: boolean }>(
          'SELECT rolcanlogin FROM pg_roles WHERE rolname = $1',
          [roleName],
        )

        return {
          databaseExists: (dbResult.rowCount ?? 0) > 0,
          databaseAllowsConnections: Boolean(dbResult.rows[0]?.datallowconn),
          roleCanLogin: Boolean(roleResult.rows[0]?.rolcanlogin),
          database: databaseName,
        }
      })

      runtimeStatus = details.databaseExists
        ? details.databaseAllowsConnections && details.roleCanLogin
          ? 'active'
          : 'paused'
        : 'failed'
      statusPayload = buildTopologyStatus(profile, env, details)
    }

    if (persist) {
      await updateProjectInstanceState(projectId, {
        status: runtimeStatus === 'active' ? 'active' : runtimeStatus === 'paused' ? 'paused' : project.status,
        runtimeStatus,
        runtimeMetadata: {
          ...asRecord(project.runtimeMetadata),
          provider: profile.runtime.key,
          status: runtimeStatus,
          workdirRelative: profile.topologyMetadata.projectRootRelative,
          deployCommand: 'shared-topology deploy',
          statusCommand: 'shared-topology inspect',
          lastStatusSyncAt: new Date().toISOString(),
          lastKnownUrls: {
            api: profile.topologyMetadata.sharedServiceUrls?.api,
            studio: profile.topologyMetadata.sharedServiceUrls?.studio,
            database: env.TENANT_DATABASE_URL ?? env.DATABASE_URL,
            mail: profile.topologyMetadata.sharedServiceUrls?.mail,
          },
          lastError: runtimeStatus === 'failed' ? 'Tenant database assets are missing or inaccessible.' : undefined,
        },
      })
    }

    return { success: true, status: statusPayload, runtimeStatus }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Failed to inspect shared-topology instance',
      runtimeStatus: profile.runtimeMetadata.status ?? 'created',
    }
  }
}

export async function stopSharedPostgresInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<MutationResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const profile = resolveStoredProjectInstanceProfile(project)
  const topologyConfig = await loadSharedTopologyConfig(context.workspaceRoot)
  const adminUrl = topologyConfig.sharedPostgres.adminUrl
  if (!adminUrl) {
    return {
      success: false,
      code: 'validation_error',
      error: 'Shared-topology provisioning requires SUPACONSOLE_SHARED_PG_ADMIN_URL to pause tenant database assets.',
    }
  }

  const env = await loadSharedProjectEnv(context.workspaceRoot, projectId)
  const tenant: SharedTenantDescriptor = {
    roleName: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    databaseName: env.TENANT_DATABASE_NAME ?? env.POSTGRES_DB,
    schemaName: env.TENANT_SCHEMA,
    databaseUrl: env.TENANT_DATABASE_URL ?? env.DATABASE_URL,
  }

  try {
    await withSharedClient(adminUrl, topologyConfig.sharedPostgres.adminDatabase, async (client) => {
      if (profile.mode.key === 'shared_core_schema_isolated') {
        await withSharedClient(adminUrl, topologyConfig.sharedPostgres.schemaDatabase, async (schemaClient) => {
          await pauseSchemaTenant(schemaClient, tenant)
        })
        return
      }

      await pauseDatabaseTenant(client, tenant)
    })

    await updateProjectInstanceState(projectId, {
      status: 'paused',
      runtimeStatus: 'paused',
      runtimeMetadata: {
        ...asRecord(project.runtimeMetadata),
        status: 'paused',
        lastStatusSyncAt: new Date().toISOString(),
      },
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Failed to stop shared-topology instance',
    }
  }
}

export async function deleteSharedPostgresInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<MutationResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const profile = resolveStoredProjectInstanceProfile(project)
  const topologyConfig = await loadSharedTopologyConfig(context.workspaceRoot)
  const adminUrl = topologyConfig.sharedPostgres.adminUrl
  const env = await loadSharedProjectEnv(context.workspaceRoot, projectId)
  const tenant: SharedTenantDescriptor = {
    roleName: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    databaseName: env.TENANT_DATABASE_NAME ?? env.POSTGRES_DB,
    schemaName: env.TENANT_SCHEMA,
    databaseUrl: env.TENANT_DATABASE_URL ?? env.DATABASE_URL,
  }

  try {
    if (adminUrl) {
      await withSharedClient(adminUrl, topologyConfig.sharedPostgres.adminDatabase, async (client) => {
        if (profile.mode.key === 'shared_core_schema_isolated') {
          await withSharedClient(adminUrl, topologyConfig.sharedPostgres.schemaDatabase, async (schemaClient) => {
            await deleteSchemaTenant(schemaClient, tenant)
          })
          return
        }

        await deleteDatabaseTenant(client, tenant)
      })
    }

    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, profile.topologyMetadata)
    await fs.rm(workspacePaths.projectRoot, { recursive: true, force: true })

    const secretRefs = (await listProjectEnvVarRecords(projectId))
      .map((envVar) => envVar.secretReference)
      .filter((reference): reference is string => typeof reference === 'string' && reference.length > 0)

    await deleteStoredSecretReferences(context.workspaceRoot, secretRefs)
    await deleteProjectEnvVars(projectId)
    await deleteProjectRecord(projectId)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Failed to delete shared-topology instance',
    }
  }
}

export async function backupSharedPostgresInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<BackupProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  return createProjectBackup(context, project)
}

export async function restoreSharedPostgresInstance(
  context: InstanceRuntimeContext,
  projectId: string,
  backupId?: string,
): Promise<RestoreProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const deployResult = await deploySharedPostgresInstance(context, projectId)
  if (!deployResult.success) {
    return {
      success: false,
      code: deployResult.code,
      error: deployResult.error,
    }
  }

  return restoreProjectBackup(context, project, backupId)
}