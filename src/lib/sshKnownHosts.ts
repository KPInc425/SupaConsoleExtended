export function ensureKnownHostForDockerHost(dockerHost: string): { ok: boolean; message: string } {
  try {
    const parsed = new URL(dockerHost)
    if (parsed.protocol !== 'ssh:') {
      return { ok: true, message: 'No SSH known_hosts update required.' }
    }

    return { ok: true, message: `Using SSH host ${parsed.hostname}.` }
  } catch {
    return { ok: false, message: 'Invalid DOCKER_HOST value.' }
  }
}

export function getDockerSshCommand(identityFile?: string): string {
  if (!identityFile) {
    return 'ssh'
  }

  return `ssh -i "${identityFile}"`
}