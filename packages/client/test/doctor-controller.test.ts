import {
	ITEM_IDS,
	getAnimal,
	homeTokens,
	itemsForSale,
	mustStay,
	type AnimalInstance,
	type GameEvent,
	type Intent,
	type ItemId
} from '@mathgame/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CueName } from '../src/audio/cues';
import { sfx } from '../src/audio/sfx.svelte';
import { LocalAuthority } from '../src/authority/local';
import { DoctorController } from '../src/doctor/controller';
import { doctorWords } from '../src/doctor/lines';
import { PICK_QUIET_SECONDS } from '../src/input/pick-guard';
import { optionKey, rowKey, tabKey } from '../src/input/press';
import { doctor, kindGoing, kindPicked, tabRows } from '../src/state/doctor.svelte';
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

function setup(
	party?: AnimalInstance[],
	options: { tokens?: number; shop?: readonly ItemId[] } = {}
) {
	const authority = new LocalAuthority({ ...(party ? { party } : {}), ...options });
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
	/** The open puzzle's answer (a heal's, or a token sum's), from the authority's latest doctor event. */
	const answer = (): number => {
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]!;
			if (e.type === 'doctor-visit-updated' || e.type === 'doctor-visit-started') {
				const phase = e.state.phase;
				if (phase.kind === 'choose-patient' || phase.kind === 'ended')
					throw new Error('no puzzle open');
				return phase.puzzle.answer;
			}
		}
		throw new Error('no visit');
	};
	const doctorSent = () => sent.filter((i) => i.type === 'doctor');
	/** The authority's own tokens and party, as a save would hold them. */
	const saved = () => {
		const game = authority.snapshot();
		return { tokens: game.tokens, items: game.items, party: game.party.map((a) => a.id) };
	};
	return { authority, controller, events, sent, cues, doctorSent, run, press, talk, answer, saved };
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
		expect(doctor.healed).toMatchObject({ amounts: { 0: 15 } });
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

	it('Escape goes back from a puzzle, and says bye from the list or mid-beat; walking comes back', () => {
		const t = setup(hurtParty());
		t.talk();
		t.press('Escape'); // inside the opening moment too
		expect(doctor.active).toBe(false);
		expect(t.events.at(-1)).toMatchObject({ type: 'doctor-visit-ended' });

		// In a puzzle, Escape puts it away: back on the list, the animal as it was.
		t.authority.dispatch({ type: 'interact' });
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter', '4');
		expect(doctor.screen).toBe('puzzle');
		t.press('Escape');
		expect(t.doctorSent().at(-1)).toEqual({ type: 'doctor', intent: { type: 'back' } });
		expect(doctor.active).toBe(true);
		expect(doctor.screen).toBe('list');
		expect(doctor.puzzle).toBeNull();
		expect(doctor.cursor).toBe(0);
		expect(doctor.line).toEqual({ say: 'hello' });
		expect(doctor.party[0]!.hp).toBe(5);

		// While a beat plays, Escape says bye.
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
		t.press('Escape', 'Escape'); // back to the list, then bye
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

/** Two tired rabbits and a hurt fox between them, a squirrel at full HP, a frog at 4. */
function bigParty(): AnimalInstance[] {
	// In species bundles, as every party in a game is (the authority puts one in them).
	return [
		{ id: 'r1', speciesId: 'rabbit', hp: 0 },
		{ id: 'r2', speciesId: 'rabbit', hp: 3 },
		{ id: 'f', speciesId: 'fox', hp: 9 },
		{ id: 's', speciesId: 'squirrel', hp: getAnimal('squirrel').maxHp },
		{ id: 'g', speciesId: 'frog', hp: 4 }
	];
}

describe("the doctor's tabs", () => {
	it('left and right go round heal, set free and shop, each with its own line and cursor', () => {
		const t = setup(hurtParty());
		t.talk();
		expect(doctor.tab).toBe('heal');
		t.cues.length = 0;
		t.press('ArrowRight');
		expect(doctor.tab).toBe('home');
		expect(doctor.line).toEqual({ say: 'homeIntro' });
		expect(doctor.cursor).toBe(0); // every animal can go home, the fit fox too
		t.press('d');
		expect(doctor.tab).toBe('shop');
		// What the catalog has on sale (the axe, the pickaxe and the boat), the cursor on the first.
		expect(doctor.line).toEqual({ say: 'shopIntro', empty: itemsForSale().length === 0 });
		expect(doctor.shop).toEqual(itemsForSale());
		expect(doctor.cursor).toBe(0);
		t.press('ArrowRight');
		expect(doctor.tab).toBe('heal');
		t.press('ArrowLeft', 'a');
		expect(doctor.tab).toBe('home');
		expect(t.cues).toEqual(['move', 'move', 'move', 'move', 'move']);
		// A tap on a tab goes there; on the tab on screen, nothing.
		t.press(tabKey('shop'));
		expect(doctor.tab).toBe('shop');
		t.press(tabKey('shop'));
		expect(doctor.tab).toBe('shop');
		expect(t.doctorSent()).toEqual([]);
	});

	it('in a puzzle, a tab puts it away and goes there', () => {
		const t = setup(hurtParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter', '4');
		t.press(tabKey('home'));
		expect(t.doctorSent().at(-1)).toEqual({ type: 'doctor', intent: { type: 'back' } });
		expect(doctor.screen).toBe('list');
		expect(doctor.tab).toBe('home');
		expect(doctor.puzzle).toBeNull();
		expect(doctor.line).toEqual({ say: 'homeIntro' });
	});
});

describe("the doctor's card: one puzzle heals a species", () => {
	it('lists the animals by species, and one right answer heals every hurt one of the kind, in one beat', () => {
		const t = setup(bigParty());
		t.talk();
		// Rabbits together, then the fox, the squirrel, the frog; the fit squirrel is skipped.
		const order = () =>
			tabRowsOf().map((r) => (r.kind === 'animal' ? doctor.party[r.partyIndex]!.id : r.kind));
		expect(order()).toEqual(['r1', 'r2', 'f', 's', 'g', 'bye']);
		expect(doctor.cursor).toBe(0);
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowDown');
		expect(doctor.cursor).toBe(1); // the other rabbit
		t.press('Enter');
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'pick-patient', partyIndex: 1 }
		});
		expect(doctor.line).toMatchObject({ say: 'letsHelp', animal: { id: 'r2' }, others: 1 });
		t.cues.length = 0;
		t.press(...String(t.answer()), 'Enter');
		t.run(0.85);
		expect(doctor.party.map((a) => a.hp)).toEqual([22, 22, 9, 20, 4]);
		expect(doctor.healed).toMatchObject({ amounts: { 0: 22, 1: 19 } });
		expect(t.cues).toEqual(['correct', 'heal']);
		expect(doctor.line).toMatchObject({
			say: 'healed',
			animal: { id: 'r2' },
			others: 1,
			someoneStillHurt: true
		});
		t.run(1.3);
		expect(doctor.screen).toBe('list');
		expect(doctor.cursor).toBe(2); // the fox, the next one down that needs the doctor
	});

	it('up and down in a heal swap to the next species that needs the doctor, never to its own kind', () => {
		const t = setup(bigParty());
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter'); // the tired rabbit
		const picked = () => (t.doctorSent().at(-1)!.intent as { partyIndex: number }).partyIndex;
		expect(picked()).toBe(0);
		t.press('ArrowDown');
		expect(picked()).toBe(2); // the fox, not the other rabbit
		t.press('ArrowDown');
		expect(picked()).toBe(4); // the frog, past the fit squirrel
		t.press('ArrowDown');
		expect(picked()).toBe(0); // round to the rabbits
		// A tap on the other rabbit: the puzzle open already helps it.
		const sent = t.doctorSent().length;
		t.press(rowKey(1));
		expect(t.doctorSent()).toHaveLength(sent);
	});
});

