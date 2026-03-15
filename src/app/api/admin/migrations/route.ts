import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateSession } from '@/lib/auth'
import { buildProjectViewModel } from '@/lib/instances/presentation'

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get('session')?.value
    if (!sessionToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    })

    const compatibilityProjects = projects
      .map((project) => buildProjectViewModel(project, 0))
      .filter((project) => project.provisioningMode === 'full_stack_isolated')

    return NextResponse.json({
      phase: 'phase-5-readonly',
      message:
        'Existing full-stack projects remain supported as compatibility-managed projects. Phase 5 does not perform in-place migrations.',
      projects: compatibilityProjects,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}