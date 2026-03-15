import { promises as fs } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createProjectBackup, restoreProjectBackup } from '../backup/service'
import { writeProjectConfigArtifacts } from '../config/project'
import { isSupabaseCliAvailable } from '../cli'
import { applyProjectEnvAliases, parseEnvText } from '../secrets/normalization'
import { mergeProjectEnvVarWrites } from '../secrets/project-env'
import {
  deleteStoredSecretReferences,
  externalizeProjectSecrets,
  materializeProjectEnvRows,
} from '../secrets/provider'
import type { ProjectEnvVarMutationMap } from '../secrets/types'
import { describeProjectTemplateBoundary, renderProjectTemplatePlan } from '../templates'
import {
  buildDefaultProjectEnv,
  buildPortAllocation,
  collectConfiguredPorts,
  rebaseProjectPorts,
  REQUIRED_INSTANCE_PORT_OFFSETS,
  type ProjectEnvRecord,
} from './env'
import { checkDockerPrerequisites, resolveContainerRuntimeEnv } from './localRuntime'
import {
  buildRuntimeMetadataFromStatus,
  getProjectFilesystemLayout,
  mergeRuntimeMetadata,
  resolveProjectInstanceProfile,
  resolveStoredProjectInstanceProfile,
} from './metadata'
import { findAvailableBasePort, isPortAvailable } from './ports'
import {
  createProjectRecord,
  deleteProjectEnvVars,
  deleteProjectRecord,
  getProjectById,
  listProjectEnvVarRecords,
  updateProjectInstanceState,
  upsertProjectEnvVarRecords,
} from './repository'
import type { CreateProjectInstanceInput, ProjectInstanceProfile } from './types'
import type {
  BackupProjectResult,
  CreateProjectResult,
  DeployProjectResult,
  InspectProjectResult,
  InstanceRuntimeContext,
  MutationResult,
  RestoreProjectResult,
} from './service'
import { loadSharedTopologyConfig } from './topology'
import { resolveProjectWorkspacePaths, writeProjectTemplateArtifacts } from './workspace'

const execAsync = promisify(exec)

function unsupportedProfileMessage(profile: ProjectInstanceProfile): string | null {
  const boundary = describeProjectTemplateBoundary(profile)
  if (!boundary.deployable) {
    return boundary.reason ?? `Provisioning mode \"${profile.mode.key}\" is not deployable.`
  }

  return null
}

function buildRuntimeEnvValues(statusJson: Record<string, unknown>): Record<string, string> {
  const persisted: Record<string, string> = {}

  if (statusJson.API_URL) persisted.API_URL = String(statusJson.API_URL)
  if (statusJson.GRAPHQL_URL) persisted.GRAPHQL_URL = String(statusJson.GRAPHQL_URL)
  if (statusJson.STORAGE_URL) persisted.STORAGE_URL = String(statusJson.STORAGE_URL)
  if (statusJson.STORAGE_S3_URL) persisted.STORAGE_S3_URL = String(statusJson.STORAGE_S3_URL)
  if (statusJson.S3_ACCESS_KEY) persisted.S3_ACCESS_KEY = String(statusJson.S3_ACCESS_KEY)
  if (statusJson.S3_SECRET_KEY) persisted.S3_SECRET_KEY = String(statusJson.S3_SECRET_KEY)
  if (statusJson.S3_REGION) persisted.S3_REGION = String(statusJson.S3_REGION)
  if (statusJson.MCP_URL) persisted.MCP_URL = String(statusJson.MCP_URL)
  if (statusJson.STUDIO_URL) persisted.STUDIO_URL = String(statusJson.STUDIO_URL)
  if (statusJson.INBUCKET_URL) persisted.INBUCKET_URL = String(statusJson.INBUCKET_URL)
  if (statusJson.MAILPIT_URL) persisted.MAILPIT_URL = String(statusJson.MAILPIT_URL)
  if (statusJson.DB_URL) persisted.DB_URL = String(statusJson.DB_URL)
  if (statusJson.JWT_SECRET) persisted.JWT_SECRET = String(statusJson.JWT_SECRET)
  if (statusJson.PUBLISHABLE_KEY) persisted.PUBLISHABLE_KEY = String(statusJson.PUBLISHABLE_KEY)
  if (statusJson.SECRET_KEY) persisted.SECRET_KEY = String(statusJson.SECRET_KEY)

  return persisted
}

