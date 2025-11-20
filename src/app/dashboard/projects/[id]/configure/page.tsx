'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import SecretInput from '@/components/ui/secret-input'
import { Label } from '@/components/ui/label'

interface ConfigureProjectPageProps {
  params: Promise<{
    id: string
  }>
}

export default function ConfigureProjectPage({ params }: ConfigureProjectPageProps) {
  const [envVars, setEnvVars] = useState({
    // Secrets
    POSTGRES_PASSWORD: 'your-super-secret-and-long-postgres-password',
    JWT_SECRET: 'your-super-secret-jwt-token-with-at-least-32-characters-long',
    ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE',
    SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q',
    DASHBOARD_USERNAME: 'supabase',
    DASHBOARD_PASSWORD: 'this_password_is_insecure_and_should_be_updated',
    SECRET_KEY_BASE: 'UpNVntn3cDxHJpq99YMc1T1AQgQpc8kfYTuRgBiYa15BLrx8etQoXz3gZv1/u2oq',
    VAULT_ENC_KEY: 'your-encryption-key-32-chars-min',
    
    // Database
    POSTGRES_HOST: 'db',
    POSTGRES_DB: 'postgres',
    POSTGRES_PORT: '5432',
    
    // Supavisor
    POOLER_PROXY_PORT_TRANSACTION: '6543',
    POOLER_DEFAULT_POOL_SIZE: '20',
    POOLER_MAX_CLIENT_CONN: '100',
    POOLER_TENANT_ID: 'your-tenant-id',
    POOLER_DB_POOL_SIZE: '5',
    
    // Kong
    KONG_HTTP_PORT: '8000',
    KONG_HTTPS_PORT: '8443',
    
    // Analytics
    ANALYTICS_PORT: '4000',
    
    // PostgREST
    PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
    
  // Auth
  // Default SITE_URL points to local frontend dev server (Vite) on 5173 so magic links open the expected app.
  SITE_URL: 'http://localhost:5173',
    ADDITIONAL_REDIRECT_URLS: '',
    JWT_EXPIRY: '3600',
    DISABLE_SIGNUP: 'false',
    API_EXTERNAL_URL: 'http://localhost:8000',
    
    // Mailer
    MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
    MAILER_URLPATHS_INVITE: '/auth/v1/verify',
    MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
    MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',
    
    // Email auth
    ENABLE_EMAIL_SIGNUP: 'true',
    ENABLE_EMAIL_AUTOCONFIRM: 'false',
    SMTP_ADMIN_EMAIL: 'admin@example.com',
    SMTP_HOST: 'supabase-mail',
    SMTP_PORT: '2500',
    SMTP_USER: 'fake_mail_user',
    SMTP_PASS: 'fake_mail_password',
    SMTP_SENDER_NAME: 'fake_sender',
    ENABLE_ANONYMOUS_USERS: 'false',
    
    // Phone auth
    ENABLE_PHONE_SIGNUP: 'true',
    ENABLE_PHONE_AUTOCONFIRM: 'true',
    
  // Studio
  STUDIO_DEFAULT_ORGANIZATION: 'Default Organization',
  STUDIO_DEFAULT_PROJECT: 'Default Project',
  STUDIO_PORT: '3000',
  // Supabase public URL used by some templates; keep API host distinct, but default front-end URLs point to 5173 for dev.
  SUPABASE_PUBLIC_URL: 'http://localhost:5173',
    
    // ImgProxy
    IMGPROXY_ENABLE_WEBP_DETECTION: 'true',
    
    // OpenAI
    OPENAI_API_KEY: '',
    
    // Functions
    FUNCTIONS_VERIFY_JWT: 'false',
    
    // Logs
    LOGFLARE_PUBLIC_ACCESS_TOKEN: 'your-super-secret-and-long-logflare-key-public',
    LOGFLARE_PRIVATE_ACCESS_TOKEN: 'your-super-secret-and-long-logflare-key-private',
    DOCKER_SOCKET_LOCATION: '/var/run/docker.sock',
    
    // Google Cloud
    GOOGLE_PROJECT_ID: 'GOOGLE_PROJECT_ID',
    GOOGLE_PROJECT_NUMBER: 'GOOGLE_PROJECT_NUMBER'
  })
  const [loading, setLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
      
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [projectId, setProjectId] = useState<string>('')
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, string> | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [systemChecks, setSystemChecks] = useState<{
    docker: boolean;
    dockerCompose: boolean;
    dockerRunning: boolean;
    internetConnection: boolean;
  } | null>(null)
  const [checkingSystem, setCheckingSystem] = useState(false)
  const router = useRouter()
  
  useEffect(() => {
    params.then(({ id }) => setProjectId(id))
  }, [params])

  // Load existing environment variables when projectId is available
  useEffect(() => {
    if (!projectId) return

    const loadEnvVars = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/env`)
        if (response.ok) {
          const responseData = await response.json()
          if (responseData.envVars && Object.keys(responseData.envVars).length > 0) {
            // Update state with existing environment variables
            setEnvVars(prev => ({
              ...prev,
              ...responseData.envVars
            }))
            // Capture original envs is no longer tracked in this UI
          }
        }
      } catch (error) {
        console.error('Failed to load environment variables:', error)
      }
    }

    loadEnvVars()
    // also fetch runtime status when opening the configure page
    ;(async () => {
      setStatusLoading(true)
      try {
        const resp = await fetch(`/api/projects/${projectId}/status`)
        if (resp.ok) {
          const data = await resp.json()
          if (data.status) setRuntimeStatus(data.status as Record<string,string>)
        }
      } finally {
        setStatusLoading(false)
      }
    })()
  }, [projectId])



  const fetchRuntimeStatus = async () => {
    if (!projectId) return
    setStatusLoading(true)
    setError('')
    try {
      const resp = await fetch(`/api/projects/${projectId}/status`)
      if (!resp.ok) {
        setRuntimeStatus(null)
        return
      }
      const data = await resp.json()
      if (data.status) setRuntimeStatus(data.status as Record<string,string>)
      else setRuntimeStatus(null)
    } catch {
      setRuntimeStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }



  const generateSecureKey = (length: number = 32) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  const handleGenerateSecrets = () => {
    // JWT_SECRET must be 40 characters for GoTrue
    const jwtSecret = generateSecureKey(40)
    const projectId = `project-${Date.now()}`

    setEnvVars(prev => ({
      ...prev,
      POSTGRES_PASSWORD: generateSecureKey(32),
      JWT_SECRET: jwtSecret,
      // Use opaque long random strings for anon/service_role keys (not pseudo-JWTs)
      ANON_KEY: generateSecureKey(64),
      SERVICE_ROLE_KEY: generateSecureKey(64),
      DASHBOARD_PASSWORD: generateSecureKey(16),
      SECRET_KEY_BASE: generateSecureKey(64),
      VAULT_ENC_KEY: generateSecureKey(32),
      POOLER_TENANT_ID: projectId,
      LOGFLARE_PUBLIC_ACCESS_TOKEN: generateSecureKey(64),
      LOGFLARE_PRIVATE_ACCESS_TOKEN: generateSecureKey(64),
    }))
  }

  const handleInputChange = (key: string, value: string) => {
    setEnvVars(prev => ({
      ...prev,
      [key]: value
    }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createInputHandler = (key: string) => (e: any) => {
    handleInputChange(key, e.target.value)
  }

  const handleSystemCheck = async () => {
    setCheckingSystem(true)
    setError('')
    
    try {
      const response = await fetch('/api/system/check')
      if (response.ok) {
        const data = await response.json()
        setSystemChecks(data.checks)
      } else {
        setError('Failed to check system prerequisites')
      }
    } catch {
      setError('Failed to check system prerequisites')
    } finally {
      setCheckingSystem(false)
    }
  }

  const handleSaveConfiguration = async () => {
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`/api/projects/${projectId}/env`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envVars),
      })

      if (response.ok) {
        setSuccess('Configuration saved successfully!')
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to save configuration')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeployProject = async () => {
    setDeploying(true)
    setError('')

    try {
      const response = await fetch(`/api/projects/${projectId}/deploy`, {
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        // If the deploy returned runtime status, surface useful URLs to the user
        if (data.status) {
          const status = data.status as Record<string, string>
          const lines: string[] = []
          if (status.API_URL) lines.push(`API: ${status.API_URL}`)
          if (status.GRAPHQL_URL) lines.push(`GraphQL: ${status.GRAPHQL_URL}`)
          if (status.STORAGE_URL) lines.push(`Storage: ${status.STORAGE_URL}`)
          if (status.STORAGE_S3_URL) lines.push(`S3 Storage: ${status.STORAGE_S3_URL}`)
          if (status.MCP_URL) lines.push(`MCP: ${status.MCP_URL}`)
          if (status.STUDIO_URL) lines.push(`Studio: ${status.STUDIO_URL}`)
          if (status.INBUCKET_URL) lines.push(`Inbucket (Mail UI): ${status.INBUCKET_URL}`)
          if (status.MAILPIT_URL) lines.push(`Mail UI (Mailpit): ${status.MAILPIT_URL}`)
          if (status.PUBLISHABLE_KEY) lines.push(`Publishable key: ${status.PUBLISHABLE_KEY}`)
          if (status.SECRET_KEY) lines.push(`Secret key: ${status.SECRET_KEY}`)
          if (status.S3_ACCESS_KEY) lines.push(`S3 access key: ${status.S3_ACCESS_KEY}`)
          if (status.S3_SECRET_KEY) lines.push(`S3 secret key: ${status.S3_SECRET_KEY}`)
          if (status.S3_REGION) lines.push(`S3 region: ${status.S3_REGION}`)
          if (status.DB_URL) lines.push(`DB: ${status.DB_URL}`)
          setSuccess(`Project deployed successfully!\n${lines.join('\n')}`)
        } else if (data.note) {
          setSuccess(`Project deployed (partial): ${data.note}`)
        } else {
          setSuccess('Project deployed successfully!')
        }
        setTimeout(() => {
          router.push('/dashboard')
        }, 2500)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to deploy project')
      }
    } catch {
      setError('An error occurred during deployment.')
    } finally {
      setDeploying(false)
    }
  }

  // Deploy with live streaming logs (uses /api/projects/stream-logs which returns SSE)
  const [logs, setLogs] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)

  const appendLog = (line: string) => {
    setLogs(prev => [...prev, line])
  }

  const handleDeployWithLogs = async () => {
    if (!projectId) return
    setStreaming(true)
    setDeploying(true)
    setError('')
    setLogs([])

    try {
      const resp = await fetch('/api/projects/stream-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        setError(data.error || 'Failed to start streaming logs')
        return
      }

      const reader = resp.body?.getReader()
      if (!reader) {
        setError('No streaming body received')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE messages are separated by double newlines
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          const lines = part.split(/\r?\n/).map(l => l.trim())
          let event = ''
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
            else if (line.startsWith('data:')) data += line.slice('data:'.length).trim()
          }

          // server sends JSON.stringify(data) for log/error messages
          let decoded = data
          try { decoded = JSON.parse(data) } catch {}

          if (event === 'log') appendLog(String(decoded))
          else if (event === 'error') appendLog(`[ERROR] ${String(decoded)}`)
          else if (event === 'done') {
            appendLog(`[DONE] ${String(decoded)}`)
            // After done, attempt to fetch project status to show runtime URLs
            try {
              const st = await fetch(`/api/projects/${projectId}/status`)
              if (st.ok) {
                const stJson = await st.json()
                const lines: string[] = []
                if (stJson.API_URL) lines.push(`API: ${stJson.API_URL}`)
                if (stJson.GRAPHQL_URL) lines.push(`GraphQL: ${stJson.GRAPHQL_URL}`)
                if (stJson.STORAGE_URL) lines.push(`Storage: ${stJson.STORAGE_URL}`)
                if (stJson.STORAGE_S3_URL) lines.push(`S3 Storage: ${stJson.STORAGE_S3_URL}`)
                if (stJson.MCP_URL) lines.push(`MCP: ${stJson.MCP_URL}`)
                if (stJson.STUDIO_URL) lines.push(`Studio: ${stJson.STUDIO_URL}`)
                if (stJson.INBUCKET_URL) lines.push(`Inbucket (Mail UI): ${stJson.INBUCKET_URL}`)
                if (stJson.MAILPIT_URL) lines.push(`Mail UI (Mailpit): ${stJson.MAILPIT_URL}`)
                if (stJson.PUBLISHABLE_KEY) lines.push(`Publishable key: ${stJson.PUBLISHABLE_KEY}`)
                if (stJson.SECRET_KEY) lines.push(`Secret key: ${stJson.SECRET_KEY}`)
                if (stJson.S3_ACCESS_KEY) lines.push(`S3 access key: ${stJson.S3_ACCESS_KEY}`)
                if (stJson.S3_SECRET_KEY) lines.push(`S3 secret key: ${stJson.S3_SECRET_KEY}`)
                if (stJson.S3_REGION) lines.push(`S3 region: ${stJson.S3_REGION}`)
                if (stJson.DB_URL) lines.push(`DB: ${stJson.DB_URL}`)
                setSuccess(`Project deployed successfully!\n${lines.join('\n')}`)
              } else {
                setSuccess('Project deployed (stream finished).')
              }
            } catch {
              setSuccess('Project deployed (stream finished).')
            }
          }
        }
      }
    } catch {
      setError('An unknown error occurred during streaming deploy')
    } finally {
      setStreaming(false)
      setDeploying(false)
      // keep logs visible to the user
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
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
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Configure Project Environment</h2>
            <p className="text-muted-foreground">
              Configure all environment variables for your Supabase project. All fields are pre-filled with default values from the official Supabase template.
            </p>
          </div>

          {success && (
            <div className="mb-6 bg-green-500/10 border border-green-500/20 text-green-500 px-4 py-3 rounded">
              {success}
            </div>
          )}

          {error && (
            <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="bg-blue-500/10 border border-blue-500/20 text-blue-500 px-4 py-3 rounded mb-6">
            <p className="text-sm">
              <strong>Important:</strong> The form below is pre-filled with default values from the Supabase configuration template. 
              You MUST change the default passwords, secrets, and keys before deploying to production for security reasons.
            </p>
          </div>

          <div className="space-y-6">
            {/* Runtime Info (live) */}
            <Card>
              <CardHeader>
                <CardTitle>⚙️ Runtime Info</CardTitle>
                <CardDescription>Live runtime URLs and keys reported by the Supabase CLI</CardDescription>
                <div className="ml-auto">
                  <Button size="sm" variant="outline" onClick={fetchRuntimeStatus}>
                    {statusLoading ? 'Refreshing...' : 'Refresh'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {runtimeStatus ? (
                  <div className="space-y-2">
                    {runtimeStatus.API_URL && (
                      <div className="flex items-center gap-2">API: <code className="font-mono">{runtimeStatus.API_URL}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.API_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.GRAPHQL_URL && (
                      <div className="flex items-center gap-2">GraphQL: <code className="font-mono">{runtimeStatus.GRAPHQL_URL}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.GRAPHQL_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.STUDIO_URL && (
                      <div className="flex items-center gap-2">Studio: <a href={runtimeStatus.STUDIO_URL} target="_blank" className="font-mono">{runtimeStatus.STUDIO_URL}</a>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.STUDIO_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.STORAGE_URL && (
                      <div className="flex items-center gap-2">Storage: <code className="font-mono">{runtimeStatus.STORAGE_URL}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.STORAGE_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.STORAGE_S3_URL && (
                      <div className="flex items-center gap-2">S3: <code className="font-mono">{runtimeStatus.STORAGE_S3_URL}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.STORAGE_S3_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.INBUCKET_URL && (
                      <div className="flex items-center gap-2">Inbucket (Mail UI): <a href={runtimeStatus.INBUCKET_URL} target="_blank" className="font-mono">{runtimeStatus.INBUCKET_URL}</a>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.INBUCKET_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.MAILPIT_URL && (
                      <div className="flex items-center gap-2">Mailpit UI: <a href={runtimeStatus.MAILPIT_URL} target="_blank" className="font-mono">{runtimeStatus.MAILPIT_URL}</a>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.MAILPIT_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.DB_URL && (
                      <div className="flex items-center gap-2">DB URL: <code className="font-mono break-all">{runtimeStatus.DB_URL}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.DB_URL)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.PUBLISHABLE_KEY && (
                      <div className="flex items-center gap-2">Publishable key: <code className="font-mono">{runtimeStatus.PUBLISHABLE_KEY}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.PUBLISHABLE_KEY)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.SECRET_KEY && (
                      <div className="flex items-center gap-2">Secret key: <code className="font-mono">{runtimeStatus.SECRET_KEY}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.SECRET_KEY)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.S3_ACCESS_KEY && (
                      <div className="flex items-center gap-2">S3 access key: <code className="font-mono">{runtimeStatus.S3_ACCESS_KEY}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.S3_ACCESS_KEY)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.S3_SECRET_KEY && (
                      <div className="flex items-center gap-2">S3 secret key: <code className="font-mono">{runtimeStatus.S3_SECRET_KEY}</code>
                        <button onClick={async () => await navigator.clipboard.writeText(runtimeStatus.S3_SECRET_KEY)} className="ml-2 text-sm text-gray-500 hover:text-gray-700">Copy</button>
                      </div>
                    )}
                    {runtimeStatus.S3_REGION && <div>S3 region: <code className="font-mono">{runtimeStatus.S3_REGION}</code></div>}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No live runtime status available. Start the stack or press Refresh.</p>
                )}
              </CardContent>
            </Card>
            {/* Secrets Section */}
            <Card>
              <CardHeader>
                <CardTitle>🔐 Secrets (Critical - Must Change for Production)</CardTitle>
                <CardDescription>
                  These are the most critical security settings. Generate new secure values for production use.
                </CardDescription>
                <Button 
                  onClick={handleGenerateSecrets}
                  variant="outline"
                  type="button"
                >
                  Generate New Secure Secrets
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="postgres_password">PostgreSQL Password</Label>
                    <SecretInput
                      id="postgres_password"
                      value={envVars.POSTGRES_PASSWORD}
                      onChange={createInputHandler('POSTGRES_PASSWORD')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jwt_secret">JWT Secret</Label>
                    <SecretInput
                      id="jwt_secret"
                      value={envVars.JWT_SECRET}
                      onChange={createInputHandler('JWT_SECRET')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dashboard_username">Dashboard Username</Label>
                    <Input
                      id="dashboard_username"
                      type="text"
                      value={envVars.DASHBOARD_USERNAME}
                      onChange={createInputHandler('DASHBOARD_USERNAME')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dashboard_password">Dashboard Password</Label>
                    <Input
                      id="dashboard_password"
                      type="text"
                      value={envVars.DASHBOARD_PASSWORD}
                      onChange={createInputHandler('DASHBOARD_PASSWORD')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secret_key_base">Secret Key Base</Label>
                    <SecretInput
                      id="secret_key_base"
                      value={envVars.SECRET_KEY_BASE}
                      onChange={createInputHandler('SECRET_KEY_BASE')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vault_enc_key">Vault Encryption Key</Label>
                    <SecretInput
                      id="vault_enc_key"
                      value={envVars.VAULT_ENC_KEY}
                      onChange={createInputHandler('VAULT_ENC_KEY')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* JWT Keys Section */}
            <Card>
              <CardHeader>
                <CardTitle>🔑 JWT Keys</CardTitle>
                <CardDescription>
                  JSON Web Token keys for authentication. The default keys are for demo purposes only.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="anon_key">Anonymous Key (Public)</Label>
                    <Input
                      id="anon_key"
                      type="text"
                      value={envVars.ANON_KEY}
                      onChange={createInputHandler('ANON_KEY')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="service_role_key">Service Role Key (Secret)</Label>
                    <SecretInput
                      id="service_role_key"
                      value={envVars.SERVICE_ROLE_KEY}
                      onChange={createInputHandler('SERVICE_ROLE_KEY')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Database Section */}
            <Card>
              <CardHeader>
                <CardTitle>🗄️ Database Configuration</CardTitle>
                <CardDescription>
                  PostgreSQL database connection settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="postgres_host">PostgreSQL Host</Label>
                    <Input
                      id="postgres_host"
                      type="text"
                      value={envVars.POSTGRES_HOST}
                      onChange={createInputHandler('POSTGRES_HOST')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postgres_db">Database Name</Label>
                    <Input
                      id="postgres_db"
                      type="text"
                      value={envVars.POSTGRES_DB}
                      onChange={createInputHandler('POSTGRES_DB')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postgres_port">PostgreSQL Port</Label>
                    <Input
                      id="postgres_port"
                      type="text"
                      value={envVars.POSTGRES_PORT}
                      onChange={createInputHandler('POSTGRES_PORT')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Auth Settings Section */}
            <Card>
              <CardHeader>
                <CardTitle>🔐 Authentication Settings</CardTitle>
                <CardDescription>
                  Configure authentication behavior and URLs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="site_url">Site URL</Label>
                    <Input
                      id="site_url"
                      type="text"
                      value={envVars.SITE_URL}
                      onChange={createInputHandler('SITE_URL')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api_external_url">API External URL</Label>
                    <Input
                      id="api_external_url"
                      type="text"
                      value={envVars.API_EXTERNAL_URL}
                      onChange={createInputHandler('API_EXTERNAL_URL')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jwt_expiry">JWT Expiry (seconds)</Label>
                    <Input
                      id="jwt_expiry"
                      type="text"
                      value={envVars.JWT_EXPIRY}
                      onChange={createInputHandler('JWT_EXPIRY')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="disable_signup">Disable Signup</Label>
                    <Input
                      id="disable_signup"
                      type="text"
                      value={envVars.DISABLE_SIGNUP}
                      onChange={createInputHandler('DISABLE_SIGNUP')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Email Settings Section */}
            <Card>
              <CardHeader>
                <CardTitle>📧 Email Configuration</CardTitle>
                <CardDescription>
                  SMTP settings for authentication emails.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="smtp_admin_email">Admin Email</Label>
                    <Input
                      id="smtp_admin_email"
                      type="email"
                      value={envVars.SMTP_ADMIN_EMAIL}
                      onChange={createInputHandler('SMTP_ADMIN_EMAIL')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_host">SMTP Host</Label>
                    <Input
                      id="smtp_host"
                      type="text"
                      value={envVars.SMTP_HOST}
                      onChange={createInputHandler('SMTP_HOST')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_port">SMTP Port</Label>
                    <Input
                      id="smtp_port"
                      type="text"
                      value={envVars.SMTP_PORT}
                      onChange={createInputHandler('SMTP_PORT')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_user">SMTP User</Label>
                    <Input
                      id="smtp_user"
                      type="text"
                      value={envVars.SMTP_USER}
                      onChange={createInputHandler('SMTP_USER')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_pass">SMTP Password</Label>
                    <SecretInput
                      id="smtp_pass"
                      value={envVars.SMTP_PASS}
                      onChange={createInputHandler('SMTP_PASS')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_sender_name">SMTP Sender Name</Label>
                    <Input
                      id="smtp_sender_name"
                      type="text"
                      value={envVars.SMTP_SENDER_NAME}
                      onChange={createInputHandler('SMTP_SENDER_NAME')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Studio Settings Section */}
            <Card>
              <CardHeader>
                <CardTitle>🎨 Studio Configuration</CardTitle>
                <CardDescription>
                  Supabase Studio dashboard settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="studio_default_organization">Default Organization</Label>
                    <Input
                      id="studio_default_organization"
                      type="text"
                      value={envVars.STUDIO_DEFAULT_ORGANIZATION}
                      onChange={createInputHandler('STUDIO_DEFAULT_ORGANIZATION')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="studio_default_project">Default Project</Label>
                    <Input
                      id="studio_default_project"
                      type="text"
                      value={envVars.STUDIO_DEFAULT_PROJECT}
                      onChange={createInputHandler('STUDIO_DEFAULT_PROJECT')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="studio_port">Studio Port</Label>
                    <Input
                      id="studio_port"
                      type="text"
                      value={envVars.STUDIO_PORT}
                      onChange={createInputHandler('STUDIO_PORT')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supabase_public_url">Supabase Public URL</Label>
                    <Input
                      id="supabase_public_url"
                      type="text"
                      value={envVars.SUPABASE_PUBLIC_URL}
                      onChange={createInputHandler('SUPABASE_PUBLIC_URL')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Advanced Settings Section */}
            <Card>
              <CardHeader>
                <CardTitle>⚙️ Advanced Settings</CardTitle>
                <CardDescription>
                  Optional advanced configuration settings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="openai_api_key">OpenAI API Key (Optional)</Label>
                    <SecretInput
                      id="openai_api_key"
                      placeholder="For SQL Editor Assistant"
                      value={envVars.OPENAI_API_KEY}
                      onChange={createInputHandler('OPENAI_API_KEY')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="kong_http_port">Kong HTTP Port</Label>
                    <Input
                      id="kong_http_port"
                      type="text"
                      value={envVars.KONG_HTTP_PORT}
                      onChange={createInputHandler('KONG_HTTP_PORT')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="analytics_port">Analytics Port</Label>
                    <Input
                      id="analytics_port"
                      type="text"
                      value={envVars.ANALYTICS_PORT}
                      onChange={createInputHandler('ANALYTICS_PORT')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pgrst_db_schemas">PostgREST DB Schemas</Label>
                    <Input
                      id="pgrst_db_schemas"
                      type="text"
                      value={envVars.PGRST_DB_SCHEMAS}
                      onChange={createInputHandler('PGRST_DB_SCHEMAS')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="functions_verify_jwt">Functions Verify JWT</Label>
                    <Input
                      id="functions_verify_jwt"
                      type="text"
                      value={envVars.FUNCTIONS_VERIFY_JWT}
                      onChange={createInputHandler('FUNCTIONS_VERIFY_JWT')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Deployment</CardTitle>
                <CardDescription>
                  Save your configuration and deploy the Supabase instance with Docker
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <Button 
                      onClick={handleSaveConfiguration} 
                      disabled={loading}
                      variant="outline"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      {loading ? 'Saving...' : 'Save Configuration'}
                    </Button>
                    
                    <Button 
                      onClick={handleSystemCheck}
                      disabled={checkingSystem}
                      variant="secondary"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {checkingSystem ? 'Checking...' : 'Check System'}
                    </Button>
                    
                    <Button 
                      onClick={handleDeployProject} 
                      disabled={deploying || !success}
                    >
                      {deploying ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Deploying...
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                          </svg>
                          Deploy Project
                        </div>
                      )}
                    </Button>
                      <Button 
                        onClick={handleDeployWithLogs}
                        disabled={deploying}
                        variant="ghost"
                        title="You can stream logs without saving changes; saving is recommended"
                      >
                        {streaming ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            Streaming...
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 19a7 7 0 100-14 7 7 0 000 14z" />
                            </svg>
                            Deploy (stream logs)
                          </div>
                        )}
                      </Button>
                  </div>

                  {systemChecks && (
                    <div className="bg-card border rounded-lg p-4">
                      <h4 className="font-medium mb-2">System Prerequisites</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className={`flex items-center gap-2 ${systemChecks.docker ? 'text-green-600' : 'text-red-600'}`}>
                          <span>{systemChecks.docker ? '✅' : '❌'}</span>
                          Docker Installed
                        </div>
                        <div className={`flex items-center gap-2 ${systemChecks.dockerRunning ? 'text-green-600' : 'text-red-600'}`}>
                          <span>{systemChecks.dockerRunning ? '✅' : '❌'}</span>
                          Docker Running
                        </div>
                        <div className={`flex items-center gap-2 ${systemChecks.dockerCompose ? 'text-green-600' : 'text-red-600'}`}>
                          <span>{systemChecks.dockerCompose ? '✅' : '❌'}</span>
                          Docker Compose Available
                        </div>
                        <div className={`flex items-center gap-2 ${systemChecks.internetConnection ? 'text-green-600' : 'text-yellow-600'}`}>
                          <span>{systemChecks.internetConnection ? '✅' : '⚠️'}</span>
                          Internet Connection
                        </div>
                      </div>
                      {(!systemChecks.docker || !systemChecks.dockerRunning || !systemChecks.dockerCompose) && (
                        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded">
                          Please install Docker Desktop and ensure it&apos;s running before deploying.
                        </div>
                      )}
                      {!systemChecks.internetConnection && (
                        <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 text-sm rounded">
                          No internet connection detected. Deployment will use cached Docker images if available.
                        </div>
                      )}
                    </div>
                  )}
                  {/* Live logs panel (shown when streaming or after stream completes) */}
                  {(streaming || logs.length > 0) && (
                    <div className="mt-4 bg-black text-white p-3 rounded font-mono text-sm max-h-64 overflow-auto">
                      {logs.length === 0 ? (<div>Starting stream...</div>) : logs.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  )}
                  {!success && (
                    <p className="text-sm text-muted-foreground">
                      Save configuration first before deploying
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}