import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READY_EVERY_MS, ReadyWatch, relit } from '../src/account/ready';
import { account } from '../src/state/account.svelte';
import { menuItems, type MenuItem } from '../src/state/pause.svelte';

/**
 * The game asks the server whether it can keep an account as the page starts
 * and every half minute while on screen, and the menus' cursors stay on their
 * rows when the account's rows come or go.
 */

describe('ReadyWatch', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	/** A server whose answers the test sets, counting the questions. */
	function watch(onScreen = () => true) {
		const heard: boolean[] = [];
		const server = { ready: false, asked: 0, fails: false };
		const w = new ReadyWatch(
			(ready) => heard.push(ready),
			async () => {
				server.asked++;
				if (server.fails) throw new TypeError('Failed to fetch');
				return server.ready;
			},
			READY_EVERY_MS,
			onScreen,
			() => Date.now()
		);
		return { w, heard, server };
	}

	it('asks as the page starts, then every half minute, and passes each answer on', async () => {
		const { w, heard, server } = watch();
		w.start();
		await vi.advanceTimersByTimeAsync(0);
		expect([server.asked, heard]).toEqual([1, [false]]);
		server.ready = true;
		await vi.advanceTimersByTimeAsync(READY_EVERY_MS - 1);
		expect(server.asked).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect([server.asked, heard]).toEqual([2, [false, true]]);
		// The server stops keeping accounts, then does not answer at all: both are a no.
		server.ready = false;
		await vi.advanceTimersByTimeAsync(READY_EVERY_MS);
		server.fails = true;
		await vi.advanceTimersByTimeAsync(READY_EVERY_MS);
		expect(heard).toEqual([false, true, false, false]);
		w.stop();
		await vi.advanceTimersByTimeAsync(READY_EVERY_MS * 3);
		expect(server.asked).toBe(4);
	});

	it('does not ask while the page is off screen, and asks at once when it comes back', async () => {
		let visible = true;
		const { w, server } = watch(() => visible);
		w.start();
		await vi.advanceTimersByTimeAsync(0);
		visible = false;
		await vi.advanceTimersByTimeAsync(READY_EVERY_MS * 4);
		expect(server.asked).toBe(1);
		visible = true;
		w.shown();
		await vi.advanceTimersByTimeAsync(0);
		expect(server.asked).toBe(2);
		// Back on screen again a moment later: it asked a moment ago.
		w.shown();
		await vi.advanceTimersByTimeAsync(0);
		expect(server.asked).toBe(2);
		w.stop();
	});
});

describe('relit', () => {
	afterEach(() => {
		account.ready = false;
	});

	it("keeps the pause menu's cursor on its row as the account's rows go and come", () => {
		account.ready = true;
		const withRows = menuItems();
		account.ready = false;
		const without = menuItems();
		const moves = (from: readonly MenuItem[], to: readonly MenuItem[]) =>
			Object.fromEntries(from.map((item, i) => [item, to[relit(from, to, i)]]));
		expect(moves(withRows, without)).toEqual({
			worlds: 'worlds',
			players: 'players',
			language: 'language',
			sound: 'sound',
			// A lit row that went: the next one still there, Keep playing.
			makeAccount: 'resume',
			logIn: 'resume',
			resume: 'resume',
			quit: 'quit'
		});
		expect(moves(without, withRows)).toEqual(Object.fromEntries(without.map((i) => [i, i])));
	});

	it('goes to the last row when nothing follows the one that went, and leaves a cursor past the rows alone', () => {
		expect(relit(['a', 'b', 'c'], ['a', 'b'], 2)).toBe(1);
		expect(relit(['a', 'b'], ['b'], 0)).toBe(0);
		expect(relit(['a', 'b'], ['a', 'x', 'b'], 1)).toBe(2);
		expect(relit(['a', 'b'], ['a'], 5)).toBe(5);
		expect(relit(['a'], [], 0)).toBe(0);
	});
});
