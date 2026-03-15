export async function rewriteLoopbackSshUriForContainer(uri: string): Promise<{ changed: boolean; uri: string }> {
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'ssh:') {
      return { changed: false, uri }
    }

    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
      return { changed: false, uri }
    }

    parsed.hostname = 'host.containers.internal'
    return { changed: true, uri: parsed.toString() }
  } catch {
    return { changed: false, uri }
  }
}