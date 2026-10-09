import {
	answerForm,
	bundles,
	buyRefusal,
	canGoHome,
	FIRST_LAND,
	kindGoingHome,
	needsHealing,
	unlockProgress,
	type AnimalInstance,
	type Authority,
	type DoctorEvent,
	type DoctorIntent,
	type DoctorState,
	type GameEvent
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { answerKey } from '../input/answer';
import { isShortcut, keyName } from '../input/keyboard';
import { isMashKey, PickGuard } from '../input/pick-guard';
import { tappedOption, tappedRow, tappedTab } from '../input/press';
import { game } from '../state/game.svelte';
import {
	doctor,
	doctorTabs,
	rowStops,
	stepCursor,
	tabRows,
	type DoctorRow,
	type DoctorTab
} from '../state/doctor.svelte';
import type { DoctorLine } from './lines';

/**
 * The doctor's card: from `doctor-visit-started` to `doctor-visit-ended`, a
 * dialogue over explore mode (no mode switch; the world keeps drawing). It
 * turns keys into doctor intents and plays the authority's doctor events back
 * a beat at a time — the judgement of an answer, then the heal, the animals
 * going home, the tokens changing hands — before it shows the latest state
 * and takes keys again, the way the battle screen does. What the doctor says
 * is chosen by event, as a `DoctorLine` the card words when it shows it, and
 * each sound plays with the beat that shows its moment (the chime with
 * "Correct!", the sparkle with the heal, the coins with the tokens). Nothing
 * here decides anything: the engine judges answers, heals, pays and sells.
 *
 * Three tabs ([[UI_SPEC]] § Doctor): heal, set free and shop, left and right
 * between them. The home tab's marks and its confirm are the card's own: the
 * authority hears of a hand-over only once the kid says yes, and even then
 * nothing leaves until the kid works out the tokens they will have.
 */

/** One beat: change the view, then hold for `hold` seconds. */
interface Beat {
	run: () => void;
	hold: number;
}

/** "Not quite!" stays up this long before the next puzzle, or the same sum, is asked again. */
const MISS_HOLD = 1.2;
/** "Correct!" stays up this long before what it earned. */
const CORRECT_HOLD = 0.8;
/** The heal (HP bars filling, "+N", the doctor's cheer) plays this long before the list takes keys. */
const HEAL_HOLD = 1.2;
/** The animals going home wave goodbye this long before the tokens come. */
const HOME_HOLD = 1.6;
/** Tokens coming in or going out, with what the doctor says about it. */
const TOKENS_HOLD = 1.6;

export class DoctorController {
	/** The visit on screen, as its events number it; null while the card is closed. */
	private visit: number | null = null;
	/** The authority's latest state; shown once the beats have played. */
	private latest: DoctorState | null = null;
	private beats: Beat[] = [];
	private wait = 0;
	/**
	 * The list and the confirm take a pick only after a quiet moment: when the
	 * card opens, each time the list comes back after a beat, and when the
	 * confirm comes up (`input/pick-guard.ts`). An Enter mashed at the tent,
	 * through a heal or through a goodbye picks nothing, and says no bye.
	 */
	private guard = new PickGuard();
	/** What the doctor says about the latest state; shown with its beat, or at `settle`. */
	private said: DoctorLine | null = null;
	/** Counts the pops and shakes, so each one starts its animation again. */
	private pops = 0;

	/**
	 * `devFly`: the `?lands` switch's quick way to fly: L on the card's list
	 * asks to fly to the next land this visit flies to, in a game saved
	 * nowhere.
	 */
	constructor(
		private authority: Authority,
		private options: { devFly?: boolean } = {}
	) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'doctor-visit-started':
				this.open(event.visit, event.state);
				break;
			case 'doctor-visit-updated': {
				// Only the visit on screen (a late event of an earlier visit carries
				// another number), and never an older state of it than the one shown.
				const latest = this.latest;
				if (event.visit !== this.visit || !latest || event.state.step < latest.step) return;
				this.latest = event.state;
				doctor.screen = 'busy';
				this.beats.push(...this.narrate(event.events, latest, event.state));
				// Nothing to play (a pick, a swap, a rejection): show it now, so a key
				// typed straight after an arrow lands in the new puzzle, not in a gap.
				if (this.beats.length === 0 && this.wait <= 0) this.settle();
				break;
			}
			case 'doctor-visit-ended':
				if (event.visit === this.visit) this.close();
				break;
			case 'unlocked-changed':
				// A hand-over that opened a land: its Fly row opens at once, in this visit.
				if (doctor.active) doctor.unlocked = [...event.unlocked];
				break;
		}
	}

	/** Play beats as their holds expire; `dt` is seconds. */
	update(dt: number): void {
		if (!doctor.active) return;
		this.guard.tick(dt);
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
		if (isShortcut(e)) return;
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		const key = keyName(e);
		// Escape goes back a step: from a puzzle or the confirm to the list, and
		// from the list, or while a beat plays, it says bye.
		if (key === 'Escape') {
			e.preventDefault();
			this.escape();
			return;
		}
		// Whether a pick may go now. A key a kid mashes starts the quiet moment
		// again on every screen, a beat and a puzzle included.
		const fresh = isMashKey(key) ? this.guard.press() : this.guard.ready;
		let handled = false;
		switch (doctor.screen) {
			case 'busy':
				return; // a beat is playing
			case 'list':
				handled = this.listKey(key, fresh);
				break;
			case 'confirm':
			case 'offer':
				handled = this.confirmKey(key, fresh);
				break;
			case 'puzzle':
				handled = this.puzzleKey(key);
				break;
		}
		if (handled) e.preventDefault();
	}

	// --- screens -------------------------------------------------------------

	private open(visit: number, state: DoctorState): void {
		doctor.reset();
		doctor.active = true;
		this.visit = visit;
		this.latest = state;
		this.beats = [];
		this.wait = 0;
		doctor.tab = 'heal';
		this.said = this.tabLine('heal', state);
		doctor.party = state.party.map((a) => ({ ...a }));
		doctor.shop = [...state.shop];
		doctor.land = state.land;
		doctor.lands = state.open.filter((land) => land !== state.land);
		doctor.unlocked = [...state.unlocked];
		// A kid with no animal here yet (a first arrival, waiting for a starter) has nobody to
		// heal or set free: the card opens where they can fly back.
		if (state.party.length === 0 && doctor.lands.length > 0) {
			doctor.tab = 'fly';
			this.said = this.tabLine('fly', state);
		}
		// A land caught open and never visited: the witch doctor's surprise comes first.
		if (state.phase.kind === 'offering') {
			this.said = { say: 'surprise', from: state.phase.from };
			doctor.confirm = 1;
		}
		doctor.cursor = this.firstStop(doctor.tab);
		sfx.play('confirm');
		this.settle();
	}

	/** Every beat has played: show the authority's latest state and take keys. */
	private settle(): void {
		const state = this.latest;
		if (!state) return;
		doctor.party = state.party.map((a) => ({ ...a }));
		doctor.tokens = state.tokens;
		doctor.items = [...state.items];
		doctor.shop = [...state.shop];
		// Unlocked lands only grow: one opened by a hand-over (`unlocked-changed`) comes after its state.
		doctor.unlocked = [...new Set([...doctor.unlocked, ...state.unlocked])];
		doctor.fare = null;
		doctor.offer = null;
		doctor.line = this.said;
		doctor.input = '';
		doctor.judged = null;
		doctor.healed = null;
		doctor.leaving = null;
		doctor.tokenPop = null;
		doctor.bought = null;
		// A mark for an animal that is no longer here goes with it.
		doctor.marked = doctor.marked.filter((id) => state.party.some((a) => a.id === id));
		const phase = state.phase;
		switch (phase.kind) {
			case 'choose-patient':
				doctor.puzzle = null;
				doctor.patient = null;
				doctor.trade = null;
				this.fixCursor();
				// The card opening, or the list back after a beat: a new choice.
				if (doctor.screen !== 'list') this.guard.show();
				doctor.screen = 'list';
				break;
			case 'solving':
				doctor.tab = 'heal';
				doctor.puzzle = phase.puzzle;
				doctor.patient = phase.partyIndex;
				doctor.trade = null;
				doctor.cursor = this.rowOf(phase.partyIndex);
				doctor.screen = 'puzzle';
				break;
			case 'handing-over':
				doctor.tab = 'home';
				doctor.puzzle = phase.puzzle;
				doctor.patient = null;
				doctor.trade = { kind: 'home', ids: [...phase.ids], reward: phase.reward };
				doctor.balance = state.tokens;
				doctor.screen = 'puzzle';
				break;
			case 'buying':
				doctor.tab = 'shop';
				doctor.puzzle = phase.puzzle;
				doctor.patient = null;
				doctor.trade = { kind: 'buy', itemId: phase.itemId, price: phase.price };
				doctor.balance = state.tokens;
				doctor.cursor = this.rows().findIndex(
					(r) => r.kind === 'item' && r.itemId === phase.itemId
				);
				doctor.screen = 'puzzle';
				break;
			case 'paying-fare':
				// The fare for a flight: a puzzle of the land's own kinds (#191), its land's row lit.
				doctor.tab = 'fly';
				doctor.puzzle = phase.puzzle;
				doctor.patient = null;
				doctor.trade = null;
				doctor.fare = phase.land;
				doctor.cursor = this.rows().findIndex((r) => r.kind === 'land' && r.land === phase.land);
				doctor.screen = 'puzzle';
				break;
			case 'offering':
				doctor.offer = phase.land;
				// The card opening on the question: a new choice.
				if (doctor.screen !== 'offer') this.guard.show();
				doctor.screen = 'offer';
				break;
			case 'ended':
				// `doctor-visit-ended` follows at once and closes the card.
				break;
		}
	}

	private close(): void {
		doctor.reset();
		this.visit = null;
		this.latest = null;
		this.beats = [];
		this.wait = 0;
		this.said = null;
	}

	private send(intent: DoctorIntent): void {
		doctor.screen = 'busy';
		this.authority.dispatch({ type: 'doctor', intent });
	}

	/** Escape: back a step, or bye. */
	private escape(): void {
		switch (doctor.screen) {
			case 'confirm':
				sfx.play('move');
				this.backToList();
				break;
			case 'puzzle':
			case 'offer':
				// Not now, for the trip: the list, and the Fly tab is still the way there.
				this.send({ type: 'back' });
				break;
			default:
				this.send({ type: 'leave' });
		}
	}

	/** From the confirm back to the list, the marks as they were: a new choice. */
	private backToList(): void {
		doctor.screen = 'list';
		this.said = this.tabLine(doctor.tab);
		doctor.line = this.said;
		this.guard.show();
	}

	private switchTab(tab: DoctorTab): void {
		if (tab === doctor.tab) return;
		doctor.tab = tab;
		doctor.cursor = this.firstStop(tab);
		this.said = this.tabLine(tab);
		doctor.line = this.said;
		sfx.play('move');
	}

	// --- keys ----------------------------------------------------------------

	private listKey(key: string, fresh: boolean): boolean {
		const tab = tappedTab(key);
		if (tab !== undefined) {
			if (doctorTabs(doctor.lands).includes(tab)) this.switchTab(tab);
			return true;
		}
		const rows = this.rows();
		const stops = rowStops(rows, doctor);
		// A tap on a row picks it at once, as the arrows and Enter would: at the
		// doctor nothing is spent by a pick. A fit animal on the heal tab can't
		// be picked, so its row does nothing. A tap is a pick like Enter, and
		// waits for the same quiet moment.
		const row = tappedRow(key);
		if (row !== undefined) {
			if (!stops.includes(row) || !(fresh || this.marks(rows[row]))) return true;
			doctor.cursor = row;
			this.pick(rows[row]);
			return true;
		}
		switch (key) {
			case 'ArrowUp':
			case 'w':
			case 'ArrowDown':
			case 's': {
				const up = key === 'ArrowUp' || key === 'w';
				const cursor = stepCursor(stops, doctor.cursor, up ? -1 : 1);
				if (cursor !== doctor.cursor) sfx.play('move');
				doctor.cursor = cursor;
				return true;
			}
			case 'ArrowLeft':
			case 'a':
			case 'ArrowRight':
			case 'd': {
				const delta = key === 'ArrowLeft' || key === 'a' ? -1 : 1;
				const tabs = doctorTabs(doctor.lands);
				const at = tabs.indexOf(doctor.tab);
				this.switchTab(tabs[(at + delta + tabs.length) % tabs.length]!);
				return true;
			}
			case 'Enter':
			case ' ':
				if (fresh || this.marks(rows[doctor.cursor])) this.pick(rows[doctor.cursor]);
				return true;
			case 'l': {
				const state = this.latest;
				if (!this.options.devFly || !state) return false;
				const others = state.open.filter((land) => land !== state.land);
				if (others.length > 0) this.send({ type: 'fly', land: others[0]! });
				return true;
			}
		}
		return false;
	}

	/**
	 * A pick that only picks or unpicks one animal to go home: it can always
	 * be taken back, so it goes at once, as the pause menu's rows do.
	 * Everything else on the list waits the quiet moment, a whole kind's row
	 * too, so an Enter mashed through a goodbye never picks a stack; and the
	 * confirm and the sum stand between a pick and a goodbye.
	 */
	private marks(row: DoctorRow | undefined): boolean {
		return doctor.tab === 'home' && row?.kind === 'animal';
	}

	/** Enter on a row of the list. */
	private pick(row: DoctorRow | undefined): void {
		switch (row?.kind) {
			case 'bye':
				sfx.play('confirm');
				this.send({ type: 'leave' });
				return;
			case 'animal': {
				const animal = doctor.party[row.partyIndex];
				if (!animal) return;
				if (doctor.tab === 'home') {
					this.toggleMark(animal);
				} else if (needsHealing(animal)) {
					sfx.play('confirm');
					this.send({ type: 'pick-patient', partyIndex: row.partyIndex });
				}
				return;
			}
			case 'bundle':
				this.toggleKind(row.speciesId);
				return;
			case 'send':
				if (doctor.marked.length === 0) return;
				sfx.play('confirm');
				doctor.confirm = 0;
				doctor.screen = 'confirm';
				this.said = { say: 'homeSure' };
				doctor.line = this.said;
				this.guard.show();
				return;
			case 'land': {
				// A land still locked gives a little shake, and the witch doctor says how to open it:
				// one of each animal of the land before it caught, and how many are so far.
				const progress = unlockProgress(row.land, game.caught);
				if (row.land !== FIRST_LAND && !doctor.unlocked.includes(row.land) && progress) {
					this.shakeRow(doctor.cursor);
					sfx.play('wrong');
					this.said = { say: 'flyLocked', land: row.land, ...progress };
					doctor.line = this.said;
					return;
				}
				sfx.play('confirm');
				this.send({ type: 'fly', land: row.land });
				return;
			}
			case 'item':
				// An item a kid owns, or can't pay for yet, gives a little shake: the card says why.
				if (buyRefusal(doctor, row.itemId) !== null) {
					this.shakeRow(doctor.cursor);
					return;
				}
				sfx.play('confirm');
				this.send({ type: 'buy', itemId: row.itemId });
				return;
		}
	}

	/** Pick or unpick an animal to go home. The last one standing always stays. */
	private toggleMark(animal: AnimalInstance): void {
		if (doctor.marked.includes(animal.id)) {
			doctor.marked = doctor.marked.filter((id) => id !== animal.id);
			sfx.play('move');
			return;
		}
		if (!canGoHome(doctor.party, [...doctor.marked, animal.id])) {
			this.shakeRow(doctor.cursor);
			return;
		}
		doctor.marked = [...doctor.marked, animal.id];
		sfx.play('confirm');
	}

	/**
	 * A bundle's row: pick every one of the kind that may go (the engine's
	 * `kindGoingHome`: all of them, or all but the first that could walk on
	 * with the kid when no other would), or, once they all are, take the whole
	 * kind back. A kind none of whom may go gives the row a little shake.
	 */
	private toggleKind(speciesId: string): void {
		const joining = kindGoingHome(doctor.party, doctor.marked, speciesId);
		if (joining.length > 0) {
			doctor.marked = [...doctor.marked, ...joining];
			sfx.play('confirm');
			return;
		}
		const kind = new Set(doctor.party.filter((a) => a.speciesId === speciesId).map((a) => a.id));
		if (doctor.marked.some((id) => kind.has(id))) {
			doctor.marked = doctor.marked.filter((id) => !kind.has(id));
			sfx.play('move');
			return;
		}
		this.shakeRow(doctor.cursor);
	}

	private confirmKey(key: string, fresh: boolean): boolean {
		// A tap on a choice does it, once the confirm's quiet moment has passed.
		const option = tappedOption(key);
		if (option !== undefined) {
			if ((option !== 0 && option !== 1) || !fresh) return true;
			doctor.confirm = option === 0 ? 0 : 1;
			return this.confirmKey('Enter', fresh);
		}
		switch (key) {
			// The two choices stand side by side, "No" (or "Not now") first: either pair of arrows
			// moves between them, without wrapping round.
			case 'ArrowLeft':
			case 'a':
			case 'ArrowUp':
			case 'w':
			case 'ArrowRight':
			case 'd':
			case 'ArrowDown':
			case 's': {
				const back = key === 'ArrowLeft' || key === 'a' || key === 'ArrowUp' || key === 'w';
				const choice = back ? 0 : 1;
				if (choice !== doctor.confirm) sfx.play('move');
				doctor.confirm = choice;
				return true;
			}
			case 'Enter':
			case ' ':
				if (!fresh) return true;
				sfx.play('confirm');
				if (doctor.screen === 'offer')
					this.send(doctor.confirm === 0 ? { type: 'back' } : { type: 'accept-offer' });
				else if (doctor.confirm === 0) this.backToList();
				else this.send({ type: 'hand-over', ids: [...doctor.marked] });
				return true;
		}
		return false;
	}

	private puzzleKey(key: string): boolean {
		// A tab puts the puzzle away and goes there; Bye leaves at any time.
		const tab = tappedTab(key);
		if (tab !== undefined) {
			if (tab !== doctor.tab) {
				doctor.tab = tab;
				doctor.cursor = this.firstStop(tab);
			}
			this.send({ type: 'back' });
			return true;
		}
		const row = tappedRow(key);
		if (row !== undefined) {
			const tapped = this.rows()[row];
			if (tapped?.kind === 'bye') this.send({ type: 'leave' });
			// On the heal tab, another hurt species' animal swaps the puzzle to it.
			else if (tapped?.kind === 'animal' && doctor.trade === null) {
				const groups = this.healGroups();
				const target = doctor.party[tapped.partyIndex];
				const group = groups.find((i) => doctor.party[i]?.speciesId === target?.speciesId);
				if (group !== undefined && group !== this.patientGroup()) {
					this.send({ type: 'pick-patient', partyIndex: tapped.partyIndex });
				}
			}
			return true;
		}
		switch (key) {
			case 'ArrowUp':
			case 'w':
			case 'ArrowDown':
			case 's': {
				// A heal's list stays live: up and down swap the puzzle for the next
				// species that needs the doctor. A token sum stays until it is answered.
				if (doctor.trade !== null) return true;
				const delta = key === 'ArrowUp' || key === 'w' ? -1 : 1;
				const groups = this.healGroups();
				const from = this.patientGroup();
				const next = from === undefined ? undefined : stepCursor(groups, from, delta);
				if (next !== undefined && next !== from) {
					sfx.play('move');
					this.send({ type: 'pick-patient', partyIndex: next });
				}
				return true;
			}
		}
		const typed = answerKey(
			doctor.input,
			key,
			doctor.puzzle ? answerForm(doctor.puzzle.kind) : 'number'
		);
		doctor.input = typed.input;
		if (typed.submit) this.send({ type: 'answer', input: typed.input });
		return typed.handled;
	}

	// --- rows ----------------------------------------------------------------

	private rows(): DoctorRow[] {
		return tabRows(doctor.tab, doctor.party, doctor.shop, doctor.lands);
	}

	/** The row of the animal at `partyIndex` on the tab on screen. */
	private rowOf(partyIndex: number): number {
		return this.rows().findIndex((r) => r.kind === 'animal' && r.partyIndex === partyIndex);
	}

	/**
	 * Where the cursor starts on a tab: the first animal who needs the doctor
	 * (or Bye, when nobody does); the first row, a kind's own row when the
	 * team starts with a kind of several; the first item (or Bye, when the
	 * shop has nothing).
	 */
	private firstStop(tab: DoctorTab): number {
		const rows = tabRows(tab, doctor.party, doctor.shop, doctor.lands);
		const stops = rowStops(rows, { tab, party: doctor.party, marked: doctor.marked });
		return stops[0] ?? rows.length - 1;
	}

	/**
	 * The cursor on a row it can stop on. After a heal it moves on to the next
	 * animal who still needs the doctor, round the list, and to Bye only when
	 * nobody does; elsewhere, to the next stop down.
	 */
	private fixCursor(): void {
		const rows = this.rows();
		const stops = rowStops(rows, doctor);
		if (stops.includes(doctor.cursor)) return;
		const bye = rows.length - 1;
		const before = stops.filter((s) => s !== bye);
		doctor.cursor =
			before.find((s) => s > doctor.cursor) ??
			(doctor.tab === 'heal' ? before[0] : undefined) ??
			stops.find((s) => s > doctor.cursor) ??
			stops[0] ??
			bye;
	}

	/** The party index of the first hurt animal of each species that needs the doctor, in list order. */
	private healGroups(): number[] {
		return bundles(doctor.party).flatMap((bundle) => {
			const first = bundle.slots.find((i) => needsHealing(doctor.party[i]!));
			return first === undefined ? [] : [first];
		});
	}

	/** The heal group of the patient on screen: the first hurt animal of its species. */
	private patientGroup(): number | undefined {
		const patient = doctor.patient === null ? undefined : doctor.party[doctor.patient];
		return this.healGroups().find((i) => doctor.party[i]!.speciesId === patient?.speciesId);
	}

	private shakeRow(row: number): void {
		doctor.shake = { row, n: ++this.pops };
	}

	/** What the doctor says on a tab. */
	private tabLine(tab: DoctorTab, state: DoctorState | null = this.latest): DoctorLine {
		switch (tab) {
			case 'heal':
				return { say: state?.party.some(needsHealing) ? 'hello' : 'helloAllFit' };
			case 'home':
				return { say: 'homeIntro' };
			case 'shop':
				return { say: 'shopIntro', empty: (state?.shop.length ?? 0) === 0 };
			case 'fly':
				return { say: 'flyIntro' };
		}
	}

	// --- beats ---------------------------------------------------------------

	/**
	 * Turn one step's events into beats, and say what the doctor says about
	 * the state they leave (`this.said`). The heals one right answer makes
	 * play as one beat.
	 */
	private narrate(events: readonly DoctorEvent[], before: DoctorState, after: DoctorState): Beat[] {
		const beats: Beat[] = [];
		let heals: Extract<DoctorEvent, { type: 'healed' }>[] = [];
		const flushHeals = () => {
			if (heals.length > 0) beats.push(this.healBeat(heals, before, after));
			heals = [];
		};
		for (const e of events) {
			if (e.type === 'healed') {
				heals.push(e);
				continue;
			}
			flushHeals();
			switch (e.type) {
				case 'puzzle-shown': {
					const patient = after.party[e.partyIndex]!;
					const others = after.party.filter(
						(a, i) => i !== e.partyIndex && a.speciesId === patient.speciesId && needsHealing(a)
					).length;
					this.said = { say: 'letsHelp', animal: { ...patient }, others };
					break;
				}
				case 'hand-over-shown':
					this.said = { say: 'homeCount' };
					break;
				case 'purchase-shown':
					this.said = { say: 'shopCount' };
					break;
				case 'fare-shown':
					this.said = { say: 'fareCount', land: e.land };
					break;
				case 'closed':
					this.said = this.tabLine(doctor.tab, after);
					break;
				case 'answer-judged': {
					// The right answer is never shown (UI_SPEC): a missed heal asks a new
					// puzzle, a missed token sum the same one.
					const trade = before.phase.kind === 'handing-over' || before.phase.kind === 'buying';
					const miss: DoctorLine = { say: trade ? 'tryAgain' : 'notQuite' };
					if (!e.correct) this.said = miss;
					beats.push({
						run: () => {
							doctor.judged = { correct: e.correct };
							sfx.play(e.correct ? 'correct' : 'wrong');
							if (!e.correct) doctor.line = miss;
						},
						hold: e.correct ? CORRECT_HOLD : MISS_HOLD
					});
					break;
				}
				case 'went-home': {
					const line: DoctorLine = { say: 'wentHome', animals: e.animals.map((a) => ({ ...a })) };
					this.said = line;
					beats.push({
						run: () => {
							doctor.leaving = e.animals.map((a) => a.id);
							doctor.line = line;
							sfx.play('heal');
						},
						hold: HOME_HOLD
					});
					break;
				}
				case 'tokens-given': {
					const line: DoctorLine = { say: 'tokensGiven', amount: e.amount, tokens: e.tokens };
					this.said = line;
					beats.push({
						run: () => {
							const gone = new Set(doctor.leaving ?? []);
							doctor.party = doctor.party.filter((a) => !gone.has(a.id));
							doctor.leaving = null;
							doctor.marked = [];
							// Back at the top of the list, never on Bye, where a mash might land.
							doctor.cursor = 0;
							doctor.tokens = e.tokens;
							doctor.tokenPop = { amount: e.amount, n: ++this.pops };
							doctor.line = line;
							sfx.play('coins');
						},
						hold: TOKENS_HOLD
					});
					break;
				}
				case 'bought': {
					const line: DoctorLine = { say: 'bought', itemId: e.itemId, tokens: e.tokens };
					this.said = line;
					beats.push({
						run: () => {
							doctor.tokens = e.tokens;
							doctor.items = [...doctor.items, e.itemId];
							doctor.tokenPop = { amount: -e.price, n: ++this.pops };
							doctor.bought = e.itemId;
							doctor.line = line;
							sfx.play('coins');
						},
						hold: TOKENS_HOLD
					});
					break;
				}
				case 'ended':
					break;
				case 'rejected':
					console.warn(`doctor intent rejected: ${e.reason}`);
					break;
			}
		}
		flushHeals();
		return beats;
	}

	/** One right answer's heals, all at once: every bar fills, every row lights up. */
	private healBeat(
		heals: readonly Extract<DoctorEvent, { type: 'healed' }>[],
		before: DoctorState,
		after: DoctorState
	): Beat {
		const amounts: Record<number, number> = {};
		// What each heal gave: the HP the event says it has now, less what it had.
		for (const h of heals)
			amounts[h.partyIndex] = h.animal.hp - (before.party[h.partyIndex]?.hp ?? 0);
		// The doctor names the animal picked, and counts the rest of its kind.
		const picked = before.phase.kind === 'solving' ? before.phase.partyIndex : heals[0]!.partyIndex;
		const animal = after.party[picked] ?? heals[0]!.animal;
		const line: DoctorLine = {
			say: 'healed',
			animal: { ...animal },
			others: heals.length - 1,
			someoneStillHurt: after.party.some(needsHealing)
		};
		this.said = line;
		return {
			run: () => {
				doctor.party = doctor.party.map((a, i) => {
					const healed = heals.find((h) => h.partyIndex === i);
					return healed ? { ...healed.animal } : a;
				});
				doctor.healed = { amounts, n: ++this.pops };
				sfx.play('heal');
				doctor.line = line;
			},
			hold: HEAL_HOLD
		};
	}
}
