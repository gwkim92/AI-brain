import { describe, expect, it } from 'vitest';

import { validateCapabilityGraph } from '../graph-validator';
import { CapabilityRegistry } from '../registry';
import { createMemoryV2Repository } from '../../store/memory/v2-repositories';

describe('CapabilityRegistry', () => {
  it('registers modules and validates a compatible graph', async () => {
    const registry = new CapabilityRegistry(createMemoryV2Repository());

    await registry.registerModule({
      module_id: 'command.compiler',
      title: 'Command Compiler',
      description: 'Compile natural language commands',
      module_version: '1.0.0',
      abi_version: '1.x',
      input_schema_ref: 'schema://command-input',
      output_schema_ref: 'schema://execution-contract',
      required_permissions: [],
      dependencies: [],
      failure_modes: []
    });
    await registry.registerModule({
      module_id: 'retrieval.orchestrator',
      title: 'Retrieval Orchestrator',
      description: 'Collect evidence',
      module_version: '1.0.0',
      abi_version: '1.x',
      input_schema_ref: 'schema://execution-contract',
      output_schema_ref: 'schema://evidence-pack',
      required_permissions: [],
      dependencies: ['command.compiler@1.0.0'],
      failure_modes: []
    });

    const compiler = await registry.resolveManifest('command.compiler', '1.0.0');
    const retrieval = await registry.resolveManifest('retrieval.orchestrator', '1.0.0');
    if (!compiler || !retrieval) {
      throw new Error('expected manifests to resolve');
    }

    const result = validateCapabilityGraph({
      manifests: [compiler, retrieval],
      edges: [
        {
          from: { module_id: compiler.module_id, module_version: compiler.module_version },
          to: { module_id: retrieval.module_id, module_version: retrieval.module_version }
        }
      ]
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects graph with abi or schema mismatch', async () => {
    const registry = new CapabilityRegistry(createMemoryV2Repository());

    await registry.registerModule({
      module_id: 'module.a',
      title: 'Module A',
      description: '',
      module_version: '1.0.0',
      abi_version: '1.x',
      input_schema_ref: 'schema://a-in',
      output_schema_ref: 'schema://a-out',
      required_permissions: [],
      dependencies: [],
      failure_modes: []
    });
    await registry.registerModule({
      module_id: 'module.b',
      title: 'Module B',
      description: '',
      module_version: '1.0.0',
      abi_version: '2.x',
      input_schema_ref: 'schema://b-in',
      output_schema_ref: 'schema://b-out',
      required_permissions: [],
      dependencies: [],
      failure_modes: []
    });

    const moduleA = await registry.resolveManifest('module.a', '1.0.0');
    const moduleB = await registry.resolveManifest('module.b', '1.0.0');
    if (!moduleA || !moduleB) {
      throw new Error('expected manifests to resolve');
    }

    const result = validateCapabilityGraph({
      manifests: [moduleA, moduleB],
      edges: [
        {
          from: { module_id: 'module.a', module_version: '1.0.0' },
          to: { module_id: 'module.b', module_version: '1.0.0' }
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((item) => item.code)).toContain('abi_version_mismatch');
    expect(result.errors.map((item) => item.code)).toContain('schema_mismatch');
  });
});