/** The tab on screen's rows, as the card lists them. */
function tabRowsOf() {
	return tabRows(doctor.tab, doctor.party, doctor.shop);
}

describe('helping animals home', () => {
	/** Talk, wait out the opening moment, and go to the home tab. */
	const home = (t: ReturnType<typeof setup>) => {
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowRight');
		expect(doctor.tab).toBe('home');
	};

	it('picks animals with Enter, never the last one, and asks before anything leaves', () => {
		const t = setup(hurtParty());
		home(t);
		t.cues.length = 0;
		t.press('Enter'); // the squirrel
		t.press('ArrowDown', 'Enter'); // the rabbit
		expect(doctor.marked).toEqual(['a', 'b']);
		// The fox is the last one: it stays, with a little shake and no sound.
		t.press('ArrowDown', 'Enter');
		expect(doctor.marked).toEqual(['a', 'b']);
		expect(doctor.shake).toMatchObject({ row: 2 });
		expect(t.cues).toEqual(['confirm', 'move', 'confirm', 'move']);
		// Enter again unpicks.
		t.press('ArrowUp', 'Enter');
		expect(doctor.marked).toEqual(['a']);
		t.press('Enter');
		expect(doctor.marked).toEqual(['a', 'b']);
		// Set them free comes after the animals, then Bye. It waits a quiet moment, as a pick does.
		t.press('ArrowDown', 'ArrowDown');
		expect(tabRowsOf()[doctor.cursor]).toEqual({ kind: 'send' });
		t.press('Enter');
		expect(doctor.screen).toBe('list');
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('confirm');
		expect(doctor.confirm).toBe(0); // "No, not now" is lit first
		expect(doctor.line).toEqual({ say: 'homeSure' });
		expect(t.doctorSent()).toEqual([]);
	});

	it('the last animal standing stays: keeping only tired ones is keeping nobody who can battle', () => {
		const t = setup([
			{ id: 'a', speciesId: 'squirrel', hp: 0 },
			{ id: 'b', speciesId: 'fox', hp: 5 },
			{ id: 'c', speciesId: 'rabbit', hp: 0 }
		]);
		home(t);
		t.press('ArrowDown', 'Enter'); // the fox: the only one standing
		expect(doctor.marked).toEqual([]);
		expect(doctor.shake).toMatchObject({ row: 1 });
		t.press('ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter'); // both tired ones may go
		expect(doctor.marked).toEqual(['a', 'c']);
		t.press('ArrowUp', 'Enter'); // and still not the fox
		expect(doctor.marked).toEqual(['a', 'c']);
		expect(t.doctorSent()).toEqual([]);
	});

	it('the one that stays walks on land with the kid: a crab or a whale standing is not enough', () => {
		const t = setup([
			{ id: 'a', speciesId: 'squirrel', hp: 20 },
			{ id: 'b', speciesId: 'crab', hp: 22 },
			{ id: 'c', speciesId: 'whale', hp: 100 }
		]);
		home(t);
		t.press('Enter'); // the squirrel: the only one that walks
		expect(doctor.marked).toEqual([]);
		expect(doctor.shake).toMatchObject({ row: 0 });
		t.press('ArrowDown', 'Enter', 'ArrowDown', 'Enter'); // the sea animals may both go
		expect(doctor.marked).toEqual(['b', 'c']);
		expect(t.doctorSent()).toEqual([]);
	});

	it('No, or Escape, goes back to the list with the animals still picked; nothing leaves', () => {
		const t = setup(hurtParty());
		home(t);
		t.press('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown');
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('confirm');
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('list');
		expect(doctor.marked).toEqual(['a']);
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('confirm');
		t.press('Escape');
		expect(doctor.screen).toBe('list');
		expect(doctor.active).toBe(true);
		expect(doctor.marked).toEqual(['a']);
		expect(t.doctorSent()).toEqual([]);
		expect(t.saved().party).toEqual(['a', 'b', 'c']);
	});

	it('Yes asks the sum; a wrong answer asks it again and changes nothing; the right one sends them home and pays', () => {
		const t = setup(hurtParty(), { tokens: 5 });
		home(t);
		t.press('Enter', 'ArrowDown', 'Enter', 'ArrowDown', 'ArrowDown');
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.screen).toBe('confirm');
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowRight');
		expect(doctor.confirm).toBe(1);
		t.press('Enter');
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'hand-over', ids: ['a', 'b'] }
		});
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.trade).toEqual({ kind: 'home', ids: ['a', 'b'], reward: 4 });
		expect(doctor.balance).toBe(5);
		expect(doctor.puzzle?.prompt).toBe('5 + 4 = ?');
		expect(doctor.line).toEqual({ say: 'homeCount' });

		t.press('8', 'Enter');
		t.run(1.3);
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.line).toEqual({ say: 'tryAgain' });
		expect(doctor.puzzle?.prompt).toBe('5 + 4 = ?');
		expect(doctor.input).toBe('');
		expect(t.saved()).toEqual({ tokens: 5, items: [], party: ['a', 'b', 'c'] });

		t.cues.length = 0;
		t.press('9', 'Enter');
		t.run(0.85);
		expect(doctor.leaving).toEqual(['a', 'b']);
		expect(doctor.line).toMatchObject({ say: 'wentHome', animals: [{ id: 'a' }, { id: 'b' }] });
		t.run(1.6);
		expect(doctor.party.map((a) => a.id)).toEqual(['c']);
		expect(doctor.tokens).toBe(9);
		expect(doctor.tokenPop).toMatchObject({ amount: 4 });
		expect(doctor.line).toEqual({ say: 'tokensGiven', amount: 4, tokens: 9 });
		expect(t.cues).toEqual(['correct', 'heal', 'coins']);
		t.run(1.7);
		expect(doctor.screen).toBe('list');
		expect(doctor.marked).toEqual([]);
		expect(doctor.cursor).toBe(0);
		// Written back at once: the save holds it, whatever happens to the visit.
		expect(t.saved()).toEqual({ tokens: 9, items: [], party: ['c'] });
		const kinds = t.events.slice(-4).map((e) => e.type);
		expect(kinds).toEqual([
			'doctor-visit-updated',
			'solved-changed',
			'party-changed',
			'belongings-changed'
		]);
	});

	it('Escape in the sum puts it away: the animals stay, still picked', () => {
		const t = setup(hurtParty());
		home(t);
		t.press('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown');
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowDown', 'Enter');
		expect(doctor.screen).toBe('puzzle');
		t.press('2', 'Escape');
		expect(doctor.screen).toBe('list');
		expect(doctor.tab).toBe('home');
		expect(doctor.marked).toEqual(['a']);
		expect(t.saved().party).toEqual(['a', 'b', 'c']);
	});

	it('an Enter mashed as the confirm comes up never says yes, at any pace', () => {
		for (const { name, gaps } of everyMash(3)) {
			const t = setup(hurtParty());
			home(t);
			t.press('Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown');
			expect(tabRowsOf()[doctor.cursor], name).toEqual({ kind: 'send' });
			t.run(PICK_QUIET_SECONDS);
			// The mash's first Enter opens the confirm; the rest land on it.
			for (const gap of gaps) {
				t.controller.onKey(key('Enter'));
				t.run(gap);
			}
			expect(doctor.screen, name).toBe('confirm');
			// Even with "Yes" lit, a mash never picks it.
			t.press('ArrowRight');
			for (const gap of gaps) {
				t.controller.onKey(key('Enter'));
				t.run(gap);
			}
			expect(doctor.screen, name).toBe('confirm');
			expect(t.doctorSent(), name).toEqual([]);
		}
	});

	it('a tap on a choice of the confirm does it, after the quiet moment; the list under it takes no tap', () => {
		const t = setup(hurtParty());
		home(t);
		t.press(rowKey(0));
		expect(doctor.marked).toEqual(['a']);
		const send = tabRowsOf().findIndex((r) => r.kind === 'send');
		t.run(PICK_QUIET_SECONDS);
		t.press(rowKey(send));
		expect(doctor.screen).toBe('confirm');
		t.press(optionKey(1)); // too soon
		expect(doctor.screen).toBe('confirm');
		t.run(PICK_QUIET_SECONDS);
		t.press(rowKey(1)); // the list waits under the confirm
		expect(doctor.marked).toEqual(['a']);
		t.run(PICK_QUIET_SECONDS);
		t.press(optionKey(1));
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'hand-over', ids: ['a'] }
		});
	});
});

