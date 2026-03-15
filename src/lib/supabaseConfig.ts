import { promises as fs } from 'fs'
import path from 'path'

export async function disableSupabaseAnalytics(projectRoot: string): Promise<boolean> {
  const configPath = path.join(projectRoot, 'supabase', 'config.toml')

  try {
    const current = await fs.readFile(configPath, 'utf8')
    if (/\[analytics\][\s\S]*enabled\s*=\s*false/m.test(current)) {
      return false
    }

    if (/\[analytics\]/m.test(current)) {
      const updated = current.replace(/(\[analytics\][\s\S]*?)(\n\[|$)/m, (match, section, suffix) => {
        if (/enabled\s*=\s*(true|false)/.test(section)) {
          return `${section.replace(/enabled\s*=\s*(true|false)/, 'enabled = false')}${suffix}`
        }

        return `${section.trimEnd()}\nenabled = false${suffix}`
      })
      await fs.writeFile(configPath, updated, 'utf8')
      return true
    }

    await fs.writeFile(configPath, `${current.trimEnd()}\n\n[analytics]\nenabled = false\n`, 'utf8')
    return true
  } catch {
    return false
  }
}