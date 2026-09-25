import {
	ATTACK_LEVELS,
	getAnimal,
	tileAtWorld,
	type AnimalInstance,
	type AttackLevel,
	type Authority,
	type BattleEvent,
	type BattleIntent,
	type BattleSide,
	type BattleState,
	type GameEvent,
	type GridPos
} from '@mathgame/engine';
import { BattleScene } from '../render/battle-scene';
import type { GameRenderer } from '../render/renderer';
import { actionAt, actionCount, battle } from '../state/battle.svelte';

/**
 * Battle mode: owns the battle screen from `battle-started` until the player
 * leaves the result card. It turns keys into battle intents, and plays the
 * authority's events back one *beat* at a time — a line of narration, an HP
 * change, a lunge or a shake — with a hold after each, so a turn reads like a
 * Game Boy battle instead of resolving in one frame. Only when every beat has
 * played does the view show the authority's latest state (the menu, the
 * puzzle or the result card) and take input again.
 *
 * The authority answers every intent synchronously; the beats are purely
 * presentation and nothing here decides an outcome.
 */

/** One beat: change something and maybe say a line, then hold for `hold` seconds. */
interface Beat {
	run: () => string | undefined;
	hold: number;
}

/** A sign and six digits. Every answer in the game is shorter. */
const MAX_ANSWER_LENGTH = 7;

/**
 * Seconds the result card ignores keys after it appears, so an Enter mashed
 * through the last beats cannot dismiss it unread.
 */
const RESULT_GUARD_SECONDS = 0.8;

/**
 * Seconds the world stays on screen after `battle-started`, so the step into
 * the grass lands before the battle appears (a step takes 0.18 s).
 */
const ENTER_SECONDS = 0.3;

export class BattleController {
	/** Built on the first battle and reused for every one after it. */
	private scene: BattleScene | null = null;
	/** The authority's latest state; shown once the beats have played. */
	private latest: BattleState | null = null;
	private beats: Beat[] = [];
	private wait = 0;
	/** The authority's closing `message`, kept for the result card. */
	private closing = '';
	/** Seconds the result card has been up. */
	private resultAge = 0;
	/** Seconds left before the battle screen replaces the world. */
	private enterIn = 0;
	/** Where the player stands, to pick the battle's backdrop. */
	private playerId = '';
	private seed = 0;
	private pos: GridPos = { x: 0, y: 0 };
	private hits = 0;

