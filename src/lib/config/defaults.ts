import path from 'path'
import { DEFAULT_INSTANCE_MODE, type InstanceMode } from '@/lib/instances/types'

export interface SystemConfigDefaults {
  workspaceRoot: string
  topologySettingsFilePath: string
  localSecretFilePath: string
  backupRootPath: string
  lifecycleLogPath: string
  defaultInstanceMode: InstanceMode
}

function resolveConfiguredPath(workspaceRoot: string, configured: string | undefined, fallbackRelative: string): string {
  if (!configured) {
    return path.join(workspaceRoot, fallbackRelative)
  }

  return path.isAbsolute(configured) ? configured : path.join(workspaceRoot, configured)
}

export function getSystemConfigDefaults(workspaceRoot: string): SystemConfigDefaults {
  return {
    workspaceRoot,
    topologySettingsFilePath: resolveConfiguredPath(
      workspaceRoot,
      process.env.SUPACONSOLE_TOPOLOGY_SETTINGS_FILE,
      path.join('.supaconsole', 'shared-topology.json'),
    ),
    localSecretFilePath: resolveConfiguredPath(
      workspaceRoot,
      process.env.SUPACONSOLE_SECRET_FILE,
      path.join('.supaconsole', 'secrets.json'),
    ),
    backupRootPath: resolveConfiguredPath(
      workspaceRoot,
      process.env.SUPACONSOLE_BACKUP_DIR,
      path.join('.supaconsole', 'backups'),
    ),
    lifecycleLogPath: resolveConfiguredPath(
      workspaceRoot,
      process.env.SUPACONSOLE_LIFECYCLE_LOG_FILE,
      path.join('.supaconsole', 'logs', 'lifecycle.jsonl'),
    ),
    defaultInstanceMode: DEFAULT_INSTANCE_MODE,
  }
}