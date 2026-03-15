import { prisma } from '@/lib/db'
import { getSystemConfigDefaults } from '@/lib/config/defaults'
import { assessSharedTopologyHealth } from '@/lib/config/project'
import { loadSharedTopologyConfig } from '@/lib/instances/topology'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    const sharedTopology = await loadSharedTopologyConfig(process.cwd())
    const configChecks = assessSharedTopologyHealth(sharedTopology)
    const configStatus = configChecks.some((check) => check.status === 'error') ? 'degraded' : 'healthy'

    return NextResponse.json(
      {
        status: configStatus,
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '0.1.0',
        checks: {
          database: { status: 'healthy' },
          configuration: {
            status: configStatus,
            defaults: getSystemConfigDefaults(process.cwd()),
            sharedTopology: {
              name: sharedTopology.name,
              settingsFilePath: sharedTopology.settingsFilePath,
              settingsSource: sharedTopology.settingsSource,
              defaultMode: sharedTopology.defaultMode,
            },
            checks: configChecks,
          },
        },
      },
      { status: 200 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 },
    )
  }
}
