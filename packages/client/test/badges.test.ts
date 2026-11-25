import {
	BADGE_FAMILIES,
	BADGE_IDS,
	answerText,
	getAnimal,
	newGame,
	readSave,
	restoreGame,
	saveDocument,
	startBattle,
	type AnimalInstance,
	type BattleState,
	type GameEvent,
	type SavedGame
} from '@mathgame/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAuthority, type LocalAuthorityOptions } from '../src/authority/local';
import { DayTeller, localDay } from '../src/badges/day';
import { BADGE_PICTURES } from '../src/badges/pictures';
import { COPY, LANGUAGES } from '../src/copy/languages';
import { flatten } from '../src/copy/translate';
import { besideA, gameBeside } from './clearing';
import { mint, testStarter } from './minted';
import { rulesOf } from './rules-of.js';

/**
 * The badges in the authority ([[PRODUCT]] §4 "Badges"): what it counts for
 * them, the firsts it sees happen, when it tells (`badges-changed`), and a
 * game picked up given what it holds quietly. Which badge a number earns is
 * the engine's (`badges.test.ts` there).
 */
type Session = {
	authority: LocalAuthority;
	events: GameEvent[];
	told: Extract<GameEvent, { type: 'badges-changed' }>[];
};

function session(game?: SavedGame, options: LocalAuthorityOptions = {}): Session {
	const authority = new LocalAuthority({ today: '2026-11-25', ...options });
	const events: GameEvent[] = [];
	const told: GameEvent[] = [];
	authority.subscribe(rulesOf(events, told));
	authority.start(game ? { game } : {});
	return { authority, events, told: told as Session['told'] };
}

const saved = (game: Partial<SavedGame> = {}): SavedGame => ({
	...newGame(1, testStarter()),
	...game
});

/** Every badge celebrated so far, in order. */
const celebrated = (s: Session): string[] => s.told.flatMap((e) => e.fresh);

function welcome(s: Session): Extract<GameEvent, { type: 'welcome' }> {
	const w = s.events.find((e) => e.type === 'welcome');
	if (w?.type !== 'welcome') throw new Error('no welcome');
	return w;
}

function latestBattle(s: Session): BattleState {
	for (let i = s.events.length - 1; i >= 0; i--) {
		const e = s.events[i]!;
		if (e.type === 'battle-updated' || e.type === 'battle-started') return e.state;
	}
	throw new Error('no battle yet');
}

/** Left and right on the reed beside the spawn until a battle starts. */
function walkIntoBattle(s: Session): BattleState {
	for (let i = 0; i < 400; i++) {
		const from = s.events.length;
		s.authority.dispatch({ type: 'move', dir: i % 2 === 0 ? 'left' : 'right' });
		if (s.events.slice(from).some((e) => e.type === 'battle-started')) return latestBattle(s);
	}
	throw new Error('no encounter in 400 steps');
}

/** The strongest attack at level 3, answered right, until the battle ends. */
function win(s: Session): void {
	for (let turn = 0; turn < 80 && latestBattle(s).phase.kind !== 'ended'; turn++) {
		const state = latestBattle(s);
		if (state.phase.kind === 'choose-animal') {
			const partyIndex = state.party.findIndex((a) => a.hp > 0);
			s.authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex } });
			continue;
		}
		const attackIndex = getAnimal(state.party[state.active]!.speciesId).attacks.length;
		s.authority.dispatch({ type: 'battle', intent: { type: 'attack', attackIndex, level: 3 } });
		const phase = latestBattle(s).phase;
		if (phase.kind !== 'solving') throw new Error(`expected a puzzle, got ${phase.kind}`);
		s.authority.dispatch({
			type: 'battle',
			intent: { type: 'answer', input: answerText(phase.puzzle) }
		});
	}
}

const strong = (speciesId: string): AnimalInstance => ({
	id: speciesId,
	speciesId,
	hp: getAnimal(speciesId).maxHp
});

