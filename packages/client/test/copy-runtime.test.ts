import { afterEach, describe, expect, it, vi } from 'vitest';
import { language, languageName, t } from '../src/copy';
import {
	LANGUAGE_STORAGE_KEY,
	chooseLanguage,
	readLanguageHints
} from '../src/copy/language.svelte';
import { createTranslator, type CopyTree } from '../src/copy/translate';

/**
 * How `t()` turns a key into words: placeholders, forms, plurals, capitals,
 * the fall back to English, and which language the game starts in. Made-up
 * copy files keep each rule visible; the real files are checked in
 * `copy-files.test.ts`.
 */

const en: CopyTree = {
	hello: 'Hello, {name}!',
	caught: 'You caught {animal.a}!',
	appears: '{animal.aWild} appears!',
	missed: 'Missed! {animal.theWild} shrugs it off.',
	twice: '{name} and {name}',
	points: { one: '{count} point', other: '{count} points' },
	onlyEnglish: 'Only in English',
	group: { inner: 'Inner' }
};
const da: CopyTree = {
	hello: 'Hej, {name}!',
	caught: 'Du fangede {animal.a}!',
	appears: '{animal.aWild} dukker op!',
	missed: 'Forbi! {animal.theWild} ryster det af sig.',
	twice: '{name} og {name}',
	points: { one: '{count} point', other: '{count} point' },
	group: { inner: 'Indre' }
};
const squirrel = {
	name: 'Egern',
	a: 'et egern',
	aWild: 'et vildt egern',
	theWild: 'det vilde egern'
};

function translator() {
	const warnings: string[] = [];
	const tr = createTranslator({ en, da }, 'en', (text) => warnings.push(text));
	return { tr, warnings };
}

describe('createTranslator', () => {
	it('fills placeholders with strings and numbers, every time one appears', () => {
		const { tr, warnings } = translator();
		expect(tr('en', 'hello', { name: 'Nutty' })).toBe('Hello, Nutty!');
		expect(tr('da', 'twice', { name: 7 })).toBe('7 og 7');
		expect(warnings).toEqual([]);
	});

	it('picks a form from an object param, and a plain string stands for every form', () => {
		const { tr } = translator();
		expect(tr('da', 'caught', { animal: squirrel })).toBe('Du fangede et egern!');
		expect(tr('da', 'caught', { animal: 'Nøddi' })).toBe('Du fangede Nøddi!');
	});

	it('capitalises a value that starts a sentence, and only then', () => {
		const { tr } = translator();
		expect(tr('da', 'appears', { animal: squirrel })).toBe('Et vildt egern dukker op!');
		expect(tr('da', 'missed', { animal: squirrel })).toBe(
			'Forbi! Det vilde egern ryster det af sig.'
		);
		expect(tr('da', 'caught', { animal: squirrel })).toBe('Du fangede et egern!');
		expect(tr('da', 'hello', { name: 'æbletræ' })).toBe('Hej, æbletræ!');
		expect(tr('da', 'appears', { animal: { aWild: 'ørnen' } })).toBe('Ørnen dukker op!');
	});

	it("chooses the plural form by the language's own rules", () => {
		const { tr } = translator();
		expect([0, 1, 2, 21].map((count) => tr('en', 'points', { count }))).toEqual([
			'0 points',
			'1 point',
			'2 points',
			'21 points'
		]);
		expect(tr('da', 'points', { count: 1 })).toBe('1 point');
	});

	it('leaves a placeholder with no value on screen and warns once', () => {
		const { tr, warnings } = translator();
		expect(tr('en', 'hello')).toBe('Hello, {name}!');
		expect(tr('en', 'hello')).toBe('Hello, {name}!');
		expect(tr('en', 'caught', { animal: { name: 'Fox' } })).toBe('You caught {animal.a}!');
		expect(tr('en', 'points', {})).toBe('{count} points');
		expect(warnings).toEqual([
			'copy: "hello" was not given {name}',
			'copy: "caught" was not given {animal.a}',
			'copy: "points" was not given {count}'
		]);
	});

	it('prints only text: a lookup that finds a function is a gap', () => {
		const { tr } = translator();
		const tricky = createTranslator({ en: { x: '{animal.constructor} {toString}' } }, 'en');
		expect(tricky('en', 'x', { animal: squirrel })).toBe('{animal.constructor} {toString}');
		// A null from an untyped caller (an opponent not there yet) is a gap too, not a crash.
		expect(tr('en', 'caught', { animal: null as never })).toBe('You caught {animal.a}!');
		expect(tr('en', 'caught', { animal: { a: 'a Fox', name: 'Fox' } })).toBe('You caught a Fox!');
	});

	it('shows a key missing from Danish in English, and warns once', () => {
		const { tr, warnings } = translator();
		expect(tr('da', 'onlyEnglish')).toBe('Only in English');
		expect(tr('da', 'onlyEnglish')).toBe('Only in English');
		expect(warnings).toEqual(['copy: "onlyEnglish" is missing from da.yaml; showing en']);
	});

	it('shows a key missing from English as the key itself', () => {
		const { tr, warnings } = translator();
		expect(tr('da', 'no.such.key')).toBe('no.such.key');
		expect(tr('en', 'group')).toBe('group');
		expect(tr('en', 'group.inner')).toBe('Inner');
		expect(warnings).toEqual([
			'copy: "no.such.key" is missing from en.yaml',
			'copy: "group" is missing from en.yaml'
		]);
	});

	it('says nothing when no warn function is given (the production build)', () => {
		const tr = createTranslator({ en, da }, 'en');
		expect(tr('da', 'onlyEnglish')).toBe('Only in English');
	});
});

