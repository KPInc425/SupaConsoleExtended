import type { PortAllocationMetadata } from './types'

export const PROJECT_PORT_KEYS = [
  'POSTGRES_PORT',
  'STUDIO_PORT',
  'INBUCKET_WEB_PORT',
  'INBUCKET_SMTP_PORT',
  'INBUCKET_POP3_PORT',
  'ANALYTICS_PORT',
  'KONG_HTTP_PORT',
] as const

export const REQUIRED_INSTANCE_PORT_OFFSETS = [0, 100, 1000, 1100, 1101, 1102, 2000] as const

export type ProjectEnvRecord = Record<string, string>
export type ProjectPortKey = (typeof PROJECT_PORT_KEYS)[number]

export function buildDefaultProjectEnv(
  slug: string,
  basePort: number,
  generateSecret: (length: number) => string,
): ProjectEnvRecord {
  return {
    POSTGRES_PASSWORD: generateSecret(32),
    JWT_SECRET: generateSecret(40),
    ANON_KEY: generateSecret(64),
    SERVICE_ROLE_KEY: generateSecret(64),
    DASHBOARD_USERNAME: 'supabase',
    DASHBOARD_PASSWORD: generateSecret(16),
    SECRET_KEY_BASE: generateSecret(64),
    VAULT_ENC_KEY: generateSecret(32),
    POSTGRES_PORT: String(basePort + 2000),
    KONG_HTTP_PORT: String(basePort),
    ANALYTICS_PORT: String(basePort + 1000),
    INBUCKET_WEB_PORT: String(basePort + 1100),
    INBUCKET_SMTP_PORT: String(basePort + 1101),
    INBUCKET_POP3_PORT: String(basePort + 1102),
    POSTGRES_HOST: 'db',
    POSTGRES_DB: 'postgres',
    SITE_URL: 'http://localhost:5173',
    API_EXTERNAL_URL: 'http://localhost:5173',
    MAILER_URLPATHS_INVITE: '/auth/v1/verify',
    SMTP_HOST: 'inbucket',
    SMTP_PORT: String(basePort + 1101),
    SMTP_ADMIN_EMAIL: 'admin@example.com',
    STUDIO_PORT: String(basePort + 100),
    SUPABASE_PUBLIC_URL: 'http://localhost:5173',
    ENABLE_EMAIL_SIGNUP: 'true',
    ENABLE_PHONE_SIGNUP: 'true',
    FUNCTIONS_VERIFY_JWT: 'false',
    PROJECT_ID: slug,
  }
}

export function collectConfiguredPorts(env: ProjectEnvRecord): number[] {
  return PROJECT_PORT_KEYS.flatMap((key) => {
    const value = env[key]
    if (!value) {
      return []
    }

    const parsed = Number(value)
    return Number.isFinite(parsed) ? [parsed] : []
  })
}

export function collectConfiguredPortMap(env: ProjectEnvRecord): Partial<Record<ProjectPortKey, number>> {
  return PROJECT_PORT_KEYS.reduce<Partial<Record<ProjectPortKey, number>>>((accumulator, key) => {
    const value = env[key]
    const parsed = value ? Number(value) : Number.NaN

    if (Number.isFinite(parsed)) {
      accumulator[key] = parsed
    }

    return accumulator
  }, {})
}

export function buildPortAllocation(
  env: ProjectEnvRecord,
  source: PortAllocationMetadata['source'],
  assignedAt = new Date().toISOString(),
): PortAllocationMetadata {
  const ports = collectConfiguredPortMap(env)

  return {
    basePort: ports.KONG_HTTP_PORT ?? null,
    assignedAt,
    source,
    ports,
  }
}

export function rebaseProjectPorts(env: ProjectEnvRecord, basePort: number): ProjectEnvRecord {
  return {
    ...env,
    POSTGRES_PORT: String(basePort + 2000),
    KONG_HTTP_PORT: String(basePort),
    ANALYTICS_PORT: String(basePort + 1000),
    INBUCKET_WEB_PORT: String(basePort + 1100),
    INBUCKET_SMTP_PORT: String(basePort + 1101),
    INBUCKET_POP3_PORT: String(basePort + 1102),
    SMTP_PORT: String(basePort + 1101),
    STUDIO_PORT: String(basePort + 100),
  }
}