/** `n` animals of one kind, `<prefix>1` first, at `hp` (full when not given). */
function many(speciesId: string, n: number, prefix: string, hp?: number): AnimalInstance[] {
	const max = getAnimal(speciesId).maxHp;
	return Array.from({ length: n }, (_, i) => ({
		id: `${prefix}${i + 1}`,
		speciesId,
		hp: hp ?? max
	}));
}

describe('helping a whole kind home', () => {
	/** Talk, wait out the opening moment, and go to the home tab. */
	const home = (t: ReturnType<typeof setup>) => {
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowRight');
		expect(doctor.tab).toBe('home');
	};
	/** The home tab's rows, each by what it shows. */
	const shown = () =>
		tabRowsOf().map((r) =>
			r.kind === 'animal'
				? doctor.party[r.partyIndex]!.id
				: r.kind === 'bundle'
					? `all ${r.speciesId}`
					: r.kind
		);

	it('a kind of several has a row over its animals, which picks them all at once and takes them back', () => {
		const t = setup([
			...many('fox', 3, 'f'),
			{ id: 's', speciesId: 'squirrel', hp: 4 },
			{ id: 'r', speciesId: 'rabbit', hp: 0 }
		]);
		home(t);
		// A kind of one needs no row of its own; the heal tab has none at all.
		expect(shown()).toEqual(['all fox', 'f1', 'f2', 'f3', 's', 'r', 'send', 'bye']);
		expect(doctor.cursor).toBe(0);
		// With the squirrel standing, the row's pick sends all three: 18 tokens.
		expect(homeTokens(kindGoing('fox', doctor))).toBe(18);
		t.cues.length = 0;
		// The row picks them all; nothing leaves before the confirm and the sum.
		t.press('Enter');
		expect(doctor.marked).toEqual(['f1', 'f2', 'f3']);
		expect(kindPicked('fox', doctor)).toBe('all');
		// Unlike one animal's, a kind's pick waits the list's quiet moment: a second Enter
		// straight after does nothing, so a mash never picks or drops a stack.
		t.press('Enter');
		expect(doctor.marked).toEqual(['f1', 'f2', 'f3']);
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.marked).toEqual([]);
		expect(kindPicked('fox', doctor)).toBe('none');
		// One picked by hand (at once): the row adds the rest, then takes the whole kind back.
		t.press('ArrowDown', 'ArrowDown', 'Enter', 'ArrowUp', 'ArrowUp');
		expect(doctor.marked).toEqual(['f2']);
		expect(kindPicked('fox', doctor)).toBe('some');
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.marked).toEqual(['f2', 'f1', 'f3']);
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.marked).toEqual([]);
		expect(t.cues).toEqual([
			'confirm',
			'move',
			'move',
			'move',
			'confirm',
			'move',
			'move',
			'confirm',
			'move'
		]);
		// Another kind's picks stay as they were. A tap on the row waits the same moment.
		t.press('ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter');
		expect(doctor.marked).toEqual(['s']);
		t.press(rowKey(0));
		expect(doctor.marked).toEqual(['s']);
		t.run(PICK_QUIET_SECONDS);
		t.press(rowKey(0));
		// With the squirrel going, the foxes are the last who can walk on: the first stays.
		expect(doctor.marked).toEqual(['s', 'f2', 'f3']);
		t.press(rowKey(0));
		expect(doctor.marked).toEqual(['s']);
		expect(tabRows('heal', doctor.party, doctor.shop).some((r) => r.kind === 'bundle')).toBe(false);
		expect(t.doctorSent()).toEqual([]);
	});

	it('when the kind is all that stands, the first of it standing stays, and the rest go home', () => {
		const t = setup(
			[
				{ id: 'f1', speciesId: 'fox', hp: 0 },
				{ id: 'f2', speciesId: 'fox', hp: 9 },
				{ id: 'f3', speciesId: 'fox', hp: 35 },
				{ id: 's', speciesId: 'squirrel', hp: 0 }
			],
			{ tokens: 3 }
		);
		home(t);
		// Before anything is picked, nobody has to stay, but the row already counts only
		// the foxes its pick sends: 12 tokens, not the 18 of all three.
		expect(mustStay(doctor.party, doctor.marked)).toEqual([]);
		const going = () => kindGoing('fox', doctor).map((a) => a.id);
		expect(going()).toEqual(['f1', 'f3']);
		expect(homeTokens(kindGoing('fox', doctor))).toBe(12);
		t.press('Enter');
		expect(doctor.marked).toEqual(['f1', 'f3']);
		expect(going()).toEqual(['f1', 'f3']);
		// The fox who stays: its check box says so, and a pick on it gives a little shake and no sound.
		expect(mustStay(doctor.party, doctor.marked)).toEqual(['f2']);
		expect(kindPicked('fox', doctor)).toBe('all');
		t.cues.length = 0;
		t.press('ArrowDown', 'ArrowDown', 'Enter');
		expect(doctor.marked).toEqual(['f1', 'f3']);
		expect(doctor.shake).toMatchObject({ row: 2 });
		expect(t.cues).toEqual(['move', 'move']);
		// The tired squirrel may go too; the fox still stays.
		t.press('ArrowDown', 'ArrowDown', 'Enter');
		expect(doctor.marked).toEqual(['f1', 'f3', 's']);
		t.press('ArrowDown');
		expect(tabRowsOf()[doctor.cursor]).toEqual({ kind: 'send' });
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowRight', 'Enter');
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'hand-over', ids: ['f1', 'f3', 's'] }
		});
		expect(doctor.puzzle?.prompt).toBe('3 + 14 = ?');
		t.press('1', '7', 'Enter');
		t.run(0.85 + 1.6 + 1.7);
		expect(doctor.screen).toBe('list');
		expect(t.saved()).toEqual({ tokens: 17, items: [], party: ['f2'] });
		// One fox left: a kind of one has no row of its own.
		expect(shown()).toEqual(['f2', 'send', 'bye']);
	});

	it('forty foxes at once: the running total, the sum of the real numbers, and "No, not now" lit first under a mash', () => {
		const party = [...many('fox', 40, 'f'), { id: 's', speciesId: 'squirrel', hp: 20 }];
		for (const { name, gaps } of everyMash(3)) {
			const t = setup(party, { tokens: 23 });
			home(t);
			t.press('Enter');
			expect(doctor.marked, name).toHaveLength(40);
			expect(homeTokens(doctor.party.filter((a) => doctor.marked.includes(a.id)))).toBe(240);
			// Up from the top: round to Bye, then Set them free.
			t.press('ArrowUp', 'ArrowUp');
			expect(tabRowsOf()[doctor.cursor], name).toEqual({ kind: 'send' });
			t.run(PICK_QUIET_SECONDS);
			// The mash's first Enter opens the confirm; the rest land on it, and on "Yes" too.
			for (const gap of gaps) {
				t.controller.onKey(key('Enter'));
				t.run(gap);
			}
			expect(doctor.screen, name).toBe('confirm');
			expect(doctor.confirm, name).toBe(0);
			t.press('ArrowRight');
			for (const gap of gaps) {
				t.controller.onKey(key('Enter'));
				t.run(gap);
			}
			expect(doctor.screen, name).toBe('confirm');
			expect(t.doctorSent(), name).toEqual([]);
			// A deliberate Yes, after the quiet moment: the sum of the real numbers.
			t.run(PICK_QUIET_SECONDS);
			t.press('Enter');
			expect(doctor.puzzle?.prompt, name).toBe('23 + 240 = ?');
			expect(doctor.trade, name).toMatchObject({ kind: 'home', reward: 240 });
		}
	});

	it('a tap on a kind picks them all at once; a kind none of whom may go shakes', () => {
		const t = setup([...many('rabbit', 5, 'r'), { id: 'f', speciesId: 'fox', hp: 12 }]);
		home(t);
		t.press(rowKey(0));
		expect(doctor.marked).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
		t.press(rowKey(0));
		expect(doctor.marked).toEqual([]);

		// Nobody standing at all (a `?party=` of tired animals): nobody can go until one is healed.
		const tired = setup(many('rabbit', 3, 'r', 0));
		home(tired);
		tired.cues.length = 0;
		tired.press('Enter');
		expect(doctor.marked).toEqual([]);
		expect(doctor.shake).toMatchObject({ row: 0 });
		expect(tired.cues).toEqual([]);
	});

	it('an Enter mashed through a goodbye never picks the whole kind the cursor comes back to, at any pace', () => {
		// Forty foxes first, so after the goodbye the cursor is back on their row.
		const party = [
			...many('fox', 40, 'f'),
			...many('rabbit', 10, 'r'),
			{ id: 's', speciesId: 'squirrel', hp: 20 }
		];
		for (const { name, gaps } of everyMash(6)) {
			const t = setup(party, { tokens: 5 });
			home(t);
			const rabbit = tabRowsOf().findIndex((r) => r.kind === 'animal' && r.partyIndex === 40);
			t.press(rowKey(rabbit), rowKey(rabbit + 1));
			expect(doctor.marked, name).toEqual(['r1', 'r2']);
			t.run(PICK_QUIET_SECONDS);
			t.press(rowKey(tabRowsOf().findIndex((r) => r.kind === 'send')));
			t.run(PICK_QUIET_SECONDS);
			t.press(optionKey(1));
			expect(doctor.screen, name).toBe('puzzle');
			// The answer, then Enter mashed on through the goodbye and the tokens, and on.
			t.press(...String(t.answer()));
			for (const gap of gaps) {
				t.controller.onKey(key('Enter'));
				t.run(gap);
			}
			expect(doctor.screen, name).toBe('list');
			expect(tabRowsOf()[doctor.cursor], name).toEqual({
				kind: 'bundle',
				speciesId: 'fox',
				groupStart: false
			});
			expect(doctor.marked, name).toEqual([]);
			expect(t.saved().party, name).not.toContain('r1');
		}
	});

	it('a sea animal is no one to walk on with: the foxes keep a fox beside the crabs', () => {
		const t = setup([...many('fox', 2, 'f'), ...many('crab', 3, 'c')], { tokens: 5 });
		home(t);
		expect(shown()).toEqual(['all fox', 'f1', 'f2', 'all crab', 'c1', 'c2', 'c3', 'send', 'bye']);
		// The foxes' row keeps the first fox: crabs alone could battle nothing on land.
		t.press('Enter');
		expect(doctor.marked).toEqual(['f2']);
		expect(mustStay(doctor.party, doctor.marked)).toEqual(['f1']);
		expect(kindGoing('fox', doctor).map((a) => a.id)).toEqual(['f2']);
		// Every crab may go, and the last fox still won't: a little shake.
		t.run(PICK_QUIET_SECONDS);
		t.press(rowKey(3));
		expect(doctor.marked).toEqual(['f2', 'c1', 'c2', 'c3']);
		t.press(rowKey(1));
		expect(doctor.marked).toEqual(['f2', 'c1', 'c2', 'c3']);
		expect(doctor.shake).toMatchObject({ row: 1 });
		// The authority takes exactly those picks: one fox walks on.
		t.run(PICK_QUIET_SECONDS);
		t.press(rowKey(7));
		t.run(PICK_QUIET_SECONDS);
		t.press(optionKey(1));
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'hand-over', ids: ['f2', 'c1', 'c2', 'c3'] }
		});
		expect(doctor.screen).toBe('puzzle');
		t.press(...String(t.answer()), 'Enter');
		t.run(0.85 + 1.6 + 1.7);
		expect(t.saved().party).toEqual(['f1']);
	});

	it('a team of 120 across every kind: a row for each kind, every row a stop, up and down wrapping round', () => {
		const kinds = ['squirrel', 'rabbit', 'frog', 'fox', 'otter', 'deer', 'wolf', 'bear'];
		const t = setup(kinds.flatMap((s) => many(s, 15, `${s}-`)));
		home(t);
		const rows = tabRowsOf();
		expect(rows).toHaveLength(8 + 120 + 2);
		expect(
			rows.filter((r) => r.kind === 'bundle').map((r) => r.kind === 'bundle' && r.speciesId)
		).toEqual(kinds);
		// Every kind's row is a line apart from the kind before it.
		expect(rows.filter((r) => 'groupStart' in r && r.groupStart)).toHaveLength(7);
		// The bears, all at once, from the bottom of the list (round to Bye, past Set them free
		// while nothing is picked, then up the fifteen bears): 15 × 30 tokens.
		for (let i = 0; i < 17; i++) t.press('ArrowUp');
		expect(rows[doctor.cursor]).toEqual({ kind: 'bundle', speciesId: 'bear', groupStart: true });
		t.press('Enter');
		expect(doctor.marked).toHaveLength(15);
		expect(homeTokens(doctor.party.filter((a) => doctor.marked.includes(a.id)))).toBe(450);
	});
});

