/**
 * Strings in engine output that read as words: a letter, a space and a letter
 * ("Go, Pip!"), or two letters in a row and a closing `.`, `!`, `?` or `…`
 * ("Caught!"), as `no-words.test.ts` reads the source.
 * The engine sends ids, codes and numbers, and puzzle prompts that are sums
 * ("7 + 5 = ?"); a worded string in a state or an event would be a sentence
 * the client could only show untranslated ([[DECISIONS]] § Copy and
 * languages). Nicknames are the player's own words and are skipped.
 */
export function wordedStrings(value: unknown, path = ''): string[] {
	if (typeof value === 'string') {
		const worded = /\p{L}\s+\p{L}/u.test(value) || /\p{L}{2}.*[.!?…]$/u.test(value);
		return worded ? [`${path}: ${value}`] : [];
	}
	if (Array.isArray(value)) return value.flatMap((v, i) => wordedStrings(v, `${path}[${i}]`));
	if (value !== null && typeof value === 'object') {
		return Object.entries(value).flatMap(([key, v]) =>
			key === 'nickname' ? [] : wordedStrings(v, path ? `${path}.${key}` : key)
		);
	}
	return [];
}