	constructor(
		private authority: Authority,
		private renderer: GameRenderer
	) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.playerId = event.playerId;
				this.seed = event.seed;
				this.pos = event.pos;
				break;
			case 'player-moved':
			case 'player-placed':
				if (event.playerId === this.playerId) this.pos = event.pos;
				break;
			case 'battle-started':
				this.begin(event.state);
				break;
			case 'battle-updated':
				if (!battle.active) return; // no battle on screen: a stale or foreign event
				this.latest = event.state;
				battle.screen = 'busy';
				for (const e of event.events) this.beats.push(...this.narrate(e));
				break;
			case 'message':
				if (!battle.active || this.latest?.phase.kind !== 'ended') return;
				this.closing = event.text;
				if (battle.screen === 'result') battle.closing = event.text;
				break;
		}
	}

	/** Play beats as their holds expire; `dt` is seconds. */
	update(dt: number): void {
		if (!battle.active) return;
		if (battle.entering) {
			this.enterIn -= dt;
			if (this.enterIn > 0) return;
			battle.entering = false;
			this.renderer.setBattle(this.scene);
		}
		if (battle.screen === 'result') this.resultAge += dt;
		this.wait -= dt;
		while (this.wait <= 0 && this.beats.length > 0) {
			const beat = this.beats.shift()!;
			const line = beat.run();
			if (line !== undefined) battle.line = line;
			this.wait = beat.hold;
		}
		if (this.wait <= 0 && this.beats.length === 0 && battle.screen === 'busy') this.settle();
	}

	/** Keyboard input while the battle screen is up. */
	onKey(e: KeyboardEvent): void {
		if (!battle.active) return;
		// Leave browser shortcuts alone, and never act on auto-repeat: a key held
		// down when the battle began (a walking arrow) must not scroll the menu.
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		let handled: boolean;
		switch (battle.screen) {
			case 'busy':
				handled = true; // swallow mashing while events play
				break;
			case 'actions':
				handled = this.menuKey(e.key);
				break;
			case 'puzzle':
				handled = this.puzzleKey(e.key);
				break;
			case 'result':
				handled = e.key === 'Enter' || e.key === ' ';
				if (handled && this.resultAge >= RESULT_GUARD_SECONDS) this.leave();
				break;
		}
		if (handled) e.preventDefault();
	}

	// --- screens -------------------------------------------------------------

	private begin(state: BattleState): void {
		battle.reset();
		battle.active = true;
		battle.entering = true;
		this.enterIn = ENTER_SECONDS;
		battle.party = state.party.map((a) => ({ ...a }));
		battle.front = state.active;
		battle.opponent = { ...state.opponent };
		this.latest = state;
		this.closing = '';
		this.beats = [];
		this.wait = 0;

		const biome = tileAtWorld(this.seed, this.pos.x, this.pos.y).biome;
		this.scene ??= new BattleScene();
		this.scene.begin(biome, this.front().speciesId, state.opponent.speciesId);

		const wild = nameOf(state.opponent);
		const mine = nameOf(this.front());
		this.beats.push(
			{ run: () => `A wild ${wild} appears!`, hold: 1.4 },
			{ run: () => `Go, ${mine}!`, hold: 1.0 }
		);
	}

	/** Every beat has played: show the authority's latest state and take input. */
	private settle(): void {
		const state = this.latest;
		if (!state) return;
		battle.party = state.party.map((a) => ({ ...a }));
		battle.front = state.active;
		battle.opponent = { ...state.opponent };
		battle.hit = null;
		const front = this.front();
		switch (state.phase.kind) {
			case 'choose-action': {
				const rows = actionCount(getAnimal(front.speciesId).attacks.length);
				battle.cursor = Math.min(battle.cursor, rows - 1);
				battle.puzzle = null;
				battle.judged = null;
				battle.input = '';
				battle.line = `What will ${nameOf(front)} do?`;
				battle.screen = 'actions';
				break;
			}
			case 'solving':
				battle.puzzle = state.phase.puzzle;
				battle.input = '';
				battle.judged = null;
				battle.line = `${nameOf(front)} tries ${attackName(front, state.phase.attackIndex)}!`;
				battle.screen = 'puzzle';
				break;
			case 'ended':
				if (state.phase.outcome === 'won') this.scene?.hop('player');
				battle.outcome = state.phase.outcome;
				battle.closing = this.closing;
				battle.line = '';
				this.resultAge = 0;
				battle.screen = 'result';
				break;
		}
	}

	private leave(): void {
		this.renderer.setBattle(null);
		this.latest = null;
		this.beats = [];
		this.wait = 0;
		battle.reset();
	}

	private send(intent: BattleIntent): void {
		battle.screen = 'busy';
		this.authority.dispatch({ type: 'battle', intent });
	}

	// --- keys ----------------------------------------------------------------

	private menuKey(key: string): boolean {
		const attacks = getAnimal(this.front().speciesId).attacks;
		const rows = actionCount(attacks.length);
		switch (key) {
			case 'ArrowUp':
			case 'w':
				battle.cursor = (battle.cursor + rows - 1) % rows;
				return true;
			case 'ArrowDown':
			case 's':
				battle.cursor = (battle.cursor + 1) % rows;
				return true;
			case 'ArrowLeft':
			case 'a':
				battle.level = clampLevel(battle.level - 1);
				return true;
			case 'ArrowRight':
			case 'd':
				battle.level = clampLevel(battle.level + 1);
				return true;
			case '1':
			case '2':
			case '3': {
				// A level key on an attack row picks that level and attacks at once.
				const action = actionAt(battle.cursor, attacks.length);
				if (action.kind !== 'attack') return true;
				battle.level = clampLevel(Number(key));
				this.send({ type: 'attack', attackIndex: action.index, level: battle.level });
				return true;
			}
			case 'Enter':
			case ' ': {
				const action = actionAt(battle.cursor, attacks.length);
				if (action.kind === 'attack') {
					this.send({ type: 'attack', attackIndex: action.index, level: battle.level });
				} else if (action.kind === 'leash') {
					this.send({ type: 'throw-leash' });
				} else {
					this.send({ type: 'flee' });
				}
				return true;
			}
		}
		return false;
	}

	private puzzleKey(key: string): boolean {
		if (/^[0-9]$/.test(key)) {
			if (battle.input.length < MAX_ANSWER_LENGTH) battle.input += key;
			return true;
		}
		if (key === '-') {
			if (battle.input === '') battle.input = '-';
			return true;
		}
		if (key === 'Backspace') {
			battle.input = battle.input.slice(0, -1);
			return true;
		}
		if (key === 'Enter') {
			// An empty field is not an answer: a kid who mashes Enter after
			// picking an attack must not lose the turn to it.
			if (/\d/.test(battle.input)) this.send({ type: 'answer', input: battle.input });
			return true;
		}
		return false;
	}

	// --- narration -----------------------------------------------------------

	/**
	 * Turn one battle event into beats. Names are resolved when the beat runs,
	 * against the view as it stands then, so a switch earlier in the same
	 * turn is reflected.
	 */
	private narrate(e: BattleEvent): Beat[] {
		const scene = this.scene!;
		switch (e.type) {
			case 'puzzle-shown':
				return []; // `settle` shows the puzzle once the beats have played
			case 'answer-judged':
				return [
					{
						run: () => {
							battle.judged = { correct: e.correct, answer: e.answer };
							return e.correct ? 'Correct!' : `Not quite! It was ${e.answer}.`;
						},
						hold: e.correct ? 1.0 : 1.8
					}
				];
			case 'hit': {
				const target: BattleSide = e.attacker === 'player' ? 'opponent' : 'player';
				let said = '';
				return [
					{
						run: () => {
							scene.lunge(e.attacker);
							const who = this.animalOn(e.attacker);
							const prefix = e.attacker === 'opponent' ? 'Wild ' : '';
							said = `${prefix}${nameOf(who)} used ${attackName(who, e.attackIndex)}!`;
							return said;
						},
						hold: 0.35
					},
					{
						run: () => {
							scene.shake(target);
							if (target === 'opponent') {
								battle.opponent = { ...battle.opponent!, hp: e.targetHp };
							} else {
								battle.party = battle.party.map((a, i) =>
									i === battle.front ? { ...a, hp: e.targetHp } : a
								);
							}
							battle.hit = { side: target, damage: e.damage, n: ++this.hits };
							return `${said} ${e.damage} damage.`;
						},
						hold: 1.2
					}
				];
			}
			case 'missed':
				return [
					{
						run: () => {
							scene.lunge(e.attacker);
							scene.puff(e.attacker === 'player' ? 'opponent' : 'player');
							return `${attackName(this.animalOn(e.attacker), e.attackIndex)} missed!`;
						},
						hold: 1.0
					}
				];
			case 'fainted':
				return [
					{
						run: () => {
							scene.faint(e.side);
							return e.side === 'opponent'
								? `Wild ${nameOf(e.animal)} is tired!`
								: `${nameOf(e.animal)} is tired.`;
						},
						hold: 1.2
					}
				];
			case 'switched':
				return [
					{
						run: () => {
							battle.front = e.partyIndex;
							scene.setFigure('player', e.animal.speciesId);
							return `Go, ${nameOf(e.animal)}!`;
						},
						hold: 1.0
					}
				];
			case 'leash-thrown':
				return [
					{
						run: () => {
							scene.throwLeash();
							return 'You throw the leash…';
						},
						hold: 1.8
					},
					{
						run: () => {
							scene.leashResult(e.success);
							return e.success ? 'Caught!' : 'It broke free!';
						},
						hold: 1.2
					}
				];
			case 'fled':
				return [{ run: () => 'You got away!', hold: 0.8 }];
			case 'ended':
				return []; // `settle` shows the result card
			case 'rejected':
				console.warn(`battle intent rejected: ${e.reason}`);
				return [];
		}
	}

	private front(): AnimalInstance {
		return battle.party[battle.front] ?? battle.party[0]!;
	}

	private animalOn(side: BattleSide): AnimalInstance {
		return side === 'player' ? this.front() : battle.opponent!;
	}
}

function nameOf(animal: AnimalInstance): string {
	return animal.nickname ?? getAnimal(animal.speciesId).name;
}

function attackName(animal: AnimalInstance, attackIndex: number): string {
	return getAnimal(animal.speciesId).attacks[attackIndex - 1]?.name ?? 'its attack';
}

function clampLevel(level: number): AttackLevel {
	const lo = ATTACK_LEVELS[0];
	const hi = ATTACK_LEVELS[ATTACK_LEVELS.length - 1]!;
	return Math.max(lo, Math.min(hi, level)) as AttackLevel;
}
