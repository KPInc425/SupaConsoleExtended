import { resolveInstanceModeProfile } from './domain'
import { sharedTopologySupportsMode, type SharedTopologyConfig } from './topology'
import type { CreateProjectInstanceInput, InstanceMode, InstanceTopology, RuntimeKind } from './types'

export interface TopologySelectionDecision {
  success: true
  mode: InstanceMode
  topology: InstanceTopology
  runtimeKind: RuntimeKind
  reason: string
  usedFallback: boolean
  normalizedInput: CreateProjectInstanceInput
}

export interface TopologySelectionFailure {
  success: false
  code: 'validation_error'
  error: string
}

export type TopologySelectionResult = TopologySelectionDecision | TopologySelectionFailure

function hasExplicitConstraints(input?: CreateProjectInstanceInput): boolean {
  return Boolean(
    input?.mode ||
      input?.selection?.isolationBoundary ||
      input?.selection?.preferSharedTopology ||
      input?.selection?.requireDedicatedDatabase ||
      input?.selection?.requireFullStackServices,
  )
}

function resolveRequestedMode(input: CreateProjectInstanceInput | undefined, config: SharedTopologyConfig): {
  mode: InstanceMode
  reason: string
} {
  if (input?.mode) {
    return {
      mode: input.mode,
      reason: `Explicit provisioning mode "${input.mode}" was requested.`,
    }
  }

  if (input?.selection?.requireFullStackServices) {
    return {
      mode: 'full_stack_isolated',
      reason: 'Requested service-level isolation requires a full-stack project workspace.',
    }
  }

  if (input?.selection?.requireDedicatedDatabase || input?.selection?.isolationBoundary === 'database') {
    return {
      mode: 'db_isolated',
      reason: 'Requested dedicated database isolation maps to the database-isolated topology.',
    }
  }

  if (input?.selection?.isolationBoundary === 'schema' || input?.selection?.preferSharedTopology) {
    return {
      mode: 'shared_core_schema_isolated',
      reason: 'Requested shared topology with schema isolation maps to the shared-core topology.',
    }
  }

  return {
    mode: config.defaultMode,
    reason: `No explicit isolation constraints were provided, so the system default mode "${config.defaultMode}" was selected.`,
  }
}

export function selectProvisioningMode(
  input: CreateProjectInstanceInput | undefined,
  config: SharedTopologyConfig,
): TopologySelectionResult {
  const requested = resolveRequestedMode(input, config)
  const requestedProfile = resolveInstanceModeProfile(requested.mode)

  if (!sharedTopologySupportsMode(config, requested.mode)) {
    if (hasExplicitConstraints(input)) {
      return {
        success: false,
        code: 'validation_error',
        error:
          'Shared-topology provisioning requires SUPACONSOLE_SHARED_PG_ADMIN_URL and related shared Postgres settings. Configure those settings or request full_stack_isolated explicitly.',
      }
    }

    const fallbackProfile = resolveInstanceModeProfile('full_stack_isolated')
    return {
      success: true,
      mode: fallbackProfile.key,
      topology: fallbackProfile.defaultTopology,
      runtimeKind: fallbackProfile.defaultRuntime,
      reason: `Default mode "${requested.mode}" is not configured on this host, so provisioning fell back to "${fallbackProfile.key}".`,
      usedFallback: true,
      normalizedInput: {
        ...input,
        mode: fallbackProfile.key,
        topology: fallbackProfile.defaultTopology,
        runtimeKind: fallbackProfile.defaultRuntime,
      },
    }
  }

  if (input?.topology && input.topology !== requestedProfile.defaultTopology) {
    return {
      success: false,
      code: 'validation_error',
      error: `Topology "${input.topology}" is not compatible with mode "${requested.mode}". Expected "${requestedProfile.defaultTopology}".`,
    }
  }

  if (input?.runtimeKind && input.runtimeKind !== requestedProfile.defaultRuntime) {
    return {
      success: false,
      code: 'validation_error',
      error: `Runtime kind "${input.runtimeKind}" is not compatible with mode "${requested.mode}". Expected "${requestedProfile.defaultRuntime}".`,
    }
  }

  return {
    success: true,
    mode: requestedProfile.key,
    topology: requestedProfile.defaultTopology,
    runtimeKind: requestedProfile.defaultRuntime,
    reason: requested.reason,
    usedFallback: false,
    normalizedInput: {
      ...input,
      mode: requestedProfile.key,
      topology: requestedProfile.defaultTopology,
      runtimeKind: requestedProfile.defaultRuntime,
    },
  }
}