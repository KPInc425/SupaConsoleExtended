import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

export async function isSupabaseCliAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
  // First try a direct exec
  try {
    const { stdout } = await execAsync('supabase --version')
    const ver = String(stdout || '').trim()
    if (ver) return { available: true, version: ver }
  } catch {
    // Continue to fallback strategies
  }

  // Fallback: try to locate the binary path and run it explicitly
  try {
    if (process.platform === 'win32') {
      // 'where' returns paths on Windows
      const { stdout } = await execAsync('where supabase')
      const pathFound = String(stdout || '').split(/\r?\n/).map(s => s.trim()).find(Boolean)
      if (pathFound) {
        try {
          const { stdout: verOut } = await execAsync(`"${pathFound}" --version`)
          const ver = String(verOut || '').trim()
          return { available: true, version: ver }
        } catch {
          return { available: true }
        }
      }
    } else {
      // POSIX: which
      const { stdout } = await execAsync('which supabase')
      const pathFound = String(stdout || '').trim()
      if (pathFound) {
        try {
          const { stdout: verOut } = await execAsync(`"${pathFound}" --version`)
          const ver = String(verOut || '').trim()
          return { available: true, version: ver }
        } catch {
          return { available: true }
        }
      }
    }
  } catch {
    // ignore
  }

  return { available: false, error: 'supabase CLI not found in PATH or common locations' }
}
