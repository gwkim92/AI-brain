import { z } from 'zod';

export const AssistantContextStatusSchema = z.enum(['running', 'completed', 'failed']);

export const AssistantContextCreateSchema = z.object({
  client_context_id: z.string().min(1).max(120),
  source: z.string().min(1).max(120).default('inbox_quick_command'),
  intent: z.string().min(1).max(60).default('general'),
  prompt: z.string().min(1).max(8000),
  widget_plan: z.array(z.string().min(1).max(80)).max(20).default([]),
  task_id: z.string().uuid().optional()
});

export const AssistantContextUpdateSchema = z.object({
  status: AssistantContextStatusSchema.optional(),
  task_id: z.string().uuid().nullable().optional(),
  served_provider: z.enum(['openai', 'gemini', 'anthropic', 'local']).nullable().optional(),
  served_model: z.string().max(160).nullable().optional(),
  used_fallback: z.boolean().optional(),
  selection_reason: z.string().max(2000).nullable().optional(),
  output: z.string().max(20000).optional(),
  error: z.string().max(4000).nullable().optional()
});

export const AssistantContextListQuerySchema = z.object({
  status: AssistantContextStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80)
});

export const AssistantContextEventCreateSchema = z.object({
  event_type: z.string().min(1).max(120),
  data: z.record(z.string(), z.unknown()).default({})
});

export const AssistantContextEventListQuerySchema = z.object({
  since_sequence: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const AssistantContextGroundingEvidenceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const AssistantContextEventStreamQuerySchema = z.object({
  since_sequence: z.coerce.number().int().positive().optional(),
  poll_ms: z.coerce.number().int().min(150).max(2000).default(300),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(30000)
});

export const AssistantContextRunSchema = z.object({
  provider: z.enum(['auto', 'openai', 'gemini', 'anthropic', 'local']).optional(),
  strict_provider: z.boolean().optional(),
  task_type: z
    .enum(['chat', 'execute', 'council', 'code', 'compute', 'long_run', 'high_risk', 'radar_review', 'upgrade_execution'])
    .optional(),
  model: z.string().max(160).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().max(32000).optional(),
  force_rerun: z.boolean().default(false),
  client_run_nonce: z.string().min(1).max(160).optional()
});
