'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function CreateProjectPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNameChange = (e: any) => {
    setName(e.target.value)
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDescriptionChange = (e: any) => {
    setDescription(e.target.value)
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setLogs([])
    setShowLogs(false)

    if (!name.trim()) {
      setError('Project name is required')
      setLoading(false)
      return
    }

    try {
      // Create the project first
      const createResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      })

      if (!createResponse.ok) {
        const data = await createResponse.json()
        setError(data.error || 'Failed to create project')
        setLoading(false)
        return
      }

      const projectData = await createResponse.json()
      const createdProjectId = projectData.project.id
      // Project created; do NOT start the Supabase CLI here.
      // Redirect the user to the configuration page so they can review/save settings
      // and click Deploy when ready.
      router.push(`/dashboard/projects/${createdProjectId}/configure`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.')
      setLogs(prev => [...prev, `Error: ${err instanceof Error ? err.message : String(err)}`])
    } finally {
      setLoading(false)
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
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2">Create New Project</h2>
            <p className="text-muted-foreground">
              Set up a new Supabase project with Docker configuration
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Project Details</CardTitle>
              <CardDescription>
                Enter the basic information for your new Supabase project
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded">
                    {error}
                  </div>
                )}

                {!showLogs ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="name">Project Name *</Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder="Enter project name"
                        value={name}
                        onChange={handleNameChange}
                        required
                        disabled={loading}
                      />
                      <p className="text-sm text-muted-foreground">
                        A unique identifier will be generated automatically
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Description (optional)</Label>
                      <Input
                        id="description"
                        type="text"
                        placeholder="Brief description of your project"
                        value={description}
                        onChange={handleDescriptionChange}
                        disabled={loading}
                      />
                    </div>

                        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-500 px-4 py-3 rounded">
                          <p className="text-sm">
                            <strong>Note:</strong> The Supabase CLI is used to run local Supabase instances. After creating the project you must save any configuration changes on the next page and then click <em>Deploy</em> to start the stack.
                          </p>
                        </div>

                    <div className="flex gap-4">
                      <Button type="submit" disabled={loading}>
                        {loading ? 'Creating Project...' : 'Create Project'}
                      </Button>
                      <Link href="/dashboard">
                        <Button type="button" variant="outline" disabled={loading}>
                          Cancel
                        </Button>
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Creation Progress</Label>
                      <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto border border-gray-700">
                        {logs.length === 0 ? (
                          <div className="text-gray-400">Initializing project creation...</div>
                        ) : (
                          logs.map((log, i) => (
                            <div key={i} className="whitespace-pre-wrap break-words">
                              {log}
                            </div>
                          ))
                        )}
                        <div ref={logsEndRef} />
                      </div>
                    </div>

                    {!loading && (
                      <div className="flex gap-4">
                        <Button
                          type="button"
                          onClick={() => router.push('/dashboard')}
                          className="flex-1"
                        >
                          Back to Dashboard
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}