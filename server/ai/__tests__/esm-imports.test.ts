import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Vercel runs /api as native ESM ("type": "module") without bundling, so every relative
 * import in the files the functions load must carry an explicit ".js" extension.
 * (Vite and Vitest resolve extensionless imports, so only this check catches it.)
 */
const DIRS = ['api', 'server/ai', 'src/ai/shared'];

describe('serverless ESM imports', () => {
  it('every relative import ends with .js', () => {
    const bad: string[] = [];
    for (const dir of DIRS) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
        const src = readFileSync(join(dir, f), 'utf8');
        for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) if (!m[1].endsWith('.js')) bad.push(`${dir}/${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
