'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SettingsResponse {
  defaults: {
    topologySettingsFilePath: string
    secretFilePath: string
    backupRootPath: string
    lifecycleLogFilePath: string
    defaultInstanceMode: string
  }
  sharedTopology: {
    name: string
    defaultMode: string
    sharedPostgres: {
      adminUrl?: string
      host?: string
      port?: number
      adminDatabase: string
      schemaDatabase: string
      ready: boolean
    }
    sharedServices: {
      apiUrl?: string
      studioUrl?: string
      databaseUrl?: string
      authUrl?: string
      storageUrl?: string
      realtimeUrl?: string
      mailUrl?: string
    }
  }
  health: {
    status: 'ready' | 'degraded'
    checks: Array<{
      name: string
      status: 'ready' | 'warning' | 'error'
      detail: string
    }>
  }
  projectCounts: Record<string, number>
  compatibilityCohort: Array<{
    id: string
    name: string
    slug: string
    runtimeStatus: string
    createdAt: string
  }>
}

interface MigrationResponse {
  phase: string
  message: string
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

export default function SystemPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [migrationInfo, setMigrationInfo] = useState<MigrationResponse | null>(null)
  const [form, setForm] = useState({
    name: 'local-shared',
    defaultMode: 'full_stack_isolated',
    adminUrl: '',
    host: '',
    port: '5432',
    adminDatabase: 'postgres',
    schemaDatabase: 'postgres',
    apiUrl: '',
    studioUrl: '',
    databaseUrl: '',
    authUrl: '',
    storageUrl: '',
    realtimeUrl: '',
    mailUrl: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const syncForm = (data: SettingsResponse) => {
    setForm({
      name: data.sharedTopology.name,
      defaultMode: data.sharedTopology.defaultMode,
      adminUrl: data.sharedTopology.sharedPostgres.adminUrl ?? '',
      host: data.sharedTopology.sharedPostgres.host ?? '',
      port: String(data.sharedTopology.sharedPostgres.port ?? 5432),
      adminDatabase: data.sharedTopology.sharedPostgres.adminDatabase,
      schemaDatabase: data.sharedTopology.sharedPostgres.schemaDatabase,
      apiUrl: data.sharedTopology.sharedServices.apiUrl ?? '',
      studioUrl: data.sharedTopology.sharedServices.studioUrl ?? '',
      databaseUrl: data.sharedTopology.sharedServices.databaseUrl ?? '',
      authUrl: data.sharedTopology.sharedServices.authUrl ?? '',
      storageUrl: data.sharedTopology.sharedServices.storageUrl ?? '',
      realtimeUrl: data.sharedTopology.sharedServices.realtimeUrl ?? '',
      mailUrl: data.sharedTopology.sharedServices.mailUrl ?? '',
    })
  }

  const load = useCallback(async () => {
    try {
      setError('')
      const [settingsResponse, migrationResponse] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/migrations'),
      ])

      if (settingsResponse.ok) {
        const settingsData = (await settingsResponse.json()) as SettingsResponse
        setSettings(settingsData)
        syncForm(settingsData)
      } else {
        setError('Failed to load system settings')
      }

      if (migrationResponse.ok) {
        setMigrationInfo((await migrationResponse.json()) as MigrationResponse)
      }
    } catch {
      setError('Failed to load system settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          defaultMode: form.defaultMode,
          sharedPostgres: {
            adminUrl: form.adminUrl,
            host: form.host,
            port: form.port,
            adminDatabase: form.adminDatabase,
            schemaDatabase: form.schemaDatabase,
          },
          sharedServices: {
            apiUrl: form.apiUrl,
            studioUrl: form.studioUrl,
            databaseUrl: form.databaseUrl,
            authUrl: form.authUrl,
            storageUrl: form.storageUrl,
            realtimeUrl: form.realtimeUrl,
            mailUrl: form.mailUrl,
          },
        }),
      })

      if (!response.ok) {
        setError('Failed to save system settings')
        return
      }

