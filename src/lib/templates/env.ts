import { serializeEnvObject } from '../secrets/normalization'
import type { ProjectEnvRecord } from '../instances/env'
import type { TemplateArtifactDefinition } from './types'

export function renderEnvArtifacts(env: ProjectEnvRecord): TemplateArtifactDefinition[] {
  const content = serializeEnvObject(env)

  return [
    {
      id: 'project-env',
      kind: 'env',
      relativePath: '.env',
      description: 'Primary per-project runtime environment for the selected topology.',
      ownership: 'supaconsole',
      materialization: 'rendered',
      inspectable: true,
      content,
    },
    {
      id: 'docker-env',
      kind: 'env',
      relativePath: 'docker/.env',
      description: 'Docker workdir environment mirrored from the project root for local runtime tooling.',
      ownership: 'supaconsole',
      materialization: 'rendered',
      inspectable: true,
      content,
    },
  ]
}