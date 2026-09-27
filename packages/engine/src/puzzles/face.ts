import type { Puzzle, PuzzleKind } from './types.js';

/**
 * A puzzle's question as numbers: what its prompt is written from
 * (`facePrompt`, the one formatter every prompt goes through), and all of a
 * puzzle a player near a battle is sent (`net/scene.ts`): numbers in the
 * places a kind puts them, never words and never the answer. Whoever sends
 * one can put numbers in it, but only numbers: the formatter on the other
 * side writes the sum.
 *
 * - `add`, `sub`, `mul`, `div`: `a + b = ?`, `a − b = ?`, `a × b = ?`,
 *   `a ÷ b = ?`, `numbers` `[a, b]`;
 * - `missing`: `a + ? = total`, or `a × ? = total` (`times`), `[a, total]`;
 * - `sequence`: the four numbers shown before the "?";
 * - `sqrt`: `√n = ?`, `[n]`.
 */
export interface PuzzleFace {
	kind: PuzzleKind;
	numbers: readonly number[];
	/** `missing` only: a number missing in a times table ("4 × ? = 20"), not in a sum ("7 + ? = 12"). */
	times?: true;
}

/** How many numbers each kind's prompt shows. */
export const FACE_NUMBERS: Readonly<Record<PuzzleKind, number>> = {
	add: 2,
	sub: 2,
	mul: 2,
	div: 2,
	missing: 2,
	sequence: 4,
	sqrt: 1
};

/**
 * The biggest number a face holds. The biggest any attack's puzzle shows is
 * 25,000 (a difficulty-10 division, 500 × 50 ÷ 50) and a sum's 20,000, so a
 * face never needs more than five digits: a thought bubble stays short.
 * `face.test.ts` pins it over every kind and difficulty.
 */
export const MAX_FACE_NUMBER = 99_999;

/**
 * The prompt a face is written as: "7 × 8 = ?", "7 + ? = 12", "2, 4, 8, 16, ?",
 * "√144 = ?". Every puzzle's prompt is made here, the generators' and the
 * doctor's alike, so a face read back from a prompt (`puzzleFace`) is written
 * again the same.
 */
export function facePrompt(face: PuzzleFace): string {
	const [a, b] = face.numbers;
	switch (face.kind) {
		case 'add':
			return `${a} + ${b} = ?`;
		case 'sub':
			return `${a} − ${b} = ?`;
		case 'mul':
			return `${a} × ${b} = ?`;
		case 'div':
			return `${a} ÷ ${b} = ?`;
		case 'missing':
			return `${a} ${face.times ? '×' : '+'} ? = ${b}`;
		case 'sequence':
			return `${face.numbers.join(', ')}, ?`;
		case 'sqrt':
			return `√${a} = ?`;
	}
}

/**
 * The face a puzzle's prompt was written from: the numbers in it, in order,
 * taken only when `facePrompt` writes exactly that prompt again from them, so
 * nothing but a prompt the formatter could have written is ever read as one.
 * Null for any other text, or a number past `MAX_FACE_NUMBER`.
 */
export function puzzleFace(puzzle: Pick<Puzzle, 'kind' | 'prompt'>): PuzzleFace | null {
	const { kind, prompt } = puzzle;
	if (!Object.hasOwn(FACE_NUMBERS, kind) || prompt.length > MAX_PROMPT_LENGTH) return null;
	const numbers = (prompt.match(/\d+/g) ?? []).map(Number);
	if (numbers.length !== FACE_NUMBERS[kind]) return null;
	if (numbers.some((n) => !Number.isSafeInteger(n) || n > MAX_FACE_NUMBER)) return null;
	const faces: PuzzleFace[] =
		kind === 'missing' ? [{ kind, numbers }, { kind, numbers, times: true }] : [{ kind, numbers }];
	return faces.find((face) => facePrompt(face) === prompt) ?? null;
}

/** Longer than any prompt a face writes: the four biggest numbers of a row and their commas. */
const MAX_PROMPT_LENGTH = 40;

/**
 * A face off the wire: a kind, exactly as many numbers as it shows, each
 * whole and from 0 to `MAX_FACE_NUMBER`, and `times` only on a `missing`
 * one. A new object of those fields alone, or null.
 */
export function readPuzzleFace(value: unknown): PuzzleFace | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const { kind, numbers, times } = value as Record<string, unknown>;
	if (typeof kind !== 'string' || !Object.hasOwn(FACE_NUMBERS, kind)) return null;
	const size = FACE_NUMBERS[kind as PuzzleKind];
	if (!Array.isArray(numbers) || numbers.length !== size) return null;
	const read: number[] = [];
	for (const n of numbers as readonly unknown[]) {
		if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > MAX_FACE_NUMBER) {
			return null;
		}
		read.push(n as number);
	}
	if (times === undefined) return { kind: kind as PuzzleKind, numbers: read };
	return times === true && kind === 'missing' ? { kind, numbers: read, times: true } : null;
}
