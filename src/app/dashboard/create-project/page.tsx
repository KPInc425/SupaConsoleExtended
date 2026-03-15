'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type SelectionStrategy = 'default' | 'guided' | 'explicit'
type GuidedPath = 'schema' | 'database' | 'full-stack'
type ModeKey = 'shared_core_schema_isolated' | 'db_isolated' | 'full_stack_isolated'

interface ModeOption {
  key: ModeKey
  label: string
  shortDescription: string
  topologyLabel: string
  runtimeLabel: string
  isolationLabel: string
  availabilityLabel: string
  available: boolean
  recommended: boolean
}

interface OptionsResponse {
  sharedTopology: {
    name: string
    defaultMode: ModeKey
    sharedPostgres: {
      ready: boolean
    }
  }
  health: {
    status: 'ready' | 'degraded'
  }
  modeOptions: ModeOption[]
  defaultSelection: {
    mode: ModeKey
    label: string
    topology: string
    runtimeKind: string
    reason: string
    usedFallback: boolean
  } | null
}

const GUIDED_SELECTION_LABELS: Record<GuidedPath, string> = {
  schema: 'Shared core with schema isolation',
  database: 'Shared services with a dedicated database',
  'full-stack': 'Fully isolated local stack',
}

export default function CreateProjectPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [error, setError] = useState('')
  const [options, setOptions] = useState<OptionsResponse | null>(null)
  const [selectionStrategy, setSelectionStrategy] = useState<SelectionStrategy>('default')
  const [guidedPath, setGuidedPath] = useState<GuidedPath>('schema')
  const [explicitMode, setExplicitMode] = useState<ModeKey>('full_stack_isolated')
  const [showUnavailableModes, setShowUnavailableModes] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const response = await fetch('/api/projects/options')
        if (response.ok) {
          const data = (await response.json()) as OptionsResponse
          setOptions(data)
          setExplicitMode(data.defaultSelection?.mode ?? 'full_stack_isolated')
        } else if (response.status === 401) {
          router.push('/auth/login')
          return
        } else {
          setError('Failed to load provisioning options')
        }
      } catch {
        setError('Failed to load provisioning options')
      } finally {
        setOptionsLoading(false)
      }
    }

    loadOptions()
  }, [router])

  const sharedTopologyReady = options?.sharedTopology.sharedPostgres.ready ?? false
  const availableModeOptions = useMemo(() => options?.modeOptions.filter((option) => option.available) ?? [], [options])
  const unavailableModeOptions = useMemo(() => options?.modeOptions.filter((option) => !option.available) ?? [], [options])
  const guidedOptions = useMemo<GuidedPath[]>(() => (sharedTopologyReady ? ['schema', 'database', 'full-stack'] : ['full-stack']), [sharedTopologyReady])

  useEffect(() => {
    if (!sharedTopologyReady && guidedPath !== 'full-stack') {
      setGuidedPath('full-stack')
    }
  }, [guidedPath, sharedTopologyReady])

  useEffect(() => {
    if (!options) {
      return
    }

    const stillAvailable = options.modeOptions.some((option) => option.key === explicitMode && option.available)
    if (!stillAvailable) {
      setExplicitMode(options.defaultSelection?.mode ?? 'full_stack_isolated')
    }
  }, [explicitMode, options])

  const selectedMode = useMemo(() => {
    if (!options) {
      return null
    }

    if (selectionStrategy === 'default') {
      return options.defaultSelection
        ? options.modeOptions.find((option) => option.key === options.defaultSelection?.mode) ?? null
        : null
    }

    if (selectionStrategy === 'guided') {
      const guidedMode: ModeKey = guidedPath === 'schema'
        ? 'shared_core_schema_isolated'
        : guidedPath === 'database'
          ? 'db_isolated'
          : 'full_stack_isolated'

      return options.modeOptions.find((option) => option.key === guidedMode) ?? null
    }

    return options.modeOptions.find((option) => option.key === explicitMode) ?? null
  }, [explicitMode, guidedPath, options, selectionStrategy])

  const previewReason = useMemo(() => {
    if (!options || !selectedMode) {
      return ''
    }

    if (selectionStrategy === 'default') {
      return options.defaultSelection?.reason ?? 'The workspace default will be used.'
    }

    if (selectionStrategy === 'guided') {
      if (guidedPath === 'schema') {
        return 'Choose this when shared services are acceptable and you only need schema-level data isolation.'
      }
      if (guidedPath === 'database') {
        return 'Choose this when you want a dedicated tenant database without duplicating all Supabase services.'
      }
      return 'Choose this when you need service-level isolation or a fully self-contained local stack.'
    }

    return `This project will be created explicitly as ${selectedMode.label.toLowerCase()}.`
  }, [guidedPath, options, selectedMode, selectionStrategy])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    if (!name.trim()) {
      setError('Project name is required')
      setLoading(false)
      return
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim(),
    }

    if (selectionStrategy === 'guided') {
      payload.selection = guidedPath === 'schema'
        ? { isolationBoundary: 'schema', preferSharedTopology: true }
        : guidedPath === 'database'
          ? { isolationBoundary: 'database', requireDedicatedDatabase: true }
          : { requireFullStackServices: true }
    }

    if (selectionStrategy === 'explicit' && selectedMode) {
      payload.mode = selectedMode.key
    }

    try {
      const createResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!createResponse.ok) {
        const data = await createResponse.json().catch(() => ({ error: 'Failed to create project' }))
        setError(data.error || 'Failed to create project')
        setLoading(false)
        return
      }

      const projectData = await createResponse.json()
      router.push(`/dashboard/projects/${projectData.project.id}/configure`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="SupaConsole" width={150} height={150} className="object-contain" />
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/system">
              <Button variant="outline">System Settings</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h2 className="text-3xl font-bold">Create New Project</h2>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Start simple and only open advanced choices when you need them. Shared modes stay configurable from inside the app and appear once shared infrastructure is set up.
            </p>
          </div>

          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">{error}</div>}

          <div className="grid gap-6 lg:grid-cols-[1.3fr,0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Project Details</CardTitle>
                <CardDescription>Existing full-stack projects remain unchanged. This only affects how the new project is provisioned.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Project Name *</Label>
                    <Input id="name" data-testid="project-name-input" type="text" placeholder="Enter project name" value={name} onChange={(event) => setName(event.target.value)} required disabled={loading} />
                    <p className="text-sm text-muted-foreground">The slug and workspace paths are generated automatically.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Input id="description" data-testid="project-description-input" type="text" placeholder="Brief description of your project" value={description} onChange={(event) => setDescription(event.target.value)} disabled={loading} />
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label className="text-base">Provisioning Choice</Label>
                      <p className="mt-1 text-sm text-muted-foreground">Use the system default, answer a simple isolation question, or open advanced mode selection.</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        { key: 'default', title: 'Simple default', description: 'Use the current workspace default and keep the flow fast.' },
                        { key: 'guided', title: 'Guided choice', description: 'Pick the isolation shape and let SupaConsole map it to a mode.' },
                        { key: 'explicit', title: 'Explicit mode', description: 'Choose the exact provisioning mode and topology contract up front.' },
                      ].map((option) => (
                        <button key={option.key} type="button" data-testid={`selection-strategy-${option.key}`} className={`rounded-lg border p-4 text-left transition ${selectionStrategy === option.key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`} onClick={() => setSelectionStrategy(option.key as SelectionStrategy)}>
                          <div className="font-medium">{option.title}</div>
                          <div className="mt-2 text-sm text-muted-foreground">{option.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectionStrategy === 'guided' && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4" data-testid="guided-mode-panel">
                      <div className="text-sm font-medium">Isolation goal</div>
                      <div className="grid gap-3 md:grid-cols-3">
                        {guidedOptions.map((option) => (
                          <button key={option} type="button" data-testid={`guided-path-${option}`} className={`rounded-lg border p-3 text-left transition ${guidedPath === option ? 'border-primary bg-background' : 'border-border hover:border-primary/40'}`} onClick={() => setGuidedPath(option)}>
                            <div className="font-medium">{GUIDED_SELECTION_LABELS[option]}</div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              {option === 'schema'
                                ? 'Lightest isolation with shared Postgres and shared services.'
                                : option === 'database'
                                  ? 'Separate database assets while reusing the shared control plane.'
                                  : 'Full per-project stack for maximum independence.'}
                            </div>
                          </button>
                        ))}
                      </div>
                      {!sharedTopologyReady && (
                        <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground" data-testid="guided-shared-disabled-note">
                          Shared-core and dedicated-database paths will appear here after you configure shared infrastructure in System Settings.
                        </div>
                      )}
                    </div>
                  )}

                  {selectionStrategy === 'explicit' && options && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4" data-testid="explicit-mode-panel">
                      <div className="text-sm font-medium">Explicit mode</div>
                      <div className="grid gap-3">
                        {availableModeOptions.map((option) => (
                          <button key={option.key} type="button" data-testid={`mode-option-${option.key}`} className={`rounded-lg border p-4 text-left transition ${explicitMode === option.key ? 'border-primary bg-background' : 'border-border hover:border-primary/40'}`} onClick={() => setExplicitMode(option.key)}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{option.label}</div>
                              <span className={`rounded-full px-2 py-1 text-xs ${option.available ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{option.availabilityLabel}</span>
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">{option.shortDescription}</div>
                            <div className="mt-3 grid gap-1 text-xs text-muted-foreground md:grid-cols-3">
                              <span>{option.isolationLabel}</span>
                              <span>{option.topologyLabel}</span>
                              <span>{option.runtimeLabel}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {unavailableModeOptions.length > 0 && (
                        <div className="rounded-lg border border-border bg-background p-4 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-medium">More modes after shared setup</div>
                              <p className="mt-1 text-muted-foreground">You do not need to decide before startup. Configure shared infrastructure in System Settings when you actually want these modes.</p>
                            </div>
                            <Button type="button" variant="outline" onClick={() => setShowUnavailableModes((current) => !current)}>
                              {showUnavailableModes ? 'Hide advanced shared modes' : `Show ${unavailableModeOptions.length} unavailable mode${unavailableModeOptions.length === 1 ? '' : 's'}`}
                            </Button>
                          </div>
                          {showUnavailableModes && (
                            <div className="mt-3 grid gap-3">
                              {unavailableModeOptions.map((option) => (
                                <div key={option.key} className="rounded-lg border border-dashed border-border p-4 opacity-75" data-testid={`unavailable-mode-${option.key}`}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium">{option.label}</div>
                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800">{option.availabilityLabel}</span>
                                  </div>
                                  <div className="mt-2 text-sm text-muted-foreground">{option.shortDescription}</div>
                                </div>
                              ))}
                              <Link href="/dashboard/system">
                                <Button type="button" variant="outline" className="w-full">Open System Settings</Button>
                              </Link>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-700">
                    The project is still created first and deployed later from the configure screen. That keeps the current review-and-deploy flow intact for both new and existing projects.
                  </div>

                  <div className="flex gap-4">
                    <Button type="submit" data-testid="create-project-submit" disabled={loading || optionsLoading || !selectedMode || (!selectedMode.available && selectionStrategy !== 'default')}>
                      {loading ? 'Creating Project...' : 'Create Project'}
                    </Button>
                    <Link href="/dashboard">
                      <Button type="button" variant="outline" disabled={loading}>Cancel</Button>
                    </Link>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card data-testid="topology-preview-card">
              <CardHeader>
                <CardTitle>Provisioning Preview</CardTitle>
                <CardDescription>This previews the mode and topology contract that will be stored with the project before deployment.</CardDescription>
              </CardHeader>
              <CardContent>
                {optionsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading provisioning metadata...</div>
                ) : selectedMode ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Resolved mode</div>
                      <div className="text-xl font-semibold" data-testid="selected-mode-label">{selectedMode.label}</div>
                    </div>
                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div className="rounded-lg border border-border p-3"><div className="text-muted-foreground">Topology</div><div className="font-medium">{selectedMode.topologyLabel}</div></div>
                      <div className="rounded-lg border border-border p-3"><div className="text-muted-foreground">Runtime</div><div className="font-medium">{selectedMode.runtimeLabel}</div></div>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-sm">
                      <div className="font-medium">Why this path</div>
                      <p className="mt-2 text-muted-foreground" data-testid="selected-mode-reason">{previewReason}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-sm">
                      <div className="font-medium">Mode-relevant surfaces</div>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                        {selectedMode.recommended && <li>Matches the current workspace default.</li>}
                        <li>{selectedMode.isolationLabel}</li>
                        <li>{selectedMode.topologyLabel}</li>
                        <li>{selectedMode.runtimeLabel}</li>
                      </ul>
                    </div>
                    {!selectedMode.available && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800" data-testid="selected-mode-warning">This mode is available after shared infrastructure is configured in System Settings.</div>}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No provisioning preview available.</div>
                )}

                {options && (
                  <div className="mt-6 space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                    <div className="font-medium">Workspace defaults</div>
                      <div className="text-sm text-muted-foreground">Shared mode setup: {options.sharedTopology.sharedPostgres.ready ? 'ready to use' : 'not configured yet'}</div>
                      <div className="text-sm text-muted-foreground">Current default: {options.defaultSelection?.label ?? 'Unknown'}</div>
                      <div className="text-sm text-muted-foreground">You can change this per project at any time during creation.</div>
                    <Link href="/dashboard/system">
                      <Button type="button" variant="outline" className="w-full">Review System Settings</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