describe('badges: telling', () => {
	it('celebrates the first animal of a new game, after its welcome', () => {
		const s = session();
		expect(welcome(s).badges).toEqual([]);
		expect(welcome(s).found).toBe(0);
		expect(celebrated(s)).toEqual(expect.arrayContaining(['firsts.imprinting']));
		expect(s.authority.snapshot().badges).toEqual(celebrated(s));
	});

	it('gives a game picked up what it holds, quietly, and says how many', () => {
		const game = saved({ solved: 120, steps: 600, visits: 6 });
		const s = session(game);
		const w = welcome(s);
		expect(w.badges).toEqual(
			expect.arrayContaining(['solved.atom', 'visits.skin', 'firsts.imprinting'])
		);
		expect(w.found).toBe(w.badges.length);
		expect(w.counts.solved).toBe(120);
		expect(s.told).toEqual([]);
		// Picked up again with them saved: nothing found.
		const doc = saveDocument(s.authority.snapshot(), { lineage: 'L', seq: 1 });
		const read = readSave(JSON.parse(JSON.stringify(doc)));
		if (!read.ok) throw new Error(read.error);
		const again = session(restoreGame(read.save, mint));
		expect(welcome(again).badges).toEqual(w.badges);
		expect(welcome(again).found).toBe(0);
	});

	it('celebrates a badge once, and never takes one back', () => {
		const s = session(saved({ badges: [...BADGE_IDS] }));
		walkIntoBattle(s);
		win(s);
		expect(celebrated(s)).toEqual([]);
		expect(s.authority.snapshot().badges).toEqual([...BADGE_IDS]);
	});

	it('tells nothing for steps alone, and the steps walked with the next telling', () => {
		const s = session(saved({ badges: [...BADGE_IDS] }));
		s.authority.dispatch({ type: 'move', dir: 'right' });
		s.authority.dispatch({ type: 'move', dir: 'left' });
		expect(s.told).toEqual([]);
		s.authority.dispatch({ type: 'met-player' });
		expect(s.told).toEqual([]);
		walkIntoBattle(s);
		win(s);
		expect(s.told.at(-1)!.counts.steps).toBe(s.authority.stepsTaken);
		expect(s.told.at(-1)!.counts.battles).toBe(1);
	});
});

