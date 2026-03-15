import { NextRequest, NextResponse } from 'next/server'

interface RouteContext {
  params: Promise<{ id: string }>
}
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { inspectProject } from '@/lib/project'

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

    const result = await inspectProject(project.id)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error, runtimeStatus: result.runtimeStatus },
        { status: result.code === 'unsupported_mode' || result.code === 'validation_error' ? 400 : 500 },
      )
    }

    return NextResponse.json({ status: result.status, runtimeStatus: result.runtimeStatus, note: result.note })
  } catch (error) {
    console.error('Project status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
