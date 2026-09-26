import { getAnimal, type AnimalInstance, type GameEvent, type Intent } from '@mathgame/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CueName } from '../src/audio/cues';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { DoctorController } from '../src/doctor/controller';
import { doctorWords } from '../src/doctor/lines';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { rowKey } from '../src/input/press';
import { doctor } from '../src/state/doctor.svelte';
import { everyMash } from './mash';

/**
 * The doctor's card driven by keys against the real authority: what each key
 * does on the list and in a puzzle, the beats after an answer, and what a key
 * must never do (an Enter mashed at the tent picking an animal unseen, a held
 * key acting, a key during a beat). Answers are read from the events, never
 * hard-coded.
 */
function key(name: string, repeat = false): KeyboardEvent {
	return {
		key: name,
		repeat,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		preventDefault() {}
	} as unknown as KeyboardEvent;
}

/** A squirrel at 5 of 20, a tired rabbit, a fox at full HP. */
function hurtParty(): AnimalInstance[] {
	return [
		{ id: 'a', speciesId: 'squirrel', hp: 5 },
		{ id: 'b', speciesId: 'rabbit', hp: 0 },
		{ id: 'c', speciesId: 'fox', hp: getAnimal('fox').maxHp }
	];
}

/** The previous test's cue listener, dropped when the next one starts listening. */
let stopListening: (() => void) | undefined;

function setup(party?: AnimalInstance[]) {
	const authority = new LocalAuthority(party ? { party } : {});
	const controller = new DoctorController(authority);
	const events: GameEvent[] = [];
	const sent: Intent[] = [];
	// Every cue the card asks for, in order (no sound in tests: nothing unlocks it).
	const cues: CueName[] = [];
	stopListening?.();
	stopListening = sfx.onCue((cue) => cues.push(cue));
	const dispatch = authority.dispatch.bind(authority);
	authority.dispatch = (intent) => {
		sent.push(intent);
		dispatch(intent);
	};
	authority.subscribe((e) => {
		events.push(e);
		controller.handle(e);
	});
	authority.start();
	/** Advance the card by `seconds`, a frame at a time. */
	const run = (seconds: number) => {
		for (let t = 0; t < seconds; t += 1 / 60) controller.update(1 / 60);
	};
	/** Press keys, one frame apart, as the game loop would see them. */
	const press = (...names: string[]) =>
		names.forEach((n) => {
			controller.onKey(key(n));
			controller.update(1 / 60);
		});
	/** Seven steps right to (5, 6), bump down into the tent, and press Enter there. */
	const talk = () => {
		for (let i = 0; i < 7; i++) authority.dispatch({ type: 'move', dir: 'right' });
		authority.dispatch({ type: 'move', dir: 'down' });
		authority.dispatch({ type: 'interact' });
		expect(doctor.active).toBe(true);
	};
	/** The open puzzle's answer, from the authority's latest doctor event. */
	const answer = (): number => {
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]!;
			if (e.type === 'doctor-visit-updated' || e.type === 'doctor-visit-started') {
				if (e.state.phase.kind !== 'solving') throw new Error('no puzzle open');
				return e.state.phase.puzzle.answer;
			}
		}
		throw new Error('no visit');
	};
	const doctorSent = () => sent.filter((i) => i.type === 'doctor');
	return { authority, controller, events, sent, cues, doctorSent, run, press, talk, answer };
}

beforeEach(() => doctor.reset());

