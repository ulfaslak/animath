import {
	bundles,
	canFightIn,
	canTalkToDoctor,
	clearableAhead,
	holeAhead,
	shopFor,
	leadIndex,
	needsDoctor,
	type AnimalInstance,
	type ClearableKind,
	type GameEvent,
	type InviteEnd,
	type ItemId,
	type Line as MessageLine,
	type PartyEvent,
	type Realm
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { FISH_BITE_DELAY } from '../render/fishing';
import { t } from '../copy';
import { doctorWords, type DoctorLine } from '../doctor/lines';
import type { TalkKey } from '../input/keyboard';
import { touch } from '../input/touch.svelte';
import { messageWords } from '../lines';
import { animalWords } from '../names';
import type { SaveNotice } from '../save/notices';
import { account } from './account.svelte';
import { doctorWay } from './doctor-way.svelte';
import { game } from './game.svelte';

/**
 * What the explore HUD's message line says (UI_SPEC § Explore mode): the
 * latest thing said, for a few seconds, and under it the prompt for what
 * Enter does in front of the player (talk to the doctor at a tent, chop a
 * tree or break a rock with the tool it takes), else, while the team needs
 * the doctor, that it is tired and where to go, or the controls hint for the
 * first few steps.
 *
 * Things said are the authority's `message` events, plus lines the client
 * words itself from events that carry no words: the doctor's goodbye
 * (`doctor-visit-ended`), how to find a doctor (`nothing-to-interact`), that
 * the doctor sells the tool a tree or a rock takes (`tool-needed`, and the
 * first bump into one without it, once a game), who
 * goes first after a party edit (`party-edited`, see `leadNotice`), and what
 * start-up found about the save (`notice`, from `main.ts`). They are kept as
 * data and worded when shown, in the language on screen.
 *
 * Their seconds count only while the explore HUD is on screen (`tick`, from
 * the frame loop), so a line said while the battle screen or the doctor's
 * card is up — a battle's closing line — is still there to read when the
 * player is back in the world. A line already read there is over once a
 * battle or a friendly match takes the screen (`covered`): it never comes
 * back after it, as "Welcome back!" once did after a match.
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
	/**
	 * `interact` found no tent in front of the player (`notAtTent`); with the
	 * glider, a tap of Space there says how to fly instead, and so does the
	 * doctor's goodbye when it was just bought (`holdToFly`); a take-off with
	 * nowhere to land that way (`tooFar`); the doctor's goodbye when the
	 * harness was just bought (`rideBig`).
	 */
	| { explore: 'notAtTent' | 'holdToFly' | 'tooFar' | 'rideBig' }
	/** Up in the air, a wild bird of this species noticed the glider and follows it down. */
	| { follows: string }
	/**
	 * A tree, a rock or an ice block is in the way without the tool it takes,
	 * or a fishing hole without the rod: the doctor sells one.
	 */
	| { needs: ToolTarget }
	/** A cast at a fishing hole: nothing bit this time, or nobody in the team can swim. */
	| { fished: 'nothing' | 'no-swimmer' }
	| { party: PartyNotice }
	/** What start-up found about the save: a copy key from `SAVE_NOTICES`. */
	| { save: SaveNotice }
	/**
	 * The page started again for the account (`account/restart.ts`): the game
	 * is saved in the new account, the player logged in, or another device's
	 * newer save came in. Worded with the account's name when the line shows.
	 */
	| { account: 'saved' | 'welcome' | 'movedAhead' }
	/** How going to another player went, and whom to (`presence/controller.ts`). */
	| { presence: PresenceLine; name: string }
	| { match: MatchLine; name: string };

/**
 * After "Go to <name>": next to them now, they left the world, the server
 * could not be reached or did not answer, or there was nowhere near them to
 * stand.
 */
export type PresenceLine = 'nextTo' | 'lost' | 'cantFind' | 'noRoom';

/**
 * After a friendly match's invite ended with no match (`InviteEnd`, said
 * about the other player, `name`), or the match itself: the server could not
 * be reached (`lost`), it is updating (`updating`), the player left the
 * match (`youLeft`), or a rematch was called off because the other player
 * had gone back to exploring (`went`).
 */
export type MatchLine = Exclude<InviteEnd, 'off'> | 'lost' | 'updating' | 'youLeft' | 'went';

export function saidWords(said: Said): string {
	if ('presence' in said) return t(`presence.${said.presence}`, { name: said.name });
	if ('match' in said) return t(`match.said.${said.match}`, { name: said.name });
	if ('line' in said) return messageWords(said.line);
	if ('doctor' in said) return doctorWords(said.doctor);
	if ('party' in said) return partyWords(said.party);
	if ('save' in said) return t(said.save);
	if ('account' in said) return accountWords(said.account);
	if ('needs' in said) return t(NEEDS[said.needs]);
	if ('fished' in said)
		return said.fished === 'nothing' ? t('explore.caughtNothing') : t('explore.noSwimmer');
	// Only a bird has the grumpy form: a species' forms are written out, never built.
	if ('follows' in said)
		return t('explore.birdFollows', {
			bird: { aGrumpy: t(`species.${said.follows}.aGrumpy`) }
		});
	if (said.explore === 'holdToFly') {
		return touch.on ? t('explore.holdToFlyTouch') : t('explore.holdToFly');
	}
	if (said.explore === 'tooFar') return t('explore.tooFar');
	if (said.explore === 'rideBig') return t('explore.rideBig');
	return t('explore.notAtTent');
}

function accountWords(note: 'saved' | 'welcome' | 'movedAhead'): string {
	const name = account.name ?? '';
	switch (note) {
		case 'saved':
			return t('account.notice.saved', { name });
		case 'welcome':
			return t('account.notice.welcome', { name });
		case 'movedAhead':
			return t('account.notice.movedAhead');
	}
}

/** What a tool is for: a tile it clears, or a fishing hole the rod fishes. */
export type ToolTarget = ClearableKind | 'hole';

/** What the line says a kid in front of one without its tool needs. */
/** What Enter does in front of each, with its tool. */
const ACTIONS: Readonly<Record<ToolTarget, Exclude<ExploreAction, 'talk' | null>>> = {
	tree: 'chop',
	rock: 'break',
	iceblock: 'breakIce',
	hole: 'fish'
};

/** The prompt under the message line for what Enter does: with keys, and with the touch controls on. */
export const PROMPTS: Readonly<Record<Exclude<ExploreAction, null>, readonly [string, string]>> = {
	talk: ['explore.talkPrompt', 'explore.talkPromptTouch'],
	chop: ['explore.chopPrompt', 'explore.chopPromptTouch'],
	break: ['explore.breakPrompt', 'explore.breakPromptTouch'],
	breakIce: ['explore.breakIcePrompt', 'explore.breakIcePromptTouch'],
	fish: ['explore.fishPrompt', 'explore.fishPromptTouch']
};

export const NEEDS: Readonly<Record<ToolTarget, string>> = {
	tree: 'explore.needAxe',
	rock: 'explore.needPickaxe',
	iceblock: 'explore.needIcePick',
	hole: 'explore.needRod'
};

/**
 * What Enter (the touch controls' Talk) does in front of the player: talk,
 * chop a tree, break a rock or an ice block, fish at a hole, or nothing.
 */
export type ExploreAction = 'talk' | 'chop' | 'break' | 'breakIce' | 'fish' | null;

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
			const lead = cannotLead(realm);
			if (e.reason === 'cannot-fight-here' && lead) {
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
		const cannot = cannotLead(realm);
		if (e.type === 'species-moved' && e.to === 0 && !canFightIn(e.speciesId, realm) && cannot) {
			return { lead: cannot, speciesId: e.speciesId };
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

/**
 * Why an animal can't go first where the player is: out on the water it
 * can't swim, on land it lives in the sea. Up in the air nothing is picked (a
 * flight is three seconds, and the engine refuses it), so there is no line.
 */
function cannotLead(realm: Realm): 'cantSwim' | 'inTheSea' | null {
	if (realm === 'water') return 'cantSwim';
	return realm === 'land' ? 'inTheSea' : null;
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
	/** The line said last has been on the explore HUD: read, or there to be read. */
	private seen = false;
	/**
	 * The kinds whose "the doctor sells one" has been said since the game on
	 * screen started (`welcome`): a bump says it once, not every time.
	 */
	private toolHints = new Set<ToolTarget>();
	/** The key of the talk on its way to the authority (`talked`): a tap of Space, or Enter. */
	private talkKey: TalkKey = 'enter';
	/**
	 * A line that waits for what it tells to happen on screen: that nothing bit
	 * once the line is reeled in (`FISH_BITE_DELAY`), not as it is cast. A line
	 * said meanwhile takes its place.
	 */
	private later: { said: Said; in: number } | null = null;
	/** The items owned as the doctor's visit began: what the kid buys there is what is new at its end. */
	private itemsBefore: readonly string[] = [];

	/** The player faces a doctor's tent: interacting now talks to the doctor. */
	facingTent = $derived(canTalkToDoctor(game.seed, game.pos, game.facing));
	/**
	 * A tree, a rock or an ice block in front of the player and the tool it
	 * takes, or a fishing hole and the rod (owned or not); else null.
	 */
	ahead = $derived<{ kind: ToolTarget; tool: ItemId } | null>(
		holeAhead(game.seed, game.edits, game.pos, game.facing)
			? { kind: 'hole', tool: 'fishing-rod' }
			: clearableAhead(game.seed, game.edits, game.pos, game.facing)
	);
	/**
	 * What Enter does now: talk to the doctor at a tent, chop the tree or break
	 * the rock in front with the tool it takes, when the player owns it; else
	 * null (Enter only says how to find a doctor, and does nothing at all up in
	 * the air). The prompt below says it, and the touch controls' Talk button
	 * is named and lit by it.
	 */
	action = $derived<ExploreAction>(
		game.flying
			? null
			: this.facingTent
				? 'talk'
				: this.ahead && game.items.includes(this.ahead.tool)
					? ACTIONS[this.ahead.kind]
					: null
	);
	/**
	 * The latest thing said while it is fresh, worded now, else ''. "Walk up to
	 * a tent" is over once the player faces one: the prompt below says what next.
	 */
	message = $derived(
		this.#fresh &&
			this.#said &&
			!('explore' in this.#said && this.#said.explore === 'notAtTent' && this.facingTent)
			? saidWords(this.#said)
			: ''
	);
	/**
	 * The team needs the doctor where the player stands (the engine's
	 * `needsDoctor`): nothing challenges it, and the line under the message
	 * says where to go, as the arrow at the screen's edge shows it.
	 */
	tired = $derived(needsDoctor(game.party, game.realm));
	/**
	 * The line under it: what Enter does here (talk, chop, break, fish), else that
	 * the team is tired and needs a doctor's tent (for as long as it does: walk,
	 * sail, or where no tent is a walk away and the kid has the paraglider, fly
	 * out; `doctorWay.noWay`), or the controls hint, or ''. With the touch
	 * controls on, each names the button on screen instead of a key.
	 */
	hint = $derived(
		game.flying
			? ''
			: this.action !== null
				? t(PROMPTS[this.action][touch.on ? 1 : 0])
				: this.tired
					? game.realm === 'water'
						? t('explore.tiredSail')
						: doctorWay.noWay && game.items.includes('glider')
							? t('explore.tiredFly')
							: t('explore.tired')
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
				if (!shopFor(game.land).includes(ahead.tool)) break;
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
					shopFor(game.land).includes(event.tool) ? { needs: event.kind } : { explore: 'notAtTent' }
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
			case 'doctor-visit-started':
				this.itemsBefore = event.state.items;
				break;
			case 'doctor-visit-ended':
				// Just bought the glider or the harness: the goodbye gives way to how to use it.
				this.say(
					this.bought(event.state.items, 'glider')
						? { explore: 'holdToFly' }
						: this.bought(event.state.items, 'harness')
							? { explore: 'rideBig' }
							: { doctor: { say: 'goodbye' } }
				);
				break;
			case 'line-cast':
				// Something bit: its battle says so. Nothing did, or nobody can swim: the line says why.
				if (event.playerId !== game.playerId || event.outcome === 'bite') break;
				// Nobody to swim: said at once (no line is cast). Nothing bit: once the bobber is back.
				if (event.outcome === 'no-swimmer') this.say({ fished: event.outcome });
				else this.later = { said: { fished: event.outcome }, in: FISH_BITE_DELAY };
				break;
			case 'nothing-to-interact':
				// A tap of Space with nothing in front, the glider owned: that is how to fly.
				if (event.playerId !== game.playerId) break;
				this.say(
					this.talkKey === 'space' && game.items.includes('glider')
						? { explore: 'holdToFly' }
						: { explore: 'notAtTent' }
				);
				break;
			case 'take-off-refused':
				if (event.playerId === game.playerId && event.reason === 'nowhere-to-land') {
					this.say({ explore: 'tooFar' });
				}
				break;
			case 'bird-follows':
				if (event.playerId === game.playerId) this.say({ follows: event.speciesId });
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

	/** What the page says after starting again for the account (`account/restart.ts`). */
	accountNotice(note: 'saved' | 'welcome' | 'movedAhead'): void {
		this.say({ account: note });
	}

	/** Say how going to another player went. */
	presence(line: PresenceLine, name: string): void {
		this.say({ presence: line, name });
	}

	/** Say how an invite to a friendly match ended, or why the match did. */
	match(line: MatchLine, name: string): void {
		this.say({ match: line, name });
	}

	/**
	 * Which key the talk explore is about to send came from (`input/keyboard.ts`):
	 * the authority's answer carries no key, and a tap of Space with nothing in
	 * front says how to fly where Enter says how to find a doctor.
	 */
	talked(key: TalkKey): void {
		this.talkKey = key;
	}

	/** Whether `id` is among `items` at the doctor's goodbye and was not as the visit began. */
	private bought(items: readonly string[], id: ItemId): boolean {
		return items.includes(id) && !this.itemsBefore.includes(id);
	}

	/** Put a line on the message line; it stays for `MESSAGE_SECONDS` of the HUD on screen. */
	private say(said: Said): void {
		this.later = null;
		this.#said = said;
		this.age = 0;
		this.seen = false;
	}

	/** Advance the message clock by `dt` seconds of the explore HUD being on screen. */
	tick(dt: number): void {
		if (this.later) {
			this.later.in -= dt;
			if (this.later.in <= 0) {
				const { said } = this.later;
				this.later = null;
				this.say(said);
			}
		}
		const fresh = this.#said !== null && this.age < MESSAGE_SECONDS;
		if (fresh) this.seen = true;
		this.age += dt;
		if (this.#fresh !== fresh) this.#fresh = fresh;
	}

	/**
	 * A battle or a friendly match has the screen (each frame it does): the
	 * line the HUD has already shown is over, and does not come back after it.
	 * One said since, which the kid has not seen yet, waits for the HUD.
	 */
	covered(): void {
		if (!this.seen || this.age >= MESSAGE_SECONDS) return;
		this.age = MESSAGE_SECONDS;
		this.#fresh = false;
	}
}

export const hud = new HudView();
