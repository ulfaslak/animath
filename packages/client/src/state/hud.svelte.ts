import {
	bundles,
	canFightIn,
	canTalkToDoctor,
	clearableAhead,
	itemsForSale,
	leadIndex,
	type AnimalInstance,
	type ClearableKind,
	type GameEvent,
	type Line as MessageLine,
	type PartyEvent,
	type Realm
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { t } from '../copy';
import { doctorWords, type DoctorLine } from '../doctor/lines';
import { touch } from '../input/touch.svelte';
import { messageWords } from '../lines';
import { animalWords } from '../names';
import type { SaveNotice } from '../save/notices';
import { game } from './game.svelte';

/**
 * What the explore HUD's message line says (UI_SPEC § Explore mode): the
 * latest thing said, for a few seconds, and under it the prompt for what
 * Enter does in front of the player (talk to the doctor at a tent, chop a
 * tree or break a rock with the tool it takes), or the controls hint for the
 * first few steps.
 *
 * Things said are the authority's `message` events, plus lines the client
 * words itself from events that carry no words: the doctor's goodbye
 * (`doctor-visit-ended`), the doctor's line after a lost battle
 * (`taken-to-doctor`), how to find a doctor (`nothing-to-interact`), that
 * the doctor sells the tool a tree or a rock takes (`tool-needed`, and the
 * first bump into one without it, once a game), who
 * goes first after a party edit (`party-edited`, see `leadNotice`), and what
 * start-up found about the save (`notice`, from `main.ts`). They are kept as
 * data and worded when shown, in the language on screen.
 *
 * Their seconds count only while the explore HUD is on screen (`tick`, from
 * the frame loop), so a line said while the battle screen or the doctor's
 * card is up — the doctor's line after a lost battle — is still there to read
 * when the player is back in the world.
 */

/** Seconds a message stays on the line while the explore HUD is on screen. */
export const MESSAGE_SECONDS = 5;
/** Steps walked after which the controls hint goes away. */
export const HINT_STEPS = 5;

/**
 * A line about who goes first, after a party edit: the new lead (`chosen`),
 * or why the one asked for can't be (`tired`, `already`, out on the water
 * `cantSwim`, and on land `inTheSea`, a sea animal). The animal is named by
 * id and its name read when the line is shown, so a new name shows at once;
 * a card whose animals are all tired, or can't go first where the player
 * is, is named by its species (`speciesId`).
 */
export type PartyNotice =
	| { lead: 'chosen' | 'tired' | 'already' | 'cantSwim' | 'inTheSea'; animalId: string }
	| { lead: 'tired' | 'cantSwim' | 'inTheSea'; speciesId: string };

/** A line on the message line, as data. */
export type Said =
	/** The authority's `message`: a copy key and its values, as it sent them. */
	| { line: MessageLine }
	| { doctor: DoctorLine }
	/** `interact` found no tent in front of the player. */
	| { explore: 'notAtTent' }
	/** A tree or a rock is in the way without the tool it takes: the doctor sells one. */
	| { needs: ClearableKind }
	| { party: PartyNotice }
	/** What start-up found about the save: a copy key from `SAVE_NOTICES`. */
	| { save: SaveNotice }
	/** How going to another player went, and whom to (`presence/controller.ts`). */
	| { presence: PresenceLine; name: string };

/**
 * After "Go to <name>": next to them now, they left the world, the server
 * could not be reached or did not answer, or there was nowhere near them to
 * stand.
 */
export type PresenceLine = 'nextTo' | 'lost' | 'cantFind' | 'noRoom';

export function saidWords(said: Said): string {
	if ('presence' in said) return t(`presence.${said.presence}`, { name: said.name });
	if ('line' in said) return messageWords(said.line);
	if ('doctor' in said) return doctorWords(said.doctor);
	if ('party' in said) return partyWords(said.party);
	if ('save' in said) return t(said.save);
	if ('needs' in said)
		return said.needs === 'tree' ? t('explore.needAxe') : t('explore.needPickaxe');
	return t('explore.notAtTent');
}

/** What Enter (the touch controls' Talk) does in front of the player: talk, chop, break, or nothing. */
export type ExploreAction = 'talk' | 'chop' | 'break' | null;

function partyWords(notice: PartyNotice): string {
	if ('speciesId' in notice) {
		const kin = game.party.filter((a) => a.speciesId === notice.speciesId);
		// A card of animals that can't go first here: one is named, several by their kind.
		if (notice.lead === 'cantSwim' || notice.lead === 'inTheSea') {
			const named = kin.length === 1 ? kin[0]! : { speciesId: notice.speciesId };
			const key = notice.lead === 'cantSwim' ? 'party.leadCantSwim' : 'party.leadInTheSea';
			return t(key, { animal: animalWords(named) });
		}
		// A card whose animals are all tired: one is named, several are "all".
		if (kin.length > 1) return t('party.leadAllTired');
		return kin[0] ? t('party.leadTired', { animal: animalWords(kin[0]) }) : '';
	}
	const animal = game.party.find((a) => a.id === notice.animalId);
	if (!animal) return '';
	const params = { animal: animalWords(animal) };
	switch (notice.lead) {
		case 'chosen':
			return t('party.leadChosen', params);
		case 'tired':
			return t('party.leadTired', params);
		case 'already':
			return t('party.leadAlready', params);
		case 'cantSwim':
			return t('party.leadCantSwim', params);
		case 'inTheSea':
			return t('party.leadInTheSea', params);
	}
}

/**
 * The line a party edit puts on the message line, if any, from the party
 * after it and what happened. A lead that can't be chosen is told why —
 * nothing else on screen would say — and so is a card put at the top that
 * can't go first where the player stands (a sea animal's on land, one that
 * can't swim out on the water), since the card at the top goes first
 * everywhere else. Otherwise, whenever the edit changed who goes first (a
 * number key, a card dropped at the top, a move in the pause menu), the line
 * names the new lead, so an earlier "Fox goes first!" never outlives the
 * fox's place at the front. A move is undone on a copy to see who led before
 * it.
 */
export function leadNotice(
	after: readonly AnimalInstance[],
	events: readonly PartyEvent[],
	realm: Realm = 'land'
): PartyNotice | null {
	for (const e of events) {
		if (e.type === 'rejected') {
			// Out on the water an animal that can't swim can't go first, and on land a sea animal.
			if (e.reason === 'cannot-fight-here') {
				const lead = realm === 'water' ? 'cantSwim' : 'inTheSea';
				if (e.animalId !== undefined) return { lead, animalId: e.animalId };
				if (e.speciesId !== undefined) return { lead, speciesId: e.speciesId };
			}
			if (e.reason === 'tired' && e.animalId !== undefined) {
				return { lead: 'tired', animalId: e.animalId };
			}
			if (e.reason === 'tired' && e.speciesId !== undefined) {
				return { lead: 'tired', speciesId: e.speciesId };
			}
			if (e.reason === 'already-lead' && e.animalId !== undefined) {
				return { lead: 'already', animalId: e.animalId };
			}
		}
		if (e.type === 'lead-selected') return { lead: 'chosen', animalId: e.animalId };
		// On top, and still not first: its animals can't fight here, so the lead stays where it was.
		if (e.type === 'species-moved' && e.to === 0 && !canFightIn(e.speciesId, realm)) {
			return { lead: realm === 'water' ? 'cantSwim' : 'inTheSea', speciesId: e.speciesId };
		}
		if (e.type === 'reordered' || e.type === 'species-moved') {
			const before =
				e.type === 'reordered' ? unmoved(after, e.from, e.to) : unmovedBundle(after, e.from, e.to);
			const was = before[leadIndex(before, realm)];
			const is = after[leadIndex(after, realm)];
			if (is && was?.id !== is.id) return { lead: 'chosen', animalId: is.id };
		}
	}
	return null;
}

/** The party as it was before the animal in slot `from` moved to slot `to`. */
function unmoved(after: readonly AnimalInstance[], from: number, to: number): AnimalInstance[] {
	const before = [...after];
	const [moved] = before.splice(to, 1);
	before.splice(from, 0, moved!);
	return before;
}

/** The party as it was before the bundle in place `from` moved to place `to`. */
function unmovedBundle(
	after: readonly AnimalInstance[],
	from: number,
	to: number
): AnimalInstance[] {
	const list = bundles(after);
	const [moved] = list.splice(to, 1);
	list.splice(from, 0, moved!);
	return list.flatMap((b) => b.animals);
}

class HudView {
	#said = $state<Said | null>(null);
	#fresh = $state(false);
	private age = MESSAGE_SECONDS;
	/**
	 * The kinds whose "the doctor sells one" has been said since the game on
	 * screen started (`welcome`): a bump says it once, not every time.
	 */
	private toolHints = new Set<ClearableKind>();

	/** The player faces a doctor's tent: interacting now talks to the doctor. */
	facingTent = $derived(canTalkToDoctor(game.seed, game.pos, game.facing));
	/** A tree or a rock in front of the player, and the tool it takes (owned or not); else null. */
	ahead = $derived(clearableAhead(game.seed, game.edits, game.pos, game.facing));
	/**
	 * What Enter does now: talk to the doctor at a tent, chop the tree or break
	 * the rock in front with the tool it takes, when the player owns it; else
	 * null (Enter only says how to find a doctor). The prompt below says it,
	 * and the touch controls' Talk button is named and lit by it.
	 */
	action = $derived<ExploreAction>(
		this.facingTent
			? 'talk'
			: this.ahead && game.items.includes(this.ahead.tool)
				? this.ahead.kind === 'tree'
					? 'chop'
					: 'break'
				: null
	);
	/**
	 * The latest thing said while it is fresh, worded now, else ''. "Walk up to
	 * a tent" is over once the player faces one: the prompt below says what next.
	 */
	message = $derived(
		this.#fresh && this.#said && !('explore' in this.#said && this.facingTent)
			? saidWords(this.#said)
			: ''
	);
	/**
	 * The line under it: what Enter does here (talk, chop, break), the controls
	 * hint, or ''. With the touch controls on, each names the button on screen
	 * instead of a key.
	 */
	hint = $derived(
		this.action === 'talk'
			? touch.on
				? t('explore.talkPromptTouch')
				: t('explore.talkPrompt')
			: this.action === 'chop'
				? touch.on
					? t('explore.chopPromptTouch')
					: t('explore.chopPrompt')
				: this.action === 'break'
					? touch.on
						? t('explore.breakPromptTouch')
						: t('explore.breakPrompt')
					: game.steps < HINT_STEPS
						? touch.on
							? t('explore.controlsTouch')
							: t('explore.controls')
						: ''
	);

	/** Call after `game.apply(event)`, which knows who the player is and which way they face. */
	apply(event: GameEvent): void {
		switch (event.type) {
			case 'player-blocked': {
				// The first bump into a tree or a rock the kid has no tool for says the doctor
				// sells one, once a game: a key held against a tree bumps every frame.
				if (event.playerId !== game.playerId) break;
				const ahead = this.ahead;
				if (!ahead || game.items.includes(ahead.tool) || this.toolHints.has(ahead.kind)) break;
				if (!itemsForSale().includes(ahead.tool)) break;
				this.toolHints.add(ahead.kind);
				this.say({ needs: ahead.kind });
				break;
			}
			case 'tool-needed':
				// Enter at a tree or a rock without its tool: always said, since the kid asked
				// (and, were the tool not on sale, only how to find a doctor).
				if (event.playerId !== game.playerId) break;
				this.toolHints.add(event.kind);
				this.say(
					itemsForSale().includes(event.tool) ? { needs: event.kind } : { explore: 'notAtTent' }
				);
				break;
			case 'welcome':
				this.#said = null;
				this.age = MESSAGE_SECONDS;
				this.#fresh = false;
				this.toolHints.clear();
				break;
			case 'message':
				this.say({ line: event.line });
				break;
			case 'taken-to-doctor':
				if (event.playerId === game.playerId) {
					this.say({ doctor: { say: 'rescued', atTent: event.tent !== null } });
				}
				break;
			case 'doctor-visit-ended':
				this.say({ doctor: { say: 'goodbye' } });
				break;
			case 'nothing-to-interact':
				if (event.playerId === game.playerId) this.say({ explore: 'notAtTent' });
				break;
			case 'party-edited': {
				const notice = leadNotice(event.party, event.events, game.realm);
				if (notice) this.say({ party: notice });
				// A new animal in front: ding-ding, with its "goes first!" line.
				if (notice?.lead === 'chosen') sfx.play('lead');
				break;
			}
			case 'party-changed':
				// The world changed the party (a battle's result, a healing): a line
				// about who goes first may no longer hold. The doctor's own events
				// replace it with their line above.
				if (this.#said && 'party' in this.#said) this.#said = null;
				break;
		}
	}

	/** Say what start-up found about the save. Call after `welcome`, which clears the line. */
	notice(key: SaveNotice): void {
		this.say({ save: key });
	}

	/** Say how going to another player went. */
	presence(line: PresenceLine, name: string): void {
		this.say({ presence: line, name });
	}

	/** Put a line on the message line; it stays for `MESSAGE_SECONDS` of the HUD on screen. */
	private say(said: Said): void {
		this.#said = said;
		this.age = 0;
	}

	/** Advance the message clock by `dt` seconds of the explore HUD being on screen. */
	tick(dt: number): void {
		const fresh = this.#said !== null && this.age < MESSAGE_SECONDS;
		this.age += dt;
		if (this.#fresh !== fresh) this.#fresh = fresh;
	}
}

export const hud = new HudView();
