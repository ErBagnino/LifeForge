import { handleChat } from '../server/ai/handlers.js';

/** Vercel serverless function: POST /api/ai (Coach step with function calling). */
export function POST(request: Request): Promise<Response> {
  return handleChat(request);
}
