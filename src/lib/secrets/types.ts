export const SECRET_VALUE_SOURCES = ['inline', 'indirect'] as const

export type SecretValueSource = (typeof SECRET_VALUE_SOURCES)[number]

export interface SecretReferenceMetadata {
  provider?: 'project_env' | 'local_file' | 'process_env' | 'vault' | 'external'
  alias?: string
  [key: string]: unknown
}

export interface ProjectEnvVarValueInput {
  value?: string
  valueSource?: SecretValueSource
  secretReference?: string | null
  secretMetadata?: SecretReferenceMetadata | null
}

export type ProjectEnvVarMutationInput = string | ProjectEnvVarValueInput

export type ProjectEnvVarMutationMap = Record<string, ProjectEnvVarMutationInput>

export interface StoredProjectEnvVarLike {
  key: string
  value: string
  valueSource?: string | null
  secretReference?: string | null
  secretMetadata?: unknown | null
}

export interface NormalizedProjectEnvVarWrite {
  key: string
  value: string
  valueSource: SecretValueSource
  secretReference: string | null
  secretMetadata: SecretReferenceMetadata | null
}