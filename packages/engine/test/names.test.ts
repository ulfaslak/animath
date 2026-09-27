import { describe, expect, it } from 'vitest';
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, checkName, nameKey } from '../src/names.js';
import { Rng, hashInts } from '../src/rng.js';

/**
 * A player's name ([[PRODUCT]] §4 "Starting out"): the one rule the client
 * asks before it sends a name, and every authority and the server ask again.
 */

/** Real names kids have, in Denmark and in English, and names that hold a rude word inside them. */
const MUST_PASS = [
	// Danish, the most given of late
	'William',
	'Noah',
	'Oscar',
	'Lucas',
	'Carl',
	'Victor',
	'Malthe',
	'Alfred',
	'Oliver',
	'Aksel',
	'Emil',
	'Valdemar',
	'Elias',
	'August',
	'Arthur',
	'Frederik',
	'Magnus',
	'Anton',
	'Theo',
	'Otto',
	'Felix',
	'Villads',
	'Viggo',
	'Hugo',
	'Johan',
	'Storm',
	'Konrad',
	'Bertram',
	'Mikkel',
	'Mads',
	'Rasmus',
	'Kasper',
	'Lasse',
	'Asger',
	'Søren',
	'Bjørn',
	'Jørgen',
	'Tobias',
	'Sebastian',
	'Nikolaj',
	'Bo',
	'Ib',
	'Kaj',
	'Åge',
	'Frej',
	'Sigurd',
	'Vitus',
	'Alma',
	'Ida',
	'Clara',
	'Ella',
	'Freja',
	'Sofie',
	'Agnes',
	'Emma',
	'Karla',
	'Olivia',
	'Luna',
	'Nora',
	'Ellen',
	'Josefine',
	'Asta',
	'Aya',
	'Lærke',
	'Vilma',
	'Mathilde',
	'Esther',
	'Frida',
	'Liv',
	'Maja',
	'Signe',
	'Astrid',
	'Karoline',
	'Frederikke',
	'Benedikte',
	'Dicte',
	'Ditte',
	'Pernille',
	'Åse',
	'Sidsel',
	'Ronja',
	'Anne-Marie',
	'Ida Marie',
	'nini',
	'Bun',
	// English
	'Amelia',
	'Isla',
	'Ava',
	'Mia',
	'Charlotte',
	'Grace',
	'Freya',
	'Evie',
	'Poppy',
	'Ivy',
	'Willow',
	'George',
	'Harry',
	'Archie',
	'Henry',
	'Freddie',
	'Jack',
	'Charlie',
	'Alfie',
	'Jacob',
	'Thomas',
	'Teddy',
	'Reggie',
	'Richard',
	'Nick',
	'Nigel',
	'Fanny',
	'Willy',
	'Randy',
	// Names from everywhere, in their own letters
	'Muhammad',
	'Mohammad Ali',
	'Yusuf',
	'Hassan',
	'Zoë',
	'José',
	'Chloé',
	'Björn',
	'Łukasz',
	'Phúc',
	'Nguyễn',
	'Νίκος',
	'Алёша',
	'محمد',
	'אָבִי',
	'अनिल',
	'小明',
	'さくら',
	'민준',
	// A rude word inside, where it belongs (the Scunthorpe problem)
	'Scunthorpe',
	'Penistone',
	'Cassandra',
	'Cassidy',
	'Vassili',
	'Titus',
	'Matilda',
	'Janus',
	'Magnus',
	'Analise',
	'Ana-Lise',
	'Dickens',
	'Hancock',
	'Peacock',
	'Sussex',
	'Essex',
	'Arsène',
	'Yoshito',
	'Shital',
	'Nazira',
	'Pikachu',
	'Spike',
	'Fukuda',
	'Wankel',
	'Pissarro',
	'Cumberbatch',
	'Horeb',
	// A rude word running from one word into the next is no match
	'Adil Doğan',
	'Adil Dogan',
	'Daniel Ortega',
	'Isabel Ortega',
	'Manuel Ortega',
	'Emil Orten',
	'Per Kersten',
	'Jesper Kerr',
	'Ana L',
	// A double letter, or an accent, keeps a name its own
	'Tiit',
	'Pikk',
	'Tít',
	// Digits are fine
	'Emil 2',
	'Ida2019',
	'007'
];

/** Names that hold a rude word, in English or Danish, plainly or dressed up. */
const MUST_FAIL = [
	'Fuck',
	'fuckface',
	'Fu Ck',
	'fu-ck',
	// A rude word of its own spelt out over whole words, too.
	'Co-ck',
	'As-s',
	'Pi-k',
	'FUUUCK',
	'B1tch',
	'Sh1tty',
	'Fück',
	'Shit',
	'sh1t',
	'Shiiit',
	'Big Shit',
	'Cunt',
	'Dick',
	'Dicks',
	'Mr Dick',
	'Cock',
	'Ass',
	'Asshole',
	'Bitch',
	'Bastard',
	'Penis',
	'Pussy',
	'Whore',
	'Slut',
	'Sex',
	'Sexy Bob',
	'Porn',
	'Nazi',
	'Hitler',
	'Nigger',
	'Retard',
	'Boobs',
	'Tits',
	'Wanker',
	'Twat',
	'Piss',
	// Danish
	'Fisse',
	'Kusse',
	'Pik',
	'Pikhoved',
	'Lort',
	'Lortebarn',
	'Røv',
	'Røvhul',
	'Kælling',
	'Luder',
	'Hore',
	'Horeunge',
	'Bøsse',
	'Neger',
	'Perker',
	'Spasser',
	'Tissemand',
	'Kneppe',
	'Fanden',
	'Satan',
	'Idiot'
];

