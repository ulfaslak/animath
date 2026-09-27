/**
 * STAND-IN for the engine's `names.ts`, which `feat/worlds-names` is
 * writing: the same signature, `checkName(raw)`, so the swap is one import.
 * It follows [[DECISIONS]]' name rules without the rude-word list: trimmed,
 * NFC, 2–16 characters, letters of any script and digits, single spaces and
 * hyphens only between them. Delete this file when the engine's lands.
 */
export type NameCheck =
	{ ok: true; name: string } | { ok: false; reason: 'empty' | 'short' | 'long' | 'chars' | 'rude' };

const SHAPE = /^[\p{L}\p{M}\p{N}]+(?:[ -][\p{L}\p{M}\p{N}]+)*$/u;

export function checkName(raw: string): NameCheck {
	const name = raw.normalize('NFC').trim();
	if (name.length === 0) return { ok: false, reason: 'empty' };
	const length = [...name].length;
	if (length < 2) return { ok: false, reason: 'short' };
	if (length > 16) return { ok: false, reason: 'long' };
	if (!SHAPE.test(name)) return { ok: false, reason: 'chars' };
	return { ok: true, name };
}
