import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import type { Project } from '@prisma/client'
import { getSystemConfigDefaults } from '@/lib/config/defaults'
import { buildProjectConfigSnapshot, writeProjectConfigArtifacts } from '@/lib/config/project'
import { loadSharedTopologyConfig } from '@/lib/instances/topology'
import { resolveStoredProjectInstanceProfile } from '@/lib/instances/metadata'
import { resolveProjectWorkspacePaths } from '@/lib/instances/workspace'
import type {
  BackupProjectResult,
  InstanceRuntimeContext,
  RestoreProjectResult,
} from '@/lib/instances/service'
import { listProjectEnvVarRecords, upsertProjectEnvVarRecords } from '@/lib/instances/repository'
import { materializeProjectEnvRows } from '@/lib/secrets/provider'
import type { NormalizedProjectEnvVarWrite } from '@/lib/secrets/types'

const execFileAsync = promisify(execFile)

interface ProjectBackupManifest {
  backupId: string
  createdAt: string
  projectId: string
  projectSlug: string
  mode: string
  topology: string
  runtimeKind: string
  backupKind: 'workspace_snapshot' | 'metadata_snapshot'
  warnings: string[]
  sqlDumpFile?: string
}

interface ProjectBackupRecord {
  backupId: string
  createdAt: string
  backupDirectory: string
  manifest: ProjectBackupManifest
}

async function copyFileIfPresent(from: string, to: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.copyFile(from, to)
  } catch {
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command])
    return true
  } catch {
    return false
  }
}

async function createSqlDump(
  profileMode: string,
  env: Record<string, string>,
  outputFile: string,
): Promise<string | null> {
  if (!(await commandExists('pg_dump'))) {
    return null
  }

  const databaseUrl = env.TENANT_DATABASE_URL ?? env.DATABASE_URL
  if (!databaseUrl || profileMode === 'full_stack_isolated') {
    return null
  }

  const args = ['--file', outputFile, '--dbname', databaseUrl, '--no-owner', '--no-privileges']
  if (profileMode === 'shared_core_schema_isolated' && env.TENANT_SCHEMA) {
    args.push('--schema', env.TENANT_SCHEMA)
  }

  await execFileAsync('pg_dump', args, { maxBuffer: 1024 * 1024 * 10 })
  return outputFile
}

async function restoreSqlDump(env: Record<string, string>, sqlDumpPath: string): Promise<boolean> {
  if (!(await commandExists('psql'))) {
    return false
  }

  const databaseUrl = env.TENANT_DATABASE_URL ?? env.DATABASE_URL
  if (!databaseUrl) {
    return false
  }

  await execFileAsync('psql', ['--dbname', databaseUrl, '--file', sqlDumpPath], { maxBuffer: 1024 * 1024 * 10 })
  return true
}

function getProjectBackupRoot(workspaceRoot: string, slug: string): string {
  return path.join(getSystemConfigDefaults(workspaceRoot).backupRootPath, slug)
}

async function readBackupManifest(backupDirectory: string): Promise<ProjectBackupManifest | null> {
  try {
    const content = await fs.readFile(path.join(backupDirectory, 'manifest.json'), 'utf8')
    return JSON.parse(content) as ProjectBackupManifest
  } catch {
    return null
  }
}

export async function listProjectBackups(
  workspaceRoot: string,
  slug: string,
): Promise<ProjectBackupRecord[]> {
  const backupRoot = getProjectBackupRoot(workspaceRoot, slug)

  try {
    const entries = await fs.readdir(backupRoot, { withFileTypes: true })
    const backups = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const backupDirectory = path.join(backupRoot, entry.name)
          const manifest = await readBackupManifest(backupDirectory)
          if (!manifest) {
            return null
          }

          return {
            backupId: manifest.backupId,
            createdAt: manifest.createdAt,
            backupDirectory,
            manifest,
          } satisfies ProjectBackupRecord
        }),
    )

    return backups.filter((backup): backup is ProjectBackupRecord => Boolean(backup)).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )
  } catch {
    return []
  }
}

