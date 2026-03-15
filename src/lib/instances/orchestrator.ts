import type { ProjectEnvVarMutationMap } from '../secrets/types'
import { describeProjectTemplateBoundary } from '../templates'
import { runLifecycleOperation } from '../observability/lifecycle'
import { getProjectById } from './repository'
import { resolveProjectInstanceProfile, resolveStoredProjectInstanceProfile } from './metadata'
import type { CreateProjectInstanceInput } from './types'
import { selectProvisioningMode } from './selector'
import { loadSharedTopologyConfig } from './topology'
import {
  createFullStackInstance as defaultCreateFullStackInstance,
  backupFullStackInstance as defaultBackupFullStackInstance,
  deleteFullStackInstance as defaultDeleteFullStackInstance,
  deployFullStackInstance as defaultDeployFullStackInstance,
  inspectFullStackInstance as defaultInspectFullStackInstance,
  restoreFullStackInstance as defaultRestoreFullStackInstance,
  stopFullStackInstance as defaultStopFullStackInstance,
  updateFullStackInstanceEnvVars as defaultUpdateFullStackInstanceEnvVars,
} from './fullStack'
import {
  backupSharedPostgresInstance as defaultBackupSharedPostgresInstance,
  createSharedPostgresInstance as defaultCreateSharedPostgresInstance,
  deleteSharedPostgresInstance as defaultDeleteSharedPostgresInstance,
  deploySharedPostgresInstance as defaultDeploySharedPostgresInstance,
  inspectSharedPostgresInstance as defaultInspectSharedPostgresInstance,
  restoreSharedPostgresInstance as defaultRestoreSharedPostgresInstance,
  stopSharedPostgresInstance as defaultStopSharedPostgresInstance,
  updateSharedPostgresInstanceEnvVars as defaultUpdateSharedPostgresInstanceEnvVars,
} from './sharedPostgres'
import type {
  BackupProjectResult,
  CreateProjectResult,
  DeployProjectResult,
  InspectProjectResult,
  InstanceLifecycleService,
  InstanceRuntimeContext,
  MutationResult,
  RestoreProjectResult,
} from './service'
import type { ProjectInstanceProfile } from './types'

interface InstanceOrchestratorDependencies {
  getProjectById?: typeof getProjectById
  loadSharedTopologyConfig?: typeof loadSharedTopologyConfig
  selectProvisioningMode?: typeof selectProvisioningMode
  createFullStackInstance?: typeof defaultCreateFullStackInstance
  createSharedPostgresInstance?: typeof defaultCreateSharedPostgresInstance
  updateFullStackInstanceEnvVars?: typeof defaultUpdateFullStackInstanceEnvVars
  updateSharedPostgresInstanceEnvVars?: typeof defaultUpdateSharedPostgresInstanceEnvVars
  deployFullStackInstance?: typeof defaultDeployFullStackInstance
  deploySharedPostgresInstance?: typeof defaultDeploySharedPostgresInstance
  stopFullStackInstance?: typeof defaultStopFullStackInstance
  stopSharedPostgresInstance?: typeof defaultStopSharedPostgresInstance
  inspectFullStackInstance?: typeof defaultInspectFullStackInstance
  inspectSharedPostgresInstance?: typeof defaultInspectSharedPostgresInstance
  deleteFullStackInstance?: typeof defaultDeleteFullStackInstance
  deleteSharedPostgresInstance?: typeof defaultDeleteSharedPostgresInstance
  backupFullStackInstance?: typeof defaultBackupFullStackInstance
  backupSharedPostgresInstance?: typeof defaultBackupSharedPostgresInstance
  restoreFullStackInstance?: typeof defaultRestoreFullStackInstance
  restoreSharedPostgresInstance?: typeof defaultRestoreSharedPostgresInstance
}

type ProjectModeResolution =
  | {
      project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>
      profile: ProjectInstanceProfile
      error?: never
    }
  | { project?: never; error: MutationResult }

function unsupportedMode(error: string): MutationResult {
  return { success: false, code: 'unsupported_mode', error }
}

