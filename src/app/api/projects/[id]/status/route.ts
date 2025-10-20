import { NextRequest, NextResponse } from 'next/server'

interface RouteContext {
  params: Promise<{ id: string }>
}
import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'

const execAsync = promisify(exec)

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const session = await validateSession(sessionToken)
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

  const projectId = id
  if (!projectId) return NextResponse.json({ error: 'Project id required' }, { status: 400 })

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (project.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const projectDir = path.join(process.cwd(), 'supabase-projects', project.slug)

    try {
      const { stdout } = await execAsync('supabase status -o json --workdir .', { cwd: projectDir, timeout: 20000, maxBuffer: 1024 * 1024 * 2 })
      try {
        const json = JSON.parse(stdout)
        return NextResponse.json({ status: json })
      } catch {
        return NextResponse.json({ error: 'Failed to parse supabase status output', raw: stdout }, { status: 500 })
      }
    } catch (cliErr) {
      return NextResponse.json({ error: 'Supabase CLI status failed', detail: String(cliErr) }, { status: 500 })
    }
  } catch (error) {
    console.error('Project status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
