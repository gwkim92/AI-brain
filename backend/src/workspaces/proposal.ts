import { z } from 'zod';

export const WorkspaceProposalPayloadSchema = z.object({
  workspace_id: z.string().uuid(),
  workspace_name: z.string().min(1).max(160).optional(),
  cwd: z.string().min(1).max(400).optional(),
  command: z.string().min(1).max(2000),
  shell: z.string().min(1).max(200).optional()
});

export type WorkspaceProposalPayload = z.infer<typeof WorkspaceProposalPayloadSchema>;
