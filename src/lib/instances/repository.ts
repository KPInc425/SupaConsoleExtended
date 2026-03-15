import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { Project, ProjectEnvVar } from '@prisma/client'
import type { InstanceRuntimeStatus, PortAllocationMetadata, ProjectInstanceProfile } from './types'
import type { NormalizedProjectEnvVarWrite } from '@/lib/secrets/types'

interface CreateProjectRecordInput {
  name: string
  slug: string
  description?: string
  ownerId: string
  instance: ProjectInstanceProfile
  runtimeStatus?: InstanceRuntimeStatus
  portAllocation?: PortAllocationMetadata | null
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as Prisma.InputJsonValue
}

export async function createProjectRecord(input: CreateProjectRecordInput): Promise<Project> {
  return prisma.project.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      status: 'created',
      ownerId: input.ownerId,
      provisioningMode: input.instance.mode.key,
      topologyKind: input.instance.topology.key,
      runtimeKind: input.instance.runtime.key,
      runtimeStatus: input.runtimeStatus ?? 'created',
      topologyMetadata: toJsonValue(input.instance.topologyMetadata),
      runtimeMetadata: toJsonValue(input.instance.runtimeMetadata),
      portAllocation: toJsonValue(input.portAllocation ?? null),
      secretMetadata: toJsonValue(input.instance.secretMetadata),
    },
  })
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  return prisma.project.findUnique({ where: { id: projectId } })
}

export async function listProjectEnvVarRecords(projectId: string): Promise<ProjectEnvVar[]> {
  return prisma.projectEnvVar.findMany({ where: { projectId } })
}

export async function upsertProjectEnvVarRecords(
  projectId: string,
  envVars: NormalizedProjectEnvVarWrite[],
): Promise<void> {
  for (const envVar of envVars) {
    await prisma.projectEnvVar.upsert({
      where: {
        projectId_key: {
          projectId,
          key: envVar.key,
        },
      },
      update: {
        value: envVar.value,
        valueSource: envVar.valueSource,
        secretReference: envVar.secretReference,
        secretMetadata: toJsonValue(envVar.secretMetadata),
      },
      create: {
        projectId,
        key: envVar.key,
        value: envVar.value,
        valueSource: envVar.valueSource,
        secretReference: envVar.secretReference,
        secretMetadata: toJsonValue(envVar.secretMetadata),
      },
    })
  }
}

export async function updateProjectStatus(projectId: string, status: string): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: { status },
  })
}

export async function updateProjectRuntimeMetadata(projectId: string, runtimeMetadata: unknown): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: { runtimeMetadata: toJsonValue(runtimeMetadata) },
  })
}

interface ProjectInstanceStateUpdate {
  status?: string
  runtimeStatus?: string
  runtimeMetadata?: unknown
  portAllocation?: unknown
  secretMetadata?: unknown
}

export async function updateProjectInstanceState(
  projectId: string,
  updates: ProjectInstanceStateUpdate,
): Promise<void> {
  const data: Prisma.ProjectUpdateInput = {}

  if (updates.status !== undefined) data.status = updates.status
  if (updates.runtimeStatus !== undefined) data.runtimeStatus = updates.runtimeStatus
  if (updates.runtimeMetadata !== undefined) data.runtimeMetadata = toJsonValue(updates.runtimeMetadata)
  if (updates.portAllocation !== undefined) data.portAllocation = toJsonValue(updates.portAllocation)
  if (updates.secretMetadata !== undefined) data.secretMetadata = toJsonValue(updates.secretMetadata)

  if (Object.keys(data).length === 0) {
    return
  }

  await prisma.project.update({
    where: { id: projectId },
    data,
  })
}

export async function deleteProjectEnvVars(projectId: string): Promise<void> {
  await prisma.projectEnvVar.deleteMany({ where: { projectId } })
}

export async function deleteProjectRecord(projectId: string): Promise<void> {
  await prisma.project.delete({ where: { id: projectId } })
}