function isSharedTopologyMode(profile: ProjectInstanceProfile): boolean {
  return profile.mode.key === 'shared_core_schema_isolated' || profile.mode.key === 'db_isolated'
}

export function createInstanceOrchestrator(
  context: InstanceRuntimeContext,
  dependencies: InstanceOrchestratorDependencies = {},
): InstanceLifecycleService {
  const loadProject = dependencies.getProjectById ?? getProjectById
  const loadTopologyConfig = dependencies.loadSharedTopologyConfig ?? loadSharedTopologyConfig
  const chooseProvisioningMode = dependencies.selectProvisioningMode ?? selectProvisioningMode
  const createFullStackInstance = dependencies.createFullStackInstance ?? defaultCreateFullStackInstance
  const createSharedPostgresInstance =
    dependencies.createSharedPostgresInstance ?? defaultCreateSharedPostgresInstance
  const updateFullStackInstanceEnvVars =
    dependencies.updateFullStackInstanceEnvVars ?? defaultUpdateFullStackInstanceEnvVars
  const updateSharedPostgresInstanceEnvVars =
    dependencies.updateSharedPostgresInstanceEnvVars ?? defaultUpdateSharedPostgresInstanceEnvVars
  const deployFullStackInstance = dependencies.deployFullStackInstance ?? defaultDeployFullStackInstance
  const deploySharedPostgresInstance =
    dependencies.deploySharedPostgresInstance ?? defaultDeploySharedPostgresInstance
  const stopFullStackInstance = dependencies.stopFullStackInstance ?? defaultStopFullStackInstance
  const stopSharedPostgresInstance = dependencies.stopSharedPostgresInstance ?? defaultStopSharedPostgresInstance
  const inspectFullStackInstance = dependencies.inspectFullStackInstance ?? defaultInspectFullStackInstance
  const inspectSharedPostgresInstance =
    dependencies.inspectSharedPostgresInstance ?? defaultInspectSharedPostgresInstance
  const deleteFullStackInstance = dependencies.deleteFullStackInstance ?? defaultDeleteFullStackInstance
  const deleteSharedPostgresInstance =
    dependencies.deleteSharedPostgresInstance ?? defaultDeleteSharedPostgresInstance
  const backupFullStackInstance = dependencies.backupFullStackInstance ?? defaultBackupFullStackInstance
  const backupSharedPostgresInstance =
    dependencies.backupSharedPostgresInstance ?? defaultBackupSharedPostgresInstance
  const restoreFullStackInstance = dependencies.restoreFullStackInstance ?? defaultRestoreFullStackInstance
  const restoreSharedPostgresInstance =
    dependencies.restoreSharedPostgresInstance ?? defaultRestoreSharedPostgresInstance

  async function createInstance(
    name: string,
    userId: string,
    description?: string,
    instance?: CreateProjectInstanceInput,
  ): Promise<CreateProjectResult> {
    const topologyConfig = await loadTopologyConfig(context.workspaceRoot)
    const decision = chooseProvisioningMode(instance, topologyConfig)
    if (!decision.success) {
      return { success: false, code: decision.code, error: decision.error }
    }

    const resolvedInput: CreateProjectInstanceInput = {
      ...decision.normalizedInput,
      topologyMetadata: {
        ...decision.normalizedInput.topologyMetadata,
        selectorReason: decision.reason,
      },
    }

    const profile = resolveProjectInstanceProfile(resolvedInput, 'pending-slug')
    const boundary = describeProjectTemplateBoundary(profile)
    if (!boundary.deployable) {
      return unsupportedMode(boundary.reason ?? `Provisioning mode \"${profile.mode.key}\" is not deployable.`)
    }

    if (isSharedTopologyMode(profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'create',
          mode: profile.mode.key,
          topology: profile.topology.key,
          runtimeKind: profile.runtime.key,
          metadata: { name },
        },
        () => createSharedPostgresInstance(context, name, userId, description, resolvedInput),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'create',
        mode: profile.mode.key,
        topology: profile.topology.key,
        runtimeKind: profile.runtime.key,
        metadata: { name },
      },
      () => createFullStackInstance(context, name, userId, description, resolvedInput),
    )
  }

  async function resolveExistingProjectMode(projectId: string): Promise<ProjectModeResolution> {
    const project = await loadProject(projectId)
    if (!project) {
      return { error: { success: false, code: 'project_not_found', error: 'Project not found' } }
    }

    const profile = resolveStoredProjectInstanceProfile(project)
    const boundary = describeProjectTemplateBoundary(profile)
    if (!boundary.deployable) {
      return {
        error: unsupportedMode(boundary.reason ?? `Provisioning mode \"${profile.mode.key}\" is not deployable.`),
      }
    }

    return { project, profile }
  }

  async function updateInstanceEnvVars(projectId: string, envVars: ProjectEnvVarMutationMap): Promise<MutationResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'update_env',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
        },
        () => updateSharedPostgresInstanceEnvVars(context, projectId, envVars),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'update_env',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
      },
      () => updateFullStackInstanceEnvVars(context, projectId, envVars),
    )
  }

  async function deployInstance(projectId: string): Promise<DeployProjectResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'deploy',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
        },
        () => deploySharedPostgresInstance(context, projectId),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'deploy',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
      },
      () => deployFullStackInstance(context, projectId),
    )
  }

  async function stopInstance(projectId: string): Promise<MutationResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'stop',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
        },
        () => stopSharedPostgresInstance(context, projectId),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'stop',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
      },
      () => stopFullStackInstance(context, projectId),
    )
  }

  async function inspectInstance(projectId: string): Promise<InspectProjectResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'inspect',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
        },
        () => inspectSharedPostgresInstance(context, projectId, true),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'inspect',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
      },
      () => inspectFullStackInstance(context, projectId, true),
    )
  }

  async function deleteInstance(projectId: string): Promise<MutationResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'delete',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
        },
        () => deleteSharedPostgresInstance(context, projectId),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'delete',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
      },
      () => deleteFullStackInstance(context, projectId),
    )
  }

  async function backupInstance(projectId: string): Promise<BackupProjectResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'backup',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
        },
        () => backupSharedPostgresInstance(context, projectId),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'backup',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
      },
      () => backupFullStackInstance(context, projectId),
    )
  }

  async function restoreInstance(projectId: string, backupId?: string): Promise<RestoreProjectResult> {
    const resolved = await resolveExistingProjectMode(projectId)
    if (resolved.error) {
      return resolved.error
    }

    if (isSharedTopologyMode(resolved.profile)) {
      return runLifecycleOperation(
        {
          workspaceRoot: context.workspaceRoot,
          operation: 'restore',
          projectId: resolved.project.id,
          projectSlug: resolved.project.slug,
          mode: resolved.profile.mode.key,
          topology: resolved.profile.topology.key,
          runtimeKind: resolved.profile.runtime.key,
          metadata: backupId ? { backupId } : undefined,
        },
        () => restoreSharedPostgresInstance(context, projectId, backupId),
      )
    }

    return runLifecycleOperation(
      {
        workspaceRoot: context.workspaceRoot,
        operation: 'restore',
        projectId: resolved.project.id,
        projectSlug: resolved.project.slug,
        mode: resolved.profile.mode.key,
        topology: resolved.profile.topology.key,
        runtimeKind: resolved.profile.runtime.key,
        metadata: backupId ? { backupId } : undefined,
      },
      () => restoreFullStackInstance(context, projectId, backupId),
    )
  }

  return {
    createInstance,
    createFullStackInstance: (name, userId, description, instance) =>
      createFullStackInstance(context, name, userId, description, instance),
    createSharedPostgresInstance: (name, userId, description, instance) =>
      createSharedPostgresInstance(context, name, userId, description, instance),
    updateInstanceEnvVars,
    deployInstance,
    stopInstance,
    inspectInstance,
    deleteInstance,
    backupInstance,
    restoreInstance,
  }
}