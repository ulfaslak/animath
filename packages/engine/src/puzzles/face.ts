import { isPictureKind, type Puzzle, type PuzzleKind } from './types.js';

/**
 * A puzzle's question as numbers: what its prompt is written from
 * (`facePrompt`, the one formatter every prompt goes through), and all of a
 * puzzle a player near a battle is sent (`net/fight.ts`): numbers in the
 * places a kind puts them, never words and never the answer. Whoever sends
 * one can put numbers in it, but only numbers: the formatter on the other
 * side writes the sum, and a picture kind's words and picture are the
 * client's, drawn from these numbers alone.
 *
 * - `add`, `sub`, `mul`, `div`: `a + b = ?`, `a − b = ?`, `a × b = ?`,
 *   `a ÷ b = ?`, `numbers` `[a, b]`;
 * - `missing`: `a + ? = total`, or `a × ? = total` (`times`), `[a, total]`;
 * - `sequence`: the four numbers shown before the "?";
 * - `sqrt`: `√n = ?`, `[n]`;
 * - `balance`: `[form, a, b, c]`, one of `BALANCE_FORMS` ("8 + □ = 5 + 6");
 * - the picture kinds (#191), each a fixed row of numbers, and nothing in it
 *   the kid is not shown:
 *   - `thermometer`: `[how, a, b]`, `how` one of `THERMOMETER`: it is `a`°
 *     and gets `b`° colder or warmer, or it went from `a`° to `b`° (how many
 *     degrees warmer, or colder). The one face whose numbers go below 0;
 *   - `kroner`: `[how, ones, twos, fives, tens, twenties, fifties, hundreds,
 *     two-hundreds, p, q]`: the coins and notes in the picture (`KRONER`
 *     their values), counted (`how` 0), paid for a thing costing `p` (1), or
 *     for two costing `p` and `q` (2);
 *   - `fraction`: `[n, d, amount]`, n/d of `amount`;
 *   - `shape`: `[how, w, h, cw, ch, grid]`, the floor (`how` 0) or the fence
 *     (1) of a `w` × `h` rectangle with a `cw` × `ch` corner cut away at its
 *     top right (an L, or none when both are 0), drawn in squares when
 *     `grid` is 1 and with its sides' lengths written on it when 0; or a
 *     side missing (`how` 2, the floor has `h` squares; 3, the fence is `h`
 *     long), the bottom `w` long and the other `cw`, `ch` and `grid` 0;
 *   - `barchart`: `[how, scale, i, j, bars, v1 … v5]`: `bars` bars of
 *     those heights (the rest 0), the lines across every `scale`; read bar
 *     `i` (`how` 0), by how much `i` beats `j` (1), `i` and `j` together
 *     (2) or every bar (3);
 *   - `clock`: `[how, h, m, dh, dm]`: the clock shows `h`:`m` (1 to 12,
 *     0 to 59); what time it is (`how` 0), `dh` hours and `dm` minutes
 *     later (1), or that long before (2).
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
	sqrt: 1,
	thermometer: 3,
	kroner: 11,
	fraction: 3,
	shape: 6,
	barchart: 10,
	clock: 5,
	balance: 4
};

/**
 * The biggest number a face holds. The biggest any attack's puzzle shows is
 * 25,000 (a difficulty-10 division, 500 × 50 ÷ 50) and a sum's 20,000, so a
 * face never needs more than five digits: a thought bubble stays short.
 * `face.test.ts` pins it over every kind and difficulty.
 */
export const MAX_FACE_NUMBER = 99_999;

/** What a thermometer face's first number says: colder, warmer, or how far it went up or down. */
export const THERMOMETER = { colder: 0, warmer: 1, rose: 2, fell: 3 } as const;

/** The Danish money a `kroner` face counts, in its order: coins of 1 to 20 kroner, notes of 50 to 200. */
export const KRONER = [1, 2, 5, 10, 20, 50, 100, 200] as const;

/** The coins and notes a kroner face may show at once: more would not fit the picture. */
const MAX_KRONER_PIECES = 10;

/** The lines a bar chart may be drawn with, and the most bars and lines it has. */
const BAR_SCALES = [1, 2, 5, 10] as const;
export const MAX_BARS = 5;
export const MAX_BAR_LINES = 10;

/** The longest side of a shape drawn in squares, and of one with its lengths written on. */
const MAX_GRID_SIDE = 10;
const MAX_SHAPE_SIDE = 30;

/**
 * The balance's forms, by `form`: the box stands for the number missing, and
 * both sides weigh the same.
 */
const BALANCE_FORMS: readonly ((a: number, b: number, c: number) => string)[] = [
	(a, b, c) => `${a} + □ = ${b} + ${c}`,
	(a, b, c) => `${a} − □ = ${b} − ${c}`,
	(a, b, c) => `${a} × □ = ${b} × ${c}`,
	(a, b, c) => `${a} × □ + ${b} = ${c}`,
	(a, b, c) => `${a} × □ − ${b} = ${c}`
];