describe("the doctor's card", () => {
	it("opens with the doctor's line and the cursor on the first hurt animal; healthy ones are skipped", () => {
		const t = setup(hurtParty());
		t.talk();
		expect(doctor.line).toEqual({ say: 'hello' });
		expect(doctor.screen).toBe('list');
		expect(doctor.cursor).toBe(0);
		// An Enter mashed at the tent does nothing for a moment.
		t.press('Enter', ' ');
		expect(t.doctorSent()).toEqual([]);
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowDown');
		expect(doctor.cursor).toBe(1); // the tired rabbit
		t.press('s');
		expect(doctor.cursor).toBe(3); // Bye: the fox is fit and skipped
		t.press('ArrowDown');
		expect(doctor.cursor).toBe(0); // round to the top
		t.press('ArrowUp', 'w');
		expect(doctor.cursor).toBe(1);
		// With Caps Lock on, W and S come in capitals and steer the same.
		t.press('S');
		expect(doctor.cursor).toBe(3);
		t.press('W');
		expect(doctor.cursor).toBe(1);
		expect(t.doctorSent()).toEqual([]);
	});

	it('a miss says "Not quite!" and brings a new puzzle; the HP stays and the answer stays hidden', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.patient).toBe(0);
		expect(doctor.line).toMatchObject({ say: 'letsHelp', animal: { speciesId: 'squirrel' } });
		const first = doctor.puzzle!;
		const right = t.answer();
		t.press(...String(right + 1), 'Enter');
		expect(doctor.judged).toEqual({ correct: false });
		expect(t.cues.at(-1)).toBe('wrong'); // a soft bonk with "Not quite!"
		expect(doctor.line).toEqual({ say: 'notQuite' });
		expect(doctor.screen).toBe('busy');
		expect(doctor.party[0]!.hp).toBe(5);
		t.run(1.3);
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.judged).toBeNull();
		expect(doctor.input).toBe('');
		expect(doctor.puzzle).not.toBe(first);
		expect(doctorWords(doctor.line!)).not.toContain(String(right));
	});

	it('a right answer heals with a cheer, then moves on to the next animal who needs help', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		t.cues.length = 0;
		t.press(...String(t.answer()), 'Enter');
		expect(doctor.judged).toEqual({ correct: true });
		expect(t.cues).toEqual(['correct']); // the chime with "Correct!"; typing is quiet
		expect(doctor.party[0]!.hp).toBe(5); // the heal waits for "Correct!" to be read
		t.run(0.85);
		expect(doctor.party[0]!.hp).toBe(20);
		expect(doctor.healed).toMatchObject({ index: 0, amount: 15 });
		expect(t.cues).toEqual(['correct', 'heal']); // the sparkle with the heal
		expect(doctor.line).toMatchObject({
			say: 'healed',
			animal: { speciesId: 'squirrel', hp: 20 },
			someoneStillHurt: true
		});
		expect(doctor.screen).toBe('busy');
		t.run(1.3);
		expect(doctor.screen).toBe('list');
		expect(doctor.puzzle).toBeNull();
		expect(doctor.cursor).toBe(1); // the rabbit, still tired
		expect(doctor.healed).toBeNull(); // the cheer is over; the squirrel sits with the fit ones

		// Heal the rabbit too, once the list has been back a quiet moment: with
		// everyone fit, the cursor rests on Bye.
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		t.press(...String(t.answer()), 'Enter');
		t.run(2.2);
		expect(doctor.line).toMatchObject({
			say: 'healed',
			animal: { speciesId: 'rabbit' },
			someoneStillHurt: false
		});
		expect(doctor.cursor).toBe(3);
	});

	it('up and down swap the puzzle for another hurt animal, and never for a fit one', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter', '4');
		expect(doctor.input).toBe('4');
		t.press('ArrowDown');
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'pick-patient', partyIndex: 1 }
		});
		expect(doctor.patient).toBe(1);
		expect(doctor.cursor).toBe(1);
		expect(doctor.input).toBe('');
		expect(doctor.line).toMatchObject({ say: 'letsHelp', animal: { speciesId: 'rabbit' } });
		t.press('ArrowDown'); // past the fit fox, round to the squirrel
		expect(doctor.patient).toBe(0);

		// A pick or a swap has nothing to play: the very next key, in the same
		// frame, types into the new puzzle (on a slow machine a frame is long).
		t.controller.onKey(key('ArrowUp'));
		t.controller.onKey(key('7'));
		expect(doctor.patient).toBe(1);
		expect(doctor.input).toBe('7');

		// With only one animal hurt, there is nobody to swap to.
		const u = setup([
			{ id: 'a', speciesId: 'squirrel', hp: 5 },
			{ id: 'b', speciesId: 'rabbit', hp: getAnimal('rabbit').maxHp }
		]);
		u.talk();
		u.run(PICK_QUIET_SECONDS);
		u.press('Enter');
		const before = u.doctorSent().length;
		u.press('ArrowUp', 'ArrowDown');
		expect(u.doctorSent().length).toBe(before);
		expect(doctor.patient).toBe(0);
	});

	it('Escape leaves at any time — at once, mid-puzzle, mid-beat — and walking comes back', () => {
		const t = setup(hurtParty());
		t.talk();
		t.press('Escape'); // inside the opening moment too
		expect(doctor.active).toBe(false);
		expect(t.events.at(-1)).toMatchObject({ type: 'doctor-visit-ended' });

		t.authority.dispatch({ type: 'interact' });
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		t.press(...String(t.answer() + 1), 'Enter');
		expect(doctor.screen).toBe('busy');
		t.press('Escape');
		expect(doctor.active).toBe(false);
		t.run(2);
		expect(doctor.active).toBe(false);

		const before = t.events.length;
		t.authority.dispatch({ type: 'move', dir: 'left' });
		expect(t.events.slice(before)).toMatchObject([{ type: 'player-moved', pos: { x: 4, y: 6 } }]);
	});

	it('with nobody hurt, the doctor says so kindly, and Enter says bye', () => {
		const t = setup();
		t.talk();
		expect(doctor.line).toEqual({ say: 'helloAllFit' });
		expect(doctor.cursor).toBe(1); // Bye, below the one squirrel
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowDown', 'ArrowUp');
		expect(doctor.cursor).toBe(1);
		t.press('Enter');
		expect(doctor.active).toBe(false);
		expect(t.doctorSent()).toEqual([{ type: 'doctor', intent: { type: 'leave' } }]);
	});

	it('ignores held keys, an empty answer, and every key but Escape while a beat plays', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		for (let i = 0; i < 10; i++) t.controller.onKey(key('Enter', true));
		for (let i = 0; i < 10; i++) t.controller.onKey(key('ArrowDown', true));
		expect(doctor.cursor).toBe(0);
		expect(t.doctorSent()).toEqual([]);

		t.press('Enter');
		const picked = t.doctorSent().length;
		t.press('Enter', '-', 'Enter', 'x');
		expect(t.doctorSent().length).toBe(picked);
		expect(doctor.input).toBe('-');
		t.press('Backspace', ...String(t.answer() + 1), 'Enter');
		const answered = t.doctorSent().length;
		t.press('Enter', '1', 'ArrowDown', ' ', 'Enter');
		expect(t.doctorSent().length).toBe(answered);
	});

	it('ignores events from an earlier visit, even one further along than the visit on screen', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		// Visit 1: pick, miss twice (its step is 3 by then), leave.
		t.press('Enter');
		t.press(...String(t.answer() + 1), 'Enter');
		t.run(1.3);
		t.press(...String(t.answer() + 1), 'Enter');
		t.run(1.3);
		const lateUpdate = t.events.filter((e) => e.type === 'doctor-visit-updated').at(-1)!;
		t.press('Escape');
		const lateEnd = t.events.filter((e) => e.type === 'doctor-visit-ended').at(-1)!;

		// Visit 2, one step in: the late events of visit 1 change nothing on screen.
		t.authority.dispatch({ type: 'interact' });
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		const view = () => ({
			active: doctor.active,
			line: doctor.line,
			puzzle: doctor.puzzle,
			screen: doctor.screen,
			judged: doctor.judged
		});
		const before = view();
		expect(before.screen).toBe('puzzle');
		t.controller.handle(lateUpdate);
		t.controller.handle(lateEnd);
		t.run(3);
		expect(view()).toEqual(before);
	});
});

