import { promises as fs } from 'fs'
import { getSystemConfigDefaults } from '@/lib/config/defaults'
import { isInstanceMode } from './domain'
import { DEFAULT_INSTANCE_MODE, type InstanceMode } from './types'

type JsonRecord = Record<string, unknown>

export interface SharedServiceTopologyConfig {
  apiUrl?: string
  studioUrl?: string
  databaseUrl?: string
  authUrl?: string
  storageUrl?: string
  realtimeUrl?: string
  mailUrl?: string
}

export interface SharedPostgresTopologyConfig {
  adminUrl?: string
  host?: string
  port?: number
  adminDatabase: string
  schemaDatabase: string
  ready: boolean
}

export interface SharedTopologyConfig {
  name: string
  defaultMode: InstanceMode
  settingsFilePath: string
  settingsSource: readonly string[]
  sharedPostgres: SharedPostgresTopologyConfig
  sharedServices: SharedServiceTopologyConfig
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as JsonRecord
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function readMode(value: unknown): InstanceMode | undefined {
  return typeof value === 'string' && isInstanceMode(value) ? value : undefined
}

async function loadSettingsFile(settingsFilePath: string): Promise<JsonRecord> {
  try {
    const content = await fs.readFile(settingsFilePath, 'utf8')
    const parsed = JSON.parse(content) as unknown
    return asRecord(parsed)
  } catch {
    return {}
  }
}

function readSettingsFilePath(workspaceRoot: string): string {
  return getSystemConfigDefaults(workspaceRoot).topologySettingsFilePath
}

export async function loadSharedTopologyConfig(workspaceRoot: string): Promise<SharedTopologyConfig> {
  const settingsFilePath = readSettingsFilePath(workspaceRoot)
  const fileSettings = await loadSettingsFile(settingsFilePath)
  const sharedPostgresSettings = asRecord(fileSettings.sharedPostgres)
  const sharedServicesSettings = asRecord(fileSettings.sharedServices)
  const settingsSource: string[] = []

  const adminUrl =
    readString(process.env.SUPACONSOLE_SHARED_PG_ADMIN_URL) ?? readString(sharedPostgresSettings.adminUrl)
  const parsedAdminUrl = adminUrl ? new URL(adminUrl) : undefined

  if (adminUrl) settingsSource.push('env:SUPACONSOLE_SHARED_PG_ADMIN_URL')
  if (!adminUrl && Object.keys(sharedPostgresSettings).length > 0) settingsSource.push(`file:${settingsFilePath}`)

  const defaultMode =
    readMode(process.env.SUPACONSOLE_DEFAULT_INSTANCE_MODE) ??
    readMode(fileSettings.defaultMode) ??
    DEFAULT_INSTANCE_MODE

  if (readMode(process.env.SUPACONSOLE_DEFAULT_INSTANCE_MODE)) {
    settingsSource.push('env:SUPACONSOLE_DEFAULT_INSTANCE_MODE')
  } else if (readMode(fileSettings.defaultMode)) {
    settingsSource.push(`file:${settingsFilePath}`)
  }

  const schemaDatabase =
    readString(process.env.SUPACONSOLE_SHARED_PG_SCHEMA_DATABASE) ??
    readString(sharedPostgresSettings.schemaDatabase) ??
    (parsedAdminUrl?.pathname.replace(/^\//, '') ||
    'postgres'
    )

  const adminDatabase =
    readString(process.env.SUPACONSOLE_SHARED_PG_ADMIN_DATABASE) ??
    readString(sharedPostgresSettings.adminDatabase) ??
    (parsedAdminUrl?.pathname.replace(/^\//, '') ||
    'postgres'
    )

  const host = readString(sharedPostgresSettings.host) ?? parsedAdminUrl?.hostname
  const port = readNumber(sharedPostgresSettings.port) ?? (parsedAdminUrl?.port ? Number(parsedAdminUrl.port) : 5432)

  const sharedServices: SharedServiceTopologyConfig = {
    apiUrl: readString(process.env.SUPACONSOLE_SHARED_SERVICE_API_URL) ?? readString(sharedServicesSettings.apiUrl),
    studioUrl:
      readString(process.env.SUPACONSOLE_SHARED_SERVICE_STUDIO_URL) ?? readString(sharedServicesSettings.studioUrl),
    databaseUrl:
      readString(process.env.SUPACONSOLE_SHARED_SERVICE_DATABASE_URL) ?? readString(sharedServicesSettings.databaseUrl),
    authUrl: readString(process.env.SUPACONSOLE_SHARED_SERVICE_AUTH_URL) ?? readString(sharedServicesSettings.authUrl),
    storageUrl:
      readString(process.env.SUPACONSOLE_SHARED_SERVICE_STORAGE_URL) ?? readString(sharedServicesSettings.storageUrl),
    realtimeUrl:
      readString(process.env.SUPACONSOLE_SHARED_SERVICE_REALTIME_URL) ?? readString(sharedServicesSettings.realtimeUrl),
    mailUrl: readString(process.env.SUPACONSOLE_SHARED_SERVICE_MAIL_URL) ?? readString(sharedServicesSettings.mailUrl),
  }

  return {
    name: readString(process.env.SUPACONSOLE_SHARED_TOPOLOGY_NAME) ?? readString(fileSettings.name) ?? 'local-shared',
    defaultMode,
    settingsFilePath,
    settingsSource,
    sharedPostgres: {
      adminUrl,
      host,
      port,
      adminDatabase,
      schemaDatabase,
      ready: Boolean(adminUrl && host && port && schemaDatabase && adminDatabase),
    },
    sharedServices,
  }
}

export function sharedTopologySupportsMode(config: SharedTopologyConfig, mode: InstanceMode): boolean {
  if (mode === 'full_stack_isolated') {
    return true
  }

  return config.sharedPostgres.ready
}