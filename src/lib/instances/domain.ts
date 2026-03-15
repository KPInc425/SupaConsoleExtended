import {
  DEFAULT_INSTANCE_MODE,
  DEFAULT_INSTANCE_TOPOLOGY,
  DEFAULT_RUNTIME_KIND,
  INSTANCE_MODES,
  INSTANCE_RUNTIME_STATUSES,
  INSTANCE_TOPOLOGIES,
  RUNTIME_KINDS,
  type InstanceMode,
  type InstanceModeProfile,
  type InstanceRuntimeStatus,
  type InstanceRuntimeProfile,
  type InstanceTopology,
  type InstanceTopologyProfile,
  type RuntimeKind,
} from './types'

const INSTANCE_MODE_PROFILES: Record<InstanceMode, InstanceModeProfile> = {
  shared_core_schema_isolated: {
    key: 'shared_core_schema_isolated',
    isolationBoundary: 'schema',
    defaultTopology: 'shared_core',
    defaultRuntime: 'shared_postgres_local',
    networkScope: 'shared',
  },
  db_isolated: {
    key: 'db_isolated',
    isolationBoundary: 'database',
    defaultTopology: 'isolated_database',
    defaultRuntime: 'shared_postgres_local',
    networkScope: 'isolated',
  },
  full_stack_isolated: {
    key: 'full_stack_isolated',
    isolationBoundary: 'stack',
    defaultTopology: 'isolated_stack',
    defaultRuntime: 'supabase_cli_local',
    networkScope: 'isolated',
  },
}

const INSTANCE_TOPOLOGY_PROFILES: Record<InstanceTopology, InstanceTopologyProfile> = {
  shared_core: {
    key: 'shared_core',
    isolationBoundary: 'schema',
    networkScope: 'shared',
  },
  isolated_database: {
    key: 'isolated_database',
    isolationBoundary: 'database',
    networkScope: 'isolated',
  },
  isolated_stack: {
    key: 'isolated_stack',
    isolationBoundary: 'stack',
    networkScope: 'isolated',
  },
}

const INSTANCE_RUNTIME_PROFILES: Record<RuntimeKind, InstanceRuntimeProfile> = {
  supabase_cli_local: {
    key: 'supabase_cli_local',
    lifecycle: 'supabase_cli',
    environment: 'local',
  },
  docker_compose_local: {
    key: 'docker_compose_local',
    lifecycle: 'docker_compose',
    environment: 'local',
  },
  shared_postgres_local: {
    key: 'shared_postgres_local',
    lifecycle: 'shared_postgres',
    environment: 'local',
  },
}

export function isInstanceMode(value: string | null | undefined): value is InstanceMode {
  return !!value && INSTANCE_MODES.includes(value as InstanceMode)
}

export function isInstanceTopology(value: string | null | undefined): value is InstanceTopology {
  return !!value && INSTANCE_TOPOLOGIES.includes(value as InstanceTopology)
}

export function isRuntimeKind(value: string | null | undefined): value is RuntimeKind {
  return !!value && RUNTIME_KINDS.includes(value as RuntimeKind)
}

export function isInstanceRuntimeStatus(value: string | null | undefined): value is InstanceRuntimeStatus {
  return !!value && INSTANCE_RUNTIME_STATUSES.includes(value as InstanceRuntimeStatus)
}

export function resolveInstanceModeProfile(value: string | null | undefined): InstanceModeProfile {
  const key = isInstanceMode(value) ? value : DEFAULT_INSTANCE_MODE
  return INSTANCE_MODE_PROFILES[key]
}

export function resolveInstanceTopologyProfile(value: string | null | undefined): InstanceTopologyProfile {
  const key = isInstanceTopology(value) ? value : DEFAULT_INSTANCE_TOPOLOGY
  return INSTANCE_TOPOLOGY_PROFILES[key]
}

export function resolveInstanceRuntimeProfile(value: string | null | undefined): InstanceRuntimeProfile {
  const key = isRuntimeKind(value) ? value : DEFAULT_RUNTIME_KIND
  return INSTANCE_RUNTIME_PROFILES[key]
}

export function resolveInstanceRuntimeStatus(value: string | null | undefined): InstanceRuntimeStatus {
  return isInstanceRuntimeStatus(value) ? value : 'created'
}