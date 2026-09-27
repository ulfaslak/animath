import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import type { BattleState } from '../src/battle/types.js';
import type { MatchState } from '../src/match/types.js';
import {
	MAX_FIGHT_EVENTS,
	fightAnimal,
	matchFight,
	matchFightEvents,
	readFightEvents,
	readFightView,
	wildFight,
	wildFightEvents,
	type FightEvent,
	type FightView
} from '../src/net/fight.js';
import { facePrompt } from '../src/puzzles/face.js';
import { Rng } from '../src/rng.js';
import { arena, makeParty, makeWild, playBattle, type PlayerModel } from './battle-sim.js';
import { party, playMatch } from './match-sim.js';

/**
 * A battle seen from outside ([[ARCHITECTURE]] `net/fight.ts`): what the
 * players near a battle are sent of it. Played over whole battles and
 * matches: every view and every step's events read back through the wire's
 * reader unchanged, hold no answer and no word, and say what the state says.
 */

const read = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** Every key anywhere in a value, however deep. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) for (const v of value) keysOf(v, into);
	else if (value !== null && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			into.add(k);
			keysOf(v, into);
		}
	}
	return into;
}

/** Every string anywhere in a value: the only text a fight may carry is a species id or a clean nickname. */
function textsOf(value: unknown, into: string[] = []): string[] {
	if (typeof value === 'string') into.push(value);
	else if (Array.isArray(value)) for (const v of value) textsOf(v, into);
	else if (value !== null && typeof value === 'object')
		for (const v of Object.values(value)) textsOf(v, into);
	return into;
}

const TOKENS = new Set([
	...ANIMALS.map((a) => a.id),
	'land',
	'water',
	'a',
	'b',
	'puzzle',
	'judged',
	'hit',
	'missed',
	'leash',
	'switched',
	'fainted',
	'ended',
	'tired',
	'caught',
	'fled',
	'left',
	'add',
	'sub',
	'mul',
	'div',
	'missing',
	'sequence',
	'sqrt',
	'Pip',
	'Nini'
]);

/** What must hold of every view and events a fight sends, whatever the battle. */
function checkSent(view: FightView, events: FightEvent[], bad: string[], where: string): void {
	if (JSON.stringify(readFightView(read(view))) !== JSON.stringify(view)) {
		bad.push(`${where}: the view does not read back: ${JSON.stringify(view)}`);
	}
	if (JSON.stringify(readFightEvents(read(events))) !== JSON.stringify(events)) {
		bad.push(`${where}: the events do not read back: ${JSON.stringify(events)}`);
	}
	if (events.length > MAX_FIGHT_EVENTS) bad.push(`${where}: ${events.length} events`);
	const keys = keysOf([view, events]);
	for (const secret of ['answer', 'input', 'prompt', 'id', 'seed']) {
		if (keys.has(secret)) bad.push(`${where}: a key named ${secret}`);
	}
	for (const text of textsOf([view, events])) {
		if (!TOKENS.has(text)) bad.push(`${where}: text "${text}"`);
	}
}

const MODELS: PlayerModel[] = [
	{ accuracy: 0.7, policy: 'random', leash: 0.15, switch: 0.1 },
	{ accuracy: 0.3, policy: 'random', flee: 0.05, switch: 0.2 },
	{ accuracy: 0.9, policy: 'max', leash: 0.3 },
	{ accuracy: 0.5, policy: 'min' }
];

