import { promises as fs } from 'fs'
import path from 'path'
import { renderEnvArtifacts } from '../env'
import { renderSupabaseConfigArtifact } from '../supabaseConfig'
import type { ProjectTemplateBoundary, ProjectTemplateRenderInput, ProjectTemplateRenderPlan } from '../types'

export function describeFullStackTemplateBoundary(input: ProjectTemplateRenderInput['profile']): ProjectTemplateBoundary {
  if (input.mode.key !== 'full_stack_isolated') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Full-stack templates are reserved for isolated Supabase CLI workspaces.',
      reason: `Provisioning mode "${input.mode.key}" does not use the full-stack template set.`,
    }
  }

  if (input.topology.key !== 'isolated_stack') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Full-stack templates require the isolated_stack topology contract.',
      reason: `Topology "${input.topology.key}" is not implemented for the full-stack template set.`,
    }
  }

  if (input.runtime.key !== 'supabase_cli_local') {
    return {
      modeKey: input.mode.key,
      topologyKey: input.topology.key,
      runtimeKey: input.runtime.key,
      deployable: false,
      summary: 'Full-stack templates are currently bound to the local Supabase CLI runtime.',
      reason: `Runtime kind "${input.runtime.key}" is not implemented for the full-stack template set.`,
    }
  }

  return {
    modeKey: input.mode.key,
    topologyKey: input.topology.key,
    runtimeKey: input.runtime.key,
    deployable: true,
    summary: 'Full-stack isolated projects render env/config artifacts locally and delegate compose generation to the Supabase CLI.',
  }
}

async function loadConfigTemplateText(input: ProjectTemplateRenderInput): Promise<string | undefined> {
  if (input.configTemplateText !== undefined) {
    return input.configTemplateText
  }

  try {
    return await fs.readFile(path.join(input.workspaceRoot, 'config.toml'), 'utf8')
  } catch {
    return undefined
  }
}

export async function renderFullStackTemplatePlan(
  input: ProjectTemplateRenderInput,
): Promise<ProjectTemplateRenderPlan> {
  const boundary = describeFullStackTemplateBoundary(input.profile)
  if (!boundary.deployable) {
    return { ...boundary, artifacts: [] }
  }

  const configTemplateText = await loadConfigTemplateText(input)

  return {
    ...boundary,
    artifacts: [
      ...renderEnvArtifacts(input.env),
      renderSupabaseConfigArtifact(configTemplateText, input.env),
      {
        id: 'supabase-cli-compose',
        kind: 'compose',
        relativePath: 'docker/docker-compose.yml',
        description:
          'Compose output is delegated to `supabase start`; the Supabase CLI materializes this file inside the project workspace during deployment.',
        ownership: 'supabase_cli',
        materialization: 'delegated',
        inspectable: true,
      },
    ],
  }
}