import {
  SECRET_VALUE_SOURCES,
  type NormalizedProjectEnvVarWrite,
  type ProjectEnvVarMutationInput,
  type ProjectEnvVarMutationMap,
  type SecretReferenceMetadata,
  type SecretValueSource,
  type StoredProjectEnvVarLike,
} from './types'

function isSecretValueSource(value: string | null | undefined): value is SecretValueSource {
  return !!value && SECRET_VALUE_SOURCES.includes(value as SecretValueSource)
}

function asSecretMetadata(value: unknown): SecretReferenceMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as SecretReferenceMetadata
}

function normalizeProjectEnvVarInput(
  key: string,
  input: ProjectEnvVarMutationInput,
  existing?: StoredProjectEnvVarLike,
): NormalizedProjectEnvVarWrite {
  if (typeof input === 'string') {
    return {
      key,
      value: input,
      valueSource: 'inline',
      secretReference: null,
      secretMetadata: null,
    }
  }

  const valueSource = isSecretValueSource(input.valueSource)
    ? input.valueSource
    : isSecretValueSource(existing?.valueSource)
      ? existing.valueSource
      : 'inline'

  const currentValueIsIndirect = isSecretValueSource(existing?.valueSource) && existing?.valueSource === 'indirect'
  const nextReference = valueSource === 'indirect'
    ? input.secretReference ?? existing?.secretReference ?? null
    : null
  const effectiveValue = valueSource === 'indirect'
    ? input.value ?? (currentValueIsIndirect && nextReference === existing?.secretReference ? existing?.value ?? '' : '')
    : input.value ?? existing?.value ?? ''

  return {
    key,
    value: effectiveValue,
    valueSource,
    secretReference: nextReference,
    secretMetadata:
      valueSource === 'indirect'
        ? input.secretMetadata ?? asSecretMetadata(existing?.secretMetadata)
        : null,
  }
}

export function mergeProjectEnvVarWrites(
  existingRows: StoredProjectEnvVarLike[],
  updates: ProjectEnvVarMutationMap,
): NormalizedProjectEnvVarWrite[] {
  const merged = new Map<string, NormalizedProjectEnvVarWrite>()

  for (const row of existingRows) {
    merged.set(row.key, {
      key: row.key,
      value: row.value,
      valueSource: isSecretValueSource(row.valueSource) ? row.valueSource : 'inline',
      secretReference: row.secretReference ?? null,
      secretMetadata: asSecretMetadata(row.secretMetadata),
    })
  }

  for (const [key, value] of Object.entries(updates)) {
    merged.set(key, normalizeProjectEnvVarInput(key, value, merged.get(key)))
  }

  return Array.from(merged.values())
}

export function materializeEnvObject(rows: Array<Pick<NormalizedProjectEnvVarWrite, 'key' | 'value'>>): Record<string, string> {
  return rows.reduce<Record<string, string>>((accumulator, row) => {
    accumulator[row.key] = row.value
    return accumulator
  }, {})
}