describe('a wild battle seen from outside', () => {
	it('sends what the battle says, and reads back unchanged, at every step of whole battles', () => {
		const rng = new Rng(7);
		const bad: string[] = [];
		const ends = new Set<string>();
		const kinds = new Set<string>();
		for (let game = 0; game < 120; game++) {
			const leads = ANIMALS.map((a) => a.id);
			const lead = leads[rng.int(0, leads.length - 1)]!;
			const wildId = leads[rng.int(0, leads.length - 1)]!;
			const realm = arena(lead, wildId);
			if (!realm) continue;
			const team = makeParty([
				lead,
				...ANIMALS.filter((a) => canFightIn(a.id, realm))
					.slice(0, 2)
					.map((a) => a.id)
			]);
			team[0] = {
				...team[0]!,
				nickname: game % 3 === 0 ? 'Pip' : game % 3 === 1 ? 'Nini' : undefined
			};
			if (team[0]!.nickname === undefined) delete team[0]!.nickname;
			const model = MODELS[game % MODELS.length]!;
			playBattle(
				1000 + game,
				team,
				makeWild(wildId),
				model,
				(before, _intent, step) => {
					const where = `battle ${game} step ${before.step}`;
					const view = wildFight(step.state);
					const events = wildFightEvents(step.events);
					checkSent(view, events, bad, where);
					checkWild(step.state, view, bad, where);
					for (const e of events) {
						kinds.add(e.type);
						if (e.type === 'ended') ends.add(`${e.winner}:${e.how}`);
					}
					// The step's events end where the view stands.
					const last = [...events].reverse();
					const hitA = last.find((e) => e.type === 'hit' && e.attacker === 'b');
					if (
						hitA?.type === 'hit' &&
						hitA.hp !== view.a.hp &&
						!events.some((e) => e.type === 'switched' || e.type === 'fainted')
					) {
						bad.push(`${where}: the last hit on a left ${hitA.hp}, the view says ${view.a.hp}`);
					}
				},
				400,
				realm
			);
		}
		expect(bad.slice(0, 20)).toEqual([]);
		// The sweep met every kind of event and every way a wild battle ends.
		expect([...kinds].sort()).toEqual(
			['ended', 'fainted', 'hit', 'judged', 'leash', 'missed', 'puzzle', 'switched'].sort()
		);
		expect([...ends].sort()).toEqual(['a:caught', 'a:tired', 'b:tired', 'null:fled'].sort());
		// About 0.4 s alone (120 battles, every step read back through JSON); far more under load.
	}, 60_000);

	it('starts with no events to send, the wild animal and the lead facing each other, and no puzzle yet', () => {
		const team = makeParty(['rabbit', 'fox']);
		const state: BattleState = {
			step: 0,
			turn: 1,
			party: team,
			active: 0,
			opponent: makeWild('squirrel', 3),
			leashQuality: 1,
			realm: 'land',
			phase: { kind: 'choose-action' }
		};
		expect(wildFight(state)).toStrictEqual({
			realm: 'land',
			a: { species: 'rabbit', hp: getAnimal('rabbit').maxHp },
			b: { species: 'squirrel', hp: 3 },
			turn: 'a',
			puzzle: null
		});
		expect(wildFightEvents([])).toEqual([]);
	});
});

/** A wild battle's view says what its state says: who is in front, their HP, the open puzzle, whose turn. */
function checkWild(state: BattleState, view: FightView, bad: string[], where: string): void {
	const front = state.party[state.active]!;
	if (view.a.species !== front.speciesId || view.a.hp !== front.hp) bad.push(`${where}: side a`);
	if (view.b.species !== state.opponent.speciesId || view.b.hp !== state.opponent.hp) {
		bad.push(`${where}: side b`);
	}
	if (view.realm !== state.realm) bad.push(`${where}: realm`);
	const phase = state.phase;
	if (view.turn !== (phase.kind === 'ended' ? null : 'a')) bad.push(`${where}: turn ${view.turn}`);
	if (phase.kind === 'solving') {
		if (!view.puzzle || facePrompt(view.puzzle) !== phase.puzzle.prompt) {
			bad.push(
				`${where}: the puzzle ${phase.puzzle.prompt} shows as ${JSON.stringify(view.puzzle)}`
			);
		}
	} else if (view.puzzle !== null) bad.push(`${where}: a puzzle outside solving`);
}

