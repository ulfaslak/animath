import {
	BARCHART,
	BLOCKS,
	CLOCK,
	DOUBLE,
	SHAPE,
	THERMOMETER,
	UNITS,
	UNIT_PAIRS,
	isWordedKind,
	type Puzzle,
	type PuzzleFace,
	type UnitId
} from '@mathgame/engine';
import { t } from './copy';

/**
 * A puzzle with a picture (the Arctic's kinds, #191, and the number line)
 * in words: its question, from the face's numbers alone, in the language on
 * screen. The engine sends numbers and never words ([[DECISIONS]] § Copy
 * and languages); the words are picked here, when they are shown. Most of a
 * question is text; a fraction is drawn stacked and a bar chart's bar by
 * its shape, so those come as parts of their own.
 */
type QuestionPart = { text: string } | { fraction: readonly [number, number] } | { shape: number };

/** Where a part that is not text goes, until the text is cut there. */
const FRACTION = '';
const WHO = '';
const OTHER = '';

/** A number as the question writes it: below 0 with a real minus sign, "−4". */
export function signed(n: number): string {
	return n < 0 ? `−${-n}` : String(n);
}

/** The question of a picture puzzle, in parts, or null for a face of another kind. */
export function questionParts(face: PuzzleFace): QuestionPart[] | null {
	const n = face.numbers;
	const at = (i: number) => n[i] ?? 0;
	switch (face.kind) {
		case 'thermometer':
			return [{ text: thermometerText(at(0), at(1), at(2)) }];
		case 'kroner': {
			const [p, q] = [at(9), at(10)];
			const text =
				at(0) === 0
					? t('puzzle.ask.kroner.count')
					: at(0) === 1
						? t('puzzle.ask.kroner.oneThing', { price: p })
						: t('puzzle.ask.kroner.twoThings', { price: p, other: q });
			return [{ text }];
		}
		case 'fraction':
			return cut(t('puzzle.ask.fraction', { fraction: FRACTION, amount: at(2) }), {
				fraction: [at(0), at(1)]
			});
		case 'shape': {
			const how = at(0);
			const text =
				how === SHAPE.floor
					? t('puzzle.ask.shape.floor')
					: how === SHAPE.fence
						? t('puzzle.ask.shape.fence')
						: how === SHAPE.floorSide
							? t('puzzle.ask.shape.floorSide', { total: at(2) })
							: t('puzzle.ask.shape.fenceSide', { total: at(2) });
			return [{ text }];
		}
		case 'barchart': {
			const [how, , i, j] = [at(0), at(1), at(2), at(3)];
			const text =
				how === BARCHART.read
					? t('puzzle.ask.barchart.read', { who: WHO })
					: how === BARCHART.more
						? t('puzzle.ask.barchart.more', { who: WHO, other: OTHER })
						: how === BARCHART.both
							? t('puzzle.ask.barchart.both', { who: WHO, other: OTHER })
							: t('puzzle.ask.barchart.all');
			return cut(text, { who: i, other: j });
		}
		case 'numberline':
			return [{ text: t('puzzle.ask.numberline') }];
		case 'clock': {
			const how = at(0);
			if (how === CLOCK.read) return [{ text: t('puzzle.ask.clock.read') }];
			const time = duration(at(3), at(4));
			return [
				{
					text:
						how === CLOCK.later
							? t('puzzle.ask.clock.later', { time })
							: t('puzzle.ask.clock.earlier', { time })
				}
			];
		}
		case 'blocks': {
			const [how, , , n] = [at(0), at(1), at(2), at(3)];
			const text =
				how === BLOCKS.high
					? t('puzzle.ask.blocks.high', { total: n })
					: n > 1
						? t('puzzle.ask.blocks.box')
						: t('puzzle.ask.blocks.count');
			return [{ text }];
		}
		default:
			return null;
	}
}

/**
 * The prompt in the puzzle's big type: a worded one in words (`wordedPrompt`),
 * a sum as the engine writes it. A worded kind whose face this page cannot
 * read (a newer build's way of asking, at the same `PROTOCOL_VERSION` by
 * mistake) is a "?" alone, never its face written out ("units(0, 10, 3, 0)").
 * A picture puzzle's question is its words and its picture (`questionParts`).
 */
export function shownPrompt(
	puzzle: Pick<Puzzle, 'kind' | 'prompt'>,
	face: PuzzleFace | null
): string {
	const worded = face ? wordedPrompt(face) : null;
	if (worded !== null) return worded;
	return isWordedKind(puzzle.kind) ? '?' : puzzle.prompt;
}

/**
 * The prompt of a puzzle with words and no picture, in the language on
 * screen, shown as a sum's prompt is: "Double 8 = ?", "Half of 14 = ?",
 * "2 hours = ? minutes" (`wordedSum`). Null for a face of another kind.
 */
