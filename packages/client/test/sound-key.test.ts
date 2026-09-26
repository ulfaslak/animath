import { beforeEach, describe, expect, it } from 'vitest';
import { isSoundKey, typingNow } from '../src/input/sound-key';
import { battle } from '../src/state/battle.svelte';
import { doctor } from '../src/state/doctor.svelte';
import { pause } from '../src/state/pause.svelte';

/**
 * M turns the sound off and on over any screen, except while an answer or a
 * name is being typed, where it is a letter (UI_SPEC § Sound and juice).
 */
const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({
	key: k,
	code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : '',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	...mods
});

beforeEach(() => {
	battle.reset();
	doctor.reset();
	pause.reset();
});

describe('the sound key', () => {
	it('is M or Shift+M, never with Ctrl, Cmd or Alt, and no other letter', () => {
		expect(isSoundKey(key('m'))).toBe(true);
		expect(isSoundKey(key('M'))).toBe(true);
		expect(isSoundKey(key('m', { ctrlKey: true }))).toBe(false);
		expect(isSoundKey(key('m', { metaKey: true }))).toBe(false);
		expect(isSoundKey(key('m', { altKey: true }))).toBe(false);
		for (const other of ['n', 'Enter', 'Escape', '1', ' '])
			expect(isSoundKey(key(other))).toBe(false);
	});

	it('is not typing on the menus, the lists, the result card or in explore', () => {
		expect(typingNow(null)).toBe(false);
		battle.active = true;
		for (const screen of ['actions', 'party', 'busy', 'result'] as const) {
			battle.screen = screen;
			expect(typingNow(null), screen).toBe(false);
		}
		battle.reset();
		doctor.active = true;
		for (const screen of ['list', 'busy'] as const) {
			doctor.screen = screen;
			expect(typingNow(null), screen).toBe(false);
		}
		doctor.reset();
		pause.open = true;
		for (const screen of ['list', 'options'] as const) {
			pause.screen = screen;
			expect(typingNow(null), screen).toBe(false);
		}
	});

	it('is typing in a battle puzzle, a doctor puzzle and the name box', () => {
		battle.active = true;
		battle.screen = 'puzzle';
		expect(typingNow(null)).toBe(true);
		battle.reset();
		doctor.active = true;
		doctor.screen = 'puzzle';
		expect(typingNow(null)).toBe(true);
		doctor.reset();
		pause.open = true;
		pause.screen = 'naming';
		expect(typingNow(null)).toBe(true);
	});
});
