import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { backupProject, listProjectBackups } from '@/lib/project'

interface RouteContext {
  params: Promise<{ id: string }>
}

async function resolveOwnedProject(projectId: string, sessionUserId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return { error: NextResponse.json({ error: 'Project not found' }, { status: 404 }) }
  }

  if (project.ownerId !== sessionUserId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { project }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const session = await validateSession(sessionToken)
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const { id } = await params
    const ownership = await resolveOwnedProject(id, session.user.id)
    if (ownership.error) {
      return ownership.error
    }

    const backups = await listProjectBackups(id)
    return NextResponse.json({ backups })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const session = await validateSession(sessionToken)
    if (!session) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const { id } = await params
    const ownership = await resolveOwnedProject(id, session.user.id)
    if (ownership.error) {
      return ownership.error
    }

    const result = await backupProject(id)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.code === 'validation_error' ? 400 : 500 },
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}