export async function createProjectBackup(
  context: InstanceRuntimeContext,
  project: Pick<Project, 'id' | 'slug' | 'name'> & {
    provisioningMode: string
    topologyKind: string
    runtimeKind: string
    topologyMetadata: unknown
    runtimeMetadata: unknown
    secretMetadata: unknown
  },
): Promise<BackupProjectResult> {
  try {
    const envRows = await listProjectEnvVarRecords(project.id)
    const normalizedRows = envRows.map((row) => ({
      key: row.key,
      value: row.value,
      valueSource: row.valueSource === 'indirect' ? 'indirect' : 'inline',
      secretReference: row.secretReference,
      secretMetadata: row.secretMetadata as Record<string, unknown> | null,
    })) satisfies NormalizedProjectEnvVarWrite[]
    const materialized = await materializeProjectEnvRows(context.workspaceRoot, normalizedRows)
    const profile = resolveStoredProjectInstanceProfile(project)
    const sharedTopology = await loadSharedTopologyConfig(context.workspaceRoot)
    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, profile.topologyMetadata)
    const createdAt = new Date().toISOString()
    const backupId = createdAt.replace(/[:.]/g, '-')
    const backupDirectory = path.join(getProjectBackupRoot(context.workspaceRoot, project.slug), backupId)
    const warnings = [...materialized.unresolvedKeys.map((key) => `Secret reference for ${key} could not be resolved.`)]

    await fs.mkdir(backupDirectory, { recursive: true })

    await writeProjectConfigArtifacts({
      workspaceRoot: context.workspaceRoot,
      projectRoot: workspacePaths.projectRoot,
      project,
      profile,
      envRows: normalizedRows,
      materializedEnv: materialized.env,
      secretReferences: materialized.secretReferences,
      sharedTopology,
    })

    const snapshot = buildProjectConfigSnapshot({
      workspaceRoot: context.workspaceRoot,
      project,
      profile,
      envRows: normalizedRows,
      materializedEnv: materialized.env,
      secretReferences: materialized.secretReferences,
      sharedTopology,
    })

    await fs.writeFile(path.join(backupDirectory, 'project.json'), JSON.stringify(project, null, 2), 'utf8')
    await fs.writeFile(path.join(backupDirectory, 'env.rows.json'), JSON.stringify(normalizedRows, null, 2), 'utf8')
    await fs.writeFile(path.join(backupDirectory, 'env.materialized.json'), JSON.stringify(materialized.env, null, 2), 'utf8')
    await fs.writeFile(path.join(backupDirectory, 'config.layers.json'), JSON.stringify(snapshot, null, 2), 'utf8')

    await copyFileIfPresent(path.join(workspacePaths.projectRoot, '.env'), path.join(backupDirectory, 'workspace', '.env'))
    await copyFileIfPresent(path.join(workspacePaths.dockerDir, '.env'), path.join(backupDirectory, 'workspace', 'docker', '.env'))
    await copyFileIfPresent(
      path.join(workspacePaths.projectSupabaseDir, 'config.toml'),
      path.join(backupDirectory, 'workspace', 'supabase', 'config.toml'),
    )
    await copyFileIfPresent(
      path.join(workspacePaths.projectRoot, '.supaconsole', 'template-plan.json'),
      path.join(backupDirectory, 'workspace', '.supaconsole', 'template-plan.json'),
    )
    await copyFileIfPresent(
      path.join(workspacePaths.projectRoot, '.supaconsole', 'config.layers.json'),
      path.join(backupDirectory, 'workspace', '.supaconsole', 'config.layers.json'),
    )
    await copyFileIfPresent(
      path.join(workspacePaths.projectRoot, '.supaconsole', 'secret-references.json'),
      path.join(backupDirectory, 'workspace', '.supaconsole', 'secret-references.json'),
    )

    let sqlDumpFile: string | undefined
    try {
      sqlDumpFile = (await createSqlDump(profile.mode.key, materialized.env, path.join(backupDirectory, 'database.sql'))) ?? undefined
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Failed to create SQL dump.')
    }

    const manifest: ProjectBackupManifest = {
      backupId,
      createdAt,
      projectId: project.id,
      projectSlug: project.slug,
      mode: profile.mode.key,
      topology: profile.topology.key,
      runtimeKind: profile.runtime.key,
      backupKind: profile.mode.key === 'full_stack_isolated' ? 'workspace_snapshot' : sqlDumpFile ? 'workspace_snapshot' : 'metadata_snapshot',
      warnings,
      sqlDumpFile: sqlDumpFile ? 'database.sql' : undefined,
    }

    await fs.writeFile(path.join(backupDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    return {
      success: true,
      backupId,
      backupDirectory,
      warnings,
      status: {
        backupKind: manifest.backupKind,
        sqlDumpCreated: Boolean(sqlDumpFile),
      },
    }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Failed to create backup',
    }
  }
}