async function persistProjectEnv(
  project: { id: string; slug: string; name: string },
  context: InstanceRuntimeContext,
  profile: ProjectInstanceProfile,
  workspacePaths: ReturnType<typeof resolveProjectWorkspacePaths>,
  env: ProjectEnvRecord,
  envRows: ReturnType<typeof mergeProjectEnvVarWrites>,
  source: 'generated' | 'rebalanced' | 'persisted',
): Promise<void> {
  const templatePlan = await renderProjectTemplatePlan({
    workspaceRoot: context.workspaceRoot,
    profile,
    env,
  })
  await writeProjectTemplateArtifacts(workspacePaths, templatePlan)
  await upsertProjectEnvVarRecords(project.id, envRows)
  await updateProjectInstanceState(project.id, {
    portAllocation: buildPortAllocation(env, source),
    secretMetadata: {
      strategy: envRows.some((row) => row.valueSource === 'indirect') ? 'reference_ready' : 'inline_env',
      managedKeys: envRows.map((row) => row.key),
    },
  })

  await writeProjectConfigArtifacts({
    workspaceRoot: context.workspaceRoot,
    projectRoot: workspacePaths.projectRoot,
    project,
    profile,
    envRows,
    materializedEnv: env,
    secretReferences: (await materializeProjectEnvRows(context.workspaceRoot, envRows)).secretReferences,
    sharedTopology: await loadSharedTopologyConfig(context.workspaceRoot),
  })
}

async function markProjectFailure(projectId: string, runtimeMetadata: unknown, message: string): Promise<void> {
  await updateProjectInstanceState(projectId, {
    runtimeStatus: 'failed',
    runtimeMetadata: mergeRuntimeMetadata(runtimeMetadata, {
      status: 'failed',
      lastError: message,
      lastStatusSyncAt: new Date().toISOString(),
    }),
  })
}

async function verifyRunningStack(projectRoot: string, projectDockerDir: string): Promise<void> {
  try {
    const { stdout } = await execAsync('docker compose ps --format json', {
      cwd: projectDockerDir,
      maxBuffer: 1024 * 1024 * 2,
    })
    const rows = stdout.trim()
    const containers = rows ? JSON.parse(`[${rows.split('\n').join(',')}]`) : []
    const runningContainers = containers.filter((container: { State: string }) => container.State === 'running')

    const inbucketContainer = runningContainers.find((container: unknown) => {
      const value = container as Record<string, string | number>
      return value.Service === 'inbucket' || (typeof value.Name === 'string' && value.Name.includes('inbucket'))
    })

    if (!inbucketContainer) {
      throw new Error('Inbucket service is not running after deployment. Check `docker compose logs inbucket` for details.')
    }

    const envText = await fs.readFile(path.join(projectRoot, '.env'), 'utf8').catch(() => '')
    const fileEnv = parseEnvText(envText)
    const expectedJwt = fileEnv.JWT_SECRET || ''
    const authContainer = runningContainers.find((container: unknown) => {
      const value = container as Record<string, string | number>
      return value.Service === 'auth' || (typeof value.Name === 'string' && value.Name.includes('-auth'))
    })

    if (!authContainer) {
      throw new Error('Auth (GoTrue) container not found after deployment')
    }

    const containerName = authContainer.Name || authContainer.Names || authContainer.Container || authContainer.Name
    const { stdout: gotrueEnv } = await execAsync(`docker exec ${containerName} printenv GOTRUE_JWT_SECRET`, {
      cwd: projectDockerDir,
    })
    const containerJwt = gotrueEnv.trim()
    if (expectedJwt && containerJwt && expectedJwt !== containerJwt) {
      throw new Error(
        'GOTRUE_JWT_SECRET inside container does not match project .env JWT_SECRET. This will cause invalid JWTs for admin operations.',
      )
    }
  } catch {
    // Verification is best-effort; the CLI remains the source of truth for deploy success.
  }
}

