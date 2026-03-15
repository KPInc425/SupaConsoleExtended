import type { Project } from '@prisma/client'
import { resolveStoredProjectInstanceProfile } from './metadata'
import { selectProvisioningMode } from './selector'
import type { SharedTopologyConfig } from './topology'
import type { InstanceMode, InstanceTopology, RuntimeKind, StoredProjectInstanceFields } from './types'

type SharedServiceKey = 'api' | 'studio' | 'database' | 'auth' | 'storage' | 'realtime' | 'mail'

export interface ModeCatalogEntry {
  key: InstanceMode
  label: string
  shortDescription: string
  topologyLabel: string
  runtimeLabel: string
  isolationLabel: string
  provisioningLabel: string
  pauseLabel: string
  backupLabel: string
  restoreLabel: string
  relevantInfo: string[]
}

export interface ModeOptionView extends ModeCatalogEntry {
  available: boolean
  availabilityLabel: string
  recommended: boolean
}

export interface ProjectViewModel {
  id: string
  name: string
  slug: string
  description: string
  status: string
  createdAt: string
  provisioningMode: InstanceMode
  topologyKind: InstanceTopology
  runtimeKind: RuntimeKind
  runtimeStatus: string
  modeLabel: string
  topologyLabel: string
  runtimeLabel: string
  isolationLabel: string
  provisioningLabel: string
  pauseLabel: string
  backupLabel: string
  restoreLabel: string
  runtimeTone: 'success' | 'warning' | 'danger' | 'neutral'
  runtimeSummary: string
  selectorReason?: string
  legacyFullStack: boolean
  networkScope: 'shared' | 'isolated'
  tenantSchema?: string
  tenantDatabase?: string
  databaseHost?: string
  databasePort?: number
  sharedTopologyName?: string
  sharedServiceUrls: Partial<Record<SharedServiceKey, string>>
  lastKnownUrls: Partial<Record<'api' | 'studio' | 'database' | 'mail', string>>
  backupAvailable: boolean
  restoreAvailable: boolean
  backupCount: number
  relevantInfo: string[]
}

const MODE_CATALOG: Record<InstanceMode, ModeCatalogEntry> = {
  full_stack_isolated: {
    key: 'full_stack_isolated',
    label: 'Full stack',
    shortDescription: 'Dedicated local Supabase stack per project.',
    topologyLabel: 'Isolated stack',
    runtimeLabel: 'Supabase CLI local runtime',
    isolationLabel: 'Service and data isolation',
    provisioningLabel: 'Deploy local stack',
    pauseLabel: 'Pause local stack',
    backupLabel: 'Create workspace backup',
    restoreLabel: 'Restore latest backup',
    relevantInfo: ['Local ports', 'Supabase Studio URL', 'CLI runtime health', 'Workspace backup'],
  },
  shared_core_schema_isolated: {
    key: 'shared_core_schema_isolated',
    label: 'Shared core',
    shortDescription: 'Shared service endpoints with tenant schema isolation.',
    topologyLabel: 'Shared core topology',
    runtimeLabel: 'Shared Postgres runtime',
    isolationLabel: 'Schema isolation',
    provisioningLabel: 'Provision tenant schema',
    pauseLabel: 'Disable tenant access',
    backupLabel: 'Create tenant backup',
    restoreLabel: 'Restore tenant backup',
    relevantInfo: ['Shared Postgres health', 'Tenant schema', 'Shared service endpoints', 'Tenant backup'],
  },
  db_isolated: {
    key: 'db_isolated',
    label: 'Dedicated database',
    shortDescription: 'Shared services with a dedicated tenant database.',
    topologyLabel: 'Isolated database topology',
    runtimeLabel: 'Shared Postgres runtime',
    isolationLabel: 'Database isolation',
    provisioningLabel: 'Provision tenant database',
    pauseLabel: 'Disable tenant database',
    backupLabel: 'Create tenant backup',
    restoreLabel: 'Restore tenant backup',
    relevantInfo: ['Shared Postgres health', 'Tenant database', 'Shared service endpoints', 'Tenant backup'],
  },
}

