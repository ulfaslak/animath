import type { LandId } from '../lands/ids.js';
import type { PuzzleTopic } from '../puzzles/types.js';

/**
 * The badges ([[PRODUCT]] §4 "Badges"): 282 milestones a kid earns by playing,
 * each named after a piece of biology. A badge is for pride only: it gives
 * nothing and changes nothing in the game. Once earned it is the kid's for
 * good, whatever happens to what earned it.
 *
 * Three kinds of family. A **ladder** reads one number (`BadgeCount`) and
 * gives a badge at each step it reaches. A **collection** is earned once every
 * kind of a group is caught. A **first** marks one moment: some the game's own
 * state proves (an animal of every size on the team), the others the
 * authority catches as they happen (`BadgeMoment`).
 *
 * A badge's id is `<family>.<name>`, the copy files' key under
 * `badges.families` (the engine holds no words: [[DECISIONS]] § Copy and
 * languages). An id is never renamed or taken out once a build has shipped it:
 * a save keeps the ids it has earned, and a build keeps an id it does not have
 * as it is (`readBadges`).
 */

/** The number a ladder reads (`badgeCount`). */
export type BadgeCount =
	/** Puzzles solved in all. */
	| 'solved'
	/** Right answers of one kind of puzzle, from the puzzle record. */
	| `topic:${PuzzleTopic}`
	/** Kinds of puzzle with at least one right answer. */
	| 'kinds'
	/** The fewest right answers of any kind of puzzle there is. */
	| 'every-kind'
	/** Kinds of animal in the book, seen, caught, set free, or told about by the druid. */
	| 'seen'
	| 'caught'
	| 'freed'
	| 'told'
	/** Animals on the team in the land the kid is in. */
	| 'team'
	/** Steps walked and visits to the druid, the game's own counts. */
	| 'steps'
	| 'visits'
	/** Worlds been to, in every land. */
	| 'worlds'
	/** Tools owned, in every land. */
	| 'tools'
	/** The tally (`Tally`): leash throws that caught, wild battles won, friendly matches played, tiles cleared, days played. */
	| 'catches'
	| 'wins'
	| 'matches'
	| 'cleared'
	| 'days';

/**
 * The kinds of animal a collection asks for: every one of a list, at least
 * one of each list, every kind of a size, every sea animal (one that lives in
 * the water alone), or every kind of a land.
 */
export type BadgeGroup =
	| { readonly every: readonly string[] }
	| { readonly oneOfEach: readonly (readonly string[])[] }
	| { readonly tier: number }
	| { readonly realm: 'sea' }
	| { readonly land: LandId };

/** A ladder's step: the number it asks for, or `'all'`, every one there is (every tool of every land). */
export interface LadderBadge {
	readonly id: string;
	readonly at: number | 'all';
}

export type BadgeFamily =
	| {
			readonly id: string;
			readonly kind: 'ladder';
			readonly count: BadgeCount;
			readonly badges: readonly LadderBadge[];
	  }
	| {
			readonly id: string;
			readonly kind: 'collection';
			readonly badges: readonly { readonly id: string; readonly group: BadgeGroup }[];
	  }
	| {
			readonly id: string;
			readonly kind: 'first';
			readonly badges: readonly { readonly id: string }[];
	  };

/**
 * The firsts the authority catches as they happen: nothing in a save proves
 * them afterwards. The other firsts (`imprinting`, `latin-name`, `tundra`,
 * `food-chain`) are read from the game's state like any ladder.
 */
export type BadgeMoment =
	| 'firsts.social-animal'
	| 'firsts.homing-instinct'
	| 'firsts.webbed-feet'
	| 'firsts.hollow-bones'
	| 'firsts.thermal'
	| 'firsts.symbiosis'
	| 'firsts.kingfisher'
	| 'firsts.ant-strength';

export const BADGE_MOMENTS: readonly BadgeMoment[] = [
	'firsts.social-animal',
	'firsts.homing-instinct',
	'firsts.webbed-feet',
	'firsts.hollow-bones',
	'firsts.thermal',
	'firsts.symbiosis',
	'firsts.kingfisher',
	'firsts.ant-strength'
];