export async function createFullStackInstance(
  context: InstanceRuntimeContext,
  name: string,
  userId: string,
  description?: string,
  instanceInput?: CreateProjectInstanceInput,
): Promise<CreateProjectResult> {
  try {
    const cli = await isSupabaseCliAvailable()
    if (!cli.available) {
      throw new Error('Supabase CLI is not installed or not available in PATH. Please install it and try again.')
    }

    const timestamp = Date.now()
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`
    const instanceProfile = resolveProjectInstanceProfile(instanceInput, slug)
    const unsupportedMessage = unsupportedProfileMessage(instanceProfile)
    if (unsupportedMessage) {
      return { success: false, code: 'unsupported_mode', error: unsupportedMessage }
    }

    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, instanceProfile.topologyMetadata)
    await fs.mkdir(workspacePaths.projectRoot, { recursive: true })

    const initialBase = 8000 + (timestamp % 10000)
    const foundBase = await findAvailableBasePort(initialBase, [...REQUIRED_INSTANCE_PORT_OFFSETS], 200)
    if (!foundBase) {
      throw new Error('Failed to find an available base port for the new project. Please free local ports or try again.')
    }

    const defaultEnvVars = buildDefaultProjectEnv(slug, foundBase, context.generateSecret)
    const portAllocation = buildPortAllocation(defaultEnvVars, 'generated')
    const externalized = await externalizeProjectSecrets(context.workspaceRoot, slug, defaultEnvVars)
    const materialized = await materializeProjectEnvRows(context.workspaceRoot, externalized.writes)

    const project = await createProjectRecord({
      name,
      slug,
      description,
      ownerId: userId,
      runtimeStatus: 'created',
      portAllocation,
      instance: {
        ...instanceProfile,
        secretMetadata: {
          strategy: externalized.writes.some((row) => row.valueSource === 'indirect') ? 'reference_ready' : 'inline_env',
          managedKeys: externalized.writes.map((row) => row.key),
        },
      },
    })

    await persistProjectEnv(
      project,
      context,
      instanceProfile,
      workspacePaths,
      materialized.env,
      externalized.writes,
      'generated',
    )

    return { success: true, project }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function updateFullStackInstanceEnvVars(
  context: InstanceRuntimeContext,
  projectId: string,
  envVars: ProjectEnvVarMutationMap,
): Promise<MutationResult> {
  try {
    const project = await getProjectById(projectId)
    if (!project) {
      return { success: false, code: 'project_not_found', error: 'Project not found' }
    }

    const profile = resolveStoredProjectInstanceProfile(project)
    const unsupportedMessage = unsupportedProfileMessage(profile)
    if (unsupportedMessage) {
      return { success: false, code: 'unsupported_mode', error: unsupportedMessage }
    }

    const existingEnvRows = await listProjectEnvVarRecords(projectId)
    const mergedWrites = mergeProjectEnvVarWrites(existingEnvRows, envVars)
    const materialized = await materializeProjectEnvRows(context.workspaceRoot, mergedWrites)
    if (materialized.unresolvedKeys.length > 0) {
      return {
        success: false,
        code: 'validation_error',
        error: `Unable to resolve secret references for: ${materialized.unresolvedKeys.join(', ')}`,
      }
    }

    const mergedEnv = applyProjectEnvAliases(materialized.env)

    await upsertProjectEnvVarRecords(projectId, mergedWrites)

    const layout = getProjectFilesystemLayout(project)
    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, layout)
    const templatePlan = await renderProjectTemplatePlan({
      workspaceRoot: context.workspaceRoot,
      profile,
      env: mergedEnv,
    })
    await writeProjectTemplateArtifacts(workspacePaths, templatePlan)
    await updateProjectInstanceState(projectId, {
      portAllocation: buildPortAllocation(mergedEnv, 'persisted'),
      secretMetadata: {
        strategy: mergedWrites.some((row) => row.valueSource === 'indirect') ? 'reference_ready' : 'inline_env',
        managedKeys: mergedWrites.map((row) => row.key),
      },
    })

    await writeProjectConfigArtifacts({
      workspaceRoot: context.workspaceRoot,
      projectRoot: workspacePaths.projectRoot,
      project,
      profile,
      envRows: mergedWrites,
      materializedEnv: mergedEnv,
      secretReferences: materialized.secretReferences,
      sharedTopology: await loadSharedTopologyConfig(context.workspaceRoot),
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function inspectFullStackInstance(
  context: InstanceRuntimeContext,
  projectId: string,
  persist = false,
): Promise<InspectProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const profile = resolveStoredProjectInstanceProfile(project)
  const unsupportedMessage = unsupportedProfileMessage(profile)
  if (unsupportedMessage) {
    return { success: false, code: 'unsupported_mode', error: unsupportedMessage, runtimeStatus: 'failed' }
  }

  const layout = getProjectFilesystemLayout(project)
  const projectRoot = path.join(context.workspaceRoot, layout.projectRootRelative)

  try {
    const { stdout } = await execAsync('supabase status -o json --workdir .', {
      cwd: projectRoot,
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 2,
    })

    const statusJson = JSON.parse(stdout) as Record<string, unknown>
    if (persist) {
      const runtimeValues = buildRuntimeEnvValues(statusJson)
      await upsertProjectEnvVarRecords(projectId, mergeProjectEnvVarWrites([], runtimeValues))
      await updateProjectInstanceState(projectId, {
        status: 'active',
        runtimeStatus: 'active',
        runtimeMetadata: buildRuntimeMetadataFromStatus(statusJson, project, 'active'),
      })
    }

    return { success: true, status: statusJson, runtimeStatus: 'active' }
  } catch (error) {
    if (persist) {
      await markProjectFailure(
        projectId,
        project.runtimeMetadata,
        error instanceof Error ? error.message : 'Failed to inspect project runtime',
      )
    }

    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Failed to inspect project runtime',
      runtimeStatus: profile.runtimeMetadata.status ?? 'created',
    }
  }
}

export async function deployFullStackInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<DeployProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  const profile = resolveStoredProjectInstanceProfile(project)
  const unsupportedMessage = unsupportedProfileMessage(profile)
  if (unsupportedMessage) {
    return { success: false, code: 'unsupported_mode', error: unsupportedMessage }
  }

  const layout = getProjectFilesystemLayout(project)
  const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, layout)
  const projectRoot = workspacePaths.projectRoot
  const projectDockerDir = workspacePaths.dockerDir

    const existingEnvRows = await listProjectEnvVarRecords(projectId)
    const materializedRows = mergeProjectEnvVarWrites(existingEnvRows, {})
    const materialized = await materializeProjectEnvRows(context.workspaceRoot, materializedRows)
    if (materialized.unresolvedKeys.length > 0) {
      return {
        success: false,
        code: 'validation_error',
        error: `Unable to resolve secret references for: ${materialized.unresolvedKeys.join(', ')}`,
      }
    }

    const fileEnv = applyProjectEnvAliases(materialized.env)
    await persistProjectEnv(project, context, profile, workspacePaths, fileEnv, materializedRows, 'persisted')

  try {
    await updateProjectInstanceState(projectId, {
      runtimeStatus: 'deploying',
      runtimeMetadata: mergeRuntimeMetadata(project.runtimeMetadata, {
        status: 'deploying',
        lastError: undefined,
        lastStatusSyncAt: new Date().toISOString(),
      }),
    })

    const checks = await checkDockerPrerequisites()
    if (!checks.docker) {
      throw new Error('Docker is not installed or not running. Please install Docker Desktop and ensure it is started before deploying.')
    }

    if (!checks.dockerCompose) {
      throw new Error('Docker Compose is not available. Please ensure Docker Desktop includes Docker Compose or install it separately.')
    }

    const portsToCheck = collectConfiguredPorts(fileEnv)

    const occupied: number[] = []
    for (const port of portsToCheck) {
      try {
        const available = await isPortAvailable(port)
        if (!available) {
          occupied.push(port)
        }
      } catch {
        occupied.push(port)
      }
    }

    if (occupied.length > 0) {
      const initialBase = 8000 + (Date.now() % 10000)
      const newBase = await findAvailableBasePort(initialBase, [...REQUIRED_INSTANCE_PORT_OFFSETS], 200)
      if (!newBase) {
        throw new Error('Port(s) in use and unable to find alternative base port. Free ports or configure custom ports in the project settings.')
      }

      Object.assign(fileEnv, rebaseProjectPorts(fileEnv, newBase))
      await persistProjectEnv(project, context, profile, workspacePaths, fileEnv, materializedRows, 'rebalanced')
    }

    const cli = await isSupabaseCliAvailable()
    if (!cli.available) {
      throw new Error('Supabase CLI not available in PATH')
    }

    const runtimeEnv = await resolveContainerRuntimeEnv(projectRoot, layout.composeProjectName)
    const maxRetries = 3
    let started = false

    for (let attempt = 0; attempt < maxRetries && !started; attempt++) {
      const conflicts: number[] = []
      for (const port of collectConfiguredPorts(fileEnv)) {
        try {
          const available = await isPortAvailable(port)
          if (!available) {
            conflicts.push(port)
          }
        } catch {
          conflicts.push(port)
        }
      }

      if (conflicts.length > 0) {
        const nextBase = await findAvailableBasePort(8000 + (Date.now() % 10000), [...REQUIRED_INSTANCE_PORT_OFFSETS], 200)
        if (!nextBase) {
          throw new Error('Port(s) in use and unable to find alternative base port. Free ports or configure custom ports in the project settings.')
        }

        Object.assign(fileEnv, rebaseProjectPorts(fileEnv, nextBase))
        await persistProjectEnv(project, context, profile, workspacePaths, fileEnv, materializedRows, 'rebalanced')
      }

      try {
        await execAsync('supabase start', {
          cwd: projectRoot,
          timeout: 1000 * 60 * 10,
          maxBuffer: 1024 * 1024 * 10,
          env: runtimeEnv as NodeJS.ProcessEnv,
        })
        started = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('port is already allocated') && !message.match(/Bind for .* failed: port is already allocated/)) {
          throw error
        }

        const nextBase = await findAvailableBasePort(8000 + (Date.now() % 10000), [...REQUIRED_INSTANCE_PORT_OFFSETS], 200)
        if (!nextBase) {
          throw new Error('Unable to find alternative base port after Docker reported port allocation conflicts.')
        }

        Object.assign(fileEnv, rebaseProjectPorts(fileEnv, nextBase))
        await persistProjectEnv(project, context, profile, workspacePaths, fileEnv, materializedRows, 'rebalanced')
      }
    }

    if (!started) {
      throw new Error('Supabase CLI failed to start the stack after retries')
    }

    await verifyRunningStack(projectRoot, projectDockerDir)
    const inspection = await inspectFullStackInstance(context, projectId, true)
    if (!inspection.success) {
      await updateProjectInstanceState(projectId, {
        status: 'active',
        runtimeStatus: 'active',
        runtimeMetadata: mergeRuntimeMetadata(project.runtimeMetadata, {
          status: 'active',
          lastStatusSyncAt: new Date().toISOString(),
        }),
      })

      return { success: true, note: 'Could not query supabase CLI status after start' }
    }

    return { success: true, status: inspection.status, note: inspection.note }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await markProjectFailure(projectId, project.runtimeMetadata, message)
    return { success: false, code: 'runtime_error', error: message }
  }
}

export async function stopFullStackInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<MutationResult> {
  try {
    const project = await getProjectById(projectId)
    if (!project) {
      return { success: false, code: 'project_not_found', error: 'Project not found' }
    }

    const profile = resolveStoredProjectInstanceProfile(project)
    const unsupportedMessage = unsupportedProfileMessage(profile)
    if (unsupportedMessage) {
      return { success: false, code: 'unsupported_mode', error: unsupportedMessage }
    }

    const layout = getProjectFilesystemLayout(project)
    const dockerDir = path.join(context.workspaceRoot, layout.dockerDirRelative)
    const projectRoot = path.join(context.workspaceRoot, layout.projectRootRelative)

    try {
      await execAsync('supabase stop --workdir .', { cwd: projectRoot, timeout: 120000 })
    } catch {
      await execAsync('docker compose stop', { cwd: dockerDir })
    }

    await updateProjectInstanceState(projectId, {
      status: 'paused',
      runtimeStatus: 'paused',
      runtimeMetadata: mergeRuntimeMetadata(project.runtimeMetadata, {
        status: 'paused',
        lastStatusSyncAt: new Date().toISOString(),
      }),
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function deleteFullStackInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<MutationResult> {
  try {
    const project = await getProjectById(projectId)
    if (!project) {
      return { success: false, code: 'project_not_found', error: 'Project not found' }
    }

    const profile = resolveStoredProjectInstanceProfile(project)
    const unsupportedMessage = unsupportedProfileMessage(profile)
    if (unsupportedMessage) {
      return { success: false, code: 'unsupported_mode', error: unsupportedMessage }
    }

    const layout = getProjectFilesystemLayout(project)
    const projectDir = path.join(context.workspaceRoot, layout.projectRootRelative)
    const dockerDir = path.join(context.workspaceRoot, layout.dockerDirRelative)
    const secretRefs = (await listProjectEnvVarRecords(projectId))
      .map((envVar) => envVar.secretReference)
      .filter((reference): reference is string => typeof reference === 'string' && reference.length > 0)

    try {
      await execAsync('supabase stop --workdir .', { cwd: projectDir, timeout: 120000 })
    } catch {
      try {
        await execAsync('docker compose down --volumes --remove-orphans', {
          cwd: dockerDir,
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 5,
        })
      } catch {
        // Continue with filesystem and metadata cleanup.
      }
    }

    try {
      const removeCommand = process.platform === 'win32' ? `rmdir /s /q "${projectDir}"` : `rm -rf "${projectDir}"`
      await execAsync(removeCommand, { timeout: 60000 })
    } catch {
      // Continue with metadata cleanup even if local files remain.
    }

  await deleteStoredSecretReferences(context.workspaceRoot, secretRefs)
    await deleteProjectEnvVars(projectId)
    await deleteProjectRecord(projectId)

    return { success: true }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function backupFullStackInstance(
  context: InstanceRuntimeContext,
  projectId: string,
): Promise<BackupProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  return createProjectBackup(context, project)
}

export async function restoreFullStackInstance(
  context: InstanceRuntimeContext,
  projectId: string,
  backupId?: string,
): Promise<RestoreProjectResult> {
  const project = await getProjectById(projectId)
  if (!project) {
    return { success: false, code: 'project_not_found', error: 'Project not found' }
  }

  return restoreProjectBackup(context, project, backupId)
}