describe('a friendly match seen from outside', () => {
	it('sends what the match says, and reads back unchanged, at every step of whole matches', () => {
		const rng = new Rng(8);
		const land = ANIMALS.filter((a) => canFightIn(a.id, 'land')).map((a) => a.id);
		const bad: string[] = [];
		const ends = new Set<string>();
		for (let game = 0; game < 60; game++) {
			const pick = () =>
				Array.from({ length: rng.int(1, 3) }, () => land[rng.int(0, land.length - 1)]!);
			const teams = { a: party(pick()), b: party(pick()) };
			teams.a[0] = { ...teams.a[0]!, nickname: 'Pip' };
			playMatch(
				2000 + game,
				teams,
				{
					a: { accuracy: 0.6, policy: 'random', switch: 0.1, leave: game % 7 === 0 ? 0.05 : 0 },
					b: { accuracy: 0.8, policy: 'random', switch: 0.1 }
				},
				(before, _side, _intent, step) => {
					const where = `match ${game} step ${before.step}`;
					const view = matchFight(step.state);
					const events = matchFightEvents(step.events);
					checkSent(view, events, bad, where);
					checkMatch(step.state, view, bad, where);
					for (const e of events)
						if (e.type === 'ended')
							ends.add(`${e.winner === null ? 'nobody' : 'someone'}:${e.how}`);
				}
			);
		}
		expect(bad.slice(0, 20)).toEqual([]);
		expect([...ends].sort()).toEqual(['someone:left', 'someone:tired']);
		// About 0.3 s alone (60 matches, every step read back through JSON).
	}, 60_000);

	it('ends a match that timed out as one a player left: its winner is the one who stayed', () => {
		expect(matchFightEvents([{ type: 'ended', winner: 'b', reason: 'timed-out' }])).toEqual([
			{ type: 'ended', winner: 'b', how: 'left' }
		]);
		expect(matchFightEvents([{ type: 'rejected', reason: 'not-your-turn' }])).toEqual([]);
	});
});

function checkMatch(state: MatchState, view: FightView, bad: string[], where: string): void {
	for (const side of ['a', 'b'] as const) {
		const front = state.teams[side][state.active[side]]!;
		if (view[side].species !== front.speciesId || view[side].hp !== front.hp)
			bad.push(`${where}: side ${side}`);
	}
	const phase = state.phase;
	if (view.turn !== (phase.kind === 'ended' ? null : phase.side)) bad.push(`${where}: turn`);
	if (phase.kind === 'solving') {
		if (!view.puzzle || facePrompt(view.puzzle) !== phase.puzzle.prompt)
			bad.push(`${where}: puzzle`);
	} else if (view.puzzle !== null) bad.push(`${where}: a puzzle outside solving`);
	if (view.realm !== 'land') bad.push(`${where}: a match off land`);
}

describe('names in a fight', () => {
	it('sends a nickname only as the nickname rules keep it, with no rude word in it; the animal goes by its kind otherwise', () => {
		const fox = { speciesId: 'fox', hp: 5 };
		expect(fightAnimal({ ...fox, nickname: 'Pip' })).toStrictEqual({
			species: 'fox',
			nickname: 'Pip',
			hp: 5
		});
		expect(fightAnimal(fox)).toStrictEqual({ species: 'fox', hp: 5 });
		for (const nickname of ['  Pip ', 'Pip\u0000', 'x'.repeat(40), 'shit', 'Fisse', '']) {
			expect(fightAnimal({ ...fox, nickname }), nickname).toStrictEqual({ species: 'fox', hp: 5 });
		}
		// Off the wire the same: a nickname a rule would change or drop is dropped, the animal kept.
		const view = (nickname: unknown) => ({
			realm: 'land',
			a: { species: 'fox', nickname, hp: 5 },
			b: { species: 'rabbit', hp: 1 },
			turn: 'a',
			puzzle: null
		});
		expect(readFightView(view('Pip'))?.a).toStrictEqual({ species: 'fox', nickname: 'Pip', hp: 5 });
		expect(readFightView(view('shit'))?.a).toStrictEqual({ species: 'fox', hp: 5 });
		expect(readFightView(view(' spaced  out '))?.a).toStrictEqual({ species: 'fox', hp: 5 });
		// Not text at all, or longer than the wire takes: not an animal.
		expect(readFightView(view(7))).toBeNull();
		expect(readFightView(view('x'.repeat(65)))).toBeNull();
	});
});

describe('a fight off the wire', () => {
	const view: FightView = {
		realm: 'water',
		a: { species: 'otter', hp: 3 },
		b: { species: 'crab', hp: 2 },
		turn: 'a',
		puzzle: { kind: 'add', numbers: [3, 4] }
	};

	it('refuses a species this build does not know, HP past its own, and anything but a sum for a puzzle', () => {
		expect(readFightView(read(view))).toStrictEqual(view);
		const bad = (patch: Record<string, unknown>) => readFightView({ ...view, ...patch });
		expect(bad({ a: { species: 'dragon', hp: 3 } })).toBeNull();
		expect(bad({ a: { species: 'otter', hp: getAnimal('otter').maxHp + 1 } })).toBeNull();
		expect(bad({ a: { species: 'otter', hp: -1 } })).toBeNull();
		expect(bad({ a: { species: 'otter', hp: 1.5 } })).toBeNull();
		expect(bad({ realm: 'air' })).toBeNull();
		expect(bad({ turn: 'c' })).toBeNull();
		expect(bad({ puzzle: '3 + 4 = ?' })).toBeNull();
		expect(bad({ puzzle: { kind: 'add', numbers: [3] } })).toBeNull();
		expect(bad({ puzzle: undefined })).toBeNull();
		expect(bad({ turn: null, puzzle: null })).toStrictEqual({ ...view, turn: null, puzzle: null });
		// Only the fields it knows.
		expect(Object.keys(readFightView({ ...view, words: 'hi' })!).sort()).toEqual(
			['a', 'b', 'puzzle', 'realm', 'turn'].sort()
		);
	});

	it('refuses an event with anything out of its bounds, and more events than one step makes', () => {
		const ok: FightEvent[] = [
			{ type: 'puzzle', side: 'a', puzzle: { kind: 'sqrt', numbers: [144] } },
			{ type: 'judged', side: 'a', correct: true },
			{ type: 'hit', attacker: 'a', level: 3, damage: 7, hp: 0 },
			{ type: 'missed', attacker: 'b' },
			{ type: 'leash', caught: false },
			{ type: 'switched', side: 'b', animal: { species: 'fox', hp: 4 } },
			{ type: 'fainted', side: 'a' },
			{ type: 'ended', winner: null, how: 'fled' }
		];
		expect(readFightEvents(read(ok))).toStrictEqual(ok);
		const maxHp = Math.max(...ANIMALS.map((a) => a.maxHp));
		for (const junk of [
			{ type: 'puzzle', side: 'a', puzzle: { kind: 'sqrt', numbers: [144] }, prompt: 'hi' },
			{ type: 'judged', side: 'a', correct: 'yes' },
			{ type: 'hit', attacker: 'a', level: 4, damage: 7, hp: 0 },
			{ type: 'hit', attacker: 'a', level: 1, damage: maxHp + 1, hp: 0 },
			{ type: 'hit', attacker: 'a', level: 1, damage: 1, hp: -1 },
			{ type: 'missed', attacker: 'c' },
			{ type: 'leash' },
			{ type: 'switched', side: 'b', animal: { species: 'dragon', hp: 4 } },
			{ type: 'fainted' },
			{ type: 'ended', winner: 'a', how: 'exploded' },
			{ type: 'ended', how: 'tired' },
			{ type: 'said', text: 'hello' },
			{ type: '__proto__' }
		]) {
			const events = readFightEvents([junk]);
			// The one with an extra field is read without it; every other is refused.
			if ('prompt' in junk) expect(events).toStrictEqual([ok[0]]);
			else expect(events, JSON.stringify(junk)).toBeNull();
		}
		expect(readFightEvents(Array.from({ length: MAX_FIGHT_EVENTS }, () => ok[3]))).toHaveLength(
			MAX_FIGHT_EVENTS
		);
		expect(readFightEvents(Array.from({ length: MAX_FIGHT_EVENTS + 1 }, () => ok[3]))).toBeNull();
		expect(readFightEvents({ length: 1, 0: ok[3] })).toBeNull();
	});
});
