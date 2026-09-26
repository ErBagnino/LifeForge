/**
 * Server-only configuration. GEMINI_API_KEY exists only as an environment variable
 * (Vercel → Project → Settings → Environment Variables); it never reaches the browser.
 */

/**
 * Default model: Google's "latest Flash" alias, which always points to the current
 * multimodal Flash model (text + image, function calling, structured output) that is
 * available on the Gemini API Free Tier. Override with GEMINI_MODEL without code changes.
 */
export const DEFAULT_MODEL = 'gemini-flash-latest';

export function geminiKey(): string | undefined {
  const k = process.env.GEMINI_API_KEY?.trim();
  return k ? k : undefined;
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/** Request limits (Vercel's body limit is ~4.5 MB; photos are compressed to well under 1.5 MB). */
export const LIMITS = {
  chatBodyBytes: 3_000_000,
  foodBodyBytes: 4_200_000,
  maxOutputTokensChat: 2048,
  maxOutputTokensFood: 2048,
};
