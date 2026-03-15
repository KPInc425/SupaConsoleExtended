import TOML from '@iarna/toml'
import type { TemplateArtifactDefinition } from './types'

const PORT_MAPPING: Record<string, string[][]> = {
  POSTGRES_PORT: [['db', 'port'], ['postgres', 'port'], ['database', 'port'], ['postgrest', 'port']],
  KONG_HTTP_PORT: [['api', 'port'], ['kong', 'port'], ['gateway', 'port']],
  STUDIO_PORT: [['studio', 'port']],
  INBUCKET_WEB_PORT: [['inbucket', 'port']],
  INBUCKET_SMTP_PORT: [['inbucket', 'smtp_port']],
  INBUCKET_POP3_PORT: [['inbucket', 'pop3_port']],
  ANALYTICS_PORT: [['analytics', 'port']],
}

function buildMinimalSupabaseConfigModel(env: Record<string, string>): Record<string, unknown> {
  return {
    db: { port: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : 5432 },
    kong: { port: env.KONG_HTTP_PORT ? Number(env.KONG_HTTP_PORT) : 54321 },
    studio: { port: env.STUDIO_PORT ? Number(env.STUDIO_PORT) : 54323 },
    inbucket: {
      port: env.INBUCKET_WEB_PORT ? Number(env.INBUCKET_WEB_PORT) : 54324,
      smtp_port: env.INBUCKET_SMTP_PORT ? Number(env.INBUCKET_SMTP_PORT) : 1025,
      pop3_port: env.INBUCKET_POP3_PORT ? Number(env.INBUCKET_POP3_PORT) : 54326,
    },
    analytics: { port: env.ANALYTICS_PORT ? Number(env.ANALYTICS_PORT) : 54325 },
  }
}

function applyNumericEnvPlaceholders(templateText: string, env: Record<string, string>): string {
  let processed = templateText

  for (const envKey of Object.keys(PORT_MAPPING)) {
    const value = env[envKey]
    if (!value) {
      continue
    }

    const parsed = Number(value)
    if (Number.isNaN(parsed)) {
      continue
    }

    const paths = PORT_MAPPING[envKey as keyof typeof PORT_MAPPING]
    for (const pathParts of paths) {
      const keyName = pathParts[pathParts.length - 1]
      const expression = new RegExp(`(^\\s*${keyName}\\s*=\\s*)(?:\\"?env\\(${envKey}\\)\\"?|env\\(${envKey}\\))`, 'gmi')
      processed = processed.replace(expression, (_, prefix: string) => `${prefix}${parsed}`)
    }
  }

  return processed
}

function setMappedPortValue(parsed: Record<string, unknown>, keyPaths: string[][], value: string): void {
  for (const pathParts of keyPaths) {
    let node: unknown = parsed
    for (let index = 0; index < pathParts.length - 1; index++) {
      const part = pathParts[index]
      if ((node as Record<string, unknown>)?.[part] === undefined) {
        node = undefined
        break
      }

      node = (node as Record<string, unknown>)[part]
    }

    if (!node || typeof node !== 'object') {
      continue
    }

    const last = pathParts[pathParts.length - 1]
    const target = node as Record<string, unknown>
    const existing = target[last]
    if (typeof existing === 'string' && /^env\(.+\)$/.test(existing)) {
      const asNumber = Number(value)
      if (!Number.isNaN(asNumber)) {
        target[last] = asNumber
      }
      continue
    }

    target[last] = Number(value)
  }
}

function applyHeuristicPortOverrides(node: unknown, env: Record<string, string>): void {
  if (!node || typeof node !== 'object') {
    return
  }

  for (const key of Object.keys(node as Record<string, unknown>)) {
    const value = (node as Record<string, unknown>)[key]
    if (key === 'port' || key.endsWith('_port')) {
      const candidate = key.toUpperCase()
      if (env[candidate]) {
        ;(node as Record<string, unknown>)[key] = Number(env[candidate])
      }
    }

    if (typeof value === 'object') {
      applyHeuristicPortOverrides(value, env)
    }
  }
}

export function renderSupabaseConfig(templateText: string | undefined, env: Record<string, string>): string {
  const baseText = templateText && templateText.trim() ? templateText : TOML.stringify(buildMinimalSupabaseConfigModel(env))
  const processed = applyNumericEnvPlaceholders(baseText, env)

  try {
    const parsed = TOML.parse(processed) as Record<string, unknown>

    for (const envKey of Object.keys(PORT_MAPPING)) {
      if (env[envKey]) {
        setMappedPortValue(parsed, PORT_MAPPING[envKey as keyof typeof PORT_MAPPING], env[envKey])
      }
    }

    applyHeuristicPortOverrides(parsed, env)
    return TOML.stringify(parsed)
  } catch {
    return processed
  }
}

export function renderSupabaseConfigArtifact(
  templateText: string | undefined,
  env: Record<string, string>,
): TemplateArtifactDefinition {
  return {
    id: 'supabase-config',
    kind: 'config',
    relativePath: 'supabase/config.toml',
    description: 'Rendered Supabase CLI config derived from the repository template and current project environment.',
    ownership: 'supaconsole',
    materialization: 'rendered',
    inspectable: true,
    content: renderSupabaseConfig(templateText, env),
  }
}