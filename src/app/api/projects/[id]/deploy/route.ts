import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { deployProject } from '@/lib/project'
import { prisma } from '@/lib/db'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
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

  const result: { success: boolean; status?: unknown; note?: string; error?: string; code?: string } = await deployProject(id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.code === 'unsupported_mode' || result.code === 'validation_error' ? 400 : 500 },
      )
    }

    // If deployProject returned runtime status, include it so the UI can show URLs
  const payload: Record<string, unknown> = { success: true }
  if (result.status) payload.status = result.status
  if (result.note) payload.note = result.note

    return NextResponse.json(payload)
  } catch (error) {
    console.error('Deploy project error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}