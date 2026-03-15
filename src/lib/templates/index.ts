import type { ProjectInstanceProfile } from '../instances/types'
import { describeDbIsolatedTemplateBoundary, renderDbIsolatedTemplatePlan } from './modes/dbIsolated'
import { describeFullStackTemplateBoundary, renderFullStackTemplatePlan } from './modes/fullStack'
import { describeSharedCoreTemplateBoundary, renderSharedCoreTemplatePlan } from './modes/sharedCore'
import type { ProjectTemplateBoundary, ProjectTemplateRenderInput, ProjectTemplateRenderPlan } from './types'

export function describeProjectTemplateBoundary(profile: ProjectInstanceProfile): ProjectTemplateBoundary {
  switch (profile.mode.key) {
    case 'shared_core_schema_isolated':
      return describeSharedCoreTemplateBoundary(profile)
    case 'db_isolated':
      return describeDbIsolatedTemplateBoundary(profile)
    case 'full_stack_isolated':
    default:
      return describeFullStackTemplateBoundary(profile)
  }
}

export async function renderProjectTemplatePlan(
  input: ProjectTemplateRenderInput,
): Promise<ProjectTemplateRenderPlan> {
  switch (input.profile.mode.key) {
    case 'shared_core_schema_isolated':
      return renderSharedCoreTemplatePlan(input)
    case 'db_isolated':
      return renderDbIsolatedTemplatePlan(input)
    case 'full_stack_isolated':
    default:
      return renderFullStackTemplatePlan(input)
  }
}