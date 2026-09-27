import {
	PROTOCOL_VERSION,
	byeCloseCode,
	parseServerMessage,
	spawnPoint,
	worldSeed,
	type MatchMessage,
	type ServerMessage
} from '@mathgame/engine';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PRESENCE_PATH, attachPresence, type PresenceOptions } from '../src/presence/socket.js';

// Friendly matches over a real HTTP server and real WebSockets: every frame a
// page receives is read raw, as the browser's own tools would show it, and
// none may hold a puzzle's answer. The rules are `matches.test.ts`'s.

const running: (() => Promise<void>)[] = [];
afterEach(async () => {
	while (running.length) await running.pop()!();
});

async function start(options: PresenceOptions = {}) {
	const server: Server = createServer((_req, res) => {
		res.writeHead(404);
		res.end();
	});
	const presence = attachPresence(server, { rosterMs: 50, ...options });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	running.push(async () => {
		await presence.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return { presence, url: `ws://127.0.0.1:${port}${PRESENCE_PATH}` };
}

/** A page: every frame it gets, raw and parsed. */
class Page {
	readonly ws: WebSocket;
	readonly frames: string[] = [];
	readonly got: ServerMessage[] = [];
	readonly closed: Promise<number>;
	private readonly opened: Promise<void>;
	private waiters: (() => void)[] = [];

	constructor(url: string) {
		this.ws = new WebSocket(url);
		this.opened = new Promise<void>((resolve, reject) => {
			this.ws.once('open', () => resolve());
			this.ws.once('error', reject);
		});
		this.closed = new Promise((resolve) => this.ws.once('close', (code) => resolve(code)));
		this.ws.on('message', (data) => {
			const text = String(data);
			this.frames.push(text);
			const message = parseServerMessage(JSON.parse(text));
			expect(message, `the server sent ${text}`).not.toBeNull();
			this.got.push(message!);
			for (const wake of this.waiters.splice(0)) wake();
		});
	}

	async open(name: string, guest: string, at: { x: number; y: number }): Promise<string> {
		await this.opened;
		this.send({ t: 'hello', v: PROTOCOL_VERSION, guest, name });
		const hi = await this.next('hi');
		this.send({
			t: 'where',
			world: 1,
			...at,
			facing: 'down',
			lead: 'squirrel',
			boat: false,
			busy: 'explore'
		});
		return hi.pid;
	}

	send(value: unknown): void {
		this.ws.send(JSON.stringify(value));
	}

	/** The first match message whose view has taken at least `step` steps. */
	async step(step: number, ms = 3000): Promise<MatchMessage> {
		const deadline = Date.now() + ms;
		for (;;) {
			const found = this.got.find((m): m is MatchMessage => m.t === 'match' && m.view.step >= step);
			if (found) return found;
			if (Date.now() > deadline)
				throw new Error(`no step ${step}: ${JSON.stringify(this.got.at(-1))}`);
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				setTimeout(resolve, 20);
			});
		}
	}

	async next<T extends ServerMessage['t']>(
		t: T,
		after = 0,
		ms = 3000
	): Promise<Extract<ServerMessage, { t: T }>> {
		const deadline = Date.now() + ms;
		for (;;) {
			const found = this.got
				.slice(after)
				.find((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
			if (found) return found;
			if (Date.now() > deadline)
				throw new Error(`no ${t}: ${JSON.stringify(this.got).slice(-300)}`);
			await new Promise<void>((resolve) => {
				this.waiters.push(resolve);
				setTimeout(resolve, 20);
			});
		}
	}
}

/** Every path to a key named `answer`, and every puzzle holding more than it shows. */
function leaks(value: unknown, path = ''): string[] {
	if (Array.isArray(value)) return value.flatMap((v, i) => leaks(v, `${path}[${i}]`));
	if (value === null || typeof value !== 'object') return [];
	const found: string[] = [];
	for (const [key, v] of Object.entries(value)) {
		if (key === 'answer') found.push(`${path}.answer`);
		if (key === 'puzzle' && v && typeof v === 'object') {
			const keys = Object.keys(v).sort().join(',');
			if (keys !== 'difficulty,kind,prompt') found.push(`${path}.puzzle holds ${keys}`);
		}
		found.push(...leaks(v, `${path}.${key}`));
	}
	return found;
}

const SPAWN = spawnPoint(worldSeed(1));
const TEAM = [
	{ id: 'starter', speciesId: 'squirrel', nickname: 'Nini' },
	{ id: 'r2', speciesId: 'rabbit' }
];

async function twoPages(url: string) {
	const ada = new Page(url);
	const bo = new Page(url);
	const adaPid = await ada.open('Ada', 'a'.repeat(20), SPAWN);
	const boPid = await bo.open('Bo', 'b'.repeat(20), { x: SPAWN.x + 1, y: SPAWN.y });
	return { ada, bo, adaPid, boPid };
}

describe('a friendly match on the wire', () => {
	it('plays a whole match, and no frame either page gets holds an answer, or anything its parser would not read', async () => {
		// Played as fast as the sockets go: far faster than any kid, so past the socket's
		// and the match messages' buckets, which are not what this test is about.
		const { presence, url } = await start({
			ratePerSecond: 1000,
			burst: 1000,
			matches: { ratePerSecond: 1000, burst: 1000 }
		});
		const { ada, bo, adaPid, boPid } = await twoPages(url);
		// Where each page stands reaches the server before the challenge (one socket each, in order).
		await new Promise((resolve) => setTimeout(resolve, 50));
		ada.send({ t: 'challenge', pid: boPid, team: TEAM });
		const invite = await bo.next('invite');
		expect(invite).toMatchObject({ pid: adaPid, name: 'Ada', ms: 20_000 });
		bo.send({ t: 'accept', pid: adaPid, team: TEAM });
		let latest: MatchMessage = await ada.next('match');
		const id = latest.id;
		const pages = { a: ada, b: bo };
		let answered = 0;
		let wrong = 0;
		while (latest.view.phase.kind !== 'ended') {
			const phase = latest.view.phase;
			const page = pages[phase.side];
			if (phase.kind === 'choose-animal') {
				const team = latest.view.teams[phase.side];
				const next = team.findIndex((a, i) => a.hp > 0 && i !== latest.view.active[phase.side]);
				page.send({ t: 'play', id, intent: { type: 'pick-next', teamIndex: next } });
			} else if (phase.kind === 'choose-action') {
				page.send({ t: 'play', id, intent: { type: 'attack', attackIndex: 1, level: 1 } });
			} else {
				// The answer, read from the server's own state: no page could have it.
				const state = presence.matches.stateOf(id)!;
				if (state.phase.kind !== 'solving') throw new Error('no puzzle');
				const right = answered++ % 4 !== 3;
				if (!right) wrong++;
				const input = right
					? String(state.phase.puzzle.answer)
					: String(state.phase.puzzle.answer + 1);
				page.send({ t: 'play', id, intent: { type: 'answer', input } });
			}
			latest = await page.step(latest.view.step + 1);
			if (answered > 200) throw new Error('never ended');
		}
		expect(wrong).toBeGreaterThan(0);
		expect(latest.view.phase).toMatchObject({ kind: 'ended', reason: 'all-tired' });
		for (const page of [ada, bo]) {
			expect(page.frames.length).toBeGreaterThan(10);
			for (const frame of page.frames) {
				const raw = JSON.parse(frame) as unknown;
				expect(leaks(raw), frame.slice(0, 120)).toEqual([]);
				// Exactly what the page's parser reads: nothing on the wire it would drop.
				expect(raw, frame.slice(0, 120)).toEqual(parseServerMessage(raw));
			}
		}
		// The waiting page saw every puzzle, prompt and all.
		const shown = bo.got.flatMap((m) =>
			m.t === 'match' ? m.events.filter((e) => e.type === 'puzzle-shown') : []
		);
		expect(shown.length).toBeGreaterThan(3);
	});

	it('ends every match with no winner when the server stops for a deploy, and each page is told to come back', async () => {
		const { presence, url } = await start();
		const { ada, bo, adaPid, boPid } = await twoPages(url);
		await new Promise((resolve) => setTimeout(resolve, 50));
		ada.send({ t: 'challenge', pid: boPid, team: TEAM });
		await bo.next('invite');
		bo.send({ t: 'accept', pid: adaPid, team: TEAM });
		await ada.next('match');
		expect(presence.matches.size).toBe(1);
		presence.restart();
		expect(presence.matches.size).toBe(0);
		expect(await ada.closed).toBe(byeCloseCode('restart'));
		expect(await bo.closed).toBe(byeCloseCode('restart'));
		expect(ada.got.at(-1)).toEqual({ t: 'bye', reason: 'restart' });
	});

	it('picks a match up for a page whose socket came back in time, and says in its hi which one', async () => {
		const { url } = await start();
		const { ada, bo, adaPid, boPid } = await twoPages(url);
		await new Promise((resolve) => setTimeout(resolve, 50));
		ada.send({ t: 'challenge', pid: boPid, team: TEAM });
		await bo.next('invite');
		bo.send({ t: 'accept', pid: adaPid, team: TEAM });
		const start1 = await ada.next('match');
		expect(ada.got.find((m) => m.t === 'hi')).toMatchObject({ match: null });
		bo.ws.close();
		await bo.closed;
		const away = await ada.next('match', ada.got.indexOf(start1) + 1);
		expect(away.away).toMatchObject({ side: 'b' });
		const back = new Page(url);
		await back.open('Bo', 'b'.repeat(20), { x: SPAWN.x + 1, y: SPAWN.y });
		expect(back.got[0]).toMatchObject({ t: 'hi', match: start1.id });
		const resumed = await back.next('match');
		expect(resumed.id).toBe(start1.id);
		expect(resumed.view.you).toBe('b');
		back.ws.close();
		ada.ws.close();
	});
});
