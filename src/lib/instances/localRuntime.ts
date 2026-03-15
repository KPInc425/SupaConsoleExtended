import { exec } from 'child_process'
import { promisify } from 'util'
import { rewriteLoopbackSshUriForContainer } from '../containerHost'
import { ensureKnownHostForDockerHost, getDockerSshCommand } from '../sshKnownHosts'
import { ensurePodmanDockerApiOnWindows } from '../podmanDockerApi'
import { disableSupabaseAnalytics } from '../supabaseConfig'

const execAsync = promisify(exec)

export interface DockerPrerequisiteCheck {
  docker: boolean
  dockerCompose: boolean
  internetConnection: boolean
}

export async function checkDockerPrerequisites(): Promise<DockerPrerequisiteCheck> {
  const checks: DockerPrerequisiteCheck = {
    docker: false,
    dockerCompose: false,
    internetConnection: false,
  }

  try {
    await execAsync('docker --version')
    checks.docker = true
  } catch {
    // Docker not available.
  }

  try {
    await execAsync('docker compose version')
    checks.dockerCompose = true
  } catch {
    // Docker Compose not available.
  }

  checks.internetConnection = await checkInternetConnectivity()

  return checks
}

async function checkInternetConnectivity(): Promise<boolean> {
  const httpEndpoints = ['https://www.google.com', 'https://1.1.1.1', 'https://8.8.8.8']

  for (const endpoint of httpEndpoints) {
    try {
      await execAsync(`curl -s --max-time 10 --head ${endpoint}`, { timeout: 15000 })
      return true
    } catch {
      // Try the next probe.
    }
  }

  try {
    await execAsync('nslookup google.com', { timeout: 10000 })
    return true
  } catch {
    // Ignore lookup failures.
  }

  try {
    const pingCommand = process.platform === 'win32' ? 'ping -n 1 8.8.8.8' : 'ping -c 1 8.8.8.8'
    await execAsync(pingCommand, { timeout: 10000 })
    return true
  } catch {
    // Ignore ping failures.
  }

  try {
    await execAsync('docker pull alpine:latest', {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5,
    })
    return true
  } catch {
    return false
  }
}

export async function resolveContainerRuntimeEnv(
  projectRoot: string,
  composeProjectName: string,
): Promise<Record<string, string>> {
  const runtimeEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    COMPOSE_PROJECT_NAME: composeProjectName,
  }

  try {
    await execAsync('docker info', { timeout: 2000 })
    return runtimeEnv
  } catch {
    // Fall through to Podman detection.
  }

  try {
    const connOutput = await execAsync('podman system connection list --format json', { timeout: 2000 })
    const parsed = JSON.parse(String(connOutput.stdout || '[]')) as Array<Record<string, unknown>>
    const connections = parsed.map((connection) => ({
      URI: typeof connection.URI === 'string' ? String(connection.URI) : undefined,
      Identity: typeof connection.Identity === 'string' ? String(connection.Identity) : undefined,
      Default: typeof connection.Default === 'boolean' ? connection.Default : false,
    }))

    const selected = connections.find((connection) => connection.Default) || connections[0]
    let dockerHostEnv = selected?.URI || ''
    const dockerSshIdentity = selected?.Identity

    if (dockerHostEnv) {
      const rewritten = await rewriteLoopbackSshUriForContainer(dockerHostEnv)
      if (rewritten.changed) {
        dockerHostEnv = rewritten.uri
      }
    }

    if (process.platform === 'win32' && dockerHostEnv.startsWith('ssh://')) {
      const ensured = await ensurePodmanDockerApiOnWindows(
        { uri: dockerHostEnv, identityFile: dockerSshIdentity },
        23751,
      )
      runtimeEnv.DOCKER_HOST = ensured.dockerHost

      try {
        await disableSupabaseAnalytics(projectRoot)
      } catch {
        // Ignore analytics patch failures when setting up Podman compatibility.
      }

      return runtimeEnv
    }

    if (dockerHostEnv) {
      runtimeEnv.DOCKER_HOST = dockerHostEnv
      if (dockerHostEnv.startsWith('ssh://')) {
        ensureKnownHostForDockerHost(dockerHostEnv)
        runtimeEnv.DOCKER_SSH_COMMAND = getDockerSshCommand(dockerSshIdentity)
      }
    }
  } catch {
    // Podman not configured; keep the default environment.
  }

  return runtimeEnv
}