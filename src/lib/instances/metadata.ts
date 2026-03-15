import path from 'path'
import {
  DEFAULT_RUNTIME_KIND,
  type CreateProjectInstanceInput,
  type InstanceRuntimeStatus,
  type InstanceRuntimeMetadata,
  type InstanceTopologyMetadata,
  type PortAllocationMetadata,
  type ProjectInstanceProfile,
  type ProjectSecretMetadata,
  type StoredProjectInstanceFields,
} from './types'
import {
  isInstanceRuntimeStatus,
  isRuntimeKind,
  resolveInstanceModeProfile,
  resolveInstanceRuntimeProfile,
  resolveInstanceRuntimeStatus,
  resolveInstanceTopologyProfile,
} from './domain'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export interface ProjectFilesystemLayout {
  projectRootRelative: string
  dockerDirRelative: string
  composeProjectName: string
}

export function buildProjectFilesystemLayout(slug: string): ProjectFilesystemLayout {
  return {
    projectRootRelative: path.posix.join('supabase-projects', slug),
    dockerDirRelative: path.posix.join('supabase-projects', slug, 'docker'),
    composeProjectName: `supa_${slug}`,
  }
}

export function resolveProjectInstanceProfile(
  input: CreateProjectInstanceInput | undefined,
  slug: string,
): ProjectInstanceProfile {
  const mode = resolveInstanceModeProfile(input?.mode)
  const topology = resolveInstanceTopologyProfile(input?.topology ?? mode.defaultTopology)
  const runtime = resolveInstanceRuntimeProfile(input?.runtimeKind ?? mode.defaultRuntime)
  const layout = buildProjectFilesystemLayout(slug)

  const topologyMetadata: InstanceTopologyMetadata = {
    ...layout,
    networkScope: topology.networkScope,
    ...input?.topologyMetadata,
  }

  const runtimeMetadata: InstanceRuntimeMetadata = {
    provider: runtime.key,
    status: 'created',
    workdirRelative: layout.projectRootRelative,
    deployCommand: 'supabase start',
    statusCommand: 'supabase status -o json --workdir .',
    ...input?.runtimeMetadata,
  }

  const secretMetadata: ProjectSecretMetadata = {
    strategy: 'inline_env',
    managedKeys: [],
    ...input?.secretMetadata,
  }

  return {
    mode,
    topology,
    runtime,
    topologyMetadata,
    runtimeMetadata,
    secretMetadata,
  }
}

export function resolveStoredProjectInstanceProfile(project: StoredProjectInstanceFields): ProjectInstanceProfile {
  const mode = resolveInstanceModeProfile(project.provisioningMode)
  const topology = resolveInstanceTopologyProfile(project.topologyKind ?? mode.defaultTopology)
  const runtime = resolveInstanceRuntimeProfile(project.runtimeKind ?? mode.defaultRuntime)
  const layout = buildProjectFilesystemLayout(project.slug)
  const topologyMetadataInput = asRecord(project.topologyMetadata)
  const runtimeMetadataInput = asRecord(project.runtimeMetadata)
  const secretMetadataInput = asRecord(project.secretMetadata)

  const topologyMetadata: InstanceTopologyMetadata = {
    ...layout,
    networkScope: topology.networkScope,
    projectRootRelative: readString(topologyMetadataInput.projectRootRelative) ?? layout.projectRootRelative,
    dockerDirRelative: readString(topologyMetadataInput.dockerDirRelative) ?? layout.dockerDirRelative,
    composeProjectName: readString(topologyMetadataInput.composeProjectName) ?? layout.composeProjectName,
    sharedCoreProjectId: readString(topologyMetadataInput.sharedCoreProjectId),
    sharedTopologyName: readString(topologyMetadataInput.sharedTopologyName),
    selectorReason: readString(topologyMetadataInput.selectorReason),
    settingsSource: Array.isArray(topologyMetadataInput.settingsSource)
      ? topologyMetadataInput.settingsSource.filter((value): value is string => typeof value === 'string')
      : undefined,
    tenantSchema: readString(topologyMetadataInput.tenantSchema),
    tenantDatabase: readString(topologyMetadataInput.tenantDatabase),
    databaseRole: readString(topologyMetadataInput.databaseRole),
    databaseHost: readString(topologyMetadataInput.databaseHost),
    databasePort: typeof topologyMetadataInput.databasePort === 'number' ? topologyMetadataInput.databasePort : undefined,
    sharedServiceUrls:
      typeof topologyMetadataInput.sharedServiceUrls === 'object' && topologyMetadataInput.sharedServiceUrls
        ? (Object.fromEntries(
            Object.entries(asRecord(topologyMetadataInput.sharedServiceUrls)).filter(([, value]) => typeof value === 'string'),
          ) as InstanceTopologyMetadata['sharedServiceUrls'])
        : undefined,
  }

  const runtimeMetadata = mergeRuntimeMetadata(runtimeMetadataInput, {
    provider: runtime.key,
    workdirRelative: readString(runtimeMetadataInput.workdirRelative) ?? topologyMetadata.projectRootRelative,
  })

  const secretMetadata: ProjectSecretMetadata = {
    strategy: secretMetadataInput.strategy === 'reference_ready' ? 'reference_ready' : 'inline_env',
    managedKeys: Array.isArray(secretMetadataInput.managedKeys)
      ? secretMetadataInput.managedKeys.filter((value): value is string => typeof value === 'string')
      : [],
  }

  return {
    mode,
    topology,
    runtime,
    topologyMetadata,
    runtimeMetadata,
    secretMetadata,
  }
}

