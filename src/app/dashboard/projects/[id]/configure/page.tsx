'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import SecretInput from '@/components/ui/secret-input'
import { Label } from '@/components/ui/label'

interface ConfigureProjectPageProps {
  params: Promise<{ id: string }>
}

interface ProjectSummary {
  id: string
  name: string
  slug: string
  description: string
  provisioningMode: 'shared_core_schema_isolated' | 'db_isolated' | 'full_stack_isolated'
  modeLabel: string
  topologyLabel: string
  runtimeLabel: string
  runtimeStatus: string
  runtimeSummary: string
  provisioningLabel: string
  pauseLabel: string
  backupLabel: string
  restoreLabel: string
  selectorReason?: string
  legacyFullStack: boolean
  tenantSchema?: string
  tenantDatabase?: string
  sharedTopologyName?: string
  sharedServiceUrls: Partial<Record<'api' | 'studio' | 'database' | 'auth' | 'storage' | 'realtime' | 'mail', string>>
  lastKnownUrls: Partial<Record<'api' | 'studio' | 'database' | 'mail', string>>
  backupAvailable: boolean
  restoreAvailable: boolean
  backupCount: number
}

interface BackupRecord {
  backupId: string
  createdAt: string
  backupDirectory: string
  manifest: {
    backupKind: string
    warnings: string[]
  }
}

interface DetailResponse {
  project: ProjectSummary
  backups: BackupRecord[]
  health: {
    checks: Array<{
      name: string
      status: 'ready' | 'warning' | 'error'
      detail: string
    }>
  }
}

type RuntimePayload = Record<string, string>

function isSensitiveKey(key: string): boolean {
  return /(SECRET|PASSWORD|TOKEN|KEY|PASS)/i.test(key)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function buildRuntimeEntries(project: ProjectSummary, runtimeStatus: RuntimePayload | null) {
  const runtime = runtimeStatus ?? {}
  const shared = project.sharedServiceUrls
  const lastKnown = project.lastKnownUrls

  return [
    { label: 'API', value: runtime.API_URL ?? lastKnown.api ?? shared.api },
    { label: 'Studio', value: runtime.STUDIO_URL ?? lastKnown.studio ?? shared.studio },
    { label: 'Database', value: runtime.DB_URL ?? lastKnown.database ?? shared.database },
    { label: 'Storage', value: runtime.STORAGE_URL ?? shared.storage },
    { label: 'Auth', value: shared.auth },
    { label: 'Realtime', value: shared.realtime },
    { label: 'Mail', value: runtime.INBUCKET_URL ?? runtime.MAILPIT_URL ?? lastKnown.mail ?? shared.mail },
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry.value))
}