describe('checkName', () => {
	it('lets every real name through, in any alphabet, a rude word inside a longer one included', () => {
		const refused = MUST_PASS.map((name) => [name, checkName(name)] as const).filter(
			([, check]) => !check.ok
		);
		expect(refused).toEqual([]);
		for (const name of MUST_PASS) expect(checkName(name)).toEqual({ ok: true, name });
	});

	it('refuses every rude name, however it is spelt', () => {
		const let_through = MUST_FAIL.filter((name) => checkName(name).ok);
		expect(let_through).toEqual([]);
		for (const name of MUST_FAIL)
			expect(checkName(name), name).toEqual({ ok: false, reason: 'rude' });
	});

	it('trims, makes white space inside one space, and joins an accent typed on its own to its letter', () => {
		expect(checkName('  Nini  ')).toEqual({ ok: true, name: 'Nini' });
		expect(checkName('Ida \t  Marie')).toEqual({ ok: true, name: 'Ida Marie' });
		expect(checkName('Ida\u00a0Marie')).toEqual({ ok: true, name: 'Ida Marie' });
		// "é" typed as e and a combining accent is the one letter é.
		expect(checkName('Jose\u0301')).toEqual({ ok: true, name: 'José' });
	});

	it('says why a name is refused: empty, short, long, the wrong characters', () => {
		for (const raw of ['', '   ', '\n\t', undefined, null, 7, ['Nini'], { name: 'Nini' }]) {
			expect(checkName(raw), JSON.stringify(raw)).toEqual({ ok: false, reason: 'empty' });
		}
		expect(checkName('A')).toEqual({ ok: false, reason: 'short' });
		expect(checkName(' Ø ')).toEqual({ ok: false, reason: 'short' });
		expect(checkName('a'.repeat(MAX_NAME_LENGTH))).toMatchObject({ ok: true });
		expect(checkName('a'.repeat(MAX_NAME_LENGTH + 1))).toEqual({ ok: false, reason: 'long' });
		// Code points, not UTF-16 units: sixteen 4-byte letters are sixteen.
		expect(checkName('𝒜'.repeat(MAX_NAME_LENGTH))).toMatchObject({ ok: true });
		for (const raw of [
			'Pip!',
			"O'Brien",
			'Mr. Pip',
			'Nini 😀',
			'😀😀',
			'-Anne',
			'Anne-',
			'Anne--Marie',
			'Anne - Marie',
			'Ida_Marie',
			'Ida/Marie',
			'a\u200bb',
			'\u3164\u3164',
			// A letter under a tower of marks, and marks that decorate rather than spell.
			'Q\u0301\u0302\u0303\u0304\u0306ui',
			'N\u0332i\u0332n\u0332i\u0332',
			'\u0301\u0301'
		]) {
			expect(checkName(raw), raw).toEqual({ ok: false, reason: 'chars' });
		}
	});

	it(`is ${MIN_NAME_LENGTH} to ${MAX_NAME_LENGTH} letters or digits in words, and a name it keeps passes again as it is`, () => {
		const letters = [
			...'abcdefghijklmnopqrstuvwxyzæøåABCÆØÅ0123456789éüñßöäŁ小민ا',
			' ',
			'-',
			'!',
			'😀'
		];
		let kept = 0;
		for (let s = 0; s < 3000; s++) {
			const rng = new Rng(hashInts(31, s));
			const raw = Array.from({ length: rng.int(0, 20) }, () => rng.pick(letters)).join('');
			const check = checkName(raw);
			if (!check.ok) continue;
			kept++;
			const { name } = check;
			expect(checkName(name), raw).toEqual({ ok: true, name });
			const length = Array.from(name).length;
			expect(length).toBeGreaterThanOrEqual(MIN_NAME_LENGTH);
			expect(length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
			expect(name).toMatch(/^[\p{L}\p{Nd}]+(?:[ -][\p{L}\p{Nd}]+)*$/u);
		}
		expect(kept).toBeGreaterThan(300);
		// About 0.3 s alone (3,000 names, each one kept checked again); 2.3 s at a load average
		// of 40.
	}, 30_000);
});

describe('nameKey', () => {
	it('is the same for a name in any case, or in another form of the same letters', () => {
		for (const [a, b] of [
			['Nini', 'nini'],
			['Nini', 'NINI'],
			['Søren', 'SØREN'],
			['Ｎｉｎｉ', 'Nini'],
			['Strauß', 'STRAUSS'],
			['  Ida  Marie ', 'ida marie'],
			['José', 'Jose\u0301']
		]) {
			expect(nameKey(a), `${a} / ${b}`).toBe(nameKey(b));
		}
	});

	it('tells different names apart', () => {
		for (const [a, b] of [
			['Nini', 'Nina'],
			['Ida Marie', 'Ida-Marie'],
			['Ida Marie', 'IdaMarie'],
			['Søren', 'Soren'],
			['Emil', 'Emil2']
		]) {
			expect(nameKey(a), `${a} / ${b}`).not.toBe(nameKey(b));
		}
	});
});
