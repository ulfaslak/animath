import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY } from '../src/copy/language.svelte';
import { COPY, FALLBACK_LANGUAGE, LANGUAGES } from '../src/copy/languages';

/**
 * The page nginx shows while the game does not answer (nginx/502.html) is not
 * built from the copy files: nginx serves it on its own, from the server's
 * checkout, when the game's server is down. So it holds a copy of
 * `app.updating`, and this file checks the copy: in every language the game
 * speaks, word for word, the English also written into the page for a browser
 * that runs no script, and the language remembered where the game remembers it.
 */

const page = readFileSync(new URL('../../../nginx/502.html', import.meta.url), 'utf8');

function inPage(pattern: RegExp): string {
	const found = pattern.exec(page)?.[1];
	if (found === undefined) throw new Error(`nginx/502.html has nothing matching ${pattern}`);
	return found;
}

/** `app.updating` of one language, as its copy file writes it. */
function updating(lang: string): unknown {
	const app = (COPY as Record<string, Record<string, unknown>>)[lang]?.app;
	return (app as Record<string, unknown> | undefined)?.updating;
}

describe('the page shown while the game does not answer', () => {
	const copied: unknown = JSON.parse(
		inPage(/<script id="copy" type="application\/json">([\s\S]*?)<\/script>/)
	);

	it('carries app.updating for every language the game speaks, as the copy files write it', () => {
		expect(copied).toEqual(Object.fromEntries(LANGUAGES.map((lang) => [lang, updating(lang)])));
	});

	it("shows the fallback language's lines before any script runs", () => {
		expect({
			title: inPage(/<h1 id="title">([^<]*)<\/h1>/),
			body: inPage(/<p id="body">([^<]*)<\/p>/)
		}).toEqual(updating(FALLBACK_LANGUAGE));
		expect(inPage(/<html lang="([^"]*)">/)).toBe(FALLBACK_LANGUAGE);
	});

	it('reads the language the kid picked where the game keeps it', () => {
		expect(inPage(/localStorage\.getItem\('([^']*)'\)/)).toBe(LANGUAGE_STORAGE_KEY);
	});
});