describe('badges: what the authority counts', () => {
	it('counts a battle won, which is no catch', () => {
		const s = session(saved({ party: [strong('bear')] }));
		walkIntoBattle(s);
		win(s);
		expect(s.authority.snapshot().tally.wins).toBe(1);
		expect(celebrated(s)).toContain('battles.reflex');
		expect(celebrated(s)).not.toContain('catches.leg-ring');
	});

	it('counts a tree chopped down, and nothing for a bump without the axe', () => {
		const tree = besideA('tree');
		const without = session(gameBeside(tree, []));
		without.authority.dispatch({ type: 'interact' });
		expect(without.authority.snapshot().tally.cleared).toBe(0);
		const s = session(gameBeside(tree, ['axe']));
		s.authority.dispatch({ type: 'interact' });
		expect(s.events.at(-1)?.type).toBe('tile-cleared');
		expect(s.authority.snapshot().tally.cleared).toBe(1);
		expect(celebrated(s)).toContain('clearing.woodpecker');
	});

	it('counts a day once however many puzzles are solved on it, and another day the host tells as another', () => {
		const s = session(saved({ party: [strong('bear')] }));
		walkIntoBattle(s);
		win(s);
		expect(s.authority.snapshot().tally).toMatchObject({ days: 1, lastDay: '2026-11-25' });
		const before = s.events.length + s.told.length;
		s.authority.dispatch({ type: 'day', day: '2026-11-27' });
		// A day alone is told nothing: nothing a kid sees changed.
		expect(s.events.length + s.told.length).toBe(before);
		walkIntoBattle(s);
		win(s);
		expect(s.authority.snapshot().tally).toMatchObject({ days: 2, lastDay: '2026-11-27' });
		expect(celebrated(s)).toContain('days.mayfly');
	});

	it('counts no day before the host has told one, and takes no day that is not a date', () => {
		const s = session(saved({ party: [strong('bear')] }), { today: undefined });
		s.authority.dispatch({ type: 'day', day: 'tomorrow' });
		walkIntoBattle(s);
		win(s);
		expect(s.authority.snapshot().tally.days).toBe(0);
		s.authority.dispatch({ type: 'day', day: '2026-11-26' });
		walkIntoBattle(s);
		win(s);
		expect(s.authority.snapshot().tally).toMatchObject({ days: 1, lastDay: '2026-11-26' });
	});

	it('takes the day before a game starts, as the page tells it at load', () => {
		const authority = new LocalAuthority();
		authority.dispatch({ type: 'day', day: '2026-11-26' });
		const told: GameEvent[] = [];
		const events: GameEvent[] = [];
		authority.subscribe(rulesOf(events, told));
		authority.start({ game: saved({ party: [strong('bear')] }) });
		const s = { authority, events, told: told as Session['told'] };
		walkIntoBattle(s);
		win(s);
		expect(authority.snapshot().tally).toMatchObject({ days: 1, lastDay: '2026-11-26' });
	});

	describe('whatever the clock says', () => {
		afterEach(() => {
			vi.useRealTimers();
		});
		it('the same intents count the same days: the authority reads no clock', () => {
			const play = (clock: Date) => {
				vi.useFakeTimers({ toFake: ['Date'] });
				vi.setSystemTime(clock);
				const s = session(saved({ party: [strong('bear')] }), { today: undefined });
				s.authority.dispatch({ type: 'day', day: '2026-11-25' });
				walkIntoBattle(s);
				win(s);
				vi.setSystemTime(new Date(clock.getTime() + 3 * 86_400_000));
				walkIntoBattle(s);
				win(s);
				vi.useRealTimers();
				return s.authority.snapshot().tally;
			};
			const a = play(new Date(2031, 5, 1, 12));
			const b = play(new Date(2026, 0, 9, 23, 59));
			expect(a).toEqual(b);
			expect(a).toMatchObject({ days: 1, lastDay: '2026-11-25' });
		});
	});

	it("names today on the browser's calendar", () => {
		expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
		expect(localDay(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
	});

	it('the page tells the day at once, and again only once the date has turned', () => {
		let now = '2026-11-25';
		const told: unknown[] = [];
		const teller = new DayTeller(
			(intent) => told.push(intent),
			() => now
		);
		expect(told).toEqual([{ type: 'day', day: '2026-11-25' }]);
		for (let i = 0; i < 300; i++) teller.tick(1 / 60);
		expect(told).toHaveLength(1);
		now = '2026-11-26';
		teller.tick(0.5);
		teller.tick(0.6);
		expect(told).toEqual([
			{ type: 'day', day: '2026-11-25' },
			{ type: 'day', day: '2026-11-26' }
		]);
	});
});

describe('badges: the firsts the authority sees', () => {
	it('meeting another player, in any mode, once', () => {
		const s = session(saved({ party: [strong('bear')] }));
		walkIntoBattle(s);
		const before = latestBattle(s);
		s.authority.dispatch({ type: 'met-player' });
		s.authority.dispatch({ type: 'met-player' });
		expect(celebrated(s).filter((id) => id === 'firsts.social-animal')).toHaveLength(1);
		expect(latestBattle(s)).toBe(before);
	});

	it('taking off with the glider', () => {
		const s = session(saved({ facing: 'up', items: ['glider'] }));
		s.authority.dispatch({ type: 'take-off' });
		expect(s.events.some((e) => e.type === 'took-off')).toBe(true);
		expect(celebrated(s)).toContain('firsts.thermal');
	});

	it('going back to the home world from another, never the trip away', () => {
		const s = session(saved());
		s.authority.dispatch({ type: 'travel', world: 42 });
		expect(celebrated(s)).not.toContain('firsts.homing-instinct');
		expect(celebrated(s)).toContain('worlds.leaving-the-nest');
		s.authority.dispatch({ type: 'travel', world: 1 });
		expect(celebrated(s)).toContain('firsts.homing-instinct');
	});

	it('a step on land on the back of a lead big enough, with the harness', () => {
		const carrier = 'bear';
		expect(getAnimal(carrier).carries).toBe(true);
		const walk = (items: string[]) => {
			const s = session(saved({ party: [strong(carrier)], items }));
			s.authority.dispatch({ type: 'move', dir: 'right' });
			return celebrated(s);
		};
		expect(walk(['harness'])).toContain('firsts.symbiosis');
		expect(walk([])).not.toContain('firsts.symbiosis');
	});

	it('a catch two sizes bigger than the animal that threw, counted as a catch', () => {
		const squirrel = testStarter();
		const bear: AnimalInstance = { id: 'wild', speciesId: 'bear', hp: 1 };
		expect(
			getAnimal(bear.speciesId).tier - getAnimal(squirrel.speciesId).tier
		).toBeGreaterThanOrEqual(2);
		// Squirrels enough to throw until it holds: each steps in when the one before is tired.
		const squirrels = Array.from({ length: 12 }, (_, i) => ({ ...squirrel, id: `s${i}` }));
		const s = session(
			saved({ party: squirrels, battle: startBattle(squirrels, bear, { realm: 'land' }) })
		);
		for (let i = 0; i < 80 && latestBattle(s).phase.kind !== 'ended'; i++) {
			const state = latestBattle(s);
			if (state.phase.kind === 'choose-animal') {
				const partyIndex = state.party.findIndex((a) => a.hp > 0);
				s.authority.dispatch({ type: 'battle', intent: { type: 'switch', partyIndex } });
			} else s.authority.dispatch({ type: 'battle', intent: { type: 'throw-leash' } });
		}
		const ended = latestBattle(s).phase;
		expect(ended.kind === 'ended' && ended.outcome).toBe('caught');
		expect(s.authority.snapshot().tally.catches).toBe(1);
		expect(celebrated(s)).toEqual(
			expect.arrayContaining(['firsts.ant-strength', 'catches.leg-ring'])
		);
	});
});

describe('badges: words and pictures', () => {
	it('names every family and every badge, with its line and goal, in every language', () => {
		const missing: string[] = [];
		for (const lang of LANGUAGES) {
			const copy = flatten(COPY[lang]);
			const need = (key: string) => {
				if (!copy.has(key)) missing.push(`${lang}: ${key}`);
			};
			for (const f of BADGE_FAMILIES) {
				const family = `badges.families.${f.id}`;
				need(`${family}.title`);
				need(`${family}.about`);
				if (f.kind === 'ladder') need(`${family}.goal`);
				for (const b of f.badges) {
					const badge = `${family}.badges.${b.id.slice(f.id.length + 1)}`;
					need(`${badge}.name`);
					need(`${badge}.line`);
					if (f.kind !== 'ladder') need(`${badge}.goal`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('gives every badge a picture, and none to a badge there is not', () => {
		expect(Object.keys(BADGE_PICTURES).sort()).toEqual([...BADGE_IDS].sort());
	});

	it('draws every picture with an emoji Safari 15 has: nothing newer than Emoji 13.1', () => {
		// In the block of new pictographs, the code points of Emoji 13.1 and before; past the
		// block, the few that Emoji 14 and 15 added elsewhere. A joined emoji (ZWJ) is newer too.
		const old = [
			[0x1fa70, 0x1fa74],
			[0x1fa78, 0x1fa7a],
			[0x1fa80, 0x1fa86],
			[0x1fa90, 0x1faa8],
			[0x1fab0, 0x1fab6],
			[0x1fac0, 0x1fac2],
			[0x1fad0, 0x1fad6]
		];
		const newer = new Set([0x1f6dc, 0x1f6dd, 0x1f6de, 0x1f6df, 0x1f7f0, 0x1f979, 0x200d]);
		const tooNew = Object.entries(BADGE_PICTURES).filter(([, emoji]) =>
			[...emoji].some((ch) => {
				const cp = ch.codePointAt(0)!;
				if (newer.has(cp)) return true;
				if (cp < 0x1fa70 || cp > 0x1faff) return false;
				return !old.some(([lo, hi]) => cp >= lo! && cp <= hi!);
			})
		);
		expect(tooNew).toEqual([]);
		// The check sees one it must: a bubble (🫧, Emoji 14).
		expect([...'🫧'].some((ch) => ch.codePointAt(0)! >= 0x1fae0)).toBe(true);
	});
});