function getRuntimeStatusTone(status: string): ProjectViewModel['runtimeTone'] {
  if (status === 'active') return 'success'
  if (status === 'deploying') return 'warning'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function getRuntimeSummary(status: string, mode: InstanceMode): string {
  if (status === 'active') {
    return mode === 'full_stack_isolated'
      ? 'Runtime is active and local endpoints should be reachable.'
      : 'Tenant assets are active and shared-topology connectivity was last reported healthy.'
  }

  if (status === 'deploying') {
    return 'Provisioning is in progress or awaiting a fresh status refresh.'
  }

  if (status === 'paused') {
    return mode === 'full_stack_isolated'
      ? 'The local Supabase stack is currently stopped.'
      : 'Tenant database access is paused until it is re-provisioned.'
  }

  if (status === 'failed') {
    return 'The last lifecycle or health check reported a failure.'
  }

  return 'Provisioning metadata exists, but the runtime has not been activated yet.'
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readSettingsSource(topologyMetadata: unknown): string[] {
  if (!topologyMetadata || typeof topologyMetadata !== 'object' || Array.isArray(topologyMetadata)) {
    return []
  }

  const value = (topologyMetadata as { settingsSource?: unknown }).settingsSource
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function getModeCatalogEntry(mode: InstanceMode): ModeCatalogEntry {
  return MODE_CATALOG[mode]
}

export function buildModeOptionViews(sharedTopology: SharedTopologyConfig): ModeOptionView[] {
  return (Object.keys(MODE_CATALOG) as InstanceMode[]).map((modeKey) => {
    const entry = MODE_CATALOG[modeKey]
    const requiresSharedTopology = modeKey !== 'full_stack_isolated'
    const available = requiresSharedTopology ? sharedTopology.sharedPostgres.ready : true

    return {
      ...entry,
      available,
      availabilityLabel: available
        ? requiresSharedTopology
          ? 'Ready on this host'
          : 'Always available'
        : 'Requires shared-topology settings',
      recommended: sharedTopology.defaultMode === modeKey,
    }
  })
}

export function buildDefaultSelectionView(sharedTopology: SharedTopologyConfig) {
  const decision = selectProvisioningMode(undefined, sharedTopology)
  if (!decision.success) {
    return null
  }

  const entry = MODE_CATALOG[decision.mode]
  return {
    mode: decision.mode,
    label: entry.label,
    topology: decision.topology,
    runtimeKind: decision.runtimeKind,
    reason: decision.reason,
    usedFallback: decision.usedFallback,
  }
}

export function isLegacyFullStackProject(project: Pick<StoredProjectInstanceFields, 'provisioningMode' | 'topologyKind' | 'runtimeKind'>): boolean {
  return !project.provisioningMode || !project.topologyKind || !project.runtimeKind
}

export function buildProjectViewModel(
  project: Pick<
    Project,
    | 'id'
    | 'name'
    | 'slug'
    | 'description'
    | 'status'
    | 'createdAt'
    | 'provisioningMode'
    | 'topologyKind'
    | 'runtimeKind'
    | 'runtimeStatus'
    | 'topologyMetadata'
    | 'runtimeMetadata'
    | 'secretMetadata'
  >,
  backupCount = 0,
): ProjectViewModel {
  const profile = resolveStoredProjectInstanceProfile(project)
  const modeEntry = MODE_CATALOG[profile.mode.key]
  const settingsSource = readSettingsSource(project.topologyMetadata)

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description ?? '',
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    provisioningMode: profile.mode.key,
    topologyKind: profile.topology.key,
    runtimeKind: profile.runtime.key,
    runtimeStatus: profile.runtimeMetadata.status ?? project.runtimeStatus ?? 'created',
    modeLabel: modeEntry.label,
    topologyLabel: modeEntry.topologyLabel,
    runtimeLabel: modeEntry.runtimeLabel,
    isolationLabel: modeEntry.isolationLabel,
    provisioningLabel: modeEntry.provisioningLabel,
    pauseLabel: modeEntry.pauseLabel,
    backupLabel: modeEntry.backupLabel,
    restoreLabel: modeEntry.restoreLabel,
    runtimeTone: getRuntimeStatusTone(profile.runtimeMetadata.status ?? project.runtimeStatus ?? 'created'),
    runtimeSummary: getRuntimeSummary(profile.runtimeMetadata.status ?? project.runtimeStatus ?? 'created', profile.mode.key),
    selectorReason: profile.topologyMetadata.selectorReason,
    legacyFullStack: isLegacyFullStackProject(project) || (profile.mode.key === 'full_stack_isolated' && settingsSource.length === 0),
    networkScope: profile.topology.networkScope,
    tenantSchema: profile.topologyMetadata.tenantSchema,
    tenantDatabase: profile.topologyMetadata.tenantDatabase,
    databaseHost: profile.topologyMetadata.databaseHost,
    databasePort: profile.topologyMetadata.databasePort,
    sharedTopologyName: profile.topologyMetadata.sharedTopologyName,
    sharedServiceUrls: profile.topologyMetadata.sharedServiceUrls ?? {},
    lastKnownUrls: profile.runtimeMetadata.lastKnownUrls ?? {},
    backupAvailable: true,
    restoreAvailable: backupCount > 0,
    backupCount,
    relevantInfo: modeEntry.relevantInfo,
  }
}

export function summarizeProjectCounts(projects: Array<Pick<Project, 'provisioningMode'>>): Record<InstanceMode, number> {
  return projects.reduce<Record<InstanceMode, number>>(
    (accumulator, project) => {
      const key = (readString(project.provisioningMode) as InstanceMode | undefined) ?? 'full_stack_isolated'
      accumulator[key] += 1
      return accumulator
    },
    {
      full_stack_isolated: 0,
      shared_core_schema_isolated: 0,
      db_isolated: 0,
    },
  )
}