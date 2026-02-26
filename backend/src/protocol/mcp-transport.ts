import type { JarvisStore } from '../store/types';
import type { ProviderRouter } from '../providers/router';

export type McpStreamRequest = {
  origin?: string;
  payload: JsonRpcRequest;
};

export type McpTransportOptions = {
  allowedOrigins: string[];
};

export type McpStreamResult =
  | { accepted: true; response: JsonRpcResponse }
  | { accepted: false; reason: 'origin_not_allowed' };

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolHandler = (
  params: Record<string, unknown>,
  context: McpContext
) => Promise<unknown>;

export type McpContext = {
  store: JarvisStore;
  providerRouter: ProviderRouter;
  userId: string;
};

function createMcpTools(context: McpContext): Map<string, { definition: McpToolDefinition; handler: McpToolHandler }> {
  const tools = new Map<string, { definition: McpToolDefinition; handler: McpToolHandler }>();

  tools.set('memory_search', {
    definition: {
      name: 'memory_search',
      description: 'Search memory segments using text query. Returns relevant memories sorted by recency.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query text' },
          limit: { type: 'number', description: 'Max results to return', default: 10 }
        },
        required: ['query']
      }
    },
    handler: async (params) => {
      const limit = typeof params.limit === 'number' ? params.limit : 10;
      const segments = await context.store.listMemorySegments({
        userId: context.userId,
        limit
      });
      return {
        segments: segments.map((s) => ({
          id: s.id,
          type: s.segmentType,
          content: s.content,
          confidence: s.confidence,
          created_at: s.createdAt
        }))
      };
    }
  });

  tools.set('task_create', {
    definition: {
      name: 'task_create',
      description: 'Create a new task for JARVIS to process.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          mode: { type: 'string', enum: ['chat', 'execute', 'council', 'code', 'compute'], description: 'Task execution mode' },
          prompt: { type: 'string', description: 'Task prompt/instruction' }
        },
        required: ['title', 'mode', 'prompt']
      }
    },
    handler: async (params) => {
      const task = await context.store.createTask({
        userId: context.userId,
        mode: String(params.mode) as 'chat' | 'execute' | 'council' | 'code' | 'compute',
        title: String(params.title),
        input: { prompt: String(params.prompt), source: 'mcp' },
        idempotencyKey: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      });
      return { id: task.id, status: task.status, title: task.title };
    }
  });

  tools.set('mission_status', {
    definition: {
      name: 'mission_status',
      description: 'Get the status of missions, optionally filtered by status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'blocked', 'cancelled'], description: 'Filter by status' },
          limit: { type: 'number', description: 'Max results', default: 10 }
        }
      }
    },
    handler: async (params) => {
      const limit = typeof params.limit === 'number' ? params.limit : 10;
      const status = typeof params.status === 'string' ? params.status : undefined;
      const validStatuses = ['draft', 'planned', 'running', 'blocked', 'completed', 'failed'] as const;
      type ValidStatus = (typeof validStatuses)[number];
      const missionStatus = status && validStatuses.includes(status as ValidStatus)
        ? (status as ValidStatus)
        : undefined;
      const missions = await context.store.listMissions({
        userId: context.userId,
        status: missionStatus,
        limit
      });
      return {
        missions: missions.map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          steps: m.steps.length,
          created_at: m.createdAt
        }))
      };
    }
  });

  tools.set('radar_digest', {
    definition: {
      name: 'radar_digest',
      description: 'Get a digest of the latest tech radar recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['adopt', 'hold', 'discard'], description: 'Filter by decision' }
        }
      }
    },
    handler: async (params) => {
      const decision = typeof params.decision === 'string'
        ? params.decision as 'adopt' | 'hold' | 'discard'
        : undefined;
      const recs = await context.store.listRadarRecommendations(decision);
      return {
        recommendations: recs.slice(0, 20).map((r) => ({
          id: r.id,
          decision: r.decision,
          total_score: r.totalScore,
          expected_benefit: r.expectedBenefit,
          migration_cost: r.migrationCost,
          risk_level: r.riskLevel
        }))
      };
    }
  });

  return tools;
}

export async function handleMcpStreamRequest(
  request: McpStreamRequest,
  options: McpTransportOptions,
  context?: McpContext
): Promise<McpStreamResult> {
  if (!isOriginAllowed(request.origin, options.allowedOrigins)) {
    return { accepted: false, reason: 'origin_not_allowed' };
  }

  const { payload } = request;

  if (!context) {
    return {
      accepted: true,
      response: {
        jsonrpc: '2.0',
        id: payload.id,
        error: { code: -32603, message: 'MCP context not available' }
      }
    };
  }

  const tools = createMcpTools(context);

  switch (payload.method) {
    case 'tools/list': {
      const toolList = Array.from(tools.values()).map((t) => t.definition);
      return {
        accepted: true,
        response: { jsonrpc: '2.0', id: payload.id, result: { tools: toolList } }
      };
    }

    case 'tools/call': {
      const toolName = String(payload.params?.name ?? '');
      const toolArgs = (payload.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = tools.get(toolName);

      if (!tool) {
        return {
          accepted: true,
          response: {
            jsonrpc: '2.0',
            id: payload.id,
            error: { code: -32601, message: `Tool not found: ${toolName}` }
          }
        };
      }

      try {
        const result = await tool.handler(toolArgs, context);
        return {
          accepted: true,
          response: { jsonrpc: '2.0', id: payload.id, result }
        };
      } catch (err) {
        return {
          accepted: true,
          response: {
            jsonrpc: '2.0',
            id: payload.id,
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : 'Tool execution failed'
            }
          }
        };
      }
    }

    default:
      return {
        accepted: true,
        response: {
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32601, message: `Method not found: ${payload.method}` }
        }
      };
  }
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}
