import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import * as path from 'path'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isPortAvailable, findAvailableBasePort, updateSupabaseConfig } from '@/lib/project'
import * as fs from 'fs/promises'
// no exec required here; using spawn for streaming

export async function POST(request: NextRequest) {
  try {
    // Validate session
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const { projectId } = await request.json()
    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    }

    // Find the project
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const projectDir = path.join(process.cwd(), 'supabase-projects', project.slug)

    // Create a response with streaming headers for Server-Sent Events
    const encoder = new TextEncoder()
    let isClosed = false

    const stream = new ReadableStream({
      async start(controller) {
        // Before starting, re-check ports and update .env if necessary (avoid race conditions)
        const envPath = path.join(projectDir, '.env')
        let envText = ''
        try { envText = await fs.readFile(envPath, 'utf8') } catch {}

        const parseEnv = (text: string) => {
          const out: Record<string,string> = {}
          text.split(/\r?\n/).forEach(line => {
            const idx = line.indexOf('=')
            if (idx > 0) out[line.slice(0, idx)] = line.slice(idx+1)
          })
          return out
        }

        const fileEnv = parseEnv(envText)
        const portsToCheck: number[] = []
        if (fileEnv.POSTGRES_PORT) portsToCheck.push(Number(fileEnv.POSTGRES_PORT))
        if (fileEnv.STUDIO_PORT) portsToCheck.push(Number(fileEnv.STUDIO_PORT))
        if (fileEnv.INBUCKET_WEB_PORT) portsToCheck.push(Number(fileEnv.INBUCKET_WEB_PORT))
        if (fileEnv.ANALYTICS_PORT) portsToCheck.push(Number(fileEnv.ANALYTICS_PORT))
        if (fileEnv.KONG_HTTP_PORT) portsToCheck.push(Number(fileEnv.KONG_HTTP_PORT))

        const occupied: number[] = []
        for (const p of portsToCheck) {
          try { const ok = await isPortAvailable(p); if (!ok) occupied.push(p) } catch { occupied.push(p) }
        }

        if (occupied.length > 0) {
          const initialBase = 8000 + (Date.now() % 10000)
          const offsets = [0, 100, 1000, 1100, 1101, 2000]
          const newBase = await findAvailableBasePort(initialBase, offsets, 200)
          if (!newBase) {
            // Try to identify which containers are publishing the conflicting ports to give the user actionable advice
            try {
              const { exec } = await import('child_process')
              const { promisify } = await import('util')
              const execAsync = promisify(exec)
              const { stdout } = await execAsync('docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"')
              const lines = String(stdout || '').split(/\r?\n/).filter(Boolean)
              const matches: string[] = []
              for (const p of occupied) {
                for (const line of lines) {
                  if (line.includes(`:${p}`)) matches.push(line)
                }
              }
              const note = matches.length > 0 ? `Ports in use by containers:\n${matches.join('\n')}\nYou can stop them with: docker stop <container-id>` : 'Unable to find alternative base port'
              controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify(note)}\n\n`))
            } catch {
              controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify('Unable to find alternative base port')}\n\n`))
            }
            controller.close()
            return
          }

          fileEnv.POSTGRES_PORT = String(newBase + 2000)
          fileEnv.KONG_HTTP_PORT = String(newBase)
          fileEnv.ANALYTICS_PORT = String(newBase + 1000)
          fileEnv.INBUCKET_WEB_PORT = String(newBase + 1100)
          fileEnv.INBUCKET_SMTP_PORT = String(newBase + 1101)
          fileEnv.STUDIO_PORT = String(newBase + 100)

          const envLines = Object.entries(fileEnv).map(([k,v]) => `${k}=${v}`).join('\n')
          try { await fs.writeFile(envPath, envLines, 'utf8') } catch {}
          try { await fs.writeFile(path.join(projectDir, 'docker', '.env'), envLines, 'utf8') } catch {}
          try { await updateSupabaseConfig(projectDir, fileEnv) } catch { /* ignore */ }

          // persist to DB
          for (const [k, v] of Object.entries(fileEnv)) {
            try {
              await prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: k } }, update: { value: v }, create: { projectId, key: k, value: v } })
            } catch {
              // ignore
            }
          }
        }

        // Now spawn supabase start and stream output with retry-on-port-conflict
        const spawnWithEnv = (envOverride?: Record<string,string>) => {
          const spawnEnv = { ...(process.env as Record<string,string>), COMPOSE_PROJECT_NAME: `supa_${project.slug}`, ...(envOverride || {}) }
          return spawn('supabase', ['start'], {
            cwd: projectDir,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: spawnEnv as unknown as NodeJS.ProcessEnv,
          })
        }

        let retryCount = 0
        const maxRetries = 3
  let proc = null as unknown as ReturnType<typeof spawn>

        const sendEvent = (type: string, data: string) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
            } catch (e) {
              console.error('Error sending SSE:', e)
            }
          }
        }

        const attachHandlers = (p: ReturnType<typeof spawn>) => {
          p.stdout?.on('data', (chunk) => sendEvent('log', chunk.toString()))

          p.stderr?.on('data', async (chunk) => {
            const text = chunk.toString()
            // Classify stderr lines: only treat as 'error' when they look fatal; treat warnings/infos accordingly
            const isFatal = /failed to start|failed to set up container networking|failed to start docker container|Bind for .* failed: port is already allocated|port is already allocated|error:/i.test(text)
            const isWarn = /warn(?:ing)?[:]?|WARNING|Analytics on Windows requires Docker daemon/i.test(text)
            if (isFatal) sendEvent('error', text)
            else if (isWarn) sendEvent('warn', text)
            else sendEvent('log', text)

            // If the CLI reports a port allocation error, try to pick alternate ports and restart
            if ((/port is already allocated/i.test(text) || /Bind for .* failed: port is already allocated/i.test(text)) && retryCount < maxRetries) {
              // Extract ports mentioned in the text (if any)
              const found = Array.from(text.matchAll(/:(\d{2,5})/g)).map(m => Number((m as RegExpMatchArray)[1]))
              const conflictedPorts = found.length ? found : []

              sendEvent('log', `Detected port allocation conflict${conflictedPorts.length ? ' on ' + conflictedPorts.join(',') : ''}. Attempting fallback ports (retry ${retryCount+1}/${maxRetries})`)

              // Try to find a new base port
              const initialBase = 8000 + (Date.now() % 10000)
              const offsets = [0, 100, 1000, 1100, 1101, 2000]
              const newBase = await findAvailableBasePort(initialBase, offsets, 200)
              if (!newBase) {
                // Couldn't find new base; list containers that publish the conflicted ports
                try {
                  const { exec } = await import('child_process')
                  const { promisify } = await import('util')
                  const execAsync = promisify(exec)
                  const { stdout } = await execAsync('docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"')
                  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean)
                  const matches: string[] = []
                  for (const pNum of conflictedPorts) {
                    for (const line of lines) if (line.includes(`:${pNum}`)) matches.push(line)
                  }
                  const note = matches.length ? `Ports in use by containers:\n${matches.join('\n')}\nYou can stop them with: docker stop <container-id>` : 'Unable to find alternative base port'
                  sendEvent('error', note)
                } catch {
                  sendEvent('error', 'Unable to find alternative base port and docker ps failed')
                }
                // Give up and close stream
                try { p.kill() } catch {}
                if (!isClosed) { controller.close(); isClosed = true }
                return
              }

              // Update env files and config with the chosen new base
              fileEnv.POSTGRES_PORT = String(newBase + 2000)
              fileEnv.KONG_HTTP_PORT = String(newBase)
              fileEnv.ANALYTICS_PORT = String(newBase + 1000)
              fileEnv.INBUCKET_WEB_PORT = String(newBase + 1100)
              fileEnv.INBUCKET_SMTP_PORT = String(newBase + 1101)
              fileEnv.STUDIO_PORT = String(newBase + 100)

              const envLines = Object.entries(fileEnv).map(([k,v]) => `${k}=${v}`).join('\n')
              try { await fs.writeFile(envPath, envLines, 'utf8') } catch {}
              try { await fs.writeFile(path.join(projectDir, 'docker', '.env'), envLines, 'utf8') } catch {}
              // Only update supabase/config.toml if it already exists to avoid creating an invalid file
              try {
                const cfgPath = path.join(projectDir, 'supabase', 'config.toml')
                try {
                  await fs.access(cfgPath)
                  await updateSupabaseConfig(projectDir, fileEnv)
                  sendEvent('log', `Updated config.toml: ${cfgPath}`)
                } catch {
                  sendEvent('log', `No config.toml present at ${cfgPath}; skipping TOML update`) 
                }
              } catch {
                // ignore
              }
              for (const [k, v] of Object.entries(fileEnv)) {
                try { await prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: k } }, update: { value: v }, create: { projectId, key: k, value: v } }) } catch {}
              }

              // Restart supabase start with new ports
              retryCount += 1
              sendEvent('log', `Retrying supabase start with base port ${newBase}...`)

              // spawn new process and attach handlers BEFORE killing the old process
              const nextProc = spawnWithEnv()
              attachHandlers(nextProc)
              try { p.kill() } catch {}
              // switch active proc pointer to the new process so old close handlers don't close the stream
              proc = nextProc
            }
          })

          p.on('close', (code) => {
            // Only close the stream if the process that closed is the current active proc.
            // This avoids a race where an older process exits after we've already spawned a replacement.
            if (p !== proc) return
            sendEvent('done', code === 0 ? 'success' : `failed (exit code ${code})`)
            if (!isClosed) {
              controller.close()
              isClosed = true
            }
          })

          p.on('error', (err) => {
            if (p !== proc) return
            sendEvent('error', `Process error: ${err.message}`)
            if (!isClosed) {
              controller.close()
              isClosed = true
            }
          })
        }

        // start first process
        proc = spawnWithEnv()
        attachHandlers(proc)

        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          try { proc.kill() } catch {}
          isClosed = true
          try {
            controller.close()
          } catch (e) {
            console.error('Error closing stream:', e)
          }
        })
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Stream logs error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
