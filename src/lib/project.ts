import { promises as fs } from 'fs'
import * as path from 'path'
import { listProjectBackups as listBackupsForProject } from './backup/service'
import { createInstanceOrchestrator } from './instances/orchestrator'
import { findAvailableBasePort, isPortAvailable } from './instances/ports'
import { getProjectById } from './instances/repository'
import { createProjectProvisioningService } from './instances/service'
import type { CreateProjectInstanceInput } from './instances/types'
import { renderSupabaseConfig } from './templates/supabaseConfig'

export { findAvailableBasePort, isPortAvailable }

export async function updateSupabaseConfig(projectRoot: string, env: Record<string, string>) {
  const cfgPath = path.join(projectRoot, 'supabase', 'config.toml')
  try {
    const current = await fs.readFile(cfgPath, 'utf8').catch(() => undefined)
    await fs.mkdir(path.join(projectRoot, 'supabase'), { recursive: true })
    await fs.writeFile(cfgPath, renderSupabaseConfig(current, env), 'utf8')
  } catch {
  }
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export async function initializeSupabaseCore() {
  const coreDir = path.join(process.cwd(), 'supabase-core')
  const projectsDir = path.join(process.cwd(), 'supabase-projects')

  try {
    const coreExists = await fs.access(coreDir).then(() => true).catch(() => false)
    const projectsExists = await fs.access(projectsDir).then(() => true).catch(() => false)

    if (!projectsExists) {
      await fs.mkdir(projectsDir, { recursive: true })
    }

    if (!coreExists) {
      await fs.mkdir(coreDir, { recursive: true })
      const readme = `This folder previously contained a clone of the Supabase monorepo.
The project now relies on the Supabase CLI for local orchestration.

If you need the full supabase repository for debugging or development, clone it manually:
  git clone https://github.com/supabase/supabase supabase-core
`
      try {
        await fs.writeFile(path.join(coreDir, 'README.md'), readme, 'utf8')
      } catch {
      }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

const instanceOrchestrator = createInstanceOrchestrator({
  workspaceRoot: process.cwd(),
  generateSecret: generateRandomString,
})

const projectProvisioningService = createProjectProvisioningService({
  createProject: (name, userId, description, instanceInput) =>
    instanceOrchestrator.createInstance(name, userId, description, instanceInput),
  updateProjectEnvVars: (projectId, envVars) => instanceOrchestrator.updateInstanceEnvVars(projectId, envVars),
  deployProject: (projectId) => instanceOrchestrator.deployInstance(projectId),
  pauseProject: (projectId) => instanceOrchestrator.stopInstance(projectId),
  deleteProject: (projectId) => instanceOrchestrator.deleteInstance(projectId),
  backupProject: (projectId) => instanceOrchestrator.backupInstance(projectId),
  restoreProject: (projectId, backupId) => instanceOrchestrator.restoreInstance(projectId, backupId),
})

export async function createProject(
  name: string,
  userId: string,
  description?: string,
  instanceInput?: CreateProjectInstanceInput,
) {
  return projectProvisioningService.createProject(name, userId, description, instanceInput)
}

export async function updateProjectEnvVars(projectId: string, envVars: Record<string, string>) {
  return projectProvisioningService.updateProjectEnvVars(projectId, envVars)
}

export async function deployProject(projectId: string) {
  return projectProvisioningService.deployProject(projectId)
}

export async function pauseProject(projectId: string) {
  return projectProvisioningService.pauseProject(projectId)
}

export async function inspectProject(projectId: string) {
  return instanceOrchestrator.inspectInstance(projectId)
}

export async function deleteProject(projectId: string) {
  return projectProvisioningService.deleteProject(projectId)
}

export async function backupProject(projectId: string) {
  return projectProvisioningService.backupProject(projectId)
}

export async function restoreProject(projectId: string, backupId?: string) {
  return projectProvisioningService.restoreProject(projectId, backupId)
}

export async function listProjectBackups(projectId: string) {
  const project = await getProjectById(projectId)
  if (!project) {
    return []
  }

  return listBackupsForProject(process.cwd(), project.slug)
}
