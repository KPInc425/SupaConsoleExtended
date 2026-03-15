export const INSTANCE_MODES = [
  'shared_core_schema_isolated',
  'db_isolated',
  'full_stack_isolated',
] as const

export type InstanceMode = (typeof INSTANCE_MODES)[number]

export const INSTANCE_TOPOLOGIES = [
  'shared_core',
  'isolated_database',
  'isolated_stack',
] as const

export type InstanceTopology = (typeof INSTANCE_TOPOLOGIES)[number]

export const RUNTIME_KINDS = [
  'supabase_cli_local',
  'docker_compose_local',
  'shared_postgres_local',
] as const

export type RuntimeKind = (typeof RUNTIME_KINDS)[number]

export const INSTANCE_RUNTIME_STATUSES = [
  'created',
  'deploying',
  'active',
  'paused',
  'failed',
] as const

export type InstanceRuntimeStatus = (typeof INSTANCE_RUNTIME_STATUSES)[number]

export type NetworkScope = 'shared' | 'isolated'
export type InstanceIsolationBoundary = 'schema' | 'database' | 'stack'
export type RuntimeLifecycle = 'supabase_cli' | 'docker_compose' | 'shared_postgres'
export type InstancePortKey =
  | 'POSTGRES_PORT'
  | 'STUDIO_PORT'
  | 'INBUCKET_WEB_PORT'
  | 'INBUCKET_SMTP_PORT'
  | 'INBUCKET_POP3_PORT'
  | 'ANALYTICS_PORT'
  | 'KONG_HTTP_PORT'

export interface PortAllocationMetadata {
  basePort: number | null
  assignedAt: string
  source: 'generated' | 'rebalanced' | 'persisted'
  ports: Partial<Record<InstancePortKey, number>>
}

export interface InstanceTopologyMetadata {
  projectRootRelative: string
  dockerDirRelative: string
  composeProjectName: string
  networkScope: NetworkScope
  sharedCoreProjectId?: string
  sharedTopologyName?: string
  selectorReason?: string
  settingsSource?: string[]
  tenantSchema?: string
  tenantDatabase?: string
  databaseRole?: string
  databaseHost?: string
  databasePort?: number
  sharedServiceUrls?: Partial<
    Record<'api' | 'studio' | 'database' | 'auth' | 'storage' | 'realtime' | 'mail', string>
  >
}

export interface InstanceRuntimeMetadata {
  provider: RuntimeKind
  status?: InstanceRuntimeStatus
  workdirRelative: string
  deployCommand?: string
  statusCommand?: string
  lastStatusSyncAt?: string
  lastKnownUrls?: Partial<Record<'api' | 'studio' | 'database' | 'mail', string>>
  lastError?: string
}

export interface ProjectSecretMetadata {
  strategy: 'inline_env' | 'reference_ready'
  managedKeys?: string[]
}

export interface InstanceModeProfile {
  key: InstanceMode
  isolationBoundary: InstanceIsolationBoundary
  defaultTopology: InstanceTopology
  defaultRuntime: RuntimeKind
  networkScope: NetworkScope
}

export interface InstanceTopologyProfile {
  key: InstanceTopology
  isolationBoundary: InstanceIsolationBoundary
  networkScope: NetworkScope
}

export interface InstanceRuntimeProfile {
  key: RuntimeKind
  lifecycle: RuntimeLifecycle
  environment: 'local'
}

export interface ProjectInstanceProfile {
  mode: InstanceModeProfile
  topology: InstanceTopologyProfile
  runtime: InstanceRuntimeProfile
  topologyMetadata: InstanceTopologyMetadata
  runtimeMetadata: InstanceRuntimeMetadata
  secretMetadata: ProjectSecretMetadata
}

export interface CreateProjectInstanceInput {
  mode?: InstanceMode
  topology?: InstanceTopology
  runtimeKind?: RuntimeKind
  selection?: InstanceSelectionConstraints
  topologyMetadata?: Partial<InstanceTopologyMetadata>
  runtimeMetadata?: Partial<InstanceRuntimeMetadata>
  secretMetadata?: Partial<ProjectSecretMetadata>
}

export interface InstanceSelectionConstraints {
  isolationBoundary?: InstanceIsolationBoundary
  preferSharedTopology?: boolean
  requireDedicatedDatabase?: boolean
  requireFullStackServices?: boolean
}

export interface StoredProjectInstanceFields {
  slug: string
  provisioningMode?: string | null
  topologyKind?: string | null
  runtimeKind?: string | null
  runtimeStatus?: string | null
  topologyMetadata?: unknown
  runtimeMetadata?: unknown
  portAllocation?: unknown
  secretMetadata?: unknown
}

export const DEFAULT_INSTANCE_MODE: InstanceMode = 'full_stack_isolated'
export const DEFAULT_INSTANCE_TOPOLOGY: InstanceTopology = 'isolated_stack'
export const DEFAULT_RUNTIME_KIND: RuntimeKind = 'supabase_cli_local'