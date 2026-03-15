import { promises as fs } from 'fs'
import path from 'path'
import { getSystemConfigDefaults } from '@/lib/config/defaults'

interface LifecycleOperationResultLike {
  success: boolean
  code?: string
  error?: string
}

export interface LifecycleLogContext {
  workspaceRoot: string
  operation: 'create' | 'update_env' | 'deploy' | 'inspect' | 'stop' | 'delete' | 'backup' | 'restore'
  projectId?: string
  projectSlug?: string
  mode?: string
  topology?: string
  runtimeKind?: string
  metadata?: Record<string, unknown>
}

interface LifecycleLogEntry extends LifecycleLogContext {
  timestamp: string
  phase: 'start' | 'finish'
  durationMs?: number
  success?: boolean
  code?: string
  error?: string
}

async function appendLifecycleEntry(entry: LifecycleLogEntry): Promise<void> {
  const logPath = getSystemConfigDefaults(entry.workspaceRoot).lifecycleLogPath
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
}

export async function runLifecycleOperation<T extends LifecycleOperationResultLike>(
  context: LifecycleLogContext,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()

  try {
    await appendLifecycleEntry({
      ...context,
      timestamp: new Date(startedAt).toISOString(),
      phase: 'start',
    })
  } catch {
  }

  try {
    const result = await operation()

    try {
      await appendLifecycleEntry({
        ...context,
        timestamp: new Date().toISOString(),
        phase: 'finish',
        durationMs: Date.now() - startedAt,
        success: result.success,
        code: result.code,
        error: result.error,
      })
    } catch {
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    try {
      await appendLifecycleEntry({
        ...context,
        timestamp: new Date().toISOString(),
        phase: 'finish',
        durationMs: Date.now() - startedAt,
        success: false,
        code: 'runtime_error',
        error: message,
      })
    } catch {
    }

    throw error
  }
}