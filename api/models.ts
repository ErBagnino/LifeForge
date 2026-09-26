import { handleModels } from '../server/ai/handlers.js';

/** Vercel serverless function: GET /api/models (model discovery, capabilities, Free Tier status, health). */
export function GET(request: Request): Promise<Response> {
  return handleModels(request);
}