export async function restoreProjectBackup(
  context: InstanceRuntimeContext,
  project: Pick<Project, 'id' | 'slug' | 'name'> & {
    provisioningMode: string
    topologyKind: string
    runtimeKind: string
    topologyMetadata: unknown
    runtimeMetadata: unknown
    secretMetadata: unknown
  },
  backupId?: string,
): Promise<RestoreProjectResult> {
  try {
    const backups = await listProjectBackups(context.workspaceRoot, project.slug)
    const selectedBackup = backupId ? backups.find((backup) => backup.backupId === backupId) : backups[0]

    if (!selectedBackup) {
      return { success: false, code: 'validation_error', error: 'Backup not found for this project.' }
    }

    const envRowsContent = await fs.readFile(path.join(selectedBackup.backupDirectory, 'env.rows.json'), 'utf8')
    const envRows = JSON.parse(envRowsContent) as NormalizedProjectEnvVarWrite[]
    const profile = resolveStoredProjectInstanceProfile(project)
    const workspacePaths = resolveProjectWorkspacePaths(context.workspaceRoot, profile.topologyMetadata)
    const sharedTopology = await loadSharedTopologyConfig(context.workspaceRoot)

    await upsertProjectEnvVarRecords(project.id, envRows)
    await fs.mkdir(workspacePaths.projectRoot, { recursive: true })
    await copyFileIfPresent(path.join(selectedBackup.backupDirectory, 'workspace', '.env'), path.join(workspacePaths.projectRoot, '.env'))
    await copyFileIfPresent(path.join(selectedBackup.backupDirectory, 'workspace', 'docker', '.env'), path.join(workspacePaths.dockerDir, '.env'))
    await copyFileIfPresent(
      path.join(selectedBackup.backupDirectory, 'workspace', 'supabase', 'config.toml'),
      path.join(workspacePaths.projectSupabaseDir, 'config.toml'),
    )
    await copyFileIfPresent(
      path.join(selectedBackup.backupDirectory, 'workspace', '.supaconsole', 'template-plan.json'),
      path.join(workspacePaths.projectRoot, '.supaconsole', 'template-plan.json'),
    )

    const materialized = await materializeProjectEnvRows(context.workspaceRoot, envRows)
    await writeProjectConfigArtifacts({
      workspaceRoot: context.workspaceRoot,
      projectRoot: workspacePaths.projectRoot,
      project,
      profile,
      envRows,
      materializedEnv: materialized.env,
      secretReferences: materialized.secretReferences,
      sharedTopology,
    })

    const warnings = [...selectedBackup.manifest.warnings]
    const sqlDumpPath = selectedBackup.manifest.sqlDumpFile
      ? path.join(selectedBackup.backupDirectory, selectedBackup.manifest.sqlDumpFile)
      : undefined
    if (sqlDumpPath) {
      try {
        const restored = await restoreSqlDump(materialized.env, sqlDumpPath)
        if (!restored) {
          warnings.push('SQL dump was present but psql or a database URL was unavailable during restore.')
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : 'Failed to restore SQL dump.')
      }
    }

    return {
      success: true,
      restoredFrom: selectedBackup.backupId,
      warnings,
      status: {
        sqlDumpRestored: Boolean(sqlDumpPath),
      },
    }
  } catch (error) {
    return {
      success: false,
      code: 'runtime_error',
      error: error instanceof Error ? error.message : 'Failed to restore backup',
    }
  }
}