/**
 * The prompt a face is written as: "7 × 8 = ?", "7 + ? = 12", "2, 4, 8, 16, ?",
 * "√144 = ?", "8 + □ = 5 + 6", and a picture kind's numbers as they are,
 * "thermometer(0, 3, 5)". Every puzzle's prompt is made here, the
 * generators' and the doctor's alike, so a face read back from a prompt
 * (`puzzleFace`) is written again the same.
 */
export function facePrompt(face: PuzzleFace): string {
	const [a, b, c, d] = face.numbers as number[];
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
			return face.times ? `${a} × ? = ${b}` : `${a} + ? = ${b}`;
		case 'sequence':
			return `${face.numbers.join(', ')}, ?`;
		case 'sqrt':
			return `√${a} = ?`;
		case 'balance':
			return BALANCE_FORMS[a!]?.(b!, c!, d!) ?? '';
		case 'thermometer':
		case 'kroner':
		case 'fraction':
		case 'shape':
		case 'barchart':
		case 'clock':
			return `${face.kind}(${face.numbers.join(', ')})`;
	}
}

/**
 * The face a puzzle's prompt was written from: the numbers in it, in order,
 * taken only when `facePrompt` writes exactly that prompt again from them
 * and they are a face the kind could show (`faceFits`), so nothing but a
 * prompt the formatter could have written is ever read as one. Null for any
 * other text, or a number past `MAX_FACE_NUMBER`.
 */
export function puzzleFace(puzzle: Pick<Puzzle, 'kind' | 'prompt'>): PuzzleFace | null {
	const { kind, prompt } = puzzle;
	if (
		!Object.prototype.hasOwnProperty.call(FACE_NUMBERS, kind) ||
		prompt.length > MAX_PROMPT_LENGTH
	)
		return null;
	const numbers = (prompt.match(isPictureKind(kind) ? /-?\d+/g : /\d+/g) ?? []).map(Number);
	const size = kind === 'balance' ? FACE_NUMBERS[kind] - 1 : FACE_NUMBERS[kind];
	if (numbers.length !== size) return null;
	if (numbers.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > MAX_FACE_NUMBER)) return null;
	const faces: PuzzleFace[] =
		kind === 'missing'
			? [
					{ kind, numbers },
					{ kind, numbers, times: true }
				]
			: kind === 'balance'
				? BALANCE_FORMS.map((_, form) => ({ kind, numbers: [form, ...numbers] }))
				: [{ kind, numbers }];
	return faces.find((face) => faceFits(face) && facePrompt(face) === prompt) ?? null;
}

/** Longer than any prompt a face writes: a kroner face's eleven numbers, its two prices in the hundreds. */
const MAX_PROMPT_LENGTH = 64;

/**
 * A face off the wire: a kind, exactly as many numbers as it shows, each
 * whole and from 0 to `MAX_FACE_NUMBER` (down to −`MAX_FACE_NUMBER` on a
 * thermometer), `times` only on a `missing` one, and a face the kind could
 * show (`faceFits`). A new object of those fields alone, or null.
 */
export function readPuzzleFace(value: unknown): PuzzleFace | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const { kind, numbers, times } = value as Record<string, unknown>;
	if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(FACE_NUMBERS, kind)) {
		return null;
	}
	const size = FACE_NUMBERS[kind as PuzzleKind];
	if (!Array.isArray(numbers) || numbers.length !== size) return null;
	const lowest = kind === 'thermometer' ? -MAX_FACE_NUMBER : 0;
	const read: number[] = [];
	for (const n of numbers as readonly unknown[]) {
		if (!Number.isSafeInteger(n) || (n as number) < lowest || (n as number) > MAX_FACE_NUMBER) {
			return null;
		}
		read.push(n as number);
	}
	const face: PuzzleFace =
		times === undefined
			? { kind: kind as PuzzleKind, numbers: read }
			: { kind: kind as PuzzleKind, numbers: read, times: true };
	if (times !== undefined && (times !== true || kind !== 'missing')) return null;
	return faceFits(face) ? face : null;
}

/**
 * Whether a face is one its kind could show: a sum's always is (its numbers
 * are checked for size alone); a balance must have a whole answer of 1 or
 * more, and a picture kind's numbers must be ones its picture can be drawn
 * from (a known `how`, as many coins as fit, a bar chart's bars on its
 * lines). So a page draws nothing a generator could not have made.
 */
