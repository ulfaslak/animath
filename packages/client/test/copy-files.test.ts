import { describe, expect, it } from 'vitest';
import { FALLBACK_LANGUAGE, LANGUAGES } from '../src/copy/languages';
import {
	PLURAL_CATEGORIES,
	flatten,
	isPluralMessage,
	paramsOf,
	strayBraces,
	textsOf,
	type CopyTree,
	type Message
} from '../src/copy/translate';
import { copyCalls, svelteSources, tsSources } from './source';

/**
 * The copy files agree with each other and with the code. At run time a key
 * Danish lacks quietly shows in English, a key English lacks shows as the key
 * itself, and a translation that drops `{name}` prints a sentence with a hole
 * in it. Nothing else fails on any of these, so this file does.
 */

// Loaded through the YAML plugin in vite.config.ts, exactly as the game loads them.
const files = import.meta.glob('../src/copy/*.yaml', { eager: true, import: 'default' });
const raw = new Map<string, unknown>(
	Object.entries(files).map(([path, data]) => [path.replace(/^.*\/(.+)\.yaml$/, '$1'), data])
);
const messages = new Map<string, Map<string, Message>>(
	[...raw].map(([lang, tree]) => [lang, flatten((tree ?? {}) as CopyTree)])
);
const english = messages.get(FALLBACK_LANGUAGE) ?? new Map<string, Message>();

/** A group name: camelCase, or an engine id verbatim (`nut-toss`), so `species.${id}` finds it. */
const KEY = /^[a-z][a-zA-Z0-9]*(-[a-z0-9]+)*$/;

/** What is wrong with one copy file's shape: non-text leaves, empty text, bad keys, wrong plural forms. */
function shapeProblems(lang: string, node: unknown, path: string[] = []): string[] {
	const where = `${lang}.yaml ${path.length ? path.join('.') : '(the whole file)'}`;
	if (typeof node === 'string') return node.trim() === '' ? [`${where} is empty`] : [];
	if (node === null || typeof node !== 'object' || Array.isArray(node)) {
		return [`${where} is ${JSON.stringify(node)}, not text (quote it)`];
	}
	if (isPluralMessage(node)) {
		const forms = Object.keys(node).sort();
		const needed = [...new Intl.PluralRules(lang).resolvedOptions().pluralCategories].sort();
		const problems =
			forms.join() === needed.join()
				? []
				: [`${where} has plural forms ${forms.join('/')}; ${lang} needs ${needed.join('/')}`];
		for (const [form, text] of Object.entries(node)) {
			if (typeof text !== 'string' || text.trim() === '')
				problems.push(`${where}.${form} is empty or not text`);
		}
		return problems;
	}
	const problems: string[] = [];
	for (const [key, child] of Object.entries(node)) {
		if (!KEY.test(key))
			problems.push(`${where}: "${key}" is not a key (camelCase, or an engine id)`);
		if ((PLURAL_CATEGORIES as readonly string[]).includes(key)) {
			problems.push(
				`${where}: "${key}" names a plural form, so its group must hold plural forms only`
			);
		}
		problems.push(...shapeProblems(lang, child, [...path, key]));
	}
	return problems;
}

describe('copy files', () => {
	it('there is one file per language in the registry, and no other', () => {
		expect([...raw.keys()].sort()).toEqual([...LANGUAGES].sort());
		expect(LANGUAGES).toContain(FALLBACK_LANGUAGE);
	});

	it('every value is non-empty text, and plural messages have exactly the forms their language uses', () => {
		const problems = [...raw].flatMap(([lang, tree]) => shapeProblems(lang, tree));
		expect(problems).toEqual([]);
	});

	it('every language has exactly the keys English has', () => {
		const problems: string[] = [];
		for (const [lang, own] of messages) {
			for (const key of english.keys())
				if (!own.has(key)) problems.push(`${lang}.yaml lacks ${key}`);
			for (const key of own.keys())
				if (!english.has(key)) problems.push(`${lang}.yaml has ${key}, which en.yaml lacks`);
		}
		expect(problems).toEqual([]);
	});

	it('a message reads the same params in every language', () => {
		const problems: string[] = [];
		for (const [key, message] of english) {
			const want = [...paramsOf(message)].sort().join(', ');
			for (const [lang, own] of messages) {
				const theirs = own.get(key);
				if (theirs === undefined) continue;
				const got = [...paramsOf(theirs)].sort().join(', ');
				if (got !== want)
					problems.push(`${lang}.yaml ${key} reads {${got}}; en.yaml reads {${want}}`);
			}
		}
		expect(problems).toEqual([]);
	});

	it('every placeholder is well formed: {name} or {name.form}, camelCase, no stray braces', () => {
		const problems: string[] = [];
		for (const [lang, own] of messages) {
			for (const [key, message] of own) {
				for (const text of textsOf(message))
					if (strayBraces(text)) problems.push(`${lang}.yaml ${key}: ${text}`);
			}
		}
		expect(problems).toEqual([]);
	});

	it('every key the code passes to t() is in English, with the params its message reads', () => {
		const calls = [...svelteSources, ...tsSources].flatMap(([file, text]) => copyCalls(file, text));
		expect(calls.length).toBeGreaterThan(0);
		const problems: string[] = [];
		for (const call of calls) {
			for (const key of call.keys) {
				const message = english.get(key);
				const where = `${call.file}:${call.line} t('${key}')`;
				if (message === undefined) {
					problems.push(`${where}: no such key in en.yaml`);
					continue;
				}
				if (call.params === null) continue;
				const needed = [...paramsOf(message)];
				const missing = needed.filter((p) => !call.params!.includes(p));
				const unused = call.params.filter((p) => !needed.includes(p));
				if (missing.length)
					problems.push(
						`${where}: its message reads {${missing.join(', ')}}, which the call does not pass`
					);
				if (unused.length)
					problems.push(`${where}: passes ${unused.join(', ')}, which its message never reads`);
			}
		}
		expect(problems).toEqual([]);
	});
});