/** Every family, in the order the kid's page shows them, each family's badges easiest first. */
export const BADGE_FAMILIES: readonly BadgeFamily[] = [
	{
		id: 'solved',
		kind: 'ladder',
		count: 'solved',
		badges: [
			{ id: 'solved.atom', at: 1 },
			{ id: 'solved.molecule', at: 3 },
			{ id: 'solved.protein', at: 5 },
			{ id: 'solved.gene', at: 10 },
			{ id: 'solved.dna', at: 20 },
			{ id: 'solved.chromosome', at: 30 },
			{ id: 'solved.mitochondria', at: 50 },
			{ id: 'solved.nucleus', at: 75 },
			{ id: 'solved.cell', at: 100 },
			{ id: 'solved.tissue', at: 150 },
			{ id: 'solved.organ', at: 200 },
			{ id: 'solved.organ-system', at: 300 },
			{ id: 'solved.organism', at: 500 },
			{ id: 'solved.population', at: 750 },
			{ id: 'solved.community', at: 1000 },
			{ id: 'solved.ecosystem', at: 1500 },
			{ id: 'solved.biome', at: 2000 },
			{ id: 'solved.biosphere', at: 3000 },
			{ id: 'solved.evolution', at: 5000 },
			{ id: 'solved.tree-of-life', at: 10000 }
		]
	},
	{
		id: 'add',
		kind: 'ladder',
		count: 'topic:add',
		badges: [
			{ id: 'add.cleaner-bee', at: 1 },
			{ id: 'add.nurse-bee', at: 10 },
			{ id: 'add.builder-bee', at: 50 },
			{ id: 'add.guard-bee', at: 100 },
			{ id: 'add.forager', at: 500 },
			{ id: 'add.beehive', at: 1000 }
		]
	},
	{
		id: 'sub',
		kind: 'ladder',
		count: 'topic:sub',
		badges: [
			{ id: 'sub.frogspawn', at: 1 },
			{ id: 'sub.tadpole', at: 10 },
			{ id: 'sub.back-legs', at: 50 },
			{ id: 'sub.front-legs', at: 100 },
			{ id: 'sub.tail-gone', at: 500 },
			{ id: 'sub.frog', at: 1000 }
		]
	},
	{
		id: 'mul',
		kind: 'ladder',
		count: 'topic:mul',
		badges: [
			{ id: 'mul.roe', at: 1 },
			{ id: 'mul.alevin', at: 10 },
			{ id: 'mul.fry', at: 50 },
			{ id: 'mul.parr', at: 100 },
			{ id: 'mul.smolt', at: 500 },
			{ id: 'mul.salmon', at: 1000 }
		]
	},
	{
		id: 'div',
		kind: 'ladder',
		count: 'topic:div',
		badges: [
			{ id: 'div.first-cell', at: 1 },
			{ id: 'div.two-cells', at: 10 },
			{ id: 'div.four-cells', at: 50 },
			{ id: 'div.morula', at: 100 },
			{ id: 'div.blastula', at: 500 },
			{ id: 'div.embryo', at: 1000 }
		]
	},
	{
		id: 'missing',
		kind: 'ladder',
		count: 'topic:missing',
		badges: [
			{ id: 'missing.stick-insect', at: 1 },
			{ id: 'missing.flatfish', at: 10 },
			{ id: 'missing.winter-white', at: 50 },
			{ id: 'missing.mimicry', at: 100 },
			{ id: 'missing.colour-change', at: 500 },
			{ id: 'missing.see-through', at: 1000 }
		]
	},
	{
		id: 'sequence',
		kind: 'ladder',
		count: 'topic:sequence',
		badges: [
			{ id: 'sequence.chirp', at: 1 },
			{ id: 'sequence.call', at: 10 },
			{ id: 'sequence.babble', at: 50 },
			{ id: 'sequence.practice-song', at: 100 },
			{ id: 'sequence.full-song', at: 500 },
			{ id: 'sequence.dawn-chorus', at: 1000 }
		]
	},
	{
		id: 'sqrt',
		kind: 'ladder',
		count: 'topic:sqrt',
		badges: [
			{ id: 'sqrt.acorn', at: 1 },
			{ id: 'sqrt.root', at: 10 },
			{ id: 'sqrt.sprout', at: 50 },
			{ id: 'sqrt.seedling', at: 100 },
			{ id: 'sqrt.sapling', at: 500 },
			{ id: 'sqrt.oak', at: 1000 }
		]
	},
	{
		id: 'double',
		kind: 'ladder',
		count: 'topic:double',
		badges: [
			{ id: 'double.calf', at: 1 },
			{ id: 'double.spiker', at: 10 },
			{ id: 'double.forker', at: 50 },
			{ id: 'double.six-pointer', at: 100 },
			{ id: 'double.eight-pointer', at: 500 },
			{ id: 'double.royal', at: 1000 }
		]
	},
	{
		id: 'half',
		kind: 'ladder',
		count: 'topic:half',
		badges: [
			{ id: 'half.caterpillar', at: 1 },
			{ id: 'half.moult', at: 10 },
			{ id: 'half.chrysalis', at: 50 },
			{ id: 'half.wings', at: 100 },
			{ id: 'half.butterfly', at: 500 },
			{ id: 'half.painted-lady', at: 1000 }
		]
	},
	{
		id: 'numberline',
		kind: 'ladder',
		count: 'topic:numberline',
		badges: [
			{ id: 'numberline.flea', at: 1 },
			{ id: 'numberline.grasshopper', at: 10 },
			{ id: 'numberline.jumping-spider', at: 50 },
			{ id: 'numberline.hare', at: 100 },
			{ id: 'numberline.roe-deer', at: 500 },
			{ id: 'numberline.kangaroo', at: 1000 }
		]
	},
	{
		id: 'thermometer',
		kind: 'ladder',
		count: 'topic:thermometer',
		badges: [
			{ id: 'thermometer.sunbathing', at: 1 },
			{ id: 'thermometer.shivering', at: 10 },
			{ id: 'thermometer.down-feathers', at: 50 },
			{ id: 'thermometer.thick-fur', at: 100 },
			{ id: 'thermometer.blubber', at: 500 },
			{ id: 'thermometer.hibernation', at: 1000 }
		]
	},
	{
		id: 'kroner',
		kind: 'ladder',
		count: 'topic:kroner',
		badges: [
			{ id: 'kroner.hazelnut', at: 1 },
			{ id: 'kroner.hiding-place', at: 10 },
			{ id: 'kroner.stash', at: 50 },
			{ id: 'kroner.larder', at: 100 },
			{ id: 'kroner.winter-store', at: 500 },
			{ id: 'kroner.nutcracker', at: 1000 }
		]
	},
	{
		id: 'fraction',
		kind: 'ladder',
		count: 'topic:fraction',
		badges: [
			{ id: 'fraction.pup', at: 1 },
			{ id: 'fraction.den', at: 10 },
			{ id: 'fraction.howl', at: 50 },
			{ id: 'fraction.tracking', at: 100 },
			{ id: 'fraction.sharing', at: 500 },
			{ id: 'fraction.wolf-pack', at: 1000 }
		]
	},
	{
		id: 'area',
		kind: 'ladder',
		count: 'topic:area',
		badges: [
			{ id: 'area.kit', at: 1 },
			{ id: 'area.lodge', at: 10 },
			{ id: 'area.dam', at: 50 },
			{ id: 'area.pond', at: 100 },
			{ id: 'area.wetland', at: 500 },
			{ id: 'area.ecosystem-engineer', at: 1000 }
		]
	},
	{
		id: 'perimeter',
		kind: 'ladder',
		count: 'topic:perimeter',
		badges: [
			{ id: 'perimeter.bridge-thread', at: 1 },
			{ id: 'perimeter.frame', at: 10 },
			{ id: 'perimeter.spokes', at: 50 },
			{ id: 'perimeter.hub', at: 100 },
			{ id: 'perimeter.sticky-spiral', at: 500 },
			{ id: 'perimeter.orb-web', at: 1000 }
		]
	},
	{
		id: 'barchart',
		kind: 'ladder',
		count: 'topic:barchart',
		badges: [
			{ id: 'barchart.tally-mark', at: 1 },
			{ id: 'barchart.notebook', at: 10 },
			{ id: 'barchart.binoculars', at: 50 },
			{ id: 'barchart.field-guide', at: 100 },
			{ id: 'barchart.census', at: 500 },
			{ id: 'barchart.professor', at: 1000 }
		]
	},
	{
		id: 'balance',
		kind: 'ladder',
		count: 'topic:balance',
		badges: [
			{ id: 'balance.wobbly-legs', at: 1 },
			{ id: 'balance.first-steps', at: 10 },
			{ id: 'balance.inner-ear', at: 50 },
			{ id: 'balance.one-leg', at: 100 },
			{ id: 'balance.balancing-tail', at: 500 },
			{ id: 'balance.ibex', at: 1000 }
		]
	},
	{
		id: 'clock',
		kind: 'ladder',
		count: 'topic:clock',
		badges: [
			{ id: 'clock.rooster', at: 1 },
			{ id: 'clock.day-and-night', at: 10 },
			{ id: 'clock.dusk', at: 50 },
			{ id: 'clock.tide-clock', at: 100 },
			{ id: 'clock.seasons', at: 500 },
			{ id: 'clock.body-clock', at: 1000 }
		]
	},
	{
		id: 'blocks',
		kind: 'ladder',
		count: 'topic:blocks',
		badges: [
			{ id: 'blocks.sand-grain', at: 1 },
			{ id: 'blocks.tunnel', at: 10 },
			{ id: 'blocks.chamber', at: 50 },
			{ id: 'blocks.anthill', at: 100 },
			{ id: 'blocks.ant-colony', at: 500 },
			{ id: 'blocks.supercolony', at: 1000 }
		]
	},
	{
		id: 'units',
		kind: 'ladder',
		count: 'topic:units',
		badges: [
			{ id: 'units.ant', at: 1 },
			{ id: 'units.mouse', at: 10 },
			{ id: 'units.fox', at: 50 },
			{ id: 'units.moose', at: 100 },
			{ id: 'units.orca', at: 500 },
			{ id: 'units.blue-whale', at: 1000 }
		]
	},
	{
		id: 'senses',
		kind: 'ladder',
		count: 'kinds',
		badges: [
			{ id: 'senses.touch', at: 2 },
			{ id: 'senses.taste', at: 4 },
			{ id: 'senses.smell', at: 6 },
			{ id: 'senses.hearing', at: 8 },
			{ id: 'senses.sight', at: 10 },
			{ id: 'senses.whiskers', at: 12 },
			{ id: 'senses.heat-sense', at: 14 },
			{ id: 'senses.echolocation', at: 16 },
			{ id: 'senses.electric-sense', at: 18 },
			{ id: 'senses.magnetic-sense', at: 20 }
		]
	},
	{
		id: 'omnivore',
		kind: 'ladder',
		count: 'every-kind',
		badges: [
			{ id: 'omnivore.omnivore', at: 10 },
			{ id: 'omnivore.generalist', at: 50 },
			{ id: 'omnivore.adaptation', at: 100 }
		]
	},
	{
		id: 'seen',
		kind: 'ladder',
		count: 'seen',
		badges: [
			{ id: 'seen.eyespot', at: 1 },
			{ id: 'seen.cup-eye', at: 5 },
			{ id: 'seen.pinhole-eye', at: 10 },
			{ id: 'seen.lens', at: 20 },
			{ id: 'seen.compound-eye', at: 35 },
			{ id: 'seen.night-vision', at: 50 },
			{ id: 'seen.eagle-eye', at: 75 },
			{ id: 'seen.mantis-shrimp', at: 100 }
		]
	},
	{
		id: 'caught',
		kind: 'ladder',
		count: 'caught',
		badges: [
			{ id: 'caught.species', at: 2 },
			{ id: 'caught.genus', at: 5 },
			{ id: 'caught.family', at: 10 },
			{ id: 'caught.order', at: 20 },
			{ id: 'caught.class', at: 30 },
			{ id: 'caught.phylum', at: 50 },
			{ id: 'caught.kingdom', at: 75 },
			{ id: 'caught.domain', at: 100 }
		]
	},
	{
		id: 'freed',
		kind: 'ladder',
		count: 'freed',
		badges: [
			{ id: 'freed.bug-hotel', at: 1 },
			{ id: 'freed.nest-box', at: 3 },
			{ id: 'freed.hedgehog-house', at: 5 },
			{ id: 'freed.wildflower-meadow', at: 10 },
			{ id: 'freed.wildlife-pond', at: 20 },
			{ id: 'freed.green-corridor', at: 30 },
			{ id: 'freed.nature-reserve', at: 50 },
			{ id: 'freed.rewilding', at: 75 },
			{ id: 'freed.biodiversity', at: 100 }
		]
	},
	{
		id: 'told',
		kind: 'ladder',
		count: 'told',
		badges: [
			{ id: 'told.scent-trail', at: 1 },
			{ id: 'told.alarm-call', at: 5 },
			{ id: 'told.waggle-dance', at: 15 },
			{ id: 'told.whale-song', at: 30 }
		]
	},
	{
		id: 'team',
		kind: 'ladder',
		count: 'team',
		badges: [
			{ id: 'team.pair', at: 2 },
			{ id: 'team.litter', at: 5 },
			{ id: 'team.pack', at: 10 },
			{ id: 'team.herd', at: 20 },
			{ id: 'team.school', at: 40 },
			{ id: 'team.superorganism', at: 60 }
		]
	},
	{
		id: 'catches',
		kind: 'ladder',
		count: 'catches',
		badges: [
			{ id: 'catches.leg-ring', at: 1 },
			{ id: 'catches.ear-tag', at: 5 },
			{ id: 'catches.radio-collar', at: 10 },
			{ id: 'catches.microchip', at: 25 },
			{ id: 'catches.gps-tracker', at: 50 },
			{ id: 'catches.satellite-tag', at: 100 },
			{ id: 'catches.field-station', at: 250 }
		]
	},
	{
		id: 'battles',
		kind: 'ladder',
		count: 'wins',
		badges: [
			{ id: 'battles.reflex', at: 1 },
			{ id: 'battles.heartbeat', at: 10 },
			{ id: 'battles.adrenaline', at: 25 },
			{ id: 'battles.muscle', at: 50 },
			{ id: 'battles.lungs', at: 100 },
			{ id: 'battles.stamina', at: 250 },
			{ id: 'battles.blue-whale-heart', at: 500 }
		]
	},
	{
		id: 'collections',
		kind: 'collection',
		badges: [
			{ id: 'collections.amphibian', group: { every: ['frog', 'common-toad'] } },
			{ id: 'collections.sole-walker', group: { every: ['bear', 'polar-bear'] } },
			{
				id: 'collections.pole-to-pole',
				group: {
					oneOfEach: [
						['polar-bear'],
						['adelie-penguin', 'gentoo-penguin', 'chinstrap', 'king-penguin', 'emperor-penguin']
					]
				}
			},
			{ id: 'collections.antlers', group: { every: ['deer', 'roe-deer', 'moose', 'reindeer'] } },
			{
				id: 'collections.dog-family',
				group: { every: ['fox', 'wolf', 'arctic-fox', 'arctic-wolf'] }
			},
			{
				id: 'collections.parliament-of-owls',
				group: { every: ['tawny-owl', 'eagle-owl', 'snowy-owl', 'great-grey-owl'] }
			},
			{
				id: 'collections.raptor',
				group: { every: ['buzzard', 'golden-eagle', 'white-tailed-eagle', 'gyrfalcon'] }
			},
			{
				id: 'collections.weasel-family',
				group: { every: ['otter', 'badger', 'pine-marten', 'stoat', 'wolverine'] }
			},
			{
				id: 'collections.rodent',
				group: { every: ['squirrel', 'wood-mouse', 'brown-rat', 'beaver', 'arctic-lemming'] }
			},
			{
				id: 'collections.herpetologist',
				group: { every: ['frog', 'common-toad', 'common-lizard', 'adder', 'turtle'] }
			},
			{
				id: 'collections.waddle',
				group: {
					every: [
						'adelie-penguin',
						'gentoo-penguin',
						'chinstrap',
						'king-penguin',
						'emperor-penguin'
					]
				}
			},
			{
				id: 'collections.nocturnal',
				group: {
					every: [
						'hedgehog',
						'badger',
						'tawny-owl',
						'eagle-owl',
						'raccoon',
						'common-toad',
						'pine-marten'
					]
				}
			},
			{
				id: 'collections.salt-gland',
				group: {
					every: [
						'puffin',
						'snow-petrel',
						'glaucous-gull',
						'giant-petrel',
						'albatross',
						'arctic-tern',
						'king-eider'
					]
				}
			},
			{
				id: 'collections.gills',
				group: {
					every: [
						'plaice',
						'polar-cod',
						'arctic-char',
						'lumpsucker',
						'icefish',
						'wolffish',
						'toothfish',
						'greenland-shark'
					]
				}
			},
			{
				id: 'collections.blowhole',
				group: {
					every: [
						'dolphin',
						'harbour-porpoise',
						'whale',
						'orca',
						'beluga',
						'minke-whale',
						'bowhead-whale',
						'narwhal',
						'blue-whale'
					]
				}
			},
			{
				id: 'collections.fin-feet',
				group: {
					every: [
						'harbour-seal',
						'grey-seal',
						'ringed-seal',
						'harp-seal',
						'weddell-seal',
						'hooded-seal',
						'crabeater-seal',
						'elephant-seal',
						'leopard-seal',
						'walrus'
					]
				}
			},
			{
				id: 'collections.no-backbone',
				group: {
					every: [
						'stag-beetle',
						'crab',
						'starfish',
						'octopus',
						'moon-jellyfish',
						'lions-mane-jellyfish',
						'lobster',
						'sea-angel',
						'antarctic-krill',
						'snow-crab'
					]
				}
			},
			{
				id: 'collections.apex-predator',
				group: {
					every: [
						'wolf',
						'lynx',
						'bear',
						'golden-eagle',
						'white-tailed-eagle',
						'orca',
						'polar-bear',
						'arctic-wolf',
						'gyrfalcon',
						'leopard-seal',
						'greenland-shark'
					]
				}
			},
			{ id: 'collections.megafauna', group: { tier: 5 } },
			{
				id: 'collections.ornithologist',
				group: {
					every: [
						'robin',
						'grey-heron',
						'tawny-owl',
						'buzzard',
						'mute-swan',
						'eagle-owl',
						'golden-eagle',
						'white-tailed-eagle',
						'puffin',
						'snow-bunting',
						'rock-ptarmigan',
						'waxwing',
						'adelie-penguin',
						'snow-petrel',
						'arctic-tern',
						'king-eider',
						'raven',
						'barnacle-goose',
						'gentoo-penguin',
						'chinstrap',
						'snowy-owl',
						'great-grey-owl',
						'glaucous-gull',
						'giant-petrel',
						'king-penguin',
						'gyrfalcon',
						'emperor-penguin',
						'albatross'
					]
				}
			},
			{ id: 'collections.marine-biologist', group: { realm: 'sea' } },
			{ id: 'collections.fauna-of-nordland', group: { land: 'nordland' } },
			{ id: 'collections.fauna-of-the-arctic', group: { land: 'arctic' } }
		]
	},
	{
		id: 'steps',
		kind: 'ladder',
		count: 'steps',
		badges: [
			{ id: 'steps.snail', at: 100 },
			{ id: 'steps.hedgehog', at: 500 },
			{ id: 'steps.toad-migration', at: 1000 },
			{ id: 'steps.reindeer', at: 2500 },
			{ id: 'steps.crane', at: 5000 },
			{ id: 'steps.swallow', at: 10000 },
			{ id: 'steps.eel', at: 25000 },
			{ id: 'steps.humpback-whale', at: 50000 },
			{ id: 'steps.godwit', at: 100000 },
			{ id: 'steps.arctic-tern', at: 250000 }
		]
	},
	{
		id: 'visits',
		kind: 'ladder',
		count: 'visits',
		badges: [
			{ id: 'visits.skin', at: 1 },
			{ id: 'visits.scab', at: 5 },
			{ id: 'visits.fever', at: 10 },
			{ id: 'visits.white-blood-cell', at: 25 },
			{ id: 'visits.antibody', at: 50 },
			{ id: 'visits.memory-cell', at: 100 },
			{ id: 'visits.bone-marrow', at: 250 },
			{ id: 'visits.immune-system', at: 500 }
		]
	},
	{
		id: 'worlds',
		kind: 'ladder',
		count: 'worlds',
		badges: [
			{ id: 'worlds.leaving-the-nest', at: 2 },
			{ id: 'worlds.dandelion-seed', at: 3 },
			{ id: 'worlds.scout-bee', at: 5 },
			{ id: 'worlds.pioneer', at: 10 },
			{ id: 'worlds.coconut', at: 25 },
			{ id: 'worlds.spider-balloon', at: 50 },
			{ id: 'worlds.cosmopolitan', at: 100 }
		]
	},
	{
		id: 'tools',
		kind: 'ladder',
		count: 'tools',
		badges: [
			{ id: 'tools.twig', at: 1 },
			{ id: 'tools.stone', at: 3 },
			{ id: 'tools.hook', at: 5 },
			{ id: 'tools.toolmaker', at: 'all' }
		]
	},
	{
		id: 'clearing',
		kind: 'ladder',
		count: 'cleared',
		badges: [
			{ id: 'clearing.woodpecker', at: 1 },
			{ id: 'clearing.bark-beetle', at: 10 },
			{ id: 'clearing.beaver-teeth', at: 50 },
			{ id: 'clearing.forest-gap', at: 200 }
		]
	},
	{
		id: 'matches',
		kind: 'ladder',
		count: 'matches',
		badges: [
			{ id: 'matches.play-bow', at: 1 },
			{ id: 'matches.play-fight', at: 5 },
			{ id: 'matches.tag', at: 10 },
			{ id: 'matches.grooming', at: 25 },
			{ id: 'matches.friendship', at: 50 },
			{ id: 'matches.dolphin-pod', at: 100 }
		]
	},
	{
		id: 'days',
		kind: 'ladder',
		count: 'days',
		badges: [
			{ id: 'days.mayfly', at: 2 },
			{ id: 'days.seven-spot', at: 7 },
			{ id: 'days.hatching', at: 14 },
			{ id: 'days.moon-cycle', at: 30 },
			{ id: 'days.season', at: 100 },
			{ id: 'days.tree-ring', at: 365 }
		]
	},
	{
		id: 'firsts',
		kind: 'first',
		badges: [
			{ id: 'firsts.imprinting' },
			{ id: 'firsts.latin-name' },
			{ id: 'firsts.social-animal' },
			{ id: 'firsts.homing-instinct' },
			{ id: 'firsts.webbed-feet' },
			{ id: 'firsts.hollow-bones' },
			{ id: 'firsts.thermal' },
			{ id: 'firsts.symbiosis' },
			{ id: 'firsts.kingfisher' },
			{ id: 'firsts.tundra' },
			{ id: 'firsts.ant-strength' },
			{ id: 'firsts.food-chain' }
		]
	}
];

/** Every badge's id, in the families' order. */
export const BADGE_IDS: readonly string[] = BADGE_FAMILIES.flatMap((f) =>
	f.badges.map((b) => b.id)
);

const IDS = new Set(BADGE_IDS);

export function isBadgeId(value: unknown): value is string {
	return typeof value === 'string' && IDS.has(value);
}
