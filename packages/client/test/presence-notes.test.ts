import { describe, expect, it } from 'vitest';
import {
	ArrivalNotes,
	KNOWN_SECONDS,
	LEAVE_GRACE_SECONDS,
	NOTE_GAP_SECONDS,
	NOTE_SECONDS,
	STALE_SECONDS,
	type Note
} from '../src/presence/notes';

// The notes at the top of the screen when someone comes or goes: news, never
// noise. Driven with a clock of the test's own, in seconds.

/** Every note shown from `from` to `to` seconds, ticking every tenth of a second. */
function run(notes: ArrivalNotes, from: number, to: number, canShow = true): Note[] {
	const shown: Note[] = [];
	for (let t = from; t <= to + 1e-9; t += 0.1) {
		const note = notes.tick(t, canShow);
		if (note && shown.at(-1)?.id !== note.id) shown.push(note);
	}
	return shown;
}

const said = (list: Note[]) => list.map((n) => `${n.kind}:${n.names.join('+')}`);

describe('arrival notes', () => {
	it('say nothing about who is there when the player arrives, then who comes and who goes home', () => {
		const notes = new ArrivalNotes();
		notes.roster(['Ada', 'Bo'], 0);
		expect(run(notes, 0, 5)).toEqual([]);
		notes.roster(['Ada', 'Bo', 'Cy'], 6);
		notes.roster(['Ada', 'Cy'], 7);
		expect(said(run(notes, 6, 30))).toEqual(['arrived:Cy', 'left:Bo']);
	});

	it('wait the grace before someone went home: a reload, a hiccup or a restart is no goodbye', () => {
		const notes = new ArrivalNotes();
		notes.roster(['Ada', 'Bo'], 0);
		notes.roster(['Ada'], 1);
		notes.roster(['Ada', 'Bo'], 1 + LEAVE_GRACE_SECONDS - 1);
		expect(run(notes, 1, 40)).toEqual([]);
	});

	it('say nothing when the socket comes back and the others come back after it, one by one', () => {
		const notes = new ArrivalNotes();
		const everyone = Array.from({ length: 10 }, (_, i) => `Kid${i}`);
		notes.roster(everyone, 0);
		// The server restarts: the socket comes back first, alone in the world...
		notes.reconnected(20);
		notes.roster([], 20);
		// ...and the others come back over the next few seconds, in any order.
		for (let i = 1; i <= 10; i++) notes.roster(everyone.slice(0, i), 20 + i * 0.7);
		expect(run(notes, 20, 60)).toEqual([]);
	});

	it('put everyone who came at once in one note, and never ten notes for ten arrivals', () => {
		const notes = new ArrivalNotes();
		notes.roster([], 0);
		const crowd = Array.from({ length: 10 }, (_, i) => `Kid${i}`);
		for (let i = 1; i <= 10; i++) notes.roster(crowd.slice(0, i), 1 + i * 0.1);
		const shown = run(notes, 1, 30);
		expect(shown.length).toBeLessThanOrEqual(2);
		expect(shown.flatMap((n) => n.names).sort()).toEqual([...crowd].sort());
		// Two at once: both names in one note.
		const two = new ArrivalNotes();
		two.roster([], 0);
		two.roster(['Ada', 'Bo'], 1);
		expect(said(run(two, 1, 10))).toEqual(['arrived:Ada+Bo']);
	});

	it('show one note at a time, for NOTE_SECONDS, with a moment between two', () => {
		const notes = new ArrivalNotes();
		notes.roster([], 0);
		notes.roster(['Ada'], 1);
		expect(notes.tick(1, true)?.names).toEqual(['Ada']);
		notes.roster(['Ada', 'Bo'], 2);
		expect(notes.tick(1 + NOTE_SECONDS - 0.05, true)?.names).toEqual(['Ada']);
		expect(notes.tick(1 + NOTE_SECONDS, true)).toBeNull();
		expect(notes.tick(1 + NOTE_SECONDS + NOTE_GAP_SECONDS / 2, true)).toBeNull();
		expect(notes.tick(1 + NOTE_SECONDS + NOTE_GAP_SECONDS, true)?.names).toEqual(['Bo']);
	});

	it("wait while they can't be shown, and drop what went stale meanwhile", () => {
		const notes = new ArrivalNotes();
		notes.roster([], 0);
		notes.roster(['Ada'], 1);
		// A battle: nothing shows.
		expect(run(notes, 1, 5, false)).toEqual([]);
		expect(said(run(notes, 5.1, 12))).toEqual(['arrived:Ada']);
		// A long battle: the news is old by the end of it.
		notes.roster(['Ada', 'Bo'], 20);
		expect(run(notes, 20, 20 + STALE_SECONDS + 1, false)).toEqual([]);
		expect(run(notes, 20 + STALE_SECONDS + 1, 60)).toEqual([]);
	});

	it('say "is here" again for someone who went home and came back later, not for a blink', () => {
		const notes = new ArrivalNotes();
		notes.roster(['Ada'], 0);
		notes.roster([], 1);
		expect(said(run(notes, 1, 1 + LEAVE_GRACE_SECONDS + 5))).toEqual(['left:Ada']);
		notes.roster(['Ada'], 30);
		expect(said(run(notes, 30, 40))).toEqual(['arrived:Ada']);
		// Seen within KNOWN_SECONDS, gone for a moment by another name's case: no news.
		notes.roster(['ada'], 41);
		expect(run(notes, 41, 50)).toEqual([]);
		expect(KNOWN_SECONDS).toBeGreaterThan(LEAVE_GRACE_SECONDS);
	});

	it('start afresh in another world: its people are no news, and nobody from the last is missed', () => {
		const notes = new ArrivalNotes();
		notes.roster(['Ada'], 0);
		notes.newWorld();
		notes.roster(['Zed', 'Yo'], 1);
		expect(run(notes, 1, 40)).toEqual([]);
	});

	it("say once that another window took this one's place", () => {
		const notes = new ArrivalNotes();
		notes.elsewhere(0);
		expect(said(run(notes, 0, 20))).toEqual(['elsewhere:']);
	});
});
