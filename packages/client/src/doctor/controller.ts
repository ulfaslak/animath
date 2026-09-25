import {
	getAnimal,
	needsHealing,
	type AnimalInstance,
	type Authority,
	type DoctorEvent,
	type DoctorIntent,
	type DoctorState,
	type GameEvent
} from '@mathgame/engine';
import { answerKey } from '../input/answer';
import { cursorStops, doctor, hurtIndexes, stepCursor } from '../state/doctor.svelte';
import { doctorLines } from './lines';

/**
 * The doctor's card: from `doctor-visit-started` to `doctor-visit-ended`, a
 * dialogue over explore mode (no mode switch; the world keeps drawing). It
 * turns keys into doctor intents and plays the authority's doctor events back
 * a beat at a time — the judgement of an answer, then the heal — before it
 * shows the latest state and takes keys again, the way the battle screen
 * does. The doctor's words come from `lines.ts`, chosen by event. Nothing
 * here decides anything: the engine judges answers and heals.
 */

/** One beat: change the view, then hold for `hold` seconds. */
interface Beat {
	run: () => void;
	hold: number;
}

/**
 * Seconds after the card opens in which it takes no key but Escape, so an
 * Enter mashed at the tent cannot pick an animal (or say bye) unseen.
 */
export const OPEN_GUARD_SECONDS = 0.5;
/** "Not quite!" stays up this long before the next puzzle replaces it. */
const MISS_HOLD = 1.2;
/** "Correct!" stays up this long before the heal. */
const CORRECT_HOLD = 0.8;
/** The heal (HP bar filling, "+N", the doctor's cheer) plays this long before the list takes keys. */
const HEAL_HOLD = 1.2;

export class DoctorController {
	/** The authority's latest state; shown once the beats have played. */
	private latest: DoctorState | null = null;
	private beats: Beat[] = [];
	private wait = 0;
	/** Seconds the card has been open. */
	private age = 0;
	/** What the doctor says about the latest state; shown with its beat, or at `settle`. */
	private said = '';
	private heals = 0;

