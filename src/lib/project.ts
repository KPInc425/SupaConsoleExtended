import { promises as fs } from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from './db'
import { isSupabaseCliAvailable } from './cli'
import TOML from '@iarna/toml'
import * as net from 'net'

const execAsync = promisify(exec)

// Update supabase/config.toml with new port values if present
export async function updateSupabaseConfig(projectRoot: string, env: Record<string,string>) {
  const cfgPath = path.join(projectRoot, 'supabase', 'config.toml')
  try {
    let txt = ''
    try {
      txt = await fs.readFile(cfgPath, 'utf8')
    } catch {
      // If the config doesn't exist, create a minimal one so the CLI will honor port overrides
      // Use canonical 'port' fields (not http_port/web_port) to match the CLI's expected keys.
    const minimal: Record<string, unknown> = {
        db: { port: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : 5432 },
        kong: { port: env.KONG_HTTP_PORT ? Number(env.KONG_HTTP_PORT) : 54321 },
        studio: { port: env.STUDIO_PORT ? Number(env.STUDIO_PORT) : 54323 },
        inbucket: { port: env.INBUCKET_WEB_PORT ? Number(env.INBUCKET_WEB_PORT) : 54324, smtp_port: env.INBUCKET_SMTP_PORT ? Number(env.INBUCKET_SMTP_PORT) : 1025, pop3_port: env.INBUCKET_POP3_PORT ? Number(env.INBUCKET_POP3_PORT) : 54326 },
        analytics: { port: env.ANALYTICS_PORT ? Number(env.ANALYTICS_PORT) : 54325 }
      }
      txt = TOML.stringify(minimal)
      try { await fs.mkdir(path.join(projectRoot, 'supabase'), { recursive: true }) } catch {}
      await fs.writeFile(cfgPath, txt, 'utf8')
    }
  // Before parsing, handle the case where the config uses unquoted env(NAME) tokens
    // (the Supabase CLI accepts env(NAME) without quotes for numeric fields), which
    // our TOML parser cannot parse. For numeric envs we control (ports), do a
    // safe, targeted text replacement: replace occurrences like
    //   pop3_port = env(INBUCKET_POP3_PORT)
    // or
    //   pop3_port = "env(INBUCKET_POP3_PORT)"
    // with the numeric value from env if available. This avoids leaving a
    // non-numeric token in the TOML which the CLI would later attempt to parse
    // as a number and fail.
    // Mapping used to find common keys in the config TOML
    const mapping: Record<string, string[][]> = {
      POSTGRES_PORT: [['db', 'port'], ['postgres', 'port'], ['database', 'port'], ['postgrest', 'port']],
      KONG_HTTP_PORT: [['api', 'port'], ['kong', 'port'], ['gateway', 'port']],
      STUDIO_PORT: [['studio', 'port']],
      INBUCKET_WEB_PORT: [['inbucket', 'port']],
      INBUCKET_SMTP_PORT: [['inbucket', 'smtp_port']],
      INBUCKET_POP3_PORT: [['inbucket', 'pop3_port']],
      ANALYTICS_PORT: [['analytics', 'port']],
    }

    const numericEnvKeys = Object.keys(mapping)
    let txtProcessed = txt
    for (const envKey of numericEnvKeys) {
      const val = env[envKey]
      if (!val) continue
      const num = Number(val)
      if (Number.isNaN(num)) continue

      // Heuristics: replace common suffixes used in config keys (port, smtp_port, pop3_port)
      // Build a regex to match lines like: key = env(NAME) or key = "env(NAME)"
      // We only replace the specific env name so we don't accidentally replace other env(...) uses.
      const name = envKey
      // Possible toml key names to look for are taken from mapping paths
      const paths = mapping[name as keyof typeof mapping]
      for (const pathParts of paths) {
        const keyName = pathParts[pathParts.length - 1]
        const re = new RegExp(`(^\\s*${keyName}\\s*=\\s*)(?:\\"?env\\(${name}\\)\\"?|env\\(${name}\\))`, 'gmi')
        txtProcessed = txtProcessed.replace(re, (_, p1) => `${p1}${num}`)
      }
    }

    // Parse TOML safely after preprocessing replacements. If parsing fails, bail
    // to avoid corrupting the file (we prefer to leave the file as-is instead
    // of writing invalid content).
    let parsed: Record<string, unknown> | undefined
    try {
      parsed = TOML.parse(txtProcessed) as Record<string, unknown>
    } catch {
      // If parsing fails even after preprocessing, don't attempt to modify the file.
      return
    }

    // Helper to set nested keys by name if present in parsed TOML
    const setIfPresent = (keyPaths: string[][], value: string) => {
        for (const pathParts of keyPaths) {
        let node: unknown = parsed
        for (let i = 0; i < pathParts.length - 1; i++) {
          const part = pathParts[i]
          if ((node as Record<string, unknown>)?.[part] === undefined) {
            node = undefined
            break
          }
          node = (node as Record<string, unknown>)[part]
        }
        if (!node) continue
        const last = pathParts[pathParts.length - 1]
        // Only set if key exists or if node is an object
        if (typeof node === 'object') {
          // Do not overwrite values that are env(var) placeholders in TOML
          // The TOML parser represents quoted strings as string values, so detect those
          // and skip them to preserve env-driven templates.
          const n = node as Record<string, unknown>
          const existing = n[last]
          if (typeof existing === 'string' && /^env\(.+\)$/.test(existing)) {
            // If the existing value is an env(...) placeholder, prefer to replace it
            // with a numeric value when we actually have a numeric env value. This
            // ensures numeric fields (ports) are written as numbers instead of
            // leaving the literal env(...) string which the CLI may try to parse
            // as a number and fail.
            const asNum = Number(value)
            if (!Number.isNaN(asNum)) {
              n[last] = asNum as unknown
            } else {
              // Non-numeric env - preserve the env(...) placeholder string
            }
          } else {
            n[last] = Number(value) as unknown
          }
        }
      }
    }

    // Update common DB/API/studio/mailpit port fields if POSTGRES_PORT or other envs set
    // Reuse the `mapping` declared earlier (used for preprocessing) so we don't
    // duplicate declarations and cause linter/TS errors.
    for (const envKey of Object.keys(mapping)) {
      const paths = mapping[envKey as keyof typeof mapping]
      if (env[envKey]) setIfPresent(paths, env[envKey])
    }

    // Also attempt a best-effort recursive update: if any table contains a 'port' or key ending with '_port',
    // and the env contains a corresponding variable (by heuristic), set it. This covers variations in config.
    const heuristics = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      for (const k of Object.keys(node as Record<string, unknown>)) {
        const v = (node as Record<string, unknown>)[k]
        if (k === 'port' || k.endsWith('_port')) {
          const candidate = k.toUpperCase()
          if (env[candidate]) {
            ;(node as Record<string, unknown>)[k] = Number(env[candidate]) as unknown
          }
        }
        if (typeof v === 'object') heuristics(v)
      }
    }

    heuristics(parsed)

  // Stringify back to TOML and write
  const out = TOML.stringify(parsed)
  await fs.writeFile(cfgPath, out, 'utf8')
  } catch {
    // ignore if file doesn't exist or IO fails
  }
}