function relevantKeysForMode(mode: ProjectSummary['provisioningMode']): string[] {
  if (mode === 'shared_core_schema_isolated') {
    return ['TENANT_SCHEMA', 'DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_DB', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY']
  }
  if (mode === 'db_isolated') {
    return ['TENANT_DATABASE_NAME', 'DATABASE_URL', 'POSTGRES_HOST', 'POSTGRES_DB', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY']
  }
  return ['KONG_HTTP_PORT', 'STUDIO_PORT', 'POSTGRES_PORT', 'INBUCKET_WEB_PORT', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY']
}

export default function ConfigureProjectPage({ params }: ConfigureProjectPageProps) {
  const [projectId, setProjectId] = useState('')
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [healthChecks, setHealthChecks] = useState<DetailResponse['health']['checks']>([])
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimePayload | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [systemChecks, setSystemChecks] = useState<{ docker: boolean; dockerCompose: boolean; dockerRunning: boolean; internetConnection: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<'deploy' | 'pause' | 'backup' | 'restore' | 'delete' | null>(null)
  const [checkingSystem, setCheckingSystem] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const router = useRouter()

  const relevantKeys = useMemo(() => (project ? relevantKeysForMode(project.provisioningMode) : []), [project])
  const orderedEnvEntries = useMemo(() => {
    const entries = Object.entries(envVars)
    return entries.sort(([left], [right]) => {
      const leftIndex = relevantKeys.indexOf(left)
      const rightIndex = relevantKeys.indexOf(right)
      if (leftIndex >= 0 || rightIndex >= 0) {
        if (leftIndex === -1) return 1
        if (rightIndex === -1) return -1
        return leftIndex - rightIndex
      }
      return left.localeCompare(right)
    })
  }, [envVars, relevantKeys])

  const runtimeEntries = useMemo(() => (project ? buildRuntimeEntries(project, runtimeStatus) : []), [project, runtimeStatus])

  const loadProjectDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/projects/${id}`)
    if (!response.ok) {
      throw new Error('Failed to load project details')
    }

    const data = (await response.json()) as DetailResponse
    setProject(data.project)
    setBackups(data.backups)
    setHealthChecks(data.health.checks)
  }, [])

  const loadEnvVars = useCallback(async (id: string) => {
    const response = await fetch(`/api/projects/${id}/env`)
    if (!response.ok) {
      throw new Error('Failed to load environment variables')
    }

    const data = await response.json()
    setEnvVars(data.envVars as Record<string, string>)
  }, [])

  const fetchRuntimeStatus = useCallback(async (id = projectId) => {
    if (!id) return

    setStatusLoading(true)
    try {
      const response = await fetch(`/api/projects/${id}/status`)
      if (!response.ok) {
        setRuntimeStatus(null)
        return
      }

      const data = await response.json()
      setRuntimeStatus((data.status ?? null) as RuntimePayload | null)
    } catch {
      setRuntimeStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    params.then(({ id }) => setProjectId(id))
  }, [params])

  useEffect(() => {
    if (!projectId) return

    const load = async () => {
      try {
        setError('')
        await Promise.all([loadProjectDetail(projectId), loadEnvVars(projectId), fetchRuntimeStatus(projectId)])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load project data')
      }
    }

    load()
  }, [fetchRuntimeStatus, loadEnvVars, loadProjectDetail, projectId])

  const generateSecureKey = (length: number) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let index = 0; index < length; index += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const handleGenerateSecrets = () => {
    setEnvVars((current) => ({
      ...current,
      POSTGRES_PASSWORD: generateSecureKey(32),
      JWT_SECRET: generateSecureKey(40),
      ANON_KEY: generateSecureKey(64),
      SERVICE_ROLE_KEY: generateSecureKey(64),
      DASHBOARD_PASSWORD: generateSecureKey(16),
      SECRET_KEY_BASE: generateSecureKey(64),
      VAULT_ENC_KEY: generateSecureKey(32),
      LOGFLARE_PUBLIC_ACCESS_TOKEN: generateSecureKey(64),
      LOGFLARE_PRIVATE_ACCESS_TOKEN: generateSecureKey(64),
    }))
  }

  const handleEnvChange = (key: string, value: string) => {
    setEnvVars((current) => ({ ...current, [key]: value }))
  }

  const handleSaveConfiguration = async () => {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/projects/${projectId}/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envVars),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Failed to save configuration' }))
        setError(data.error || 'Failed to save configuration')
        return
      }

      setSuccess('Configuration saved successfully.')
    } catch {
      setError('An error occurred while saving configuration.')
    } finally {
      setLoading(false)
    }
  }

  const handleLifecycleAction = async (action: 'deploy' | 'pause' | 'backup' | 'restore' | 'delete', backupId?: string) => {
    if (!projectId) return

    setActionLoading(action)
    setError('')
    setSuccess('')

    try {
      const endpoint = action === 'deploy' ? `/api/projects/${projectId}/deploy` : action === 'pause' ? `/api/projects/${projectId}/pause` : action === 'backup' ? `/api/projects/${projectId}/backup` : action === 'restore' ? `/api/projects/${projectId}/restore` : `/api/projects/${projectId}`
      const response = await fetch(endpoint, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: action === 'restore' ? { 'Content-Type': 'application/json' } : undefined,
        body: action === 'restore' ? JSON.stringify(backupId ? { backupId } : {}) : undefined,
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || `Failed to ${action} project`)
        return
      }

      if (action === 'delete') {
        router.push('/dashboard')
        return
      }

      setSuccess(action === 'deploy' ? `${project?.provisioningLabel ?? 'Deploy'} completed.` : action === 'pause' ? `${project?.pauseLabel ?? 'Pause'} completed.` : action === 'backup' ? `Backup created${data.backupId ? ` (${data.backupId})` : ''}.` : `Restore completed${data.restoredFrom ? ` from ${data.restoredFrom}` : ''}.`)
      await Promise.all([loadProjectDetail(projectId), fetchRuntimeStatus(projectId)])
    } catch {
      setError(`Failed to ${action} project`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleSystemCheck = async () => {
    setCheckingSystem(true)
    setError('')
    try {
      const response = await fetch('/api/system/check')
      if (!response.ok) {
        setError('Failed to check system prerequisites')
        return
      }

      const data = await response.json()
      setSystemChecks(data.checks)
    } catch {
      setError('Failed to check system prerequisites')
    } finally {
      setCheckingSystem(false)
    }
  }

  if (!project) {
    return <div className="flex min-h-screen items-center justify-center"><div>Loading project...</div></div>
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="SupaConsole" width={150} height={150} className="object-contain" />
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/system"><Button variant="outline">System Settings</Button></Link>
            <Link href="/dashboard"><Button variant="outline">Back to Dashboard</Button></Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <h2 className="text-3xl font-bold" data-testid="configure-project-title">{project.name}</h2>
            <p className="mt-2 text-muted-foreground">{project.description || 'Review this project, update its saved settings, and run deploy, pause, backup, or restore actions when you are ready.'}</p>
          </div>

          {success && <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">{success}</div>}
          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">{error}</div>}

          <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
            <Card data-testid="project-summary-card">
              <CardHeader>
                <CardTitle>Project Setup</CardTitle>
                <CardDescription>This shows how the project is currently configured. Nothing changes until you run an action or save updated settings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border p-3"><div className="text-sm text-muted-foreground">Mode</div><div className="font-medium">{project.modeLabel}</div></div>
                  <div className="rounded-lg border border-border p-3"><div className="text-sm text-muted-foreground">Topology</div><div className="font-medium">{project.topologyLabel}</div></div>
                  <div className="rounded-lg border border-border p-3"><div className="text-sm text-muted-foreground">Runtime</div><div className="font-medium">{project.runtimeLabel}</div></div>
                  <div className="rounded-lg border border-border p-3"><div className="text-sm text-muted-foreground">Runtime status</div><div className="font-medium">{project.runtimeStatus}</div></div>
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm">
                  <div className="font-medium">Why this setup</div>
                  <p className="mt-2 text-muted-foreground">{project.selectorReason ?? project.runtimeSummary}</p>
                  {project.legacyFullStack && <p className="mt-2 text-amber-700">This is an existing full-stack project. Shared setup changes elsewhere do not migrate it automatically.</p>}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {project.sharedTopologyName && <div className="rounded-lg border border-border p-3 text-sm"><div className="text-muted-foreground">Shared topology</div><div className="font-medium">{project.sharedTopologyName}</div></div>}
                  {project.tenantSchema && <div className="rounded-lg border border-border p-3 text-sm"><div className="text-muted-foreground">Tenant schema</div><div className="font-medium">{project.tenantSchema}</div></div>}
                  {project.tenantDatabase && <div className="rounded-lg border border-border p-3 text-sm"><div className="text-muted-foreground">Tenant database</div><div className="font-medium">{project.tenantDatabase}</div></div>}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="lifecycle-actions-card">
              <CardHeader>
                <CardTitle>Project Actions</CardTitle>
                <CardDescription>Use these when you want to deploy, pause, back up, restore, or delete this project. The labels adapt to the project mode.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" onClick={() => handleLifecycleAction('deploy')} disabled={actionLoading !== null}>{actionLoading === 'deploy' ? 'Working...' : project.provisioningLabel}</Button>
                <Button className="w-full" variant="outline" onClick={() => handleLifecycleAction('pause')} disabled={actionLoading !== null}>{actionLoading === 'pause' ? 'Working...' : project.pauseLabel}</Button>
                <Button className="w-full" variant="outline" onClick={() => handleLifecycleAction('backup')} disabled={actionLoading !== null}>{actionLoading === 'backup' ? 'Working...' : project.backupLabel}</Button>
                <Button className="w-full" variant="outline" onClick={() => handleLifecycleAction('restore', backups[0]?.backupId)} disabled={actionLoading !== null || backups.length === 0}>{actionLoading === 'restore' ? 'Working...' : backups.length > 0 ? `${project.restoreLabel} (${backups[0].backupId})` : 'No backup to restore'}</Button>
                <Button className="w-full" variant="destructive" onClick={() => handleLifecycleAction('delete')} disabled={actionLoading !== null}>{actionLoading === 'delete' ? 'Deleting...' : 'Delete project'}</Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
            <Card data-testid="runtime-info-card">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Connections</CardTitle>
                    <CardDescription>Use these links after deployment. When live status is unavailable, SupaConsole shows the last known or shared endpoints instead.</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => fetchRuntimeStatus()}>{statusLoading ? 'Refreshing...' : 'Refresh'}</Button>
                </div>
              </CardHeader>
              <CardContent>
                {runtimeEntries.length > 0 ? (
                  <div className="space-y-3">
                    {runtimeEntries.map((entry) => (
                      <div key={entry.label} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3 text-sm">
                        <div className="font-medium">{entry.label}</div>
                        <div className="flex items-center gap-3">
                          <a href={entry.value} target="_blank" rel="noreferrer" className="max-w-[28rem] truncate font-mono text-blue-600 hover:text-blue-800">{entry.value}</a>
                          <button onClick={async () => navigator.clipboard.writeText(entry.value)} className="text-xs text-muted-foreground hover:text-foreground">Copy</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No runtime endpoints are currently available. Deploy the project or refresh the runtime status.</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="health-backup-card">
              <CardHeader>
                <CardTitle>Checks And Backups</CardTitle>
                <CardDescription>See the current checks for this project and restore from a known backup when one is available.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  {healthChecks.map((check) => (
                    <div key={check.name} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{check.name}</div>
                        <span className={`rounded-full px-2 py-1 text-xs ${check.status === 'ready' ? 'bg-emerald-100 text-emerald-800' : check.status === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{check.status}</span>
                      </div>
                      <p className="mt-2 text-muted-foreground">{check.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-border p-3 text-sm">
                  <div className="mb-2 font-medium">Known backups</div>
                  {backups.length > 0 ? (
                    <div className="space-y-2">
                      {backups.slice(0, 5).map((backup) => (
                        <div key={backup.backupId} className="rounded border border-border bg-muted/20 p-3">
                          <div className="font-medium">{backup.backupId}</div>
                          <div className="text-muted-foreground">{formatDate(backup.createdAt)} · {backup.manifest.backupKind}</div>
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => handleLifecycleAction('restore', backup.backupId)} disabled={actionLoading !== null}>Restore this backup</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No backups captured yet.</div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Saved Settings</CardTitle>
                  <CardDescription>Mode-relevant values are shown first, and you can still edit the full stored environment below if needed.</CardDescription>
                </div>
                <Button variant="outline" type="button" onClick={handleGenerateSecrets}>Generate secure secrets</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-700">Review the key settings, save when you are ready, then run deploy or backup separately. Saving settings does not automatically deploy the project.</div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {relevantKeys.filter((key) => key in envVars).map((key) => (
                  <div key={key} className="space-y-2 rounded-lg border border-border p-4" data-testid={`relevant-env-${key}`}>
                    <Label htmlFor={`focus-${key}`}>{key}</Label>
                    {isSensitiveKey(key) ? <SecretInput id={`focus-${key}`} value={envVars[key] ?? ''} onChange={(event) => handleEnvChange(key, event.target.value)} /> : <Input id={`focus-${key}`} value={envVars[key] ?? ''} onChange={(event) => handleEnvChange(key, event.target.value)} />}
                  </div>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {orderedEnvEntries.map(([key, value]) => (
                  <div key={key} className="space-y-2 rounded-lg border border-border p-4">
                    <Label htmlFor={key}>{key}</Label>
                    {isSensitiveKey(key) ? <SecretInput id={key} value={value} onChange={(event) => handleEnvChange(key, event.target.value)} /> : <Input id={key} value={value} onChange={(event) => handleEnvChange(key, event.target.value)} />}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={handleSaveConfiguration} disabled={loading} data-testid="save-config-button">{loading ? 'Saving...' : 'Save configuration'}</Button>
                <Button variant="outline" onClick={handleSystemCheck} disabled={checkingSystem}>{checkingSystem ? 'Checking...' : 'Run system check'}</Button>
              </div>

              {systemChecks && (
                <div className="grid gap-3 rounded-lg border border-border p-4 text-sm md:grid-cols-2">
                  <div>Docker installed: <span className="font-medium">{String(systemChecks.docker)}</span></div>
                  <div>Docker Compose: <span className="font-medium">{String(systemChecks.dockerCompose)}</span></div>
                  <div>Docker running: <span className="font-medium">{String(systemChecks.dockerRunning)}</span></div>
                  <div>Internet connection: <span className="font-medium">{String(systemChecks.internetConnection)}</span></div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
