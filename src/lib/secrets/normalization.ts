export function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {}

  for (const line of text.split(/\r?\n/)) {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex > 0) {
      env[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1)
    }
  }

  return env
}

export function serializeEnvObject(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function applyProjectEnvAliases(env: Record<string, string>): Record<string, string> {
  if (!env.SITE_URL) {
    return { ...env }
  }

  return {
    ...env,
    SUPABASE_PUBLIC_URL: env.SUPABASE_PUBLIC_URL ?? env.SITE_URL,
    SUPABASE_SITE_URL: env.SUPABASE_SITE_URL ?? env.SITE_URL,
  }
}