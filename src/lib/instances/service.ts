import type { CreateProjectInstanceInput, InstanceRuntimeStatus } from './types'
import type { ProjectEnvVarMutationMap } from '@/lib/secrets/types'

export type InstanceOperationCode =
  | 'project_not_found'
  | 'unsupported_mode'
  | 'validation_error'
  | 'configuration_error'
  | 'runtime_error'

export interface CreateProjectResult {
  success: boolean
  project?: unknown
  error?: string
  code?: InstanceOperationCode
}

export interface MutationResult {
  success: boolean
  error?: string
  code?: InstanceOperationCode
}

export interface DeployProjectResult extends MutationResult {
  status?: Record<string, unknown>
  note?: string
}

export interface BackupProjectResult extends MutationResult {
  backupId?: string
  backupDirectory?: string
  status?: Record<string, unknown>
  warnings?: string[]
}

export interface RestoreProjectResult extends MutationResult {
  restoredFrom?: string
  status?: Record<string, unknown>
  warnings?: string[]
}

export interface InspectProjectResult extends MutationResult {
  status?: Record<string, unknown>
  note?: string
  runtimeStatus?: InstanceRuntimeStatus
}

export interface InstanceRuntimeContext {
  workspaceRoot: string
  generateSecret: (length: number) => string
}

export interface InstanceLifecycleService {
  createInstance: (
    name: string,
    userId: string,
    description?: string,
    instance?: CreateProjectInstanceInput,
  ) => Promise<CreateProjectResult>
  createFullStackInstance: (
    name: string,
    userId: string,
    description?: string,
    instance?: CreateProjectInstanceInput,
  ) => Promise<CreateProjectResult>
  createSharedPostgresInstance: (
    name: string,
    userId: string,
    description?: string,
    instance?: CreateProjectInstanceInput,
  ) => Promise<CreateProjectResult>
  updateInstanceEnvVars: (projectId: string, envVars: ProjectEnvVarMutationMap) => Promise<MutationResult>
  deployInstance: (projectId: string) => Promise<DeployProjectResult>
  stopInstance: (projectId: string) => Promise<MutationResult>
  inspectInstance: (projectId: string) => Promise<InspectProjectResult>
  deleteInstance: (projectId: string) => Promise<MutationResult>
  backupInstance: (projectId: string) => Promise<BackupProjectResult>
  restoreInstance: (projectId: string, backupId?: string) => Promise<RestoreProjectResult>
}

export interface ProjectProvisioningOrchestrator {
  createProject: (
    name: string,
    userId: string,
    description?: string,
    instance?: CreateProjectInstanceInput,
  ) => Promise<CreateProjectResult>
  updateProjectEnvVars: (projectId: string, envVars: ProjectEnvVarMutationMap) => Promise<MutationResult>
  deployProject: (projectId: string) => Promise<DeployProjectResult>
  pauseProject: (projectId: string) => Promise<MutationResult>
  deleteProject: (projectId: string) => Promise<MutationResult>
  backupProject: (projectId: string) => Promise<BackupProjectResult>
  restoreProject: (projectId: string, backupId?: string) => Promise<RestoreProjectResult>
}

export function createProjectProvisioningService(orchestrator: ProjectProvisioningOrchestrator) {
  return {
    createProject: orchestrator.createProject,
    updateProjectEnvVars: orchestrator.updateProjectEnvVars,
    deployProject: orchestrator.deployProject,
    pauseProject: orchestrator.pauseProject,
    deleteProject: orchestrator.deleteProject,
    backupProject: orchestrator.backupProject,
    restoreProject: orchestrator.restoreProject,
  }
}