export function wordedPrompt(face: PuzzleFace): string | null {
	if (face.kind === 'units') return wordedSum(face);
	if (face.kind !== 'double') return null;
	const n = face.numbers[1] ?? 0;
	const text =
		face.numbers[0] === DOUBLE.half ? t('puzzle.ask.half', { n }) : t('puzzle.ask.double', { n });
	// The number and its "= ?" stay on one line: never "?" alone at a line's start.
	return text.replace(/ = \?$/, '\u00a0=\u00a0?');
}

function thermometerText(how: number, a: number, b: number): string {
	const start = signed(a);
	switch (how) {
		case THERMOMETER.colder:
			return t('puzzle.ask.thermometer.colder', { start, change: b });
		case THERMOMETER.warmer:
			return t('puzzle.ask.thermometer.warmer', { start, change: b });
		case THERMOMETER.rose:
			return t('puzzle.ask.thermometer.rose', { start, end: signed(b) });
		default:
			return t('puzzle.ask.thermometer.fell', { start, end: signed(b) });
	}
}

/**
 * A kind of words (`units`, #191's measuring) as the sum a kid reads, in
 * the language on screen: "2 hours = ? minutes", "2 m 35 cm = ? cm",
 * "130 minutes = 2 hours and ? minutes". Time's units are words and join
 * with "and" ("1 hour and 20 minutes"); the others are signs and stand side
 * by side, as a ruler writes them ("2 m 35 cm"). A number and its unit stay
 * on one line, and so do "?" and the unit it asks for. Null for a face of
 * another kind.
 */
export function wordedSum(face: PuzzleFace): string | null {
	if (face.kind !== 'units') return null;
	const [how, index, a, b] = face.numbers as number[];
	const pair = UNIT_PAIRS[index!];
	if (!pair) return null;
	const words = pair.quantity === 'time';
	const want = t(`puzzle.units.asked.${how === UNITS.back ? pair.big : pair.small}`);
	const sum =
		how === UNITS.mixed
			? t(words ? 'puzzle.units.mixedWords' : 'puzzle.units.mixed', {
					have: amount(a!, pair.big),
					more: amount(b!, pair.small),
					want
				})
			: how === UNITS.rest
				? t(words ? 'puzzle.units.restWords' : 'puzzle.units.rest', {
						have: amount(a!, pair.small),
						more: amount(b!, pair.big),
						want
					})
				: t('puzzle.units.plain', {
						have: amount(a!, how === UNITS.back ? pair.small : pair.big),
						want
					});
	// The question mark stays with the unit it asks for: "? minutes".
	return sum.replace('? ', '?\u00a0');
}

/** A number and its unit, kept on one line: "2 hours", "35 cm". */
function amount(count: number, unit: UnitId): string {
	return t(`puzzle.units.count.${unit}`, { count }).replace(' ', '\u00a0');
}

/** How long passes on a clock: "2 hours", "45 minutes", "1 hour and 20 minutes". */
function duration(hours: number, minutes: number): string {
	// A number and its unit stay on one line: "2 timer", never "2" at a line's end.
	const h = t('puzzle.ask.clock.hours', { count: hours }).replace(' ', '\u00a0');
	const m = t('puzzle.ask.clock.minutes', { count: minutes }).replace(' ', '\u00a0');
	if (minutes === 0) return h;
	if (hours === 0) return m;
	return t('puzzle.ask.clock.both', { hours: h, minutes: m });
}

/** The text cut at its marks, each mark made the part it stands for. */
function cut(
	text: string,
	marks: { fraction?: readonly [number, number]; who?: number; other?: number }
): QuestionPart[] {
	return text
		.split(/([-])/)
		.filter((piece) => piece !== '')
		.map((piece): QuestionPart => {
			if (piece === FRACTION && marks.fraction) return { fraction: marks.fraction };
			if (piece === WHO && marks.who !== undefined) return { shape: marks.who };
			if (piece === OTHER && marks.other !== undefined) return { shape: marks.other };
			return { text: piece };
		});
}

/**
 * The question in plain words, for a screen reader (the `.ask` line's
 * label): a fraction as "3/5", a bar by its mark's name ("the star").
 */
export function questionText(parts: readonly QuestionPart[]): string {
	return parts
		.map((part) =>
			'text' in part
				? part.text
				: 'fraction' in part
					? `${part.fraction[0]}/${part.fraction[1]}`
					: markName(part.shape)
		)
		.join('');
}

/** A bar chart's mark by name, in `BAR_MARKS`' order (`ui/pictures/BarMark.svelte`). */
function markName(index: number): string {
	switch (index % 5) {
		case 0:
			return t('puzzle.picture.marks.circle');
		case 1:
			return t('puzzle.picture.marks.triangle');
		case 2:
			return t('puzzle.picture.marks.square');
		case 3:
			return t('puzzle.picture.marks.star');
		default:
			return t('puzzle.picture.marks.heart');
	}
}
