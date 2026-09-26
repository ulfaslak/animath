import { COPY, FALLBACK_LANGUAGE, LANGUAGES, isLanguage, type Language } from './languages';
import { createTranslator, type Params, type Translate } from './translate';

export { FALLBACK_LANGUAGE, LANGUAGES, isLanguage, type Language };

/** Where this device remembers the language picked in the Language setting. */
export const LANGUAGE_STORAGE_KEY = 'animath.language';

/** Gaps in the copy are reported in development only; production shows the fallback quietly. */
const warn = import.meta.env.DEV ? (text: string) => console.warn(text) : undefined;

/** Replaced only when a copy file changes under the dev server (see the end of this file). */
let translate = $state.raw<Translate<Language>>(createTranslator(COPY, FALLBACK_LANGUAGE, warn));

/** What the browser says about language. Every field may be missing. */
export interface LanguageHints {
	/** `?lang=` in the page's address: wins for this visit, and is not remembered. */
	query: string | null;
	/** The language picked earlier on this device. */
	saved: string | null;
	/** `navigator.languages`: the browser's languages, most preferred first. */
	preferred: readonly string[];
}

/**
 * The language to start in: `?lang=`, else the one picked earlier on this
 * device, else the first of the browser's languages the game speaks
 * (`da-DK` counts as `da`), else English.
 */
export function chooseLanguage(hints: LanguageHints): Language {
	for (const tag of [hints.query, hints.saved, ...hints.preferred]) {
		const base = tag?.trim().toLowerCase().split(/[-_]/)[0];
		if (isLanguage(base)) return base;
	}
	return FALLBACK_LANGUAGE;
}

/** Reads the hints from the page. Storage can throw (blocked site data), so it is read defensively. */
export function readLanguageHints(): LanguageHints {
	if (typeof window === 'undefined') return { query: null, saved: null, preferred: [] };
	let saved: string | null = null;
	try {
		saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
	} catch {
		// No storage: the browser's languages decide.
	}
	const nav = window.navigator;
	return {
		query: new URLSearchParams(window.location.search).get('lang'),
		saved,
		preferred: nav.languages?.length ? nav.languages : nav.language ? [nav.language] : []
	};
}

function remember(lang: Language): void {
	try {
		if (typeof window !== 'undefined') window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
	} catch {
		// Not remembered on this device; the choice still holds until the page reloads.
	}
}

/** `<html lang>`: screen readers and hyphenation follow it. */
function showOnPage(lang: Language): void {
	if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

/**
 * The language on screen. Svelte markup that reads it, directly or through
 * `t()`, updates the moment it changes. Code outside Svelte (the Three.js
 * layer, if it ever draws words) reads `current` and listens with `onChange`.
 */
class LanguageView {
	#current = $state<Language>(FALLBACK_LANGUAGE);
	#listeners = new Set<(lang: Language) => void>();

	constructor(initial: Language) {
		this.#current = initial;
		showOnPage(initial);
	}

	get current(): Language {
		return this.#current;
	}

	/** Switch every word on screen now, and remember the choice on this device. */
	set(lang: Language): void {
		if (!isLanguage(lang)) return;
		remember(lang);
		if (lang === this.#current) return;
		this.#current = lang;
		showOnPage(lang);
		this.changed();
	}

	/**
	 * `listener` runs after every change of the words on screen: a new
	 * language, or (dev server only) an edited copy file. Returns the unsubscribe.
	 */
	onChange(listener: (lang: Language) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Tell the listeners the words changed. */
	changed(): void {
		for (const listener of [...this.#listeners]) listener(this.#current);
	}
}

export const language = new LanguageView(chooseLanguage(readLanguageHints()));

/**
 * The words for `key` in the language on screen, with `params` filled in:
 * `t('puzzle.keys')`, `t('battle.hits', { damage: 14 })`. Reactive in Svelte
 * markup. A key missing from the language shows in English; a key missing
 * from English shows as the key (and fails `copy-files.test.ts`).
 */
export function t(key: string, params?: Params): string {
	return translate(language.current, key, params);
}

/** A language's name in that language ("Dansk"), as the Language setting lists it. */
export function languageName(lang: Language): string {
	return translate(lang, 'language.name');
}

/**
 * Switch to the language `step` places along `LANGUAGES`, wrapping round:
 * every word on screen changes at once, and the choice is remembered on this
 * device (`language.set`). What the Language rows of the pause menu and the
 * title do.
 */
export function nextLanguage(step: 1 | -1): void {
	const i = LANGUAGES.indexOf(language.current);
	language.set(LANGUAGES[(i + step + LANGUAGES.length) % LANGUAGES.length]!);
}

// Dev server: an edited copy file swaps the words in place, without a reload
// and without losing the game on screen. The update stops here, so the
// `language` above is never re-created.
if (import.meta.hot) {
	import.meta.hot.accept('./languages', (next) => {
		if (!next) return;
		translate = createTranslator(next.COPY as typeof COPY, FALLBACK_LANGUAGE, warn);
		language.changed();
	});
}
