import { renderEnvArtifacts } from '../env'
import type { ProjectTemplateBoundary, ProjectTemplateRenderInput, ProjectTemplateRenderPlan } from '../types'

export function describeDbIsolatedTemplateBoundary(input: ProjectTemplateRenderInput['profile']): ProjectTemplateBoundary {
  if (input.mode.key !== 'db_isolated') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Database-isolated templates are reserved for shared-control dedicated database topologies.',
      reason: `Provisioning mode "${input.mode.key}" does not use the database-isolated template set.`,
    }
  }

  if (input.topology.key !== 'isolated_database') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Database-isolated templates require the isolated_database topology contract.',
      reason: `Topology "${input.topology.key}" is not implemented for the database-isolated template set.`,
    }
  }

  if (input.runtime.key !== 'shared_postgres_local') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Database-isolated templates are currently bound to the shared Postgres local runtime.',
      reason: `Runtime kind "${input.runtime.key}" is not implemented for the database-isolated template set.`,
    }
  }

  return {
    modeKey: input.mode.key,
    topologyKey: input.topology.key,
    runtimeKey: input.runtime.key,
    deployable: true,
    summary:
      'Database-isolated projects render tenant env/config/SQL artifacts and provision a dedicated database into a configured shared Postgres cluster.',
  }
}

function buildDbIsolatedConfig(input: ProjectTemplateRenderInput): string {
  const urls = input.profile.topologyMetadata.sharedServiceUrls ?? {}
  const lines = [
    '# Dedicated database topology reference for this tenant workspace.',
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

export async function renderDbIsolatedTemplatePlan(
  input: ProjectTemplateRenderInput,
): Promise<ProjectTemplateRenderPlan> {
  const boundary = describeDbIsolatedTemplateBoundary(input.profile)
  if (!boundary.deployable) {
    return { ...boundary, artifacts: [] }
  }

  return {
    ...boundary,
    artifacts: [
      ...renderEnvArtifacts(input.env),
      {
        id: 'db-isolated-config',
        kind: 'config',
        relativePath: 'supabase/config.toml',
        description: 'Inspectable dedicated-database topology reference for this tenant workspace.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: buildDbIsolatedConfig(input),
      },
      {
        id: 'db-isolated-bootstrap-sql',
        kind: 'sql',
        relativePath: 'sql/bootstrap.sql',
        description: 'Bootstrap SQL representing the dedicated database and tenant role.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: [
          `CREATE ROLE ${input.env.POSTGRES_USER ?? 'tenant_role'} LOGIN PASSWORD '<managed-by-supaconsole>';`,
          `CREATE DATABASE ${input.env.POSTGRES_DB ?? 'tenant_db'} OWNER ${input.env.POSTGRES_USER ?? 'tenant_role'};`,
        ].join('\n'),
      },
      {
        id: 'db-isolated-pause-sql',
        kind: 'sql',
        relativePath: 'sql/pause.sql',
        description: 'Pause SQL for preventing new connections to the tenant database.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: [
          `ALTER DATABASE ${input.env.POSTGRES_DB ?? 'tenant_db'} WITH ALLOW_CONNECTIONS false;`,
          `ALTER ROLE ${input.env.POSTGRES_USER ?? 'tenant_role'} NOLOGIN;`,
        ].join('\n'),
      },
      {
        id: 'db-isolated-delete-sql',
        kind: 'sql',
        relativePath: 'sql/delete.sql',
        description: 'Delete SQL for dropping the tenant database and login role.',
        ownership: 'supaconsole',
        materialization: 'rendered',
        inspectable: true,
        content: [
          `DROP DATABASE IF EXISTS ${input.env.POSTGRES_DB ?? 'tenant_db'};`,
          `DROP ROLE IF EXISTS ${input.env.POSTGRES_USER ?? 'tenant_role'};`,
        ].join('\n'),
      },
    ],
  }
}