export function getProjectFilesystemLayout(project: StoredProjectInstanceFields): ProjectFilesystemLayout {
  const profile = resolveStoredProjectInstanceProfile(project)

  return {
    projectRootRelative: profile.topologyMetadata.projectRootRelative,
    dockerDirRelative: profile.topologyMetadata.dockerDirRelative,
    composeProjectName: profile.topologyMetadata.composeProjectName,
  }
}

export function resolveStoredPortAllocation(project: StoredProjectInstanceFields): PortAllocationMetadata | null {
  const current = asRecord(project.portAllocation)
  const ports = asRecord(current.ports)
  const basePort = typeof current.basePort === 'number' ? current.basePort : null
  const assignedAt = readString(current.assignedAt)

  return {
    basePort,
    assignedAt: assignedAt ?? new Date(0).toISOString(),
    source:
      current.source === 'rebalanced' || current.source === 'persisted' || current.source === 'generated'
        ? current.source
        : 'persisted',
    ports: Object.fromEntries(
      Object.entries(ports).filter(([, value]) => typeof value === 'number'),
    ) as PortAllocationMetadata['ports'],
  }
}

export function mergeRuntimeMetadata(
  existing: unknown,
  updates: Partial<InstanceRuntimeMetadata>,
): InstanceRuntimeMetadata {
  const current = asRecord(existing)
  const currentUrls = asRecord(current.lastKnownUrls)
  const provider = readString(updates.provider) ?? readString(current.provider)
  const status = readString(updates.status) ?? readString(current.status)

  return {
    provider: isRuntimeKind(provider) ? provider : DEFAULT_RUNTIME_KIND,
    status: isInstanceRuntimeStatus(status) ? status : 'created',
    workdirRelative: readString(updates.workdirRelative) ?? readString(current.workdirRelative) ?? '',
    deployCommand: readString(updates.deployCommand) ?? readString(current.deployCommand),
    statusCommand: readString(updates.statusCommand) ?? readString(current.statusCommand),
    lastStatusSyncAt: readString(updates.lastStatusSyncAt) ?? readString(current.lastStatusSyncAt),
    lastKnownUrls: {
      ...(Object.fromEntries(
        Object.entries(currentUrls).filter(([, value]) => typeof value === 'string'),
      ) as Partial<Record<'api' | 'studio' | 'database' | 'mail', string>>),
      ...(updates.lastKnownUrls ?? {}),
    },
    lastError: readString(updates.lastError) ?? readString(current.lastError),
  }
}

export function buildRuntimeMetadataFromStatus(
  status: Record<string, unknown>,
  project: StoredProjectInstanceFields,
  runtimeStatus: InstanceRuntimeStatus = resolveInstanceRuntimeStatus(project.runtimeStatus),
): InstanceRuntimeMetadata {
  const profile = resolveStoredProjectInstanceProfile(project)

  return mergeRuntimeMetadata(project.runtimeMetadata, {
    provider: profile.runtime.key,
    status: runtimeStatus,
    workdirRelative: profile.topologyMetadata.projectRootRelative,
    deployCommand: 'supabase start',
    statusCommand: 'supabase status -o json --workdir .',
    lastStatusSyncAt: new Date().toISOString(),
    lastKnownUrls: {
      api: readString(status.API_URL),
      studio: readString(status.STUDIO_URL),
      database: readString(status.DB_URL),
      mail: readString(status.INBUCKET_URL) ?? readString(status.MAILPIT_URL),
    },
    lastError: undefined,
  })
}