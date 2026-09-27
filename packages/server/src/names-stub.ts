/**
 * TEMPORARY: a stand-in for the engine's `names.ts`, which `feat/worlds-names`
 * is writing with exactly this signature. Delete this file and import
 * `checkName` and `nameKey` from '@mathgame/engine' once that lands.
 */

export type NameRefusal = 'empty' | 'short' | 'long' | 'chars' | 'rude';

export type NameCheck = { ok: true; name: string } | { ok: false; reason: NameRefusal };

const ALLOWED = /^[\p{L}\p{M}\p{Nd}]+(?:[ -][\p{L}\p{M}\p{Nd}]+)*$/u;

export function checkName(raw: string): NameCheck {
	if (raw.length > 200) return { ok: false, reason: 'long' };
	const name = raw.trim().normalize('NFC');
	if (name.length === 0) return { ok: false, reason: 'empty' };
	const length = [...name].length;
	if (length < 2) return { ok: false, reason: 'short' };
	if (length > 16) return { ok: false, reason: 'long' };
	if (!ALLOWED.test(name)) return { ok: false, reason: 'chars' };
	return { ok: true, name };
}

export function nameKey(name: string): string {
	return name.normalize('NFC').toLowerCase();
}
