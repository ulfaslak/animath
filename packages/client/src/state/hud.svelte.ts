import {
	canTalkToDoctor,
	leadIndex,
	type AnimalInstance,
	type GameEvent,
	type PartyEvent
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { t } from '../copy';
import { doctorWords, type DoctorLine } from '../doctor/lines';
import { nameOf } from '../names';
import { game } from './game.svelte';

/**
 * What the explore HUD's message line says (UI_SPEC § Explore mode): the
 * latest thing said, for a few seconds, and under it the doctor prompt while
 * the player faces a tent, or the controls hint for the first few steps.
 *
 * Things said are the authority's `message` events, plus lines the client
 * words itself from events that carry no words: the doctor's goodbye
 * (`doctor-visit-ended`), the doctor's line after a lost battle
 * (`taken-to-doctor`), how to find a doctor (`nothing-to-interact`), and who
 * goes first after a party edit (`party-edited`, see `leadNotice`).
 * They are kept as data and worded when shown, in the language on screen.
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
 * or why the one asked for can't be (`tired`, `already`). The animal is named
 * by id and its name read when the line is shown, so a new name shows at once.
 */
export interface PartyNotice {
	lead: 'chosen' | 'tired' | 'already';
	animalId: string;
}

/** A line on the message line, as data. */
export type Said =
	/** The authority's `message`, as it sent it. */
	| { text: string }
	| { doctor: DoctorLine }
	/** `interact` found no tent in front of the player. */
	| { explore: 'notAtTent' }
	| { party: PartyNotice };

export function saidWords(said: Said): string {
	if ('text' in said) return said.text;
	if ('doctor' in said) return doctorWords(said.doctor);
	if ('party' in said) return partyWords(said.party);
	return t('explore.notAtTent');
}

function partyWords(notice: PartyNotice): string {
	const animal = game.party.find((a) => a.id === notice.animalId);
	if (!animal) return '';
	const name = nameOf(animal);
	switch (notice.lead) {
		case 'chosen':
			return t('party.leadChosen', { name });
		case 'tired':
			return t('party.leadTired', { name });
		case 'already':
			return t('party.leadAlready', { name });
	}
}

/**
 * The line a party edit puts on the message line, if any, from the party
 * after it and what happened. A lead that can't be chosen is told why —
 * nothing else on screen would say. Otherwise, whenever the edit changed who
 * goes first (a number key, a move in the pause menu), the line names the
 * new lead, so an earlier "Fox goes first!" never outlives the fox's place at
 * the front. A move is undone on a copy to see who led before it.
 */
export function leadNotice(
	after: readonly AnimalInstance[],
	events: readonly PartyEvent[]
): PartyNotice | null {
	for (const e of events) {
		if (e.type === 'rejected' && e.animalId !== undefined) {
			if (e.reason === 'tired') return { lead: 'tired', animalId: e.animalId };
			if (e.reason === 'already-lead') return { lead: 'already', animalId: e.animalId };
		}
		if (e.type === 'lead-selected') return { lead: 'chosen', animalId: e.animalId };
		if (e.type === 'reordered') {
			const before = [...after];
			const [moved] = before.splice(e.to, 1);
			before.splice(e.from, 0, moved!);
			const was = before[leadIndex(before)];
			const is = after[leadIndex(after)];
			if (is && was?.id !== is.id) return { lead: 'chosen', animalId: is.id };
		}
	}
	return null;
}

class HudView {
	#said = $state<Said | null>(null);
	#fresh = $state(false);
	private age = MESSAGE_SECONDS;

	#facingTent = $derived(canTalkToDoctor(game.seed, game.pos, game.facing));
	/**
	 * The latest thing said while it is fresh, worded now, else ''. "Walk up to
	 * a tent" is over once the player faces one: the prompt below says what next.
	 */
	message = $derived(
		this.#fresh && this.#said && !('explore' in this.#said && this.#facingTent)
			? saidWords(this.#said)
			: ''
	);
	/** The line under it: the doctor prompt, the controls hint, or ''. */
	hint = $derived(
		this.#facingTent
			? t('explore.talkPrompt')
			: game.steps < HINT_STEPS
				? t('explore.controls')
				: ''
	);

	/** Call after `game.apply(event)`, which knows who the player is. */
	apply(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
				this.#said = null;
				this.age = MESSAGE_SECONDS;
				this.#fresh = false;
				break;
			case 'message':
				this.say({ text: event.text });
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
				const notice = leadNotice(event.party, event.events);
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
