import { handleStatus } from '../server/ai/handlers.js';

/** Vercel serverless function: GET /api/status (connection check, never exposes the key). */
export function GET(request: Request): Promise<Response> {
  return handleStatus(request);
}