describe('the shop', () => {
	/** Talk, wait out the opening moment, and go to the shop, every item for sale. */
	const shop = (tokens: number) => {
		const t = setup(hurtParty(), { tokens, shop: ITEM_IDS });
		t.talk();
		t.run(PICK_QUIET_SECONDS);
		t.press('ArrowLeft');
		expect(doctor.tab).toBe('shop');
		expect(doctor.shop).toEqual(['axe', 'pickaxe', 'boat', 'glider']);
		return t;
	};

	it('sells the paraglider, the dearest tool, for 34: the sum of the tokens left buys it', () => {
		const t = shop(40);
		t.press('ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter'); // the paraglider, 34
		expect(doctor.trade).toEqual({ kind: 'buy', itemId: 'glider', price: 34 });
		expect(doctor.puzzle?.prompt).toBe('40 − 34 = ?');
		t.press('6', 'Enter');
		t.run(0.85);
		expect(doctor.items).toEqual(['glider']);
		expect(t.saved()).toMatchObject({ tokens: 6, items: ['glider'] });
	});

	it('an item a kid cannot pay for gives a little shake, and nothing is bought', () => {
		const t = shop(10);
		t.press('ArrowDown'); // the pickaxe, 13
		t.cues.length = 0;
		t.press('Enter');
		expect(doctor.shake).toMatchObject({ row: 1 });
		expect(t.cues).toEqual([]);
		expect(t.doctorSent()).toEqual([]);
	});

	it('buying asks the tokens left; a wrong answer asks it again; the right one buys it', () => {
		const t = shop(23);
		t.press('Enter'); // the axe, 8
		expect(t.doctorSent().at(-1)).toEqual({
			type: 'doctor',
			intent: { type: 'buy', itemId: 'axe' }
		});
		expect(doctor.screen).toBe('puzzle');
		expect(doctor.trade).toEqual({ kind: 'buy', itemId: 'axe', price: 8 });
		expect(doctor.puzzle?.prompt).toBe('23 − 8 = ?');
		expect(doctor.line).toEqual({ say: 'shopCount' });
		t.press('1', '6', 'Enter');
		t.run(1.3);
		expect(doctor.line).toEqual({ say: 'tryAgain' });
		expect(doctor.puzzle?.prompt).toBe('23 − 8 = ?');
		expect(t.saved()).toMatchObject({ tokens: 23, items: [] });

		t.cues.length = 0;
		t.press('1', '5', 'Enter');
		t.run(0.85);
		expect(doctor.tokens).toBe(15);
		expect(doctor.items).toEqual(['axe']);
		expect(doctor.bought).toBe('axe');
		expect(doctor.tokenPop).toMatchObject({ amount: -8 });
		expect(doctor.line).toEqual({ say: 'bought', itemId: 'axe', tokens: 15 });
		expect(t.cues).toEqual(['correct', 'coins']);
		expect(t.saved()).toMatchObject({ tokens: 15, items: ['axe'] });
		t.run(1.7);
		expect(doctor.screen).toBe('list');
		// One is all anyone needs: now it shakes.
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		expect(doctor.shake).toMatchObject({ row: 0 });
		expect(t.doctorSent().filter((i) => i.intent.type === 'buy')).toHaveLength(1);
	});

	it('Escape in the sum, or a tap on Back, puts it away and buys nothing', () => {
		const t = shop(30);
		t.press('ArrowDown', 'ArrowDown', 'Enter'); // the boat, 21
		expect(doctor.puzzle?.prompt).toBe('30 − 21 = ?');
		t.press('9', 'Escape');
		expect(doctor.screen).toBe('list');
		expect(doctor.tab).toBe('shop');
		expect(doctor.cursor).toBe(2);
		expect(t.saved()).toMatchObject({ tokens: 30, items: [] });
		// Bye in the list leaves at any time, from a sum too.
		t.run(PICK_QUIET_SECONDS);
		t.press('Enter');
		t.press(rowKey(tabRowsOf().length - 1));
		expect(doctor.active).toBe(false);
		expect(t.saved()).toMatchObject({ tokens: 30, items: [] });
	});
});
