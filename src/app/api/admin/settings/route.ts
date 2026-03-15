import { promises as fs } from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateSession } from '@/lib/auth'
import { getSystemConfigDefaults } from '@/lib/config/defaults'
import { assessSharedTopologyHealth } from '@/lib/config/project'
import { summarizeProjectCounts } from '@/lib/instances/presentation'
import { loadSharedTopologyConfig } from '@/lib/instances/topology'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as JsonRecord
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

async function ensureAuthenticated(request: NextRequest) {
  const sessionToken = request.cookies.get('session')?.value
  if (!sessionToken) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const session = await validateSession(sessionToken)
  if (!session) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) }
  }

  return { session }
}

async function buildResponsePayload() {
  const workspaceRoot = process.cwd()
  const defaults = getSystemConfigDefaults(workspaceRoot)
  const sharedTopology = await loadSharedTopologyConfig(workspaceRoot)
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      provisioningMode: true,
      runtimeStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  const healthChecks = assessSharedTopologyHealth(sharedTopology)

  return {
    defaults,
    sharedTopology,
    health: {
      status: healthChecks.some((check) => check.status === 'error') ? 'degraded' : 'ready',
      checks: healthChecks,
    },
    projectCounts: summarizeProjectCounts(projects),
    compatibilityCohort: projects
      .filter((project) => project.provisioningMode === 'full_stack_isolated')
      .map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        runtimeStatus: project.runtimeStatus,
        createdAt: project.createdAt.toISOString(),
      })),
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await ensureAuthenticated(request)
    if (auth.error) return auth.error

    return NextResponse.json(await buildResponsePayload())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await ensureAuthenticated(request)
    if (auth.error) return auth.error

    const body = (await request.json().catch(() => ({}))) as JsonRecord
    const sharedPostgres = asRecord(body.sharedPostgres)
    const sharedServices = asRecord(body.sharedServices)

    const payload = {
      name: readString(body.name) ?? 'local-shared',
      defaultMode: readString(body.defaultMode) ?? 'full_stack_isolated',
      sharedPostgres: {
        adminUrl: readString(sharedPostgres.adminUrl),
        host: readString(sharedPostgres.host),
        port: readNumber(sharedPostgres.port),
        adminDatabase: readString(sharedPostgres.adminDatabase),
        schemaDatabase: readString(sharedPostgres.schemaDatabase),
      },
      sharedServices: {
        apiUrl: readString(sharedServices.apiUrl),
        studioUrl: readString(sharedServices.studioUrl),
        databaseUrl: readString(sharedServices.databaseUrl),
        authUrl: readString(sharedServices.authUrl),
        storageUrl: readString(sharedServices.storageUrl),
        realtimeUrl: readString(sharedServices.realtimeUrl),
        mailUrl: readString(sharedServices.mailUrl),
      },
    }

    const filePath = getSystemConfigDefaults(process.cwd()).topologySettingsFilePath
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')

    return NextResponse.json(await buildResponsePayload())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}