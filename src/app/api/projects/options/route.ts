import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'
import { assessSharedTopologyHealth } from '@/lib/config/project'
import {
  buildDefaultSelectionView,
  buildModeOptionViews,
} from '@/lib/instances/presentation'
import { loadSharedTopologyConfig } from '@/lib/instances/topology'

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

    const sharedTopology = await loadSharedTopologyConfig(process.cwd())
    const healthChecks = assessSharedTopologyHealth(sharedTopology)
    const healthStatus = healthChecks.some((check) => check.status === 'error') ? 'degraded' : 'ready'

    return NextResponse.json({
      sharedTopology,
      health: {
        status: healthStatus,
        checks: healthChecks,
      },
      modeOptions: buildModeOptionViews(sharedTopology),
      defaultSelection: buildDefaultSelectionView(sharedTopology),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}