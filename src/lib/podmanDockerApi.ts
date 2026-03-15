interface PodmanDockerApiOptions {
  uri: string
  identityFile?: string
}

interface PodmanDockerApiResult {
  dockerHost: string
  message?: string
}

export async function ensurePodmanDockerApiOnWindows(
  options: PodmanDockerApiOptions,
  _unusedPort: number,
): Promise<PodmanDockerApiResult> {
  return {
    dockerHost: options.uri,
    message: options.identityFile
      ? `Using Podman connection ${options.uri} with identity file on port ${_unusedPort}.`
      : `Using Podman connection ${options.uri} on port ${_unusedPort}.`,
  }
}