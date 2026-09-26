import { handleFood } from '../server/ai/handlers.js';

/** Vercel serverless function: POST /api/food (photo analysis / corrections / explanations). */
export function POST(request: Request): Promise<Response> {
  return handleFood(request);
}