describe('chooseLanguage', () => {
	const none = { query: null, saved: null, preferred: [] };

	it('prefers ?lang=, then the saved choice, then the browser, then English', () => {
		expect(chooseLanguage({ query: 'da', saved: 'en', preferred: ['en-US'] })).toBe('da');
		expect(chooseLanguage({ query: null, saved: 'da', preferred: ['en-US'] })).toBe('da');
		expect(chooseLanguage({ query: null, saved: null, preferred: ['da-DK', 'en'] })).toBe('da');
		expect(chooseLanguage(none)).toBe('en');
	});

	it('reads region tags and odd casing, and skips languages the game does not speak', () => {
		expect(chooseLanguage({ ...none, preferred: ['DA_dk'] })).toBe('da');
		expect(chooseLanguage({ ...none, preferred: ['de-DE', 'da'] })).toBe('da');
		expect(chooseLanguage({ ...none, preferred: ['en-US', 'da-DK'] })).toBe('en');
		expect(chooseLanguage({ query: 'fr', saved: 'klingon', preferred: ['sv'] })).toBe('en');
		expect(chooseLanguage({ query: '', saved: '', preferred: [''] })).toBe('en');
	});
});

describe('the language on screen', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		language.set('en');
	});

	it('t() follows language.set() at once, from the real copy files', () => {
		language.set('en');
		expect(t('puzzle.keys')).toBe('Type the answer, then press Enter');
		language.set('da');
		expect(language.current).toBe('da');
		expect(t('puzzle.keys')).toBe('Skriv svaret, og tryk så på Enter');
	});

	it('names every language in itself, whatever is on screen', () => {
		language.set('en');
		expect(languageName('da')).toBe('Dansk');
		expect(languageName('en')).toBe('English');
	});

	it('tells onChange listeners about a change, not about a repeat', () => {
		language.set('en');
		const heard: string[] = [];
		const stop = language.onChange((lang) => heard.push(lang));
		language.set('da');
		language.set('da');
		language.set('en');
		stop();
		language.set('da');
		expect(heard).toEqual(['da', 'en']);
	});

	it('ignores a language the game does not speak', () => {
		language.set('en');
		language.set('fr' as never);
		expect(language.current).toBe('en');
	});

	it('remembers the choice on this device, and sets <html lang>', () => {
		const stored = new Map<string, string>();
		vi.stubGlobal('window', {
			localStorage: { setItem: (k: string, v: string) => stored.set(k, v) }
		});
		vi.stubGlobal('document', { documentElement: { lang: 'en' } });
		language.set('da');
		expect(stored.get(LANGUAGE_STORAGE_KEY)).toBe('da');
		expect(document.documentElement.lang).toBe('da');
	});

	it('still switches when storage throws (blocked site data)', () => {
		vi.stubGlobal('window', {
			localStorage: {
				setItem: () => {
					throw new Error('SecurityError');
				}
			}
		});
		language.set('da');
		expect(t('puzzle.keys')).toBe('Skriv svaret, og tryk så på Enter');
	});

	it('reads ?lang=, the saved choice and the browser languages from the page', () => {
		vi.stubGlobal('window', {
			localStorage: { getItem: (k: string) => (k === LANGUAGE_STORAGE_KEY ? 'da' : null) },
			location: { search: '?zoo&lang=en' },
			navigator: { languages: ['de-DE', 'da'], language: 'de-DE' }
		});
		expect(readLanguageHints()).toEqual({ query: 'en', saved: 'da', preferred: ['de-DE', 'da'] });
	});

	it('reads no saved choice when storage throws', () => {
		vi.stubGlobal('window', {
			get localStorage(): Storage {
				throw new Error('SecurityError');
			},
			location: { search: '' },
			navigator: { languages: [], language: 'da-DK' }
		});
		expect(readLanguageHints()).toEqual({ query: null, saved: null, preferred: ['da-DK'] });
	});
});