/**
 * A key mashed at the tent or through a heal (#37): the list takes a pick
 * only after a quiet moment, when the card opens and each time it comes back,
 * so a mash at any pace picks nobody and never says bye.
 */
describe("the doctor's card under a mash", () => {
	/** Press Enter at each gap in turn; the kinds of doctor intent sent meanwhile. */
	const mash = (t: ReturnType<typeof setup>, gaps: number[]) => {
		const before = t.doctorSent().length;
		for (const gap of gaps) {
			t.controller.onKey(key('Enter'));
			t.run(gap);
		}
		return t
			.doctorSent()
			.slice(before)
			.map((i) => i.intent.type);
	};

	it('an Enter mashed at the tent, at any pace, picks nobody; after a pause one does', () => {
		for (const { name, gaps } of everyMash(3)) {
			const t = setup(hurtParty());
			t.talk();
			expect(mash(t, gaps), name).toEqual([]);
			expect(doctor.screen, name).toBe('list');
			t.run(PICK_QUIET_SECONDS);
			t.press('Enter');
			expect(t.doctorSent(), name).toEqual([
				{ type: 'doctor', intent: { type: 'pick-patient', partyIndex: 0 } }
			]);
		}
	});

	it('an Enter mashed through a heal never picks the next animal, nor says bye after the last', () => {
		for (const { name, gaps } of everyMash(5)) {
			const t = setup([
				{ id: 'a', speciesId: 'squirrel', hp: 5 },
				{ id: 'b', speciesId: 'rabbit', hp: 3 }
			]);
			t.talk();
			t.run(PICK_QUIET_SECONDS);
			t.press('Enter');
			t.press(...String(t.answer()));
			// The mash's first Enter answers; the rest go on through "Correct!", the
			// heal and for seconds of the list, which picks nothing from them.
			expect(mash(t, gaps), name).toEqual(['answer']);
			expect(doctor.screen, name).toBe('list');
			expect(doctor.cursor, name).toBe(1); // the rabbit, waiting to be picked

			// The same through the last heal: the cursor rests on Bye, and the card stays.
			t.run(PICK_QUIET_SECONDS);
			t.press('Enter');
			t.press(...String(t.answer()));
			expect(mash(t, gaps), name).toEqual(['answer']);
			expect(doctor.active, name).toBe(true);
			expect(doctor.cursor, name).toBe(2);
		}
	});
});

