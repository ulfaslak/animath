import {
	MAX_FIGHT_EVENTS,
	wildFight,
	wildFightEvents,
	type BattleMessage,
	type Busy,
	type FightEvent,
	type FightView,
	type GameEvent
} from '@mathgame/engine';

/**
 * The page's own battle with a wild animal, as the players near it see it
 * ([[PRODUCT]] §4 "Playing together"): what the presence controller tells the
 * server (`battle`), from the authority's own events, through the engine's
 * `wildFight` and `wildFightEvents`: numbers, species and a clean nickname,
 * never words and never an answer. The battle is the browser's (the server
 * decides nothing of it), so this page is the only one that can tell it.
 *
 * - **When.** Only while the page says it is in a battle (`busy`), so the
 *   server, which drops a report from a page that says otherwise, hears
 *   where it is first; and only with the socket on.
 * - **What.** How the battle stands after each step, and the step's events,
 *   which the others play back. What happened while the socket was down is
 *   let go: a moment missed is missed, and the next report says how the
 *   battle stands. When the socket comes back, the battle is told again as
 *   it stands (the new socket's server knows nothing of it).
 * - **The end.** The step that ends it goes out like any other; after it
 *   nothing more is told.
 */
export class BattleReport {
	/** How the battle stands, while there is one to tell; null otherwise. */
	private view: FightView | null = null;
	/** What happened since the last report. */
	private events: FightEvent[] = [];
	/** Whether there is something the server has not heard yet. */
	private unsent = false;
	/** The battle ended: its last report goes out, and then there is nothing to tell. */
	private over = false;

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'battle-started':
				this.view = wildFight(event.state);
				this.events = [];
				this.unsent = true;
				this.over = false;
				return;
			case 'battle-updated': {
				if (!this.view || this.over) return;
				const view = wildFight(event.state);
				const events = wildFightEvents(event.events);
				// A refused intent changes nothing: nothing to tell.
				if (events.length === 0 && JSON.stringify(view) === JSON.stringify(this.view)) return;
				this.view = view;
				this.events = [...this.events, ...events].slice(-MAX_FIGHT_EVENTS);
				this.unsent = true;
				if (events.some((e) => e.type === 'ended')) this.over = true;
				return;
			}
			case 'battle-ended':
				this.over = true;
				return;
			case 'welcome':
			case 'game-left':
			case 'travelled':
				this.reset();
				return;
		}
	}

	/** The socket came back: a battle going on is told again, as it stands. */
	again(): void {
		if (!this.view || this.over) return;
		this.events = [];
		this.unsent = true;
	}

	/**
	 * The report to send now, if there is one: `busy` is what the page tells
	 * the server it is doing, `on` whether the socket is. Null when there is
	 * nothing new, or it can't be told now.
	 */
	take(busy: Busy | null, on: boolean): BattleMessage | null {
		const view = this.view;
		if (!view || !this.unsent) return null;
		if (!on || busy !== 'battle') {
			// Not now: what happened meanwhile is let go, and a battle whose end can no longer be
			// told has nothing left to tell.
			this.events = [];
			if (this.over) this.reset();
			return null;
		}
		const message: BattleMessage = { t: 'battle', view, events: this.events };
		this.events = [];
		this.unsent = false;
		if (this.over) this.reset();
		return message;
	}

	private reset(): void {
		this.view = null;
		this.events = [];
		this.unsent = false;
		this.over = false;
	}
}
