/**
 * The copy engine without a language store: flatten a copy file into
 * messages, pick a plural form, fill in `{placeholders}`, fall back to the
 * fallback language. Pure, so every rule is unit-tested with small made-up
 * files (`test/copy-runtime.test.ts`); `language.svelte.ts` wraps it with the
 * language on screen. The conventions are in DEVELOPMENT § Copy and languages.
 */

/** A parsed copy file: groups nest, and every leaf is a message. */
export interface CopyTree {
	readonly [key: string]: string | CopyTree;
}

/** CLDR plural categories. A group whose keys are only these, `other` included, is one plural message. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];
export type PluralMessage = { readonly [C in PluralCategory]?: string } & {
	readonly other: string;
};
export type Message = string | PluralMessage;

/**
 * What fills a `{placeholder}`. A number or a string prints as it is. An
 * object holds the forms of one thing, `{ name: 'Ræv', a: 'en ræv' }`, and the
 * message picks one with a dotted placeholder, `{animal.a}`; a plain string
 * (a nickname) stands for every form of itself.
 */
export type ParamValue = string | number | { readonly [form: string]: string };
export type Params = { readonly [name: string]: ParamValue };

/** `(language, key, params?) → text`. */
export type Translate<L extends string> = (lang: L, key: string, params?: Params) => string;

/** `{name}` or `{name.form}`: camelCase words. Anything else is not a placeholder. */
const PLACEHOLDER = /\{([a-z][a-zA-Z0-9]*)(?:\.([a-z][a-zA-Z0-9]*))?\}/g;

export function isPluralMessage(node: unknown): node is PluralMessage {
	if (!node || typeof node !== 'object') return false;
	const keys = Object.keys(node);
	return (
		keys.includes('other') &&
		keys.every((k) => (PLURAL_CATEGORIES as readonly string[]).includes(k))
	);
}

/**
 * Every message in a copy file by its dotted key. Leaves that are not strings
 * (a number, `true`, null) are left out, so `t()` shows the key for them;
 * `copy-files.test.ts` fails on them first.
 */
export function flatten(tree: CopyTree, prefix = '', into = new Map<string, Message>()) {
	for (const [key, node] of Object.entries(tree)) {
		const path = prefix === '' ? key : `${prefix}.${key}`;
		if (typeof node === 'string' || isPluralMessage(node)) into.set(path, node);
		else if (node !== null && typeof node === 'object') flatten(node, path, into);
	}
	return into;
}

/** Each text a message can show: the string, or every plural form. */
export function textsOf(message: Message): string[] {
	if (typeof message === 'string') return [message];
	return Object.values(message).filter((text): text is string => typeof text === 'string');
}

/**
 * The params a message reads, by name: `{count}` and `{animal.a}` give
 * `count` and `animal`. A plural message always reads `count`.
 */
export function paramsOf(message: Message): Set<string> {
	const names = new Set<string>(typeof message === 'string' ? [] : ['count']);
	for (const text of textsOf(message)) for (const m of text.matchAll(PLACEHOLDER)) names.add(m[1]!);
	return names;
}

/** Braces left over once the placeholders are taken out: a typo like `{name` or `{Name}`. */
export function strayBraces(text: string): boolean {
	return /[{}]/.test(text.replace(PLACEHOLDER, ''));
}

/**
 * A translator over a set of copy files. A key missing from `lang` is looked
 * up in `fallback`; a key missing from both is shown as the key itself. Each
 * such gap, and each placeholder with no param to fill it, is reported to
 * `warn` once (the dev build passes `console.warn`; production passes nothing).
 */
export function createTranslator<L extends string>(
	copy: Readonly<Record<L, CopyTree>>,
	fallback: NoInfer<L>,
	warn?: (text: string) => void
): Translate<L> {
	const messages = new Map<string, Map<string, Message>>();
	const plurals = new Map<string, Intl.PluralRules>();
	for (const lang of Object.keys(copy) as L[]) {
		messages.set(lang, flatten(copy[lang]));
		plurals.set(lang, new Intl.PluralRules(lang));
	}
	const warned = new Set<string>();
	const once = (text: string) => {
		if (!warn || warned.has(text)) return;
		warned.add(text);
		warn(text);
	};

	return (lang, key, params) => {
		let from: L = lang;
		let message = messages.get(lang)?.get(key);
		if (message === undefined && lang !== fallback) {
			from = fallback;
			message = messages.get(fallback)?.get(key);
			if (message !== undefined)
				once(`copy: "${key}" is missing from ${lang}.yaml; showing ${fallback}`);
		}
		if (message === undefined) {
			once(`copy: "${key}" is missing from ${fallback}.yaml`);
			return key;
		}
		const missing = (placeholder: string) => once(`copy: "${key}" was not given ${placeholder}`);
		const text =
			typeof message === 'string'
				? message
				: pluralForm(message, plurals.get(from)!, params, missing);
		return fill(text, from, params, missing);
	};
}

/** The form for `params.count` by the language's plural rules; `other` when there is no count. */
function pluralForm(
	message: PluralMessage,
	rules: Intl.PluralRules,
	params: Params | undefined,
	missing: (placeholder: string) => void
): string {
	const count = params?.count;
	if (typeof count !== 'number') {
		missing('{count}');
		return message.other;
	}
	return message[rules.select(count)] ?? message.other;
}

/**
 * Fill every placeholder. One with no value is left as it is, so the gap shows
 * on screen. A form that starts a sentence (the message's start, or after
 * `.`, `!` or `?` and a space) gets a capital first letter, so forms are
 * written the way they read mid-sentence ("et vildt egern") and still read
 * right first ("Et vildt egern dukker op!"). A plain string — a nickname, a
 * typed name — is never changed: it is shown as the kid wrote it.
 */
function fill(
	text: string,
	lang: string,
	params: Params | undefined,
	missing: (placeholder: string) => void
): string {
	return text.replace(
		PLACEHOLDER,
		(whole: string, name: string, form: string | undefined, at: number) => {
			const value = params?.[name];
			let out: unknown;
			let isForm = false;
			if (typeof value === 'string' || typeof value === 'number') out = String(value);
			else if (typeof value === 'object' && value !== null && form !== undefined) {
				out = value[form];
				isForm = true;
			}
			// Only text prints: `{animal.constructor}` finds a function, not a form.
			if (typeof out !== 'string') {
				missing(whole);
				return whole;
			}
			return isForm && /(^|[.!?]\s+)$/.test(text.slice(0, at)) ? capitalize(out, lang) : out;
		}
	);
}

function capitalize(text: string, lang: string): string {
	const code = text.codePointAt(0);
	if (code === undefined) return text;
	const first = String.fromCodePoint(code);
	return first.toLocaleUpperCase(lang) + text.slice(first.length);
}
