import type { ProjectEnvRecord } from '../instances/env'
import type { ProjectInstanceProfile } from '../instances/types'

export type TemplateArtifactKind = 'env' | 'config' | 'compose' | 'metadata' | 'sql'
export type TemplateArtifactOwner = 'supaconsole' | 'supabase_cli' | 'phase3_pending'
export type TemplateArtifactMaterialization = 'rendered' | 'delegated' | 'placeholder'

export interface TemplateArtifactDefinition {
  id: string
  kind: TemplateArtifactKind
  relativePath: string
  description: string
  ownership: TemplateArtifactOwner
  materialization: TemplateArtifactMaterialization
  inspectable: boolean
  content?: string
}

export interface ProjectTemplateBoundary {
  modeKey: ProjectInstanceProfile['mode']['key']
  topologyKey: ProjectInstanceProfile['topology']['key']
  runtimeKey: ProjectInstanceProfile['runtime']['key']
  deployable: boolean
  summary: string
  reason?: string
}

export interface ProjectTemplateRenderPlan extends ProjectTemplateBoundary {
  artifacts: TemplateArtifactDefinition[]
}

export interface ProjectTemplateRenderInput {
  workspaceRoot: string
  profile: ProjectInstanceProfile
  env: ProjectEnvRecord
  configTemplateText?: string
}