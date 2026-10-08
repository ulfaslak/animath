import { BARCHART, CLOCK, SHAPE, THERMOMETER, type PuzzleFace } from '@mathgame/engine';
import { t } from './copy';

/**
 * A puzzle with a picture (the Arctic's kinds, #191) in words: its question,
 * from the face's numbers alone, in the language on screen. The engine sends
 * numbers and never words ([[DECISIONS]] § Copy and languages); the words are
 * picked here, when they are shown. Most of a question is text; a fraction
 * is drawn stacked and a bar chart's bar by its shape, so those come as
 * parts of their own.
 */
export type QuestionPart =
	{ text: string } | { fraction: readonly [number, number] } | { shape: number };

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
		default:
			return null;
	}
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

/** The question in plain words, for a screen reader: a fraction as "3/5", a bar by nothing but its place. */
export function questionText(parts: readonly QuestionPart[]): string {
	return parts
		.map((part) =>
			'text' in part
				? part.text
				: 'fraction' in part
					? `${part.fraction[0]}/${part.fraction[1]}`
					: `${part.shape + 1}`
		)
		.join('');
}
