import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const session = await validateSession(sessionToken)
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const { projectId, containerId } = await request.json()
    if (!projectId || !containerId) return NextResponse.json({ error: 'projectId and containerId required' }, { status: 400 })

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (project.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Verify container info to avoid stopping arbitrary containers
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)

    try {
      const { stdout } = await execAsync(`docker ps --format "{{.ID}} {{.Names}} {{.Ports}}" --filter id=${containerId}`)
      if (!stdout) return NextResponse.json({ error: 'Container not found' }, { status: 404 })

      const line = String(stdout || '').trim()
      // Only allow stop if the container name or ports look like a Supabase local instance
      const allowed = /supabase|supabase_db|postgres|inbucket|gotrue|postgrest/i.test(line) || line.includes('0.0.0.0:')
      if (!allowed) return NextResponse.json({ error: 'Refusing to stop container: not recognized as a Supabase instance' }, { status: 400 })

      await execAsync(`docker stop ${containerId}`)
      return NextResponse.json({ success: true })
    } catch (e) {
      return NextResponse.json({ error: 'Failed to stop container', detail: String(e) }, { status: 500 })
    }
  } catch (error) {
    console.error('stop-container error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