/**
 * A click or a tap reaches the card as a key press (`input/press.ts`): an
 * animal's row is its row key, which picks it at once, since nothing is
 * spent at the doctor; Bye is Escape.
 */
describe("the doctor's card under a pointer", () => {
	it('a tap picks a hurt animal at once, but not before the quiet moment, and never a fit one', () => {
		const t = setup(hurtParty());
		t.talk();
		// A tap straight after the tent is inside the quiet moment, as Enter is.
		t.press(rowKey(1));
		expect(t.doctorSent()).toEqual([]);
		t.run(PICK_QUIET_SECONDS);
		// The fox is fit: its row does nothing, and the cursor stays where it was.
		t.press(rowKey(2));
		expect(t.doctorSent()).toEqual([]);
		expect(doctor.cursor).toBe(0);
		t.press(rowKey(1));
		expect(t.doctorSent()).toEqual([
			{ type: 'doctor', intent: { type: 'pick-patient', partyIndex: 1 } }
		]);
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.patient).toBe(1);
	});

	it("in a puzzle, a tap on another hurt animal swaps to it; the patient's own row and a fit one do nothing", () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press(rowKey(0));
		expect(doctor.patient).toBe(0);
		t.press('4');
		const picks = () => t.doctorSent().filter((i) => i.intent.type === 'pick-patient');
		t.press(rowKey(0), rowKey(2));
		expect(picks()).toHaveLength(1);
		expect(doctor.input).toBe('4');
		t.press(rowKey(1));
		expect(picks()).toHaveLength(2);
		expect(doctor.patient).toBe(1);
		// A fresh puzzle: what was typed is dropped, as with the arrows.
		expect(doctor.input).toBe('');
		// And it is answered the same way: the pad's keys are the keys.
		t.press(...String(t.answer()), 'Enter');
		t.run(3);
		expect(doctor.party[1]!.hp).toBe(getAnimal('rabbit').maxHp);
	});
});
