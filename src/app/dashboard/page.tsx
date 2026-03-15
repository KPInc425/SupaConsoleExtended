'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type RuntimeTone = 'success' | 'warning' | 'danger' | 'neutral'
type ModeKey = 'shared_core_schema_isolated' | 'db_isolated' | 'full_stack_isolated'

interface ProjectCardView {
  id: string
  name: string
  slug: string
  description: string
  createdAt: string
  provisioningMode: ModeKey
  modeLabel: string
  topologyLabel: string
  runtimeLabel: string
  runtimeStatus: string
  runtimeTone: RuntimeTone
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

interface ProjectOptionsResponse {
  sharedTopology: {
    name: string
    defaultMode: ModeKey
    sharedPostgres: {
      ready: boolean
    }
  }
  defaultSelection: {
    label: string
    reason: string
    usedFallback: boolean
  } | null
}

function workspaceDefaultCopy(options: ProjectOptionsResponse | null): { title: string; detail: string } {
  if (!options?.defaultSelection) {
    return {
      title: 'New projects will use the current workspace default.',
      detail: 'You can still change the mode for each project from the create screen.',
    }
  }

  return {
    title: `New projects will default to ${options.defaultSelection.label.toLowerCase()}.`,
    detail: `${options.defaultSelection.reason} You can still change the mode during project creation.`,
  }
}

function toneClasses(tone: RuntimeTone): string {
  if (tone === 'success') return 'bg-emerald-100 text-emerald-800'
  if (tone === 'warning') return 'bg-amber-100 text-amber-800'
  if (tone === 'danger') return 'bg-red-100 text-red-800'
  return 'bg-slate-100 text-slate-700'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

function buildProjectLinks(project: ProjectCardView): Array<{ label: string; href: string }> {
  const ordered: Array<[string, string | undefined]> = [
    ['API', project.lastKnownUrls.api ?? project.sharedServiceUrls.api],
    ['Studio', project.lastKnownUrls.studio ?? project.sharedServiceUrls.studio],
    ['Database', project.lastKnownUrls.database ?? project.sharedServiceUrls.database],
    ['Mail', project.lastKnownUrls.mail ?? project.sharedServiceUrls.mail],
  ]

  return ordered.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, href]) => ({ label, href }))
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectCardView[]>([])
  const [loading, setLoading] = useState(true)
  const [initializing, setInitializing] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [initProgress, setInitProgress] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'deploy' | 'pause' | 'backup' | null>(null)
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null)
  const [options, setOptions] = useState<ProjectOptionsResponse | null>(null)
  const router = useRouter()

  const projectCountCopy = useMemo(() => (projects.length === 1 ? '1 project' : `${projects.length} projects`), [projects.length])
  const defaultCopy = useMemo(() => workspaceDefaultCopy(options), [options])

  const fetchProjects = useCallback(async () => {
    try {
      const response = await fetch('/api/projects')
      if (response.ok) {
        const data = await response.json()
        const nextProjects = data.projects as ProjectCardView[]
        setProjects(nextProjects)
        if (nextProjects.length > 0) {
          setInitialized(true)
        }
      } else if (response.status === 401) {
        router.push('/auth/login')
      }
    } catch {
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const response = await fetch('/api/projects/options')
        if (response.ok) {
          setOptions((await response.json()) as ProjectOptionsResponse)
        }
      } catch {
        // Keep the dashboard usable if the options call fails.
      }
    }

    const checkCli = async () => {
      try {
        const response = await fetch('/api/cli/check')
        if (response.ok) {
          const data = await response.json()
          setCliAvailable(Boolean(data.available))
        } else {
          setCliAvailable(false)
        }
      } catch {
        setCliAvailable(false)
      }
    }

    fetchOptions()
    checkCli()
  }, [])

  const handleInitialize = async () => {
    setInitializing(true)
    setError('')
    setMessage('')
    setInitProgress('Preparing workspace directories...')

    try {
      const response = await fetch('/api/projects/initialize', { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Initialization failed' }))
        setError(data.error || 'Initialization failed')
        setInitProgress('')
        return
      }

      setInitialized(true)
      setMessage('Workspace initialized. You can now create a project.')
      setInitProgress('')
    } catch {
      setError('An error occurred during initialization')
      setInitProgress('')
    } finally {
      setInitializing(false)
    }
  }

  const handleProjectAction = async (project: ProjectCardView, action: 'deploy' | 'pause' | 'backup') => {
    setBusyProjectId(project.id)
    setBusyAction(action)
    setError('')
    setMessage('')

    try {
      const endpoint = action === 'deploy' ? `/api/projects/${project.id}/deploy` : action === 'pause' ? `/api/projects/${project.id}/pause` : `/api/projects/${project.id}/backup`
      const response = await fetch(endpoint, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || `Failed to ${action} project`)
        return
      }

      setMessage(action === 'backup' ? `${project.name}: backup snapshot created${data.backupId ? ` (${data.backupId})` : ''}.` : `${project.name}: ${action === 'deploy' ? project.provisioningLabel : project.pauseLabel} completed.`)
      await fetchProjects()
    } catch {
      setError(`Failed to ${action} project`)
    } finally {
      setBusyProjectId(null)
      setBusyAction(null)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/auth/login')
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><div>Loading...</div></div>
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="SupaConsole" width={150} height={150} className="object-contain" />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => router.push('/dashboard/system')}>System Settings</Button>
            <Button variant="outline" onClick={handleLogout}>Logout</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {cliAvailable === false && (
          <div className="mb-6 rounded border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <strong>Supabase CLI not found.</strong>
                <div className="text-sm">The full-stack mode and live CLI inspection depend on the Supabase CLI being available on this host.</div>
              </div>
              <a className="text-sm text-blue-600" href="https://supabase.com/docs/guides/cli" target="_blank" rel="noreferrer">Docs</a>
            </div>
          </div>
        )}

        {error && <div className="mb-6 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">{error}</div>}
        {message && <div className="mb-6 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">{message}</div>}

        {options && (initialized || projects.length > 0) && (
          <Card className="mb-6" data-testid="workspace-default-card">
            <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Current default for new projects</div>
                <div className="text-lg font-semibold">{options.defaultSelection?.label ?? 'Unknown'}</div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{defaultCopy.detail}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
                <div>Shared modes: <span className="font-medium">{options.sharedTopology.sharedPostgres.ready ? 'configured' : 'not configured yet'}</span></div>
                <div className="text-muted-foreground">Configure shared infrastructure later in System Settings if you want schema or dedicated-database projects.</div>
              </div>
            </CardContent>
          </Card>
        )}

        {!initialized && projects.length === 0 ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Welcome to SupaConsole</CardTitle>
                <CardDescription>Initialize the workspace to prepare the control-plane folders before you create projects.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 rounded-lg border border-border bg-muted/20 p-4 text-left text-sm" data-testid="startup-default-note">
                  <div className="font-medium">{defaultCopy.title}</div>
                  <p className="mt-2 text-muted-foreground">{defaultCopy.detail}</p>
                  {!options?.sharedTopology.sharedPostgres.ready && (
                    <p className="mt-2 text-muted-foreground">Shared-core and dedicated-database modes stay hidden until you configure shared services in System Settings.</p>
                  )}
                </div>
                {initProgress && <div className="mb-4 text-sm text-blue-600">{initProgress}</div>}
                <Button onClick={handleInitialize} disabled={initializing} className="w-full">{initializing ? 'Initializing...' : 'Initialize Workspace'}</Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">This ensures `supabase-projects/` and the reference `supabase-core/` folder exist. It does not migrate existing projects.</p>
                <Button variant="ghost" className="mt-3 w-full" onClick={() => router.push('/dashboard/system')}>Review shared-mode settings</Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div>
            <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-3xl font-bold">Projects</h2>
                <p className="text-muted-foreground">{projectCountCopy}. Each card shows provisioning mode, topology, runtime status, and backup visibility.</p>
              </div>
              <Button onClick={() => router.push('/dashboard/create-project')} data-testid="new-project-button">New Project</Button>
            </div>

            {projects.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <h3 className="mb-2 text-lg font-medium">No projects yet</h3>
                  <p className="mb-4 text-muted-foreground">Create your first project to test the Phase 5 mode-aware flow.</p>
                  <Button onClick={() => router.push('/dashboard/create-project')}>Create Project</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => {
                  const projectLinks = buildProjectLinks(project)
                  const isBusy = busyProjectId === project.id

                  return (
                    <Card key={project.id} className="transition-shadow hover:shadow-lg" data-testid={`project-card-${project.slug}`}>
                      <CardHeader className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-lg">{project.name}</CardTitle>
                            <CardDescription className="mt-1">{project.description || 'No description provided.'}</CardDescription>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${toneClasses(project.runtimeTone)}`}>{project.runtimeStatus}</span>
                        </div>

                        <div className="grid gap-2 text-sm text-muted-foreground">
                          <div>Mode: <span className="font-medium text-foreground">{project.modeLabel}</span></div>
                          <div>Topology: <span className="font-medium text-foreground">{project.topologyLabel}</span></div>
                          <div>Runtime: <span className="font-medium text-foreground">{project.runtimeLabel}</span></div>
                          <div>Created: <span className="font-medium text-foreground">{formatDate(project.createdAt)}</span></div>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                          <div className="font-medium">Runtime summary</div>
                          <p className="mt-2 text-muted-foreground">{project.runtimeSummary}</p>
                          {project.selectorReason && <p className="mt-2 text-xs text-muted-foreground">Decision: {project.selectorReason}</p>}
                          {project.legacyFullStack && <p className="mt-2 text-xs text-amber-700">Compatibility-managed full-stack project. No automatic migration has been applied.</p>}
                        </div>

                        <div className="grid gap-2 rounded-lg border border-border p-3 text-sm">
                          <div className="font-medium">Mode-relevant info</div>
                          {project.tenantSchema && <div>Tenant schema: <span className="font-medium">{project.tenantSchema}</span></div>}
                          {project.tenantDatabase && <div>Tenant database: <span className="font-medium">{project.tenantDatabase}</span></div>}
                          {project.sharedTopologyName && <div>Shared topology: <span className="font-medium">{project.sharedTopologyName}</span></div>}
                          <div>Backup support: <span className="font-medium">{project.backupAvailable ? 'available' : 'not available'}</span></div>
                          <div>Restore readiness: <span className="font-medium">{project.restoreAvailable ? `${project.backupCount} backup(s)` : 'no backups yet'}</span></div>
                        </div>

                        <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
                          <div className="font-medium">Visible endpoints</div>
                          {projectLinks.length > 0 ? (
                            projectLinks.map((link) => (
                              <div key={link.label} className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">{link.label}</span>
                                <a href={link.href} target="_blank" rel="noreferrer" className="truncate font-mono text-blue-600 hover:text-blue-800">{link.href}</a>
                              </div>
                            ))
                          ) : (
                            <div className="text-muted-foreground">No known endpoints have been reported yet.</div>
                          )}
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          <Button variant="outline" onClick={() => router.push(`/dashboard/projects/${project.id}/configure`)}>Configure</Button>
                          <Button variant={project.runtimeStatus === 'active' ? 'outline' : 'default'} onClick={() => handleProjectAction(project, project.runtimeStatus === 'active' ? 'pause' : 'deploy')} disabled={isBusy}>
                            {isBusy && busyAction !== 'backup' ? 'Working...' : project.runtimeStatus === 'active' ? project.pauseLabel : project.provisioningLabel}
                          </Button>
                          <Button variant="outline" onClick={() => handleProjectAction(project, 'backup')} disabled={isBusy}>{isBusy && busyAction === 'backup' ? 'Creating backup...' : project.backupLabel}</Button>
                          <Button variant="outline" onClick={() => router.push(`/dashboard/projects/${project.id}/configure`)}>{project.restoreAvailable ? project.restoreLabel : 'View details'}</Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
