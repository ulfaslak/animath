import type { CopyTree } from './translate';

/**
 * The languages the game speaks, in the order the Language setting lists
 * them. Each has its copy in `copy/<code>.yaml`. To add one, write the file
 * and add its code here (DEVELOPMENT § Copy and languages).
 */
export const LANGUAGES = ['en', 'da'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Where a key missing from another language is looked up. Every key must exist here. */
export const FALLBACK_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
	return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Every copy file beside this one, parsed at build time by the YAML plugin in `vite.config.ts`. */
const files = import.meta.glob<CopyTree>('./*.yaml', { eager: true, import: 'default' });

/**
 * The copy of every language. A registered language without a file gets an
 * empty one, so all of it falls back to English; `copy-files.test.ts` fails first.
 */
export const COPY = Object.fromEntries(
	LANGUAGES.map((lang) => [lang, files[`./${lang}.yaml`] ?? {}])
) as Readonly<Record<Language, CopyTree>>;
