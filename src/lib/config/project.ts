import { promises as fs } from 'fs'
import path from 'path'
import type { Project } from '@prisma/client'
import type { ProjectInstanceProfile } from '@/lib/instances/types'
import type { SharedTopologyConfig } from '@/lib/instances/topology'
import type { ProjectSecretReferenceSummary } from '@/lib/secrets/provider'
import type { NormalizedProjectEnvVarWrite } from '@/lib/secrets/types'
import { getSystemConfigDefaults } from './defaults'

type ConfigCheckStatus = 'ready' | 'warning' | 'error'

export interface ConfigHealthCheck {
  name: string
  status: ConfigCheckStatus
  detail: string
}

export interface ProjectConfigSnapshot {
  generatedAt: string
  layers: {
    systemDefaults: ReturnType<typeof getSystemConfigDefaults>
    sharedTopology: {
      name: string
      defaultMode: SharedTopologyConfig['defaultMode']
      settingsFilePath: string
      settingsSource: readonly string[]
      sharedPostgres: SharedTopologyConfig['sharedPostgres']
      sharedServices: SharedTopologyConfig['sharedServices']
    }
    project: {
      id: string
      slug: string
      name: string
      mode: ProjectInstanceProfile['mode']['key']
      topology: ProjectInstanceProfile['topology']['key']
      runtimeKind: ProjectInstanceProfile['runtime']['key']
      config: Record<string, string>
      inlineKeys: string[]
      secretManagedKeys: string[]
    }
    secretReferences: ProjectSecretReferenceSummary[]
  }
  health: {
    status: 'ready' | 'degraded'
    checks: ConfigHealthCheck[]
  }
}

export function assessSharedTopologyHealth(
  sharedTopology: SharedTopologyConfig,
  mode: ProjectInstanceProfile['mode']['key'] | 'system-default' = 'system-default',
): ConfigHealthCheck[] {
  const checks: ConfigHealthCheck[] = []
  const requiresSharedTopology = mode === 'shared_core_schema_isolated' || mode === 'db_isolated'

  checks.push({
    name: 'shared-topology-settings',
    status: sharedTopology.settingsSource.length > 0 ? 'ready' : 'warning',
    detail:
      sharedTopology.settingsSource.length > 0
        ? `Shared topology configuration loaded from ${sharedTopology.settingsSource.join(', ')}.`
        : 'Shared topology configuration is using defaults only.',
  })

  checks.push({
    name: 'shared-postgres-admin',
    status: sharedTopology.sharedPostgres.ready ? 'ready' : requiresSharedTopology ? 'error' : 'warning',
    detail: sharedTopology.sharedPostgres.ready
      ? 'Shared Postgres admin connectivity is configured.'
      : requiresSharedTopology
        ? 'Shared-topology modes require shared Postgres admin connectivity.'
        : 'Shared Postgres admin connectivity is optional until a shared-topology mode is used.',
  })

  const sharedServiceCount = Object.values(sharedTopology.sharedServices).filter((value) => typeof value === 'string' && value.trim()).length
  checks.push({
    name: 'shared-service-endpoints',
    status: sharedServiceCount > 0 ? 'ready' : requiresSharedTopology ? 'warning' : 'ready',
    detail:
      sharedServiceCount > 0
        ? `${sharedServiceCount} shared service endpoint(s) are configured.`
        : requiresSharedTopology
          ? 'Shared-topology project modes can work without shared service URLs, but health visibility is limited.'
          : 'No shared service URLs configured.',
  })

  return checks
}

function omitReferencedKeys(
  env: Record<string, string>,
  references: ProjectSecretReferenceSummary[],
): Record<string, string> {
  const referencedKeys = new Set(references.map((reference) => reference.key))
  return Object.fromEntries(Object.entries(env).filter(([key]) => !referencedKeys.has(key)))
}

export function buildProjectConfigSnapshot(input: {
  workspaceRoot: string
  project: Pick<Project, 'id' | 'slug' | 'name'>
  profile: ProjectInstanceProfile
  envRows: NormalizedProjectEnvVarWrite[]
  materializedEnv: Record<string, string>
  secretReferences: ProjectSecretReferenceSummary[]
  sharedTopology: SharedTopologyConfig
}): ProjectConfigSnapshot {
  const checks = [
    ...assessSharedTopologyHealth(input.sharedTopology, input.profile.mode.key),
    {
      name: 'secret-references',
      status: input.secretReferences.every((reference) => reference.resolved) ? 'ready' : 'error',
      detail: input.secretReferences.length === 0
        ? 'No indirect secret references are configured for this project.'
        : `${input.secretReferences.filter((reference) => reference.resolved).length}/${input.secretReferences.length} indirect secret reference(s) resolved successfully.`,
    } satisfies ConfigHealthCheck,
  ]

  return {
    generatedAt: new Date().toISOString(),
    layers: {
      systemDefaults: getSystemConfigDefaults(input.workspaceRoot),
      sharedTopology: {
        name: input.sharedTopology.name,
        defaultMode: input.sharedTopology.defaultMode,
        settingsFilePath: input.sharedTopology.settingsFilePath,
        settingsSource: input.sharedTopology.settingsSource,
        sharedPostgres: input.sharedTopology.sharedPostgres,
        sharedServices: input.sharedTopology.sharedServices,
      },
      project: {
        id: input.project.id,
        slug: input.project.slug,
        name: input.project.name,
        mode: input.profile.mode.key,
        topology: input.profile.topology.key,
        runtimeKind: input.profile.runtime.key,
        config: omitReferencedKeys(input.materializedEnv, input.secretReferences),
        inlineKeys: input.envRows.filter((row) => row.valueSource === 'inline').map((row) => row.key),
        secretManagedKeys: input.secretReferences.map((reference) => reference.key),
      },
      secretReferences: input.secretReferences,
    },
    health: {
      status: checks.some((check) => check.status === 'error') ? 'degraded' : 'ready',
      checks,
    },
  }
}

export async function writeProjectConfigArtifacts(input: {
  workspaceRoot: string
  projectRoot: string
  project: Pick<Project, 'id' | 'slug' | 'name'>
  profile: ProjectInstanceProfile
  envRows: NormalizedProjectEnvVarWrite[]
  materializedEnv: Record<string, string>
  secretReferences: ProjectSecretReferenceSummary[]
  sharedTopology: SharedTopologyConfig
}): Promise<ProjectConfigSnapshot> {
  const snapshot = buildProjectConfigSnapshot(input)
  const outputDir = path.join(input.projectRoot, '.supaconsole')
  await fs.mkdir(outputDir, { recursive: true })

  await fs.writeFile(path.join(outputDir, 'config.layers.json'), JSON.stringify(snapshot, null, 2), 'utf8')
  await fs.writeFile(
    path.join(outputDir, 'secret-references.json'),
    JSON.stringify({ generatedAt: snapshot.generatedAt, references: input.secretReferences }, null, 2),
    'utf8',
  )

  return snapshot
}