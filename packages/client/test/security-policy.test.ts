import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Content-Security-Policy nginx sends with every page (nginx/app.conf):
 * a page of the game loads its own files from its own address and nothing
 * from another host, and runs no inline script but the ones it was built
 * with, each named by its hash. A change to one of those scripts changes its
 * hash, and the policy must learn the new one: this test prints it.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const conf = read('../../../nginx/app.conf');
const PAGES = {
	'packages/client/index.html': read('../index.html'),
	'nginx/502.html': read('../../../nginx/502.html')
};

function policy(): Map<string, string[]> {
	const header = /add_header Content-Security-Policy(?:-Report-Only)? "([^"]*)" always;/.exec(conf);
	if (!header) throw new Error('nginx/app.conf sends no Content-Security-Policy');
	const directives = new Map<string, string[]>();
	for (const part of header[1]!.split(';')) {
		const [name, ...sources] = part.trim().split(/\s+/);
		if (name) directives.set(name, sources);
	}
	return directives;
}

/** Each script a page runs from its own text: no `src`, and a type a browser runs. */
function inlineScripts(html: string): string[] {
	const scripts: string[] = [];
	for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
		const attributes = match[1] ?? '';
		if (/\ssrc=/.test(attributes)) continue;
		const type = /\stype="([^"]*)"/.exec(attributes)?.[1];
		if (type !== undefined && type !== 'module' && type !== 'text/javascript') continue;
		scripts.push(match[2]!);
	}
	return scripts;
}

const hashOf = (script: string) =>
	`'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`;

describe('the security policy', () => {
	it('names every inline script of the pages by its hash, and no other', () => {
		const wanted = Object.entries(PAGES).flatMap(([file, html]) =>
			inlineScripts(html).map((script) => ({ file, hash: hashOf(script) }))
		);
		const listed = (policy().get('script-src') ?? []).filter((s) => s.startsWith("'sha256-"));
		const missing = wanted.filter((w) => !listed.includes(w.hash));
		const stale = listed.filter((hash) => !wanted.some((w) => w.hash === hash));
		expect({ missing, stale }).toEqual({ missing: [], stale: [] });
		expect(wanted.length).toBeGreaterThan(0);
	});

	it('lets a page load from its own address only', () => {
		const allowed = new Set([
			"'self'",
			"'none'",
			"'unsafe-inline'",
			"'unsafe-eval'",
			'data:',
			'wss://$http_host',
			'ws://$http_host'
		]);
		const elsewhere: string[] = [];
		for (const [name, sources] of policy()) {
			for (const source of sources) {
				if (!allowed.has(source) && !source.startsWith("'sha256-")) {
					elsewhere.push(`${name} ${source}`);
				}
			}
		}
		expect(elsewhere).toEqual([]);
		expect(policy().get('default-src')).toEqual(["'self'"]);
	});

	it('stands behind pages that link and load no other host', () => {
		const away: string[] = [];
		for (const [file, html] of Object.entries(PAGES)) {
			for (const match of html.matchAll(/<(?:script|link)\s[^>]*?\b(?:src|href)="([^"]*)"/g)) {
				if (/^[a-z][a-z0-9+.-]*:\/\//i.test(match[1]!)) away.push(`${file}: ${match[1]}`);
			}
		}
		expect(away).toEqual([]);
	});
});
