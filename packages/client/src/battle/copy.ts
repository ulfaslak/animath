import type { AttackLevel } from '@mathgame/engine';

/**
 * The battle screen's words for attack levels and switching animals, in one
 * place until the game's copy moves into per-language files (English and
 * Danish). The older battle lines still sit next to the code that shows them
 * (`controller.ts`, `BattlePanel.svelte`). Kids read every one of these:
 * short, warm, second person ([[DESIGN]] § Voice and copy).
 */

/** What an attack's levels are called, on its row and on its level buttons. */
export const LEVEL_WORDS: Readonly<Record<AttackLevel, string>> = {
	1: 'easy',
	2: 'medium',
	3: 'hard'
};

export const BATTLE_COPY = {
	/** The key reminder under "Pick an attack". */
	menuKeys: '↑ ↓ choose · ← → how hard · Enter go',
	/** The highlighted attack, e.g. "Scurry Kick on hard: adding or taking away. It hits for 14." */
	attackDetail: (attack: string, level: string, kinds: string, damage: number) =>
		`${attack} on ${level}: ${kinds}. It hits for ${damage}.`,

	switchRow: 'Switch',
	switchDetail: 'Send in a different animal. It uses up your turn.',
	/** The Switch row when the party is one animal. */
	switchAlone: 'You need a second animal to switch. Catch one with the leash!',
	/** The Switch row when everyone else is tired. */
	switchAllTired: 'Your other animals are tired.',

	pickTitle: 'Pick an animal',
	/** The party list's key reminder, and the one after a knock-out (no way back). */
	listKeys: '↑ ↓ choose · Enter go · Esc back',
	mustPickKeys: '↑ ↓ choose · Enter go',
	tiredTag: 'tired',
	inBattleTag: 'in battle',
	/** The highlighted animal in the list. */
	sendIn: (name: string, wild: string) => `Send in ${name}. Then the wild ${wild} has a turn.`,
	sendInFree: (name: string) => `Send in ${name}. Then it's your turn.`,
	tiredDetail: (name: string) => `${name} is tired and needs a rest.`,
	inBattleDetail: (name: string) => `${name} is already in the battle.`,
	/** The narration line when the animal in front is tired and someone must step in. */
	whoIsNext: (tired: string) => `${tired} is tired. Who goes next?`,
	/** The narration beat as the player's animal leaves. */
	comeBack: (name: string) => `Come back, ${name}!`
} as const;
