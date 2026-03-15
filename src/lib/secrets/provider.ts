import { promises as fs } from 'fs'
import path from 'path'
import { getSystemConfigDefaults } from '@/lib/config/defaults'
import type { NormalizedProjectEnvVarWrite } from './types'

type SecretProviderKind = 'local_file' | 'process_env'

export interface SecretProviderResolution {
  provider: SecretProviderKind
  reference: string
  source: string
  value: string
}

export interface ProjectSecretReferenceSummary {
  key: string
  reference: string
  provider: SecretProviderKind | 'unknown'
  source: string
  resolved: boolean
  usesFallback: boolean
}

interface ParsedSecretReference {
  provider: SecretProviderKind | 'unknown'
  key: string
}

const SENSITIVE_PROJECT_ENV_KEY_PATTERN = /(^|_)(PASSWORD|SECRET|TOKEN|KEY)($|_)|DATABASE_URL|DB_URL|SMTP_PASS|VAULT_ENC_KEY/i

function parseSecretReference(reference: string): ParsedSecretReference {
  if (reference.startsWith('env:')) {
    return { provider: 'process_env', key: reference.slice(4) }
  }

  if (reference.startsWith('file:')) {
    return { provider: 'local_file', key: reference.slice(5) }
  }

  return { provider: 'unknown', key: reference }
}

async function readLocalSecretStore(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(content) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>
  } catch {
    return {}
  }
}

async function writeLocalSecretStore(filePath: string, store: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf8')
}

export function isSensitiveProjectEnvKey(key: string): boolean {
  return SENSITIVE_PROJECT_ENV_KEY_PATTERN.test(key)
}

export async function resolveSecretReference(
  workspaceRoot: string,
  reference: string,
): Promise<SecretProviderResolution | null> {
  const parsed = parseSecretReference(reference)

  if (parsed.provider === 'process_env') {
    const value = process.env[parsed.key]
    return value
      ? {
          provider: 'process_env',
          reference,
          source: `env:${parsed.key}`,
          value,
        }
      : null
  }

  if (parsed.provider === 'local_file') {
    const filePath = getSystemConfigDefaults(workspaceRoot).localSecretFilePath
    const store = await readLocalSecretStore(filePath)
    const value = store[parsed.key]
    return value
      ? {
          provider: 'local_file',
          reference,
          source: `file:${filePath}`,
          value,
        }
      : null
  }

  return null
}

export async function storeSecretValues(
  workspaceRoot: string,
  secrets: Record<string, string>,
): Promise<Record<string, string>> {
  const filePath = getSystemConfigDefaults(workspaceRoot).localSecretFilePath
  const store = await readLocalSecretStore(filePath)

  for (const [key, value] of Object.entries(secrets)) {
    store[key] = value
  }

  await writeLocalSecretStore(filePath, store)
  return Object.fromEntries(Object.keys(secrets).map((key) => [key, `file:${key}`]))
}

export async function deleteStoredSecretReferences(workspaceRoot: string, references: string[]): Promise<void> {
  const filePath = getSystemConfigDefaults(workspaceRoot).localSecretFilePath
  const store = await readLocalSecretStore(filePath)
  let changed = false

  for (const reference of references) {
    const parsed = parseSecretReference(reference)
    if (parsed.provider !== 'local_file') {
      continue
    }

    if (parsed.key in store) {
      delete store[parsed.key]
      changed = true
    }
  }

  if (changed) {
    await writeLocalSecretStore(filePath, store)
  }
}

export async function materializeProjectEnvRows(
  workspaceRoot: string,
  rows: NormalizedProjectEnvVarWrite[],
): Promise<{
  env: Record<string, string>
  secretReferences: ProjectSecretReferenceSummary[]
  unresolvedKeys: string[]
}> {
  const env: Record<string, string> = {}
  const secretReferences: ProjectSecretReferenceSummary[] = []
  const unresolvedKeys: string[] = []

  for (const row of rows) {
    if (row.valueSource !== 'indirect' || !row.secretReference) {
      env[row.key] = row.value
      continue
    }

    const resolved = await resolveSecretReference(workspaceRoot, row.secretReference)
    const fallbackValue = row.value
    const materializedValue = resolved?.value ?? fallbackValue

    env[row.key] = materializedValue
    secretReferences.push({
      key: row.key,
      reference: row.secretReference,
      provider: resolved?.provider ?? parseSecretReference(row.secretReference).provider,
      source: resolved?.source ?? 'unresolved',
      resolved: Boolean(resolved),
      usesFallback: !resolved && Boolean(fallbackValue),
    })

    if (!resolved && !fallbackValue) {
      unresolvedKeys.push(row.key)
    }
  }

  return { env, secretReferences, unresolvedKeys }
}

export async function externalizeProjectSecrets(
  workspaceRoot: string,
  projectSlug: string,
  env: Record<string, string>,
): Promise<{
  writes: NormalizedProjectEnvVarWrite[]
  secretReferences: Record<string, string>
}> {
  const secretsToStore = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => isSensitiveProjectEnvKey(key))
      .map(([key, value]) => [`projects/${projectSlug}/${key}`, value]),
  )
  const storedReferences = await storeSecretValues(workspaceRoot, secretsToStore)

  return {
    writes: Object.entries(env).map(([key, value]) => {
      const secretStoreKey = `projects/${projectSlug}/${key}`
      const secretReference = storedReferences[secretStoreKey]

      if (!secretReference) {
        return {
          key,
          value,
          valueSource: 'inline',
          secretReference: null,
          secretMetadata: null,
        } satisfies NormalizedProjectEnvVarWrite
      }

      return {
        key,
        value: '',
        valueSource: 'indirect',
        secretReference,
        secretMetadata: {
          provider: 'local_file',
          alias: secretStoreKey,
        },
      } satisfies NormalizedProjectEnvVarWrite
    }),
    secretReferences: Object.fromEntries(
      Object.entries(storedReferences).map(([storeKey, reference]) => [storeKey.split('/').slice(-1)[0], reference]),
    ),
  }
}