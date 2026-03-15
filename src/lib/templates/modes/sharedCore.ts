import { renderEnvArtifacts } from '../env'
import type { ProjectTemplateBoundary, ProjectTemplateRenderInput, ProjectTemplateRenderPlan } from '../types'

export function describeSharedCoreTemplateBoundary(
  input: ProjectTemplateRenderInput['profile'],
): ProjectTemplateBoundary {
  if (input.mode.key !== 'shared_core_schema_isolated') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Shared-core schema-isolated templates are reserved for shared Postgres topologies.',
      reason: `Provisioning mode "${input.mode.key}" does not use the shared-core template set.`,
    }
  }

  if (input.topology.key !== 'shared_core') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Shared-core templates require the shared_core topology contract.',
      reason: `Topology "${input.topology.key}" is not implemented for the shared-core template set.`,
    }
  }

  if (input.runtime.key !== 'shared_postgres_local') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Shared-core templates are currently bound to the shared Postgres local runtime.',
      reason: `Runtime kind "${input.runtime.key}" is not implemented for the shared-core template set.`,
    }
  }

  return {
    modeKey: input.mode.key,
    topologyKey: input.topology.key,
    runtimeKey: input.runtime.key,
    deployable: true,
    summary:
      'Shared-core schema-isolated projects render tenant env/config/SQL artifacts and provision their database assets into a configured shared Postgres cluster.',
  }
}

function buildSharedCoreConfig(input: ProjectTemplateRenderInput): string {
  const urls = input.profile.topologyMetadata.sharedServiceUrls ?? {}
  const lines = [
    '# Shared-core topology reference for this tenant workspace.',
    '[topology]',
    `mode = "${input.profile.mode.key}"`,
    `runtime = "${input.profile.runtime.key}"`,
    `network_scope = "${input.profile.topology.networkScope}"`,
    '',
    '[database]',
    `host = "${input.env.POSTGRES_HOST ?? 'localhost'}"`,
    `port = ${Number(input.env.POSTGRES_PORT ?? 5432)}`,
    `database = "${input.env.POSTGRES_DB ?? ''}"`,
    `role = "${input.env.POSTGRES_USER ?? ''}"`,
    `schema = "${input.env.TENANT_SCHEMA ?? ''}"`,
  ]

  if (urls.api || urls.studio || urls.auth || urls.storage || urls.realtime) {
    lines.push('', '[shared_services]')
    if (urls.api) lines.push(`api_url = "${urls.api}"`)
    if (urls.studio) lines.push(`studio_url = "${urls.studio}"`)
    if (urls.auth) lines.push(`auth_url = "${urls.auth}"`)
    if (urls.storage) lines.push(`storage_url = "${urls.storage}"`)
    if (urls.realtime) lines.push(`realtime_url = "${urls.realtime}"`)
    if (urls.mail) lines.push(`mail_url = "${urls.mail}"`)
  }

  return lines.join('\n')
}

function buildBootstrapSql(input: ProjectTemplateRenderInput): string {
  const schemaName = input.env.TENANT_SCHEMA ?? 'tenant_schema'
  const roleName = input.env.POSTGRES_USER ?? 'tenant_role'
  const databaseName = input.env.POSTGRES_DB ?? 'postgres'

  return [
    `CREATE ROLE ${roleName} LOGIN PASSWORD '<managed-by-supaconsole>';`,
    `CREATE SCHEMA IF NOT EXISTS ${schemaName} AUTHORIZATION ${roleName};`,
    `GRANT CONNECT ON DATABASE ${databaseName} TO ${roleName};`,
    `GRANT USAGE, CREATE ON SCHEMA ${schemaName} TO ${roleName};`,
    `ALTER ROLE ${roleName} IN DATABASE ${databaseName} SET search_path = ${schemaName}, public;`,
  ].join('\n')
}

export async function renderSharedCoreTemplatePlan(
  input: ProjectTemplateRenderInput,
): Promise<ProjectTemplateRenderPlan> {
  const boundary = describeSharedCoreTemplateBoundary(input.profile)
  if (!boundary.deployable) {
    return { ...boundary, artifacts: [] }
  }

  return {
    ...boundary,
    artifacts: [
      ...renderEnvArtifacts(input.env),
      {
        id: 'shared-core-config',
        kind: 'config',
        relativePath: 'supabase/config.toml',
        description: 'Inspectable shared-core topology reference for this tenant workspace.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: buildSharedCoreConfig(input),
      },
      {
        id: 'shared-core-bootstrap-sql',
        kind: 'sql',
        relativePath: 'sql/bootstrap.sql',
        description: 'Schema bootstrap SQL representing the shared-core tenant deployment.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: buildBootstrapSql(input),
      },
      {
        id: 'shared-core-pause-sql',
        kind: 'sql',
        relativePath: 'sql/pause.sql',
        description: 'Pause SQL for revoking tenant login without deleting tenant data.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: `ALTER ROLE ${input.env.POSTGRES_USER ?? 'tenant_role'} NOLOGIN;`,
      },
      {
        id: 'shared-core-delete-sql',
        kind: 'sql',
        relativePath: 'sql/delete.sql',
        description: 'Delete SQL for dropping the tenant schema and login role.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: [
          `DROP SCHEMA IF EXISTS ${input.env.TENANT_SCHEMA ?? 'tenant_schema'} CASCADE;`,
          `DROP ROLE IF EXISTS ${input.env.POSTGRES_USER ?? 'tenant_role'};`,
        ].join('\n'),
      },
    ],
  }
}