// Helper functions for generating secure defaults
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}



// Pre-flight checks for Docker deployment
async function checkDockerPrerequisites() {
  const checks = {
    docker: false,
    dockerCompose: false,
    internetConnection: false,
  }
  
  try {
    await execAsync('docker --version')
    checks.docker = true
  } catch {
    // Docker not available
  }
  
  try {
    await execAsync('docker compose version')
    checks.dockerCompose = true
  } catch {
    // Docker Compose not available
  }
  
  // Multi-layered internet connectivity check
  checks.internetConnection = await checkInternetConnectivity()
  
  return checks
}

// Improved internet connectivity check using multiple methods
async function checkInternetConnectivity(): Promise<boolean> {
  // Method 1: HTTP connectivity test to multiple reliable endpoints
  const httpEndpoints = [
    'https://www.google.com',
    'https://1.1.1.1', // Cloudflare DNS
    'https://8.8.8.8', // Google DNS
  ]
  
  for (const endpoint of httpEndpoints) {
    try {
      // Use curl for HTTP connectivity test with short timeout
      await execAsync(`curl -s --max-time 10 --head ${endpoint}`, { timeout: 15000 })
      return true // If any endpoint succeeds, we have internet
    } catch {
      // Try next endpoint
      continue
    }
  }
  
  // Method 2: DNS resolution test
  try {
    await execAsync('nslookup google.com', { timeout: 10000 })
    return true
  } catch {
    // DNS resolution failed
  }
  
  // Method 3: Ping test (as fallback)
  try {
    const pingCommand = process.platform === 'win32' 
      ? 'ping -n 1 8.8.8.8' 
      : 'ping -c 1 8.8.8.8'
    await execAsync(pingCommand, { timeout: 10000 })
    return true
  } catch {
    // Ping failed
  }
  
  // Method 4: Docker registry connectivity (original method as last resort)
  try {
    await execAsync('docker pull alpine:latest', { 
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5 // 5MB buffer for Docker pull
    })
    return true
  } catch {
    // All methods failed
  }
  
  return false
}

// Port utility: check if a TCP port on localhost is available
export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  // First, check if Docker reports the port as published by any container.
  try {
    const { stdout } = await execAsync('docker ps --format "{{.Ports}}"', { timeout: 3000 })
    if (stdout && stdout.includes(`:${port}`)) {
      return false
    }
  } catch {
    // If docker isn't available or the command fails, continue to TCP bind checks
  }

  // Try binding on multiple interfaces to detect a real conflict (0.0.0.0 vs 127.0.0.1 differences)
  const hostsToTry = [host, '0.0.0.0', '::1']
  for (const h of hostsToTry) {
    const ok = await new Promise<boolean>(resolve => {
      const server = net.createServer()
      let done = false
      const cleanup = () => {
        try { server.close() } catch {}
      }
      server.once('error', () => { if (!done) { done = true; cleanup(); resolve(false) } })
      server.once('listening', () => { if (!done) { done = true; cleanup(); resolve(true) } })
      try {
        server.listen(port, h)
      } catch {
        if (!done) { done = true; cleanup(); resolve(false) }
      }
      setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false) } }, 1000)
    })
    if (!ok) return false
  }

  return true
}

// Try to find a basePort where a set of offsets are free. Returns number or null
export async function findAvailableBasePort(start: number, offsets: number[], attempts = 100): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const candidate = start + i * 10
    const checks = await Promise.all(offsets.map(off => isPortAvailable(candidate + off)))
    if (checks.every(Boolean)) return candidate
  }
  return null
}

export async function initializeSupabaseCore() {
  const coreDir = path.join(process.cwd(), 'supabase-core')
  const projectsDir = path.join(process.cwd(), 'supabase-projects')
  
  try {
    // Check if directories already exist
    const coreExists = await fs.access(coreDir).then(() => true).catch(() => false)
    const projectsExists = await fs.access(projectsDir).then(() => true).catch(() => false)
    
    // Create supabase-projects directory if it doesn't exist
    if (!projectsExists) {
      await fs.mkdir(projectsDir, { recursive: true })
    }
    
    // We no longer clone the full supabase-core repository as the CLI handles runtime artifacts.
    // Create a minimal placeholder for developer guidance if the directory doesn't exist.
    if (!coreExists) {
      await fs.mkdir(coreDir, { recursive: true })
      const readme = `This folder previously contained a clone of the Supabase monorepo.
The project now relies on the Supabase CLI for local orchestration.

If you need the full supabase repository for debugging or development, clone it manually:
  git clone https://github.com/supabase/supabase supabase-core
`
      try { await fs.writeFile(path.join(coreDir, 'README.md'), readme, 'utf8') } catch {}
    }
    
    return { success: true }
  } catch (error) {
    console.error('Failed to initialize Supabase core:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function createProject(name: string, userId: string, description?: string) {
  // New flow: use supabase CLI exclusively to create and start projects
  try {
    const cli = await isSupabaseCliAvailable()
    if (!cli.available) {
      throw new Error('Supabase CLI is not installed or not available in PATH. Please install it and try again.')
    }

    // Generate unique slug
    const timestamp = Date.now()
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`

    // Create project record in DB
    const project = await prisma.project.create({
      data: { name, slug, description, ownerId: userId }
    })

    // Create project directory
    const projectDir = path.join(process.cwd(), 'supabase-projects', slug)
    await fs.mkdir(projectDir, { recursive: true })

    // Generate envs and write .env (both project root and docker for compatibility)
    // Choose a basePort and ensure required service ports are free to avoid collisions
    const initialBase = 8000 + (timestamp % 10000)
  const requiredOffsets = [0, 100, 1000, 1100, 1101, 1102, 2000]
    const foundBase = await findAvailableBasePort(initialBase, requiredOffsets, 200)
    if (!foundBase) {
      throw new Error('Failed to find an available base port for the new project. Please free local ports or try again.')
    }
    const basePort = foundBase
    const defaultEnvVars: Record<string, string> = {
      POSTGRES_PASSWORD: generateRandomString(32),
      JWT_SECRET: generateRandomString(40),
      ANON_KEY: generateRandomString(64),
      SERVICE_ROLE_KEY: generateRandomString(64),
      DASHBOARD_USERNAME: 'supabase',
      DASHBOARD_PASSWORD: generateRandomString(16),
      SECRET_KEY_BASE: generateRandomString(64),
      VAULT_ENC_KEY: generateRandomString(32),
      POSTGRES_PORT: (basePort + 2000).toString(),
      KONG_HTTP_PORT: basePort.toString(),
      ANALYTICS_PORT: (basePort + 1000).toString(),
      INBUCKET_WEB_PORT: (basePort + 1100).toString(),
  INBUCKET_SMTP_PORT: (basePort + 1101).toString(),
  INBUCKET_POP3_PORT: (basePort + 1102).toString(),
      POSTGRES_HOST: 'db',
      POSTGRES_DB: 'postgres',
  // Default frontend URL should point at typical dev servers (Vite uses 5173).
  // Use localhost:5173 by default so magic links from Studio/mailpit open the developer frontend.
  SITE_URL: `http://localhost:5173`,
  API_EXTERNAL_URL: `http://localhost:5173`,
      MAILER_URLPATHS_INVITE: '/auth/v1/verify',
      SMTP_HOST: 'inbucket',
      SMTP_PORT: (basePort + 1101).toString(),
      SMTP_ADMIN_EMAIL: 'admin@example.com',
      STUDIO_PORT: (basePort + 100).toString(),
  SUPABASE_PUBLIC_URL: `http://localhost:5173`,
      ENABLE_EMAIL_SIGNUP: 'true',
      ENABLE_PHONE_SIGNUP: 'true',
      FUNCTIONS_VERIFY_JWT: 'false',
      PROJECT_ID: slug,
    }

    const envText = Object.entries(defaultEnvVars).map(([k, v]) => `${k}=${v}`).join('\n')
    await fs.writeFile(path.join(projectDir, '.env'), envText)
    const dockerEnvDir = path.join(projectDir, 'docker')
    await fs.mkdir(dockerEnvDir, { recursive: true })
    await fs.writeFile(path.join(dockerEnvDir, '.env'), envText)

    // Persist envs to DB
    for (const [key, value] of Object.entries(defaultEnvVars)) {
      await prisma.projectEnvVar.create({ data: { projectId: project.id, key, value } })
    }

    // If a repository-level config.toml template exists, copy it into the project so the CLI has a valid
    // starting point and we can safely merge port overrides into it.
    try {
      const repoCfg = path.join(process.cwd(), 'config.toml')
      const projectSupabaseDir = path.join(projectDir, 'supabase')
      const projectCfg = path.join(projectSupabaseDir, 'config.toml')
      try {
        // check repo template exists
        await fs.access(repoCfg)
        await fs.mkdir(projectSupabaseDir, { recursive: true })
        const template = await fs.readFile(repoCfg, 'utf8')
  await fs.writeFile(projectCfg, template, 'utf8')
  // Intentionally do NOT rewrite the copied config.toml here. The repository
  // template should contain env(...) placeholders (e.g. env(POSTGRES_PORT))
  // and we rely on the per-project `.env` to provide values. Avoid modifying
  // the TOML file to prevent malformed numeric substitutions and parsing
  // errors in the Supabase CLI.
      } catch {
        // no template present; skip
      }
    } catch {
      // ignore filesystem errors
    }

    // We intentionally do NOT start the Supabase CLI here.
    // Creation now only persists DB records and .env files. Actual stack startup is performed
    // when the user triggers Deploy (handled in deployProject).
    await prisma.project.update({ where: { id: project.id }, data: { status: 'created' } })

    return { success: true, project }
  } catch (error) {
    console.error('Failed to create project via CLI:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function updateProjectEnvVars(projectId: string, envVars: Record<string, string>) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })
    
    if (!project) {
      throw new Error('Project not found')
    }
    
    // Read existing env vars from DB so we merge updates instead of overwriting
    const existingEnvRows = await prisma.projectEnvVar.findMany({ where: { projectId } })
    const existingEnv: Record<string, string> = {}
    existingEnvRows.forEach(r => { existingEnv[r.key] = r.value })

    // Merge: incoming envVars overwrite existing keys; missing keys are preserved
    const mergedEnv: Record<string, string> = { ...existingEnv, ...envVars }

    // Ensure Studio and other SUPABASE_* aliases see the SITE_URL if provided.
    // Some Supabase components and Studio expect SUPABASE_PUBLIC_URL or SUPABASE_SITE_URL
    // for constructing magic links. Mirror SITE_URL into SUPABASE_PUBLIC_URL when present.
    if (mergedEnv.SITE_URL) {
      if (!mergedEnv.SUPABASE_PUBLIC_URL) mergedEnv.SUPABASE_PUBLIC_URL = mergedEnv.SITE_URL
      if (!mergedEnv.SUPABASE_SITE_URL) mergedEnv.SUPABASE_SITE_URL = mergedEnv.SITE_URL
    }

    // Upsert all merged env vars into DB (preserve any keys not present in the incoming payload)
    for (const [key, value] of Object.entries(mergedEnv)) {
      await prisma.projectEnvVar.upsert({
        where: {
          projectId_key: {
            projectId,
            key,
          },
        },
        update: { value },
        create: {
          projectId,
          key,
          value,
        },
      })
    }

    // Update .env file in project directory with merged content
  const projectRoot = path.join(process.cwd(), 'supabase-projects', project.slug)
  const envFilePath = path.join(projectRoot, '.env')

    const envContent = Object.entries(mergedEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    await fs.writeFile(envFilePath, envContent)
    
    return { success: true }
  } catch (error) {
    console.error('Failed to update project env vars:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function deployProject(projectId: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })
    
    if (!project) {
      throw new Error('Project not found')
    }
    
  const projectRoot = path.join(process.cwd(), 'supabase-projects', project.slug)
  const projectDockerDir = path.join(projectRoot, 'docker')
    
  // Run pre-flight checks
    console.log('Running pre-flight checks...')
    const checks = await checkDockerPrerequisites()
    
    if (!checks.docker) {
      throw new Error('Docker is not installed or not running. Please install Docker Desktop and ensure it is started before deploying.')
    }
    
    if (!checks.dockerCompose) {
      throw new Error('Docker Compose is not available. Please ensure Docker Desktop includes Docker Compose or install it separately.')
    }
    
      // Use supabase CLI to start the stack (CLI creates/manages compose files)
      try {
        // Read .env file to pick up configured ports
          const envPath = path.join(projectRoot, '.env')
        let envText = ''
        try { envText = await fs.readFile(envPath, 'utf8') } catch {}
        const parseEnv = (text: string) => {
          const out: Record<string,string> = {}
          text.split(/\r?\n/).forEach(line => {
            const idx = line.indexOf('=')
            if (idx > 0) {
              out[line.slice(0, idx)] = line.slice(idx+1)
            }
          })
          return out
        }
        const fileEnv = parseEnv(envText)
        const portsToCheck: number[] = []
        if (fileEnv.POSTGRES_PORT) portsToCheck.push(Number(fileEnv.POSTGRES_PORT))
        if (fileEnv.STUDIO_PORT) portsToCheck.push(Number(fileEnv.STUDIO_PORT))
        if (fileEnv.INBUCKET_WEB_PORT) portsToCheck.push(Number(fileEnv.INBUCKET_WEB_PORT))
  if (fileEnv.INBUCKET_SMTP_PORT) portsToCheck.push(Number(fileEnv.INBUCKET_SMTP_PORT))
  if (fileEnv.INBUCKET_POP3_PORT) portsToCheck.push(Number(fileEnv.INBUCKET_POP3_PORT))
        if (fileEnv.ANALYTICS_PORT) portsToCheck.push(Number(fileEnv.ANALYTICS_PORT))
        if (fileEnv.KONG_HTTP_PORT) portsToCheck.push(Number(fileEnv.KONG_HTTP_PORT))

        const occupied = [] as number[]
        for (const p of portsToCheck) {
          try {
            const ok = await isPortAvailable(p)
            if (!ok) occupied.push(p)
          } catch {
            occupied.push(p)
          }
        }

        if (occupied.length > 0) {
          // Find a new base port that frees the required offsets
          const initialBase = 8000 + (Date.now() % 10000)
          const offsets = [0, 100, 1000, 1100, 1101, 1102, 2000]
          const newBase = await findAvailableBasePort(initialBase, offsets, 200)
          if (!newBase) throw new Error('Port(s) in use and unable to find alternative base port. Free ports or configure custom ports in the project settings.')

          // Update env file and DB env vars to the new base
          const updatedEnv = { ...fileEnv }
          updatedEnv.ANALYTICS_PORT = String(newBase + 1000)
          updatedEnv.INBUCKET_WEB_PORT = String(newBase + 1100)
          updatedEnv.INBUCKET_SMTP_PORT = String(newBase + 1101)
          updatedEnv.STUDIO_PORT = String(newBase + 100)

          const envLines = Object.entries(updatedEnv).map(([k,v]) => `${k}=${v}`).join('\n')
          try { await fs.writeFile(envPath, envLines, 'utf8') } catch {}
            try { await fs.writeFile(path.join(projectDockerDir, '.env'), envLines, 'utf8') } catch {}

          // Do NOT rewrite supabase/config.toml here. Keep the copied template
          // untouched and rely on `.env` values (env(...) placeholders) so the CLI
          // resolves them at runtime. This avoids writing numeric values into the
          // TOML which can cause parse failures.

          // Persist updated env vars into DB
          for (const [k, v] of Object.entries(updatedEnv)) {
            try {
              await prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: k } }, update: { value: v }, create: { projectId, key: k, value: v } })
            } catch {
              // continue
            }
          }
        }

        // Ensure CLI is available
        const cli = await isSupabaseCliAvailable()
        if (!cli.available) throw new Error('Supabase CLI not available in PATH')

        // Final pre-start verification: re-check ports immediately before starting the CLI.
        // This helps avoid a race where ports become occupied between the initial probe and `supabase start`.
  const finalOffsets = [0, 100, 1000, 1100, 1101, 1102, 2000]
        const maxRetries = 3
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const conflicts: number[] = []
          for (const p of portsToCheck) {
            try {
              const ok = await isPortAvailable(p)
              if (!ok) conflicts.push(p)
            } catch {
              conflicts.push(p)
            }
          }

          if (conflicts.length === 0) break // ports still free; proceed to start

          // Try to find a new base port and rewrite env files & DB
          const attemptBase = 8000 + (Date.now() % 10000)
          const newBase = await findAvailableBasePort(attemptBase, finalOffsets, 200)
          if (!newBase) {
            if (attempt === maxRetries - 1) {
              throw new Error('Port(s) in use and unable to find alternative base port. Free ports or configure custom ports in the project settings.')
            }
            // small backoff before retry
            await new Promise(r => setTimeout(r, 250))
            continue
          }

          // Update fileEnv with the chosen base and persist to disk + DB
          fileEnv.POSTGRES_PORT = String(newBase + 2000)
          fileEnv.KONG_HTTP_PORT = String(newBase)
          fileEnv.ANALYTICS_PORT = String(newBase + 1000)
          fileEnv.INBUCKET_WEB_PORT = String(newBase + 1100)
          fileEnv.INBUCKET_SMTP_PORT = String(newBase + 1101)
          fileEnv.INBUCKET_POP3_PORT = String(newBase + 1102)
          fileEnv.STUDIO_PORT = String(newBase + 100)

            const envLines = Object.entries(fileEnv).map(([k, v]) => `${k}=${v}`).join('\n')
          try { await fs.writeFile(envPath, envLines, 'utf8') } catch {}
          try { await fs.writeFile(path.join(projectDockerDir, '.env'), envLines, 'utf8') } catch {}

          for (const [k, v] of Object.entries(fileEnv)) {
            try {
              await prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: k } }, update: { value: v }, create: { projectId, key: k, value: v } })
            } catch {
              // ignore per-key persistence failures
            }
          }

          // Note: intentionally not updating supabase/config.toml here. Keep the
          // project TOML template as-is and let the Supabase CLI resolve env(...)
          // placeholders from the project's .env at runtime. This avoids parsing
          // and numeric substitution issues.

          // update portsToCheck for the next iteration
          portsToCheck.length = 0
          if (fileEnv.POSTGRES_PORT) portsToCheck.push(Number(fileEnv.POSTGRES_PORT))
          if (fileEnv.STUDIO_PORT) portsToCheck.push(Number(fileEnv.STUDIO_PORT))
          if (fileEnv.INBUCKET_WEB_PORT) portsToCheck.push(Number(fileEnv.INBUCKET_WEB_PORT))
          if (fileEnv.ANALYTICS_PORT) portsToCheck.push(Number(fileEnv.ANALYTICS_PORT))
          if (fileEnv.KONG_HTTP_PORT) portsToCheck.push(Number(fileEnv.KONG_HTTP_PORT))

          // small backoff before re-checking
          await new Promise(r => setTimeout(r, 250))
        }

    console.log('Starting Supabase stack via supabase CLI...')
    try {
      // Provide a unique compose project name to avoid Docker stack/network collisions
      const spawnEnvBase = { ...(process.env as Record<string,string>), COMPOSE_PROJECT_NAME: `supa_${project.slug}` }
      const maxRetriesStart = 3
      let attempt = 0
      let started = false
      while (attempt < maxRetriesStart && !started) {
        try {
          attempt += 1
          await execAsync('supabase start', { cwd: projectRoot, timeout: 1000 * 60 * 10, maxBuffer: 1024 * 1024 * 10, env: spawnEnvBase as unknown as NodeJS.ProcessEnv })
          started = true
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('port is already allocated') || msg.match(/Bind for .* failed: port is already allocated/)) {
            // Try to select a new base port and rewrite envs/config
            if (attempt >= maxRetriesStart) {
              throw new Error(`Supabase start failed due to port allocation after ${attempt} attempts. ${msg}`)
            }
            // find new base
            const initialBase = 8000 + (Date.now() % 10000)
            const offsets = [0, 100, 1000, 1100, 1101, 1102, 2000]
            const newBase = await findAvailableBasePort(initialBase, offsets, 200)
            if (!newBase) {
              // Can't find alternative; surface the docker containers owning the ports
              try {
                const { exec } = await import('child_process')
                const { promisify } = await import('util')
                const execAsyncLocal = promisify(exec)
                const { stdout } = await execAsyncLocal('docker ps --format "{{.ID}} {{.Names}} {{.Ports}}"')
                const lines = String(stdout || '').split(/\r?\n/).filter(Boolean)
                // Try to list any lines that show 5432-ish ports as a best-effort
                const matches = lines.filter(l => /:543\d{1,2}|:5432/.test(l))
                throw new Error('Unable to find alternative base port. Ports in use: ' + JSON.stringify(matches))
              } catch {
                throw new Error('Unable to find alternative base port and docker ps failed')
              }
            }

            // update fileEnv and write
            fileEnv.POSTGRES_PORT = String(newBase + 2000)
            fileEnv.KONG_HTTP_PORT = String(newBase)
            fileEnv.ANALYTICS_PORT = String(newBase + 1000)
            fileEnv.INBUCKET_WEB_PORT = String(newBase + 1100)
            fileEnv.INBUCKET_SMTP_PORT = String(newBase + 1101)
            fileEnv.STUDIO_PORT = String(newBase + 100)

            const envLines = Object.entries(fileEnv).map(([k, v]) => `${k}=${v}`).join('\n')
            try { await fs.writeFile(envPath, envLines, 'utf8') } catch {}
            try { await fs.writeFile(path.join(projectDockerDir, '.env'), envLines, 'utf8') } catch {}
            // Intentionally not updating supabase/config.toml here to avoid
            // introducing numeric replacements that may break TOML parsing.

            for (const [k, v] of Object.entries(fileEnv)) {
              try { await prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: k } }, update: { value: v }, create: { projectId, key: k, value: v } }) } catch {}
            }

            // small delay before retry
            await new Promise(r => setTimeout(r, 300))
            continue
          }
          throw err
        }
      }
      if (!started) throw new Error('Supabase CLI failed to start the stack after retries')
    } catch (startError) {
      const msg = startError instanceof Error ? startError.message : String(startError)
      throw new Error(`Supabase CLI failed to start the stack: ${msg}`)
    }
      } catch (startError) {
        const msg = startError instanceof Error ? startError.message : String(startError)
        throw new Error(`Supabase CLI failed to start the stack: ${msg}`)
      }
    
  // Verify that containers are running and retrieve runtime status from the CLI
  try {
      // Docker compose files are written to the project's 'docker' subdirectory by the CLI
        const projectDockerDir = path.join(projectRoot, 'docker')
      const { stdout } = await execAsync('docker compose ps --format json', { 
        cwd: projectDockerDir,
        maxBuffer: 1024 * 1024 * 2 // 2MB buffer for container status
      })
      const containers = JSON.parse(`[${stdout.trim().split('\n').join(',')}]`)
      const runningContainers = containers.filter((c: { State: string }) => c.State === 'running')
  console.log(`Deployment successful: ${runningContainers.length} containers running`)
      
      // Ensure Inbucket is running
      const inbucketContainer = runningContainers.find((c: unknown) => {
  const obj = c as Record<string, string | number>
        return obj.Service === 'inbucket' || (typeof obj.Name === 'string' && obj.Name.includes('inbucket'))
      })

      if (!inbucketContainer) {
        throw new Error('Inbucket service is not running after deployment. Check `docker compose logs inbucket` for details.')
      }

      // Verify GOTRUE_JWT_SECRET inside auth container matches the .env JWT_SECRET
        const envFilePath = path.join(projectRoot, '.env')
      let envText = ''
      try {
        envText = await fs.readFile(envFilePath, 'utf8')
      } catch {
        envText = ''
      }

      const parseEnv = (text: string) => {
        const out: Record<string,string> = {}
        text.split(/\r?\n/).forEach(line => {
          const idx = line.indexOf('=')
          if (idx > 0) {
            const k = line.slice(0, idx)
            const v = line.slice(idx+1)
            out[k] = v
          }
        })
        return out
      }

      const fileEnv = parseEnv(envText)
      const expectedJwt = fileEnv['JWT_SECRET'] || ''

      // Find auth container name
      const authContainer = runningContainers.find((c: unknown) => {
  const obj = c as Record<string, string | number>
        return obj.Service === 'auth' || (typeof obj.Name === 'string' && obj.Name.includes('-auth'))
      })

      if (!authContainer) {
        throw new Error('Auth (GoTrue) container not found after deployment')
      }

      // Determine container name to exec into
      const containerName = authContainer.Name || authContainer.Names || authContainer.Container || authContainer.Name
      try {
          const { stdout: gotrueEnv } = await execAsync(`docker exec ${containerName} printenv GOTRUE_JWT_SECRET`, { cwd: projectDockerDir })
        const containerJwt = gotrueEnv.trim()
        if (expectedJwt && containerJwt && expectedJwt !== containerJwt) {
          throw new Error('GOTRUE_JWT_SECRET inside container does not match project .env JWT_SECRET. This will cause invalid JWTs for admin operations.')
        }
      } catch (e) {
        throw new Error(`Failed to verify GOTRUE_JWT_SECRET inside auth container: ${e instanceof Error ? e.message : String(e)}`)
      }
    } catch {
      console.warn('Could not verify container status, but deployment may have succeeded')
    }
      // Query supabase CLI for runtime status (preferred) and persist runtime URLs + JWT_SECRET
      try {
          const { stdout: statusOut } = await execAsync('supabase status -o json --workdir .', { cwd: projectRoot, timeout: 20000, maxBuffer: 1024 * 1024 * 2 })
        try {
          const statusJson = JSON.parse(statusOut)
          // Persist a selection of runtime values into projectEnvVar rows
          const toPersist: Record<string,string> = {}
          if (statusJson.API_URL) toPersist.API_URL = String(statusJson.API_URL)
          if (statusJson.GRAPHQL_URL) toPersist.GRAPHQL_URL = String(statusJson.GRAPHQL_URL)
          if (statusJson.STORAGE_URL) toPersist.STORAGE_URL = String(statusJson.STORAGE_URL)
          if (statusJson.STORAGE_S3_URL) toPersist.STORAGE_S3_URL = String(statusJson.STORAGE_S3_URL)
          if (statusJson.S3_ACCESS_KEY) toPersist.S3_ACCESS_KEY = String(statusJson.S3_ACCESS_KEY)
          if (statusJson.S3_SECRET_KEY) toPersist.S3_SECRET_KEY = String(statusJson.S3_SECRET_KEY)
          if (statusJson.S3_REGION) toPersist.S3_REGION = String(statusJson.S3_REGION)
          if (statusJson.MCP_URL) toPersist.MCP_URL = String(statusJson.MCP_URL)
          if (statusJson.STUDIO_URL) toPersist.STUDIO_URL = String(statusJson.STUDIO_URL)
          if (statusJson.INBUCKET_URL) toPersist.INBUCKET_URL = String(statusJson.INBUCKET_URL)
          if (statusJson.MAILPIT_URL) toPersist.MAILPIT_URL = String(statusJson.MAILPIT_URL)
          if (statusJson.DB_URL) toPersist.DB_URL = String(statusJson.DB_URL)
          if (statusJson.JWT_SECRET) toPersist.JWT_SECRET = String(statusJson.JWT_SECRET)
          if (statusJson.PUBLISHABLE_KEY) toPersist.PUBLISHABLE_KEY = String(statusJson.PUBLISHABLE_KEY)
          if (statusJson.SECRET_KEY) toPersist.SECRET_KEY = String(statusJson.SECRET_KEY)

          for (const [k, v] of Object.entries(toPersist)) {
            try {
              await prisma.projectEnvVar.upsert({ where: { projectId_key: { projectId, key: k } }, update: { value: v }, create: { projectId, key: k, value: v } })
            } catch {
              // ignore per-key persistence failures
            }
          }

          // Return status object in the result so callers (API/UI) can show runtime URLs
          await prisma.project.update({ where: { id: projectId }, data: { status: 'active' } })
          return { success: true, status: statusJson }
    } catch {
          // Could not parse status output; still mark active and return success without status
          await prisma.project.update({ where: { id: projectId }, data: { status: 'active' } })
          return { success: true }
        }
    } catch {
        // Status query failed — still mark project active but return a partial success with message
        try { await prisma.project.update({ where: { id: projectId }, data: { status: 'active' } }) } catch {}
        return { success: true, note: 'Could not query supabase CLI status after start' }
      }
    
    // Should not reach here; return generic success as fallback
    await prisma.project.update({ where: { id: projectId }, data: { status: 'active' } })
    return { success: true }
  } catch (error) {
    console.error('Failed to deploy project:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function pauseProject(projectId: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })
    
    if (!project) {
      throw new Error('Project not found')
    }
    
    const projectDir = path.join(process.cwd(), 'supabase-projects', project.slug, 'docker')

    // Prefer using Supabase CLI to stop the stack (cross-platform and aware of CLI-managed resources)
    try {
      await execAsync('supabase stop --workdir .', { cwd: path.join(process.cwd(), 'supabase-projects', project.slug), timeout: 120000 })
    } catch (cliStopError) {
      console.warn('supabase stop failed, falling back to docker compose stop:', cliStopError)
      // Fallback to docker compose stop in the docker folder
      await execAsync('docker compose stop', { cwd: projectDir })
    }
    
    // Update project status
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'paused' },
    })
    
    return { success: true }
  } catch (error) {
    console.error('Failed to pause project:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function deleteProject(projectId: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    })
    
    if (!project) {
      throw new Error('Project not found')
    }
    
    const projectDir = path.join(process.cwd(), 'supabase-projects', project.slug)
    const dockerDir = path.join(projectDir, 'docker')
    
    // Step 1: Stop and remove Docker containers
    try {
      console.log(`Stopping Docker containers for project ${project.slug} via supabase CLI...`)
      await execAsync('supabase stop --workdir .', { cwd: projectDir, timeout: 120000 })
    } catch (cliStopError) {
      console.warn('supabase stop failed, falling back to docker compose down:', cliStopError)
      try {
        await execAsync('docker compose down --volumes --remove-orphans', { 
          cwd: dockerDir,
          timeout: 120000, // 2 minutes timeout
          maxBuffer: 1024 * 1024 * 5 // 5MB buffer
        })
      } catch (dockerError) {
        console.warn('Failed to stop Docker containers (they may not be running):', dockerError)
        // Continue with deletion even if Docker cleanup fails
      }
    }
    
    // Step 2: Remove project directory
    try {
      console.log(`Removing project directory: ${projectDir}`)
      const isWindows = process.platform === 'win32'
      const removeCommand = isWindows 
        ? `rmdir /s /q "${projectDir}"` 
        : `rm -rf "${projectDir}"`
      
      await execAsync(removeCommand, { timeout: 60000 })
    } catch (fsError) {
      console.warn('Failed to remove project directory:', fsError)
      // Continue with database cleanup even if filesystem cleanup fails
    }
    
    // Step 3: Clean up database records
    try {
      // Delete project environment variables
      await prisma.projectEnvVar.deleteMany({
        where: { projectId },
      })
      
      // Delete the project itself
      await prisma.project.delete({
        where: { id: projectId },
      })
    } catch (dbError) {
      console.error('Failed to clean up database records:', dbError)
      throw new Error('Failed to remove project from database')
    }
    
    console.log(`Project ${project.slug} deleted successfully`)
    return { success: true }
  } catch (error) {
    console.error('Failed to delete project:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}