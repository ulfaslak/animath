import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The engine runs unchanged in the browser and on the server, and every
 * outcome must be reproducible from a seed. Two rules make that true, and
 * this test pins both:
 *   1. No imports from outside the package (no DOM, no Three.js, no Node).
 *   2. No ambient randomness or wall-clock reads.
 */
function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
	});
}

const files = walk(join(import.meta.dirname, '..', 'src'));

describe('engine purity', () => {
	it('has source files', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const src = readFileSync(file, 'utf8');
		const rel = file.slice(file.indexOf('/src/'));

		it(`${rel} imports only relative modules`, () => {
			const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
			for (const spec of imports) expect(spec, `${rel} imports ${spec}`).toMatch(/^\.\.?\//);
		});

		it(`${rel} never uses Math.random or Date.now`, () => {
			// Comments may mention them (they explain the rule); code may not.
			const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
			expect(code).not.toMatch(/Math\.random/);
			expect(code).not.toMatch(/Date\.now|new Date\(/);
		});
	}
});
