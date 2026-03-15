import { exec } from 'child_process'
import * as net from 'net'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  try {
    const { stdout } = await execAsync('docker ps --format "{{.Ports}}"', { timeout: 3000 })
    if (stdout && stdout.includes(`:${port}`)) {
      return false
    }
  } catch {
    // Fall back to direct socket checks when Docker is unavailable.
  }

  const hostsToTry = [host, '0.0.0.0', '::1']
  for (const candidateHost of hostsToTry) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer()
      let completed = false
      const cleanup = () => {
        try {
          server.close()
        } catch {
          // Ignore close failures for probe sockets.
        }
      }

      server.once('error', () => {
        if (!completed) {
          completed = true
          cleanup()
          resolve(false)
        }
      })

      server.once('listening', () => {
        if (!completed) {
          completed = true
          cleanup()
          resolve(true)
        }
      })

      try {
        server.listen(port, candidateHost)
      } catch {
        if (!completed) {
          completed = true
          cleanup()
          resolve(false)
        }
      }

      setTimeout(() => {
        if (!completed) {
          completed = true
          cleanup()
          resolve(false)
        }
      }, 1000)
    })

    if (!available) {
      return false
    }
  }

  return true
}

export async function findAvailableBasePort(
  start: number,
  offsets: number[],
  attempts = 100,
): Promise<number | null> {
  for (let index = 0; index < attempts; index++) {
    const candidate = start + index * 10
    const checks = await Promise.all(offsets.map((offset) => isPortAvailable(candidate + offset)))
    if (checks.every(Boolean)) {
      return candidate
    }
  }

  return null
}