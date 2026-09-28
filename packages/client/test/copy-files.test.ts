import { ALL_PUZZLE_TOPICS, ANIMALS, ITEMS, LINES } from '@mathgame/engine';
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
import { ITEM_FORMS } from '../src/items';
import { ANIMAL_FORMS } from '../src/names';
import { copyCalls, svelteSources, tsSources, type CopyCall } from './source';
import { turn } from './turn';

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
	if (path.length === 0 && (typeof node !== 'object' || node === null || Array.isArray(node))) {
		return [`${where} must be groups of keys, not ${JSON.stringify(node)}`];
	}
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

	it('every key the code passes to t() is in English, with the params its message reads', async () => {
		const calls: CopyCall[] = [];
		for (const [file, text] of [...svelteSources, ...tsSources]) {
			calls.push(...copyCalls(file, text));
			await turn();
		}
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
		// Every client source file parsed with TypeScript: 2.5 s alone at a load average of 12 to
		// 23, 7.3 s in the whole suite at 62, which scales to 25 s at 150; its loop turns after
		// each file.
	}, 90_000);

	it('every species in the catalog has every form, and a name for every attack', () => {
		const problems: string[] = [];
		for (const spec of ANIMALS) {
			const keys = [
				...ANIMAL_FORMS.map((form) => `species.${spec.id}.${form}`),
				...spec.attacks.map((attack) => `species.${spec.id}.attacks.${attack.id}`)
			];
			for (const key of keys) if (!english.has(key)) problems.push(`en.yaml lacks ${key}`);
			// A form is a phrase to fill in, never a sentence with a slot of its own.
			for (const form of ANIMAL_FORMS) {
				const message = english.get(`species.${spec.id}.${form}`);
				if (message !== undefined && paramsOf(message).size > 0) {
					problems.push(`species.${spec.id}.${form} reads params; a form is plain text`);
				}
			}
		}
		const known = new Set(ANIMALS.map((a) => a.id));
		for (const key of english.keys()) {
			const id = /^species\.([^.]+)\./.exec(key)?.[1];
			if (id !== undefined && !known.has(id))
				problems.push(`en.yaml has ${key}, but no species ${id}`);
		}
		expect(problems).toEqual([]);
	});

	it('every item in the catalog has every form and what it does, on sale or not', () => {
		const problems: string[] = [];
		for (const item of ITEMS) {
			for (const part of [...ITEM_FORMS, 'use']) {
				const key = `items.${item.id}.${part}`;
				const message = english.get(key);
				if (message === undefined) problems.push(`en.yaml lacks ${key}`);
				else if (paramsOf(message).size > 0) problems.push(`${key} reads params; it is plain text`);
			}
		}
		const known = new Set(ITEMS.map((i) => i.id));
		for (const key of english.keys()) {
			const id = /^items\.([^.]+)\./.exec(key)?.[1];
			if (id !== undefined && !known.has(id as never))
				problems.push(`en.yaml has ${key}, but no item ${id}`);
		}
		expect(problems).toEqual([]);
	});

	it('every puzzle topic has its words, so an attack can say what it asks', () => {
		const missing = ALL_PUZZLE_TOPICS.filter((topic) => !english.has(`battle.kinds.${topic}`));
		expect(missing).toEqual([]);
	});

	it("every line the engine can send is in English, reading exactly the engine's params", () => {
		const problems: string[] = [];
		for (const [key, kinds] of Object.entries(LINES)) {
			const params = Object.keys(kinds);
			const message = english.get(key);
			if (message === undefined) {
				problems.push(`en.yaml lacks ${key}`);
				continue;
			}
			const reads = [...paramsOf(message)].sort().join(', ');
			const sent = [...params].sort().join(', ');
			if (reads !== sent) problems.push(`${key} reads {${reads}}; the engine sends {${sent}}`);
		}
		expect(Object.keys(LINES).length).toBeGreaterThan(0);
		expect(problems).toEqual([]);
	});

	it('the witch doctor goes by his name, and the animals he takes are set free, in every line', () => {
		// The human renamed him and the tab: "in danish it's "heksedoktor" ... rename from
		// "dyrlæge". and "help home" should be "set free" i think. "slip fri" in danish."
		// So no line says "dyrlæge", "doktor" alone, or a doctor who isn't a witch doctor,
		// and none helps animals home (DESIGN § Voice and copy).
		const problems: string[] = [];
		const forbid = (lang: string, pattern: RegExp, why: string) => {
			for (const [key, message] of messages.get(lang) ?? []) {
				for (const text of textsOf(message)) {
					if (pattern.test(text)) problems.push(`${lang}.yaml ${key}: "${text}" ${why}`);
				}
			}
		};
		forbid('da', /dyrlæge/i, 'says dyrlæge, not heksedoktor');
		forbid('da', /(?<!hekse)doktor/i, 'says doktor, not heksedoktor');
		// "hjælpe", "hjælp" and the past, "hjalp": "hjalp ræven hjem".
		forbid('da', /\bhj[æa]lp\w*\s+(?:\S+\s+)?hjem\b/i, 'helps animals home, not slip fri');
		forbid('en', /(?<!witch )doctor/i, 'says doctor, not witch doctor');
		forbid('en', /\bhelp\w*\s+(?:\S+\s+)?home\b/i, 'helps animals home, not set free');
		expect(messages.has('da')).toBe(true);
		expect(problems).toEqual([]);
	});

	it('Danish has no comma before "og" or "eller" unless a sentence with its own subject follows (#73)', () => {
		// DESIGN § Voice and copy, Danish: "Skriv svaret og tryk på Enter", never with a
		// comma between two commands or before a list's last item; but "Jeg gør dem helt
		// raske, og du får mønter som tak!" keeps it, "du" being the next sentence's
		// subject. A subject is known by its pronoun or by an animal's placeholder.
		const SUBJECTS = new Set(
			'jeg du han hun den det vi de man der min mit mine din dit dine vores jeres deres'.split(' ')
		);
		const problems: string[] = [];
		for (const [key, message] of messages.get('da') ?? []) {
			for (const text of textsOf(message)) {
				for (const [comma, , next] of text.matchAll(/,\s+(og|eller)\s+(\S+)/g)) {
					if (!SUBJECTS.has(next!.toLowerCase()) && !next!.startsWith('{')) {
						problems.push(`da.yaml ${key}: "${comma}…" in "${text}"`);
					}
				}
			}
		}
		expect(messages.has('da')).toBe(true);
		expect(problems).toEqual([]);
	});
});
