import type { FastifyInstance } from 'fastify';

import { registerAssistantContextCrudRoutes } from './assistant/context-routes';
import { registerAssistantContextEventRoutes } from './assistant/event-routes';
import { registerAssistantContextRunRoute } from './assistant/run-route';
import type { RouteContext } from './types';

export async function assistantRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  registerAssistantContextCrudRoutes(app, ctx);
  registerAssistantContextEventRoutes(app, ctx);
  registerAssistantContextRunRoute(app, ctx);
}