function faceFits(face: PuzzleFace): boolean {
	const n = face.numbers;
	if (n.length !== FACE_NUMBERS[face.kind]) return false;
	// Only a thermometer reads below 0.
	if (face.kind !== 'thermometer' && n.some((x) => x < 0)) return false;
	const at = (i: number) => n[i] as number;
	switch (face.kind) {
		case 'balance': {
			const [form, a, b, c] = [at(0), at(1), at(2), at(3)];
			const answer = balanceAnswer(form, a, b, c);
			// Neither side below 1: `a − □ = b − c` has b over c.
			if (form === 1 && b <= c) return false;
			return answer !== null && Number.isInteger(answer) && answer >= 1;
		}
		case 'thermometer': {
			const [how, a, b] = [at(0), at(1), at(2)];
			if (Math.abs(a) > MAX_DEGREES || Math.abs(b) > MAX_DEGREES) return false;
			// Where it ends up stays on the thermometer too.
			if (how === THERMOMETER.colder) return b >= 1 && a - b >= -MAX_DEGREES;
			if (how === THERMOMETER.warmer) return b >= 1 && a + b <= MAX_DEGREES;
			if (how === THERMOMETER.rose) return b > a;
			if (how === THERMOMETER.fell) return a > b;
			return false;
		}
		case 'kroner': {
			const how = at(0);
			const counts = n.slice(1, 9);
			const pieces = counts.reduce((s, c) => s + c, 0);
			if (pieces < 1 || pieces > MAX_KRONER_PIECES) return false;
			const paid = counts.reduce((s, c, i) => s + c * KRONER[i]!, 0);
			const [p, q] = [at(9), at(10)];
			if (how === 0) return p === 0 && q === 0;
			if (how === 1) return p >= 1 && q === 0 && paid > p;
			if (how === 2) return p >= 1 && q >= 1 && paid > p + q;
			return false;
		}
		case 'fraction': {
			const [num, den, amount] = [at(0), at(1), at(2)];
			return (
				num >= 1 &&
				num < den &&
				FRACTION_PIECES.includes(den) &&
				gcd(num, den) === 1 &&
				amount > 0 &&
				amount % den === 0
			);
		}
		case 'shape': {
			const [how, w, h, cw, ch, grid] = [at(0), at(1), at(2), at(3), at(4), at(5)];
			if (w < 1 || w > MAX_SHAPE_SIDE) return false;
			if (how === 2 || how === 3) {
				if (cw !== 0 || ch !== 0 || grid !== 0) return false;
				// The floor's squares or the fence's length, and the side missing at least 1.
				return how === 2
					? h >= w && h % w === 0 && h / w <= MAX_SHAPE_SIDE
					: h % 2 === 0 && h / 2 > w && h / 2 - w <= MAX_SHAPE_SIDE;
			}
			if (how !== 0 && how !== 1) return false;
			if (h < 1 || h > MAX_SHAPE_SIDE || (grid !== 0 && grid !== 1)) return false;
			if (grid === 1 && (w > MAX_GRID_SIDE || h > MAX_GRID_SIDE)) return false;
			if (cw === 0 && ch === 0) return true;
			return cw >= 1 && cw < w && ch >= 1 && ch < h;
		}
		case 'barchart': {
			const [how, scale, i, j, bars] = [at(0), at(1), at(2), at(3), at(4)];
			const values = n.slice(5);
			if (!(BAR_SCALES as readonly number[]).includes(scale)) return false;
			if (bars < 2 || bars > MAX_BARS || i >= bars || j >= bars) return false;
			// Each bar on a line or halfway between two, the bars past the last 0.
			const half = scale % 2 === 0 ? scale / 2 : scale;
			if (values.some((v, k) => (k < bars ? v > scale * MAX_BAR_LINES || v % half !== 0 : v !== 0)))
				return false;
			if (how === 0) return j === 0;
			if (how === 1) return i !== j && values[i]! > values[j]!;
			if (how === 2) return i !== j;
			if (how === 3) return i === 0 && j === 0;
			return false;
		}
		case 'clock': {
			const [how, h, m, dh, dm] = [at(0), at(1), at(2), at(3), at(4)];
			if (h < 1 || h > 12 || m > 59) return false;
			if (how === 0) return dh === 0 && dm === 0;
			return (how === 1 || how === 2) && dh <= 12 && dm <= 59 && dh + dm > 0;
		}
		default:
			return true;
	}
}

/** The coldest and warmest a thermometer face reads: the ladder's ±40 and a little room. */
const MAX_DEGREES = 99;

/**
 * The pieces a whole is cut into: the ones a kid meets at school, never
 * sevenths, ninths or elevenths.
 */
export const FRACTION_PIECES: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12];

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

/** The number in the box of a balance, or null for a form there is not. */
function balanceAnswer(form: number, a: number, b: number, c: number): number | null {
	switch (form) {
		case 0:
			return b + c - a;
		case 1:
			return a - b + c;
		case 2:
			return a === 0 ? null : (b * c) / a;
		case 3:
			return a === 0 ? null : (c - b) / a;
		case 4:
			return a === 0 ? null : (c + b) / a;
		default:
			return null;
	}
}