	constructor(private authority: Authority) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'doctor-visit-started':
				this.open(event.state);
				break;
			case 'doctor-visit-updated': {
				// Only the visit on screen, and never an older state than the one shown.
				const latest = this.latest;
				if (!doctor.active || !latest || event.state.step < latest.step) return;
				const said = lineFor(event.events, event.state);
				if (said) this.said = said;
				this.latest = event.state;
				doctor.screen = 'busy';
				for (const e of event.events) this.beats.push(...this.narrate(e, said));
				// Nothing to play (a pick, a swap, a rejection): show it now, so a key
				// typed straight after an arrow lands in the new puzzle, not in a gap.
				if (this.beats.length === 0 && this.wait <= 0) this.settle();
				break;
			}
			case 'doctor-visit-ended':
				if (doctor.active) this.close();
				break;
		}
	}

	/** Play beats as their holds expire; `dt` is seconds. */
	update(dt: number): void {
		if (!doctor.active) return;
		this.age += dt;
		this.wait -= dt;
		while (this.wait <= 0 && this.beats.length > 0) {
			const beat = this.beats.shift()!;
			beat.run();
			this.wait = beat.hold;
		}
		if (this.wait <= 0 && this.beats.length === 0 && doctor.screen === 'busy') this.settle();
	}

	/** Keyboard input while the card is open. */
	onKey(e: KeyboardEvent): void {
		if (!doctor.active) return;
		// Leave browser shortcuts alone, and never act on auto-repeat: an Enter
		// or an arrow held down when the card opened does nothing until pressed again.
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		// Escape leaves at any time, mid-puzzle and mid-beat included.
		if (e.key === 'Escape') {
			e.preventDefault();
			this.send({ type: 'leave' });
			return;
		}
		if (this.age < OPEN_GUARD_SECONDS) return;
		let handled = false;
		switch (doctor.screen) {
			case 'busy':
				return; // a beat is playing
			case 'list':
				handled = this.listKey(e.key);
				break;
			case 'puzzle':
				handled = this.puzzleKey(e.key);
				break;
		}
		if (handled) e.preventDefault();
	}

	// --- screens -------------------------------------------------------------

	private open(state: DoctorState): void {
		doctor.reset();
		doctor.active = true;
		this.latest = state;
		this.beats = [];
		this.wait = 0;
		this.age = 0;
		this.said = state.party.some(needsHealing) ? doctorLines.hello : doctorLines.helloAllFit;
		doctor.cursor = hurtIndexes(state.party)[0] ?? state.party.length;
		this.settle();
	}

	/** Every beat has played: show the authority's latest state and take keys. */
	private settle(): void {
		const state = this.latest;
		if (!state) return;
		doctor.party = state.party.map((a) => ({ ...a }));
		doctor.line = this.said;
		doctor.input = '';
		doctor.judged = null;
		switch (state.phase.kind) {
			case 'choose-patient': {
				doctor.puzzle = null;
				doctor.patient = null;
				// After a heal the cursor moves on to the next animal who still needs
				// the doctor, round the party, and to Bye only when nobody does.
				if (!cursorStops(doctor.party).includes(doctor.cursor)) {
					const hurt = hurtIndexes(doctor.party);
					doctor.cursor = hurt.find((i) => i > doctor.cursor) ?? hurt[0] ?? doctor.party.length;
				}
				doctor.screen = 'list';
				break;
			}
			case 'solving':
				doctor.puzzle = state.phase.puzzle;
				doctor.patient = state.phase.partyIndex;
				doctor.cursor = state.phase.partyIndex;
				doctor.screen = 'puzzle';
				break;
			case 'ended':
				// `doctor-visit-ended` follows at once and closes the card.
				break;
		}
	}

	private close(): void {
		doctor.reset();
		this.latest = null;
		this.beats = [];
		this.wait = 0;
		this.said = '';
	}

	private send(intent: DoctorIntent): void {
		doctor.screen = 'busy';
		this.authority.dispatch({ type: 'doctor', intent });
	}

	// --- keys ----------------------------------------------------------------

	private listKey(key: string): boolean {
		const stops = cursorStops(doctor.party);
		switch (key) {
			case 'ArrowUp':
			case 'w':
				doctor.cursor = stepCursor(stops, doctor.cursor, -1);
				return true;
			case 'ArrowDown':
			case 's':
				doctor.cursor = stepCursor(stops, doctor.cursor, 1);
				return true;
			case 'Enter':
			case ' ': {
				const animal = doctor.party[doctor.cursor];
				if (!animal) this.send({ type: 'leave' });
				else if (needsHealing(animal)) {
					this.send({ type: 'pick-patient', partyIndex: doctor.cursor });
				}
				return true;
			}
		}
		return false;
	}

	private puzzleKey(key: string): boolean {
		switch (key) {
			case 'ArrowUp':
			case 'w':
			case 'ArrowDown':
			case 's': {
				// The list stays live: up and down swap the puzzle for the next animal's.
				const delta = key === 'ArrowUp' || key === 'w' ? -1 : 1;
				const next = stepCursor(hurtIndexes(doctor.party), doctor.patient ?? 0, delta);
				if (next !== doctor.patient) this.send({ type: 'pick-patient', partyIndex: next });
				return true;
			}
		}
		const typed = answerKey(doctor.input, key);
		doctor.input = typed.input;
		if (typed.submit) this.send({ type: 'answer', input: typed.input });
		return typed.handled;
	}

	// --- beats ---------------------------------------------------------------

	/** Turn one doctor event into beats. `said` is what the doctor says to the whole step. */
	private narrate(e: DoctorEvent, said: string | null): Beat[] {
		switch (e.type) {
			case 'puzzle-shown':
				return []; // `settle` shows the puzzle once the beats have played
			case 'answer-judged':
				// The right answer is never shown (UI_SPEC): the next puzzle is a new one.
				return [
					{
						run: () => {
							doctor.judged = { correct: e.correct };
							if (!e.correct && said) doctor.line = said;
						},
						hold: e.correct ? CORRECT_HOLD : MISS_HOLD
					}
				];
			case 'healed':
				return [
					{
						run: () => {
							const before = doctor.party[e.partyIndex];
							const max = getAnimal(e.animal.speciesId).maxHp;
							doctor.party = doctor.party.map((a, i) => (i === e.partyIndex ? { ...e.animal } : a));
							doctor.healed = {
								index: e.partyIndex,
								amount: max - (before?.hp ?? 0),
								n: ++this.heals
							};
							if (said) doctor.line = said;
						},
						hold: HEAL_HOLD
					}
				];
			case 'ended':
				return [];
			case 'rejected':
				console.warn(`doctor intent rejected: ${e.reason}`);
				return [];
		}
	}
}

/**
 * What the doctor says to one step's events, or null to keep the line as it
 * is (`ended` closes the card; `rejected` changes nothing).
 */
function lineFor(events: readonly DoctorEvent[], state: DoctorState): string | null {
	for (const e of events) {
		if (e.type === 'answer-judged' && !e.correct) return doctorLines.notQuite;
		if (e.type === 'healed') {
			return doctorLines.healed(nameOf(e.animal), state.party.some(needsHealing));
		}
	}
	for (const e of events) {
		const patient = e.type === 'puzzle-shown' ? state.party[e.partyIndex] : undefined;
		if (patient) return doctorLines.letsHelp(nameOf(patient));
	}
	return null;
}

function nameOf(animal: AnimalInstance): string {
	return animal.nickname ?? getAnimal(animal.speciesId).name;
}