      const data = (await response.json()) as SettingsResponse
      setSettings(data)
      syncForm(data)
      setSuccess('System settings updated.')
    } catch {
      setError('Failed to save system settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div>Loading system settings...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="SupaConsole"
              width={150}
              height={150}
              className="object-contain"
            />
          </div>
          <Link href="/dashboard">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <h2 className="text-3xl font-bold" data-testid="system-settings-title">System Settings</h2>
            <p className="mt-2 text-muted-foreground">
              Optional shared setup for schema-isolated or dedicated-database projects. If you only want full-stack projects, you can leave this alone.
            </p>
          </div>

          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Optional Shared Setup</CardTitle>
                <CardDescription>
                  Add shared Postgres and shared service endpoints here when you want those modes available during project creation. Existing projects are not changed automatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Topology name</Label>
                      <Input id="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="defaultMode">Default mode</Label>
                      <select
                        id="defaultMode"
                        value={form.defaultMode}
                        onChange={(event) => setForm((current) => ({ ...current, defaultMode: event.target.value }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                      >
                        <option value="full_stack_isolated">Full stack</option>
                        <option value="shared_core_schema_isolated">Shared core</option>
                        <option value="db_isolated">Dedicated database</option>
                      </select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="adminUrl">Shared Postgres admin URL</Label>
                      <Input id="adminUrl" value={form.adminUrl} onChange={(event) => setForm((current) => ({ ...current, adminUrl: event.target.value }))} placeholder="postgresql://postgres:password@host:5432/postgres" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="host">Host</Label>
                      <Input id="host" value={form.host} onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="port">Port</Label>
                      <Input id="port" value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="adminDatabase">Admin database</Label>
                      <Input id="adminDatabase" value={form.adminDatabase} onChange={(event) => setForm((current) => ({ ...current, adminDatabase: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="schemaDatabase">Schema database</Label>
                      <Input id="schemaDatabase" value={form.schemaDatabase} onChange={(event) => setForm((current) => ({ ...current, schemaDatabase: event.target.value }))} />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {[
                      ['apiUrl', 'API URL'],
                      ['studioUrl', 'Studio URL'],
                      ['databaseUrl', 'Database URL'],
                      ['authUrl', 'Auth URL'],
                      ['storageUrl', 'Storage URL'],
                      ['realtimeUrl', 'Realtime URL'],
                      ['mailUrl', 'Mail URL'],
                    ].map(([key, label]) => (
                      <div key={key} className="space-y-2">
                        <Label htmlFor={key}>{label}</Label>
                        <Input
                          id={key}
                          value={form[key as keyof typeof form]}
                          onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                        />
                      </div>
                    ))}
                  </div>

                  <Button type="submit" disabled={saving} data-testid="save-system-settings-button">
                    {saving ? 'Saving...' : 'Save system settings'}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card data-testid="system-health-card">
              <CardHeader>
                <CardTitle>Status And Storage</CardTitle>
                <CardDescription>
                  A quick view of whether shared setup is usable on this host and where SupaConsole keeps its local state.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="rounded-lg border border-border p-3">
                  <div className="font-medium">Health status</div>
                  <div className="mt-2 text-muted-foreground">{settings.health.status}</div>
                </div>
                {settings.health.checks.map((check) => (
                  <div key={check.name} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{check.name}</div>
                      <span className={`rounded-full px-2 py-1 text-xs ${
                        check.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-800'
                          : check.status === 'warning'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-red-800'
                      }`}>
                        {check.status}
                      </span>
                    </div>
                    <p className="mt-2 text-muted-foreground">{check.detail}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-border p-3">
                  <div className="font-medium">Config files</div>
                  <div className="mt-2 text-muted-foreground">Topology: {settings.defaults.topologySettingsFilePath}</div>
                  <div className="text-muted-foreground">Secrets: {settings.defaults.secretFilePath}</div>
                  <div className="text-muted-foreground">Backups: {settings.defaults.backupRootPath}</div>
                  <div className="text-muted-foreground">Lifecycle log: {settings.defaults.lifecycleLogFilePath}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[0.8fr,1.2fr]">
            <Card>
              <CardHeader>
                <CardTitle>Project Mix</CardTitle>
                <CardDescription>
                  Counts by project mode so you can see what people are actually creating.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {Object.entries(settings.projectCounts).map(([mode, count]) => (
                  <div key={mode} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="font-medium">{mode}</div>
                    <div>{count}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card data-testid="compatibility-cohort-card">
              <CardHeader>
                <CardTitle>Existing Full-Stack Projects</CardTitle>
                <CardDescription>
                  These projects keep working as they already do. Saving shared setup here does not migrate them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {migrationInfo && (
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-blue-700">
                    {migrationInfo.message}
                  </div>
                )}
                {settings.compatibilityCohort.length > 0 ? (
                  <div className="space-y-2">
                    {settings.compatibilityCohort.map((project) => (
                      <div key={project.id} className="rounded-lg border border-border p-3">
                        <div className="font-medium">{project.name}</div>
                        <div className="text-muted-foreground">{project.slug}</div>
                        <div className="text-muted-foreground">{project.runtimeStatus} · {formatDate(project.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground">No compatibility-managed full-stack projects are currently recorded.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}