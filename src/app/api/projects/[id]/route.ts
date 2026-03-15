import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { deleteProject } from '@/lib/project'
import { prisma } from '@/lib/db'
import { listProjectBackups } from '@/lib/project'
import { assessSharedTopologyHealth } from '@/lib/config/project'
import { loadSharedTopologyConfig } from '@/lib/instances/topology'
import { buildProjectViewModel } from '@/lib/instances/presentation'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const sessionToken = request.cookies.get('session')?.value

    if (!sessionToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    const project = await prisma.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [backups, sharedTopology] = await Promise.all([
      listProjectBackups(project.id).catch(() => []),
      loadSharedTopologyConfig(process.cwd()),
    ])
    const projectView = buildProjectViewModel(project, backups.length)
    const healthChecks = assessSharedTopologyHealth(sharedTopology, projectView.provisioningMode)

    return NextResponse.json({
      project: projectView,
      backups,
      sharedTopology,
      health: {
        status: healthChecks.some((check) => check.status === 'error') ? 'degraded' : 'ready',
        checks: healthChecks,
      },
    })
  } catch (error) {
    console.error('Get project detail error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const sessionToken = request.cookies.get('session')?.value
    
    if (!sessionToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    const project = await prisma.project.findUnique({ where: { id } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await deleteProject(id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete project error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}