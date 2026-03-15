import { promises as fs } from 'fs'
import path from 'path'
import type { ProjectTemplateRenderPlan } from '../templates/types'
import type { ProjectFilesystemLayout } from './metadata'

export interface ProjectWorkspacePaths {
  projectRoot: string
  dockerDir: string
  projectSupabaseDir: string
}

export function resolveProjectWorkspacePaths(
  workspaceRoot: string,
  layout: Pick<ProjectFilesystemLayout, 'projectRootRelative' | 'dockerDirRelative'>,
): ProjectWorkspacePaths {
  const projectRoot = path.join(workspaceRoot, layout.projectRootRelative)

  return {
    projectRoot,
    dockerDir: path.join(workspaceRoot, layout.dockerDirRelative),
    projectSupabaseDir: path.join(projectRoot, 'supabase'),
  }
}

export async function writeProjectTemplateArtifacts(
  paths: ProjectWorkspacePaths,
  plan: ProjectTemplateRenderPlan,
): Promise<void> {
  await fs.mkdir(paths.projectRoot, { recursive: true })

  for (const artifact of plan.artifacts) {
    if (artifact.materialization !== 'rendered' || artifact.content === undefined) {
      continue
    }

    const filePath = path.join(paths.projectRoot, artifact.relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, artifact.content, 'utf8')
  }

  const manifestDir = path.join(paths.projectRoot, '.supaconsole')
  const manifestPath = path.join(manifestDir, 'template-plan.json')
  await fs.mkdir(manifestDir, { recursive: true })
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        modeKey: plan.modeKey,
        topologyKey: plan.topologyKey,
        runtimeKey: plan.runtimeKey,
        deployable: plan.deployable,
        summary: plan.summary,
        reason: plan.reason,
        artifacts: plan.artifacts.map(({ content, ...artifact }) => ({
          ...artifact,
          contentBytes: content ? Buffer.byteLength(content, 'utf8') : 0,
        })),
      },
      null,
      2,
    ),
    'utf8',
  )
}