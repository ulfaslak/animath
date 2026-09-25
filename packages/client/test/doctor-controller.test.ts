import { getAnimal, type AnimalInstance, type GameEvent, type Intent } from '@mathgame/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAuthority } from '../src/authority/local';
import { DoctorController, OPEN_GUARD_SECONDS } from '../src/doctor/controller';
import { doctorLines } from '../src/doctor/lines';
import { doctor } from '../src/state/doctor.svelte';

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

function setup(party?: AnimalInstance[]) {
	const authority = new LocalAuthority(party ? { party } : {});
	const controller = new DoctorController(authority);
	const events: GameEvent[] = [];
	const sent: Intent[] = [];
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
	return { authority, controller, events, sent, doctorSent, run, press, talk, answer };
}

beforeEach(() => doctor.reset());

describe("the doctor's card", () => {
	it("opens with the doctor's line and the cursor on the first hurt animal; healthy ones are skipped", () => {
		const t = setup(hurtParty());
		t.talk();
		expect(doctor.line).toBe(doctorLines.hello);
		expect(doctor.screen).toBe('list');
		expect(doctor.cursor).toBe(0);
		// An Enter mashed at the tent does nothing for a moment.
		t.press('Enter', ' ');
		expect(t.doctorSent()).toEqual([]);
		t.run(OPEN_GUARD_SECONDS);
		t.press('ArrowDown');
		expect(doctor.cursor).toBe(1); // the tired rabbit
		t.press('s');
		expect(doctor.cursor).toBe(3); // Bye: the fox is fit and skipped
		t.press('ArrowDown');
		expect(doctor.cursor).toBe(0); // round to the top
		t.press('ArrowUp', 'w');
		expect(doctor.cursor).toBe(1);
		expect(t.doctorSent()).toEqual([]);
	});

	it('a miss says "Not quite!" and brings a new puzzle; the HP stays and the answer stays hidden', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(OPEN_GUARD_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.patient).toBe(0);
		expect(doctor.line).toBe(doctorLines.letsHelp('Squirrel'));
		const first = doctor.puzzle!;
		const right = t.answer();
		t.press(...String(right + 1), 'Enter');
		expect(doctor.judged).toEqual({ correct: false });
		expect(doctor.line).toBe(doctorLines.notQuite);
		expect(doctor.screen).toBe('busy');
		expect(doctor.party[0]!.hp).toBe(5);
		t.run(1.3);
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.judged).toBeNull();
		expect(doctor.input).toBe('');
		expect(doctor.puzzle).not.toBe(first);
		expect(doctor.line).not.toContain(String(right));
	});

	it('a right answer heals with a cheer, then moves on to the next animal who needs help', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(OPEN_GUARD_SECONDS);
		t.press('Enter');
		t.press(...String(t.answer()), 'Enter');
		expect(doctor.judged).toEqual({ correct: true });
		expect(doctor.party[0]!.hp).toBe(5); // the heal waits for "Correct!" to be read
		t.run(0.85);
		expect(doctor.party[0]!.hp).toBe(20);
		expect(doctor.healed).toMatchObject({ index: 0, amount: 15 });
		expect(doctor.line).toBe(doctorLines.healed('Squirrel', true));
		expect(doctor.screen).toBe('busy');
		t.run(1.3);
		expect(doctor.screen).toBe('list');
		expect(doctor.puzzle).toBeNull();
		expect(doctor.cursor).toBe(1); // the rabbit, still tired

		// Heal the rabbit too: with everyone fit, the cursor rests on Bye.
		t.press('Enter');
		t.press(...String(t.answer()), 'Enter');
		t.run(2.2);
		expect(doctor.line).toBe(doctorLines.healed('Rabbit', false));
		expect(doctor.cursor).toBe(3);
	});

	it('up and down swap the puzzle for another hurt animal, and never for a fit one', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(OPEN_GUARD_SECONDS);
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
		expect(doctor.line).toBe(doctorLines.letsHelp('Rabbit'));
		t.press('ArrowDown'); // past the fit fox, round to the squirrel
		expect(doctor.patient).toBe(0);

		// With only one animal hurt, there is nobody to swap to.
		const u = setup([
			{ id: 'a', speciesId: 'squirrel', hp: 5 },
			{ id: 'b', speciesId: 'rabbit', hp: getAnimal('rabbit').maxHp }
		]);
		u.talk();
		u.run(OPEN_GUARD_SECONDS);
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
		t.run(OPEN_GUARD_SECONDS);
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
		expect(doctor.line).toBe(doctorLines.helloAllFit);
		expect(doctor.cursor).toBe(1); // Bye, below the one squirrel
		t.run(OPEN_GUARD_SECONDS);
		t.press('ArrowDown', 'ArrowUp');
		expect(doctor.cursor).toBe(1);
		t.press('Enter');
		expect(doctor.active).toBe(false);
		expect(t.doctorSent()).toEqual([{ type: 'doctor', intent: { type: 'leave' } }]);
	});

	it('ignores held keys, an empty answer, and every key but Escape while a beat plays', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(OPEN_GUARD_SECONDS);
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
});
