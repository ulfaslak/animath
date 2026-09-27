<script lang="ts">
	import {
		ATTACK_LEVELS,
		attackDamage,
		bundles,
		canFightIn,
		catchProbability,
		getAnimal,
		landHit,
		puzzleDifficulty,
		puzzleTopics,
		type AttackLevel,
		type PuzzleTopic
	} from '@mathgame/engine';
	import { actionAt, attackRows, levelWord, rowOf, type FightMove } from '../battle/menu';
	import { t } from '../copy';
	import { rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { kindList } from '../kinds';
	import { messageWords, whose, words } from '../lines';
	import { animalWords, nameOf, speciesName } from '../names';
	import { battle } from '../state/battle.svelte';
	import ActionPreview, { type Preview } from './ActionPreview.svelte';
	import AttackTile from './AttackTile.svelte';
	import Celebration from './Celebration.svelte';
	import HpBar from './HpBar.svelte';
	import MatchNotes from './MatchNotes.svelte';
	import MatchResult from './MatchResult.svelte';
	import MoveButton from './MoveButton.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';
	import StatusBox from './StatusBox.svelte';

	/**
	 * The battle screen's overlay: status boxes over the scene, a narration
	 * line, the two-column bottom panel (the actions or the party list | the
	 * preview card or the puzzle) and the result card. Everything it shows
	 * comes from `battle` (the presentation view), every number from the
	 * engine and every word from the copy files; keys are handled by
	 * `BattleController`, so nothing here dispatches. It composes the battle's
	 * pieces (`StatusBox`, `AttackTile`, `MoveButton`, `ActionPreview`), which
	 * take their data as props, so a friendly match can build its screen from
	 * the same ones (UI_SPEC § Component reuse). A click or a tap is a key
	 * press (`data-press`, `input/taps.ts`): a tile or a move is its `row:<i>`
	 * key and a level button its `level:<n>`, which only highlight and set,
	 * since a pick spends the turn; Go is Enter, which does the highlighted
	 * row; Back is Escape; and the result card, all of it, is Enter. Go and
	 * the result card's button stay dimmed until a pick would count
	 * (`battle.ready`).
	 *
	 * A friendly match is drawn here too (`battle.vs`, filled by
	 * `MatchController`): the other player's animal goes by its owner's name
	 * ("Bo's Rabbit"), the row of moves is Switch and Leave, the other's turn
	 * shows their puzzle without its answer and that they are thinking
	 * (`waiting`), and the result is the match's own (`MatchResult`), with the
	 * match's notes over the screen (`MatchNotes`).
	 */
	/** The other player, in a friendly match. */
	const vs = $derived(battle.vs);
	const front = $derived(battle.party[battle.front] ?? null);
	const spec = $derived(front ? getAnimal(front.speciesId) : null);
	const opponent = $derived(battle.opponent);
	const opponentSpec = $derived(opponent ? getAnimal(opponent.speciesId) : null);
	/** Each attack with its own level, that level's word and what it hits for there (the engine's). */
	const tiles = $derived(
		spec
			? attackRows(spec, battle.levels).map((row) => ({
					...row,
					damage: attackDamage(spec, row.index, row.level, true)
				}))
			: []
	);
	/** Someone could step in; with nobody, Switch is greyed and says why. */
	const canSwitch = $derived(battle.pickable.some(Boolean));
	/** The party list in species groups (the party is in bundles), each row still its party slot. */
	const groups = $derived(bundles(battle.party));

	/** The highlighted animal of a long party list stays in view as the cursor walks it. */
	function showRow(row: HTMLElement) {
		row.scrollIntoView({ block: 'nearest' });
	}
	/** Go on the highlighted row would do nothing: a greyed Switch, or an animal that can't step in. */
	const goIdle = $derived(
		battle.screen === 'party'
			? !battle.pickable[battle.partyCursor]
			: !!spec && battle.cursor === rowOf('switch', spec.attacks.length, battle.moves) && !canSwitch
	);

	/** "adding, taking away, or missing numbers": the language's own "or" list. */
	function kindWords(topics: readonly PuzzleTopic[]): string {
		return kindList(topics, 'disjunction');
	}

	/** What the highlighted row of the action menu does: an attack, the leash, a switch or running. */
	const action = $derived(spec ? actionAt(battle.cursor, spec.attacks.length, battle.moves) : null);
	/** The attack tile the cursor is on, if it is on one. */
	const tile = $derived(action?.kind === 'attack' ? (tiles[action.index - 1] ?? null) : null);
	/** The highlighted row can't be done (a greyed Switch): Enter and Go do nothing there. */
	const greyed = $derived(action?.kind === 'switch' && !canSwitch);

	/** The leash's catch hint: a word and its colour (`leashBand`). */
	const leashHint = $derived.by(() => {
		const words =
			leashBand === 'good'
				? t('battle.leash.good')
				: leashBand === 'warn'
					? t('battle.leash.maybe')
					: t('battle.leash.hard');
		return { band: leashBand, words };
	});

	/**
	 * The HP the highlighted attack at its level would leave the wild animal
	 * with, from the engine's `landHit` on the HP on screen — the very
	 * function the battle lands the hit with, so the preview on its HP bar
	 * can never disagree with the hit. Shown while the menu is up and while
	 * that attack's puzzle waits for its answer.
	 */
	const previewHp = $derived.by(() => {
		if (!spec || !opponent || !tile) return null;
		const choosing = battle.screen === 'actions' || (battle.screen === 'puzzle' && !battle.judged);
		if (!choosing) return null;
		return landHit(spec, tile.index, tile.level, opponent).target.hp;
	});

	/** What the highlighted move does, in words a kid can read: the sentence under its preview. */
	const detail = $derived.by(() => {
		if (!spec || !action || !opponent) return '';
		if (action.kind === 'attack') {
			if (!tile) return '';
			return t(vs ? 'match.attackDetail' : 'battle.attackDetail', {
				attack: tile.name,
				level: tile.word,
				kinds: kindWords(topicsOf(tile.index, tile.level)),
				damage: tile.damage,
				...(vs ? { whose: whose(vs.name) } : {}),
				animal: animalWords(opponent)
			});
		}
		if (action.kind === 'leash') return t('battle.leash.detail', { animal: animalWords(opponent) });
		if (action.kind === 'leave') return t('match.leave.detail', { name: vs?.name ?? '' });
		if (action.kind === 'switch') {
			if (canSwitch) return t('battle.switch.detail');
			if (battle.party.length < 2) return t(vs ? 'match.switch.alone' : 'battle.switch.alone');
			// The others may be standing, only not able to fight here: out on the water
			// they can't swim, and on land they live in the sea.
			const others = battle.party.filter((_, i) => i !== battle.front);
			if (!others.some((a) => a.hp > 0 && !canFightIn(a.speciesId, battle.realm)))
				return t('battle.switch.allTired');
			return battle.realm === 'water'
				? t('battle.switch.noSwimmers')
				: t('battle.switch.noWalkers');
		}
		const run = battle.realm === 'water' ? 'battle.run.detailSea' : 'battle.run.detail';
		return t(run, { animal: animalWords(opponent) });
	});

	/**
	 * What the puzzles of attack `index` can actually be at `level`, from the
	 * engine: a hard missing number can sit in a times table, and then it
	 * says so.
	 */
	function topicsOf(index: number, level: AttackLevel): PuzzleTopic[] {
		if (!spec) return [];
		const difficulty = puzzleDifficulty(spec.tier, index, level);
		return puzzleTopics(spec.attacks[index - 1]!.kinds, difficulty);
	}

	/** A move's word on its button. */
	function moveLabel(move: FightMove): string {
		switch (move) {
			case 'leash':
				return t('battle.leash.row');
			case 'switch':
				return t('battle.switch.row');
			case 'run':
				return t('battle.run.row');
			case 'leave':
				return t('match.leave.row');
		}
	}

	/** A move's title on the preview card: what picking it does. */
	function moveTitle(move: FightMove): string {
		switch (move) {
			case 'leash':
				return t('battle.menu.leash');
			case 'switch':
				return t('battle.menu.switch');
			case 'run':
				return t('battle.menu.run');
			case 'leave':
				return t('match.leave.title');
		}
	}

	/** The preview card for the highlighted row, before anything is picked. */
	const preview = $derived.by((): Preview | null => {
		if (!spec || !action || !opponent) return null;
		if (action.kind !== 'attack') {
			return {
				kind: 'move',
				icon: action.kind,
				title: moveTitle(action.kind),
				line: detail,
				hint: action.kind === 'leash' ? leashHint : undefined,
				off: greyed
			};
		}
		if (!tile) return null;
		return {
			kind: 'attack',
			name: tile.name,
			level: tile.level,
			damage: tile.damage,
			levels: ATTACK_LEVELS.map((level) => ({
				level,
				word: levelWord(level),
				damage: attackDamage(spec, tile.index, level, true)
			})),
			topics: topicsOf(tile.index, tile.level),
			line: detail,
			tires: previewHp === 0 ? t(vs ? 'match.tiresOut' : 'battle.tiresOut') : null
		};
	});

	/** What a right answer to the puzzle on screen wins: its attack's hit, at its level. */
	const reward = $derived(tile ? { damage: tile.damage, level: tile.level } : undefined);

	/**
	 * The key reminder for the highlighted row: left and right change the
	 * level on an attack and go along the row on the other moves, and there
	 * is no Enter where it does nothing. With the touch controls on, a tap
	 * hint instead; on a greyed row, where Go does nothing, the way to an
	 * attack.
	 */
	const rowKeys = $derived.by(() => {
		if (touch.on) {
			return action?.kind === 'attack' || greyed
				? t('battle.menu.touchAttack')
				: t('battle.menu.touch');
		}
		if (action?.kind === 'attack') return t('battle.menu.keysAttack');
		return greyed ? t('battle.menu.keysGreyed') : t('battle.menu.keys');
	});

	/** What picking the highlighted animal of the party list would do. */
	const partyDetail = $derived.by(() => {
		const animal = battle.party[battle.partyCursor];
		if (!animal || !opponent) return '';
		const params = { animal: animalWords(animal) };
		if (battle.pickable[battle.partyCursor]) {
			if (battle.mustPick) return t('battle.switch.sendInFree', params);
			return vs
				? t('match.switch.sendIn', { ...params, whose: whose(vs.name) })
				: t('battle.switch.sendIn', params);
		}
		if (!canFightIn(animal.speciesId, battle.realm)) {
			return battle.realm === 'water'
				? t('battle.switch.cantSwim', params)
				: t('battle.switch.inTheSea', params);
		}
		return animal.hp === 0 ? t('battle.switch.tired', params) : t('battle.switch.inBattle', params);
	});

	/**
	 * The leash hints at the real odds — the engine's `catchProbability` for
	 * this animal at the HP on screen, with this leash — never as a number
	 * (UI_SPEC): at least one in two is a good chance, at least one in five is
	 * a maybe, anything less is hard. The word says what the colour says.
	 */
	const leashBand = $derived.by((): 'good' | 'warn' | 'bad' => {
		if (!opponent || !opponentSpec) return 'bad';
		const hp = opponent.hp / opponentSpec.maxHp;
		const chance = catchProbability(hp, opponentSpec.catchRate, battle.leashQuality);
		return chance >= 0.5 ? 'good' : chance >= 0.2 ? 'warn' : 'bad';
	});

	/** A narration beat split after each ".", "!" or "?" that ends a sentence. */
	function sentences(text: string): string[] {
		return text.split(/(?<=[.!?])\s+/);
	}

	/**
	 * How the result card celebrates: big for an animal that joined the team
	 * (its name in big letters, a burst of rays, stars), small for a win (a
	 * few stars round the headline).
	 */
	const celebration = $derived.by(() => {
		if (battle.outcome === 'caught') return 'big';
		return battle.outcome === 'won' ? 'small' : null;
	});

	const headline = $derived.by(() => {
		switch (battle.outcome) {
			case 'won':
				return t('battle.result.won');
			case 'caught':
				return opponent
					? t('battle.result.caught', { animal: animalWords(opponent) })
					: t('battle.leash.caught');
			case 'lost':
				return t('battle.result.lost');
			case 'fled':
				return t('battle.result.fled');
			default:
				return '';
		}
	});
</script>

{#if opponent && opponentSpec}
	<!-- The leash flies under this box: `WILD_STATUS_BOX` in `render/battle-scene.ts` knows where it is. -->
	<div class="status opponent">
		<StatusBox
			name={vs
				? t('match.animalOf', { whose: whose(vs.name), animal: animalWords(opponent) })
				: t('battle.wildName', { animal: animalWords(opponent) })}
			id={opponent.id}
			hp={opponent.hp}
			max={opponentSpec.maxHp}
			opponent
			keepEnd={!!vs}
			acting={battle.turn === 'opponent'}
			preview={previewHp}
			hit={battle.hit?.side === 'opponent' ? battle.hit : null}
			burst="right"
		/>
	</div>
{/if}

{#if front && spec}
	<div class="status player">
		<StatusBox
			name={vs
				? t('match.animalOf', { whose: whose(vs.me), animal: animalWords(front) })
				: nameOf(front)}
			keepEnd={!!vs}
			id={front.id}
			hp={front.hp}
			max={spec.maxHp}
			acting={battle.turn === 'player'}
			hit={battle.hit?.side === 'player' ? battle.hit : null}
			burst="left"
		/>
	</div>
{/if}

{#if battle.line}
	<!-- Each sentence holds together, so a beat too long for one line breaks between them. -->
	<div class="battle-line">
		{#each sentences(words(battle.line)) as sentence, i (i)}{#if i > 0}{' '}{/if}<span
				class="sentence">{sentence}</span
			>{/each}
	</div>
{/if}

<div class="panel" class:listing={battle.screen === 'party'}>
	{#if battle.screen === 'party'}
		<div class="card actions party">
			{#key battle.refused}
				{#each groups as group (group.speciesId)}
					{#if group.animals.length > 1}
						<!-- Several of one kind: a heading over them, as their card in the HUD reads. -->
						<div class="group">
							{speciesName(group.speciesId)}
							<span class="count">{t('team.count', { count: group.animals.length })}</span>
						</div>
					{/if}
					{#each group.animals as animal, k (animal.id)}
						{@const i = group.slots[k]!}
						{@const selected = battle.partyCursor === i}
						<button
							type="button"
							class="row"
							class:selected
							class:heads={k === 0 && group.animals.length > 1}
							class:off={!battle.pickable[i]}
							class:nudge={selected && battle.refused > 0}
							data-press={rowKey(i)}
							{@attach unfocusable}
							{@attach selected ? showRow : undefined}
						>
							<span class="caret">▸</span>
							<span class="label">{nameOf(animal)}</span>
							<span class="hp-cell"
								><HpBar hp={animal.hp} max={getAnimal(animal.speciesId).maxHp} /></span
							>
							<span class="how">
								{#if !canFightIn(animal.speciesId, battle.realm)}
									{battle.realm === 'water'
										? t('battle.switch.cantSwimTag')
										: t('battle.switch.seaTag')}
								{:else if animal.hp === 0}
									{t('battle.switch.tiredTag')}
								{:else if i === battle.front}
									{t('battle.switch.inBattleTag')}
								{/if}
							</span>
						</button>
					{/each}
				{/each}
			{/key}
		</div>
	{:else}
		<div class="card actions menu" class:dim={battle.screen !== 'actions'}>
			{#if spec}
				<!-- The attacks: the heroes, one chunky tile each. -->
				<div class="attacks">
					{#each tiles as row, i (row.index)}
						<AttackTile
							name={row.name}
							word={row.word}
							level={row.level}
							damage={row.damage}
							press={rowKey(i)}
							selected={battle.cursor === i}
						/>
					{/each}
				</div>
				<!-- The other moves: a row of smaller round buttons under them. -->
				<div class="moves">
					{#each battle.moves as move (move)}
						{@const row = rowOf(move, spec.attacks.length, battle.moves)}
						<MoveButton
							icon={move}
							label={moveLabel(move)}
							press={rowKey(row)}
							selected={battle.cursor === row}
							off={move === 'switch' && !canSwitch}
							hint={move === 'leash' ? leashHint : undefined}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<div class="card puzzle" class:correct={battle.judged?.correct === true}>
		{#if battle.puzzle && vs && battle.turn === 'opponent'}
			<!-- The other player's puzzle, watched while they think: never its answer, nor what they type. -->
			<PuzzlePanel
				puzzle={battle.puzzle}
				input=""
				judged={battle.judged}
				typing={false}
				watch={t('match.thinking', { name: vs.name })}
				back={battle.screen === 'waiting' ? t('match.leave.title') : undefined}
			/>
		{:else if battle.puzzle}
			<PuzzlePanel
				puzzle={battle.puzzle}
				input={battle.input}
				judged={battle.judged}
				typing={battle.screen === 'puzzle'}
				{reward}
			/>
		{:else if vs && battle.screen === 'waiting'}
			<div class="soft">{t('match.theirTurn', { whose: whose(vs.name) })}</div>
			<div class="detail">{t('match.thinking', { name: vs.name })}</div>
			<!-- Leaving is always the kid's to do, their turn or not. -->
			<div class="footer">
				<div class="keys"></div>
				<div class="buttons">
					<button type="button" class="pill-button" data-press="Escape" {@attach unfocusable}>
						{t('match.leave.title')}
						{#if !touch.on}<kbd>{t('keys.esc')}</kbd>{/if}
					</button>
				</div>
			</div>
		{:else if battle.screen === 'party'}
			<div class="soft">{t('battle.switch.title')}</div>
			<div class="detail">{partyDetail}</div>
			<div class="footer">
				<div class="keys">
					{touch.on
						? t('battle.switch.touch')
						: battle.mustPick
							? t('battle.switch.mustPickKeys')
							: t('battle.switch.keys')}
				</div>
				<div class="buttons">
					{#if !battle.mustPick}
						<button type="button" class="pill-button" data-press="Escape" {@attach unfocusable}>
							{t('battle.backButton')}
							{#if !touch.on}<kbd>{t('keys.esc')}</kbd>{/if}
						</button>
					{/if}
					<button
						type="button"
						class="pill-button go"
						class:idle={goIdle || !battle.ready}
						data-press="Enter"
						{@attach unfocusable}
					>
						{t('battle.goButton')}
						{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
					</button>
				</div>
			</div>
		{:else}
			{#if preview}
				<ActionPreview {preview} waiting={battle.screen !== 'actions'} />
			{/if}
			<div class="footer choosing">
				<div class="keys">{rowKeys}</div>
				<div class="buttons">
					<button
						type="button"
						class="pill-button go big"
						class:idle={goIdle || battle.screen !== 'actions' || !battle.ready}
						data-press="Enter"
						{@attach unfocusable}
					>
						{t('battle.goButton')}
						{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

{#if vs}
	<MatchNotes />
{/if}

{#if battle.screen === 'result' && vs}
	<MatchResult />
{:else if battle.screen === 'result'}
	<!-- All of it is the button: a tap anywhere goes on, as Enter does (and waits as Enter waits). -->
	<button type="button" class="result" data-press="Enter" {@attach unfocusable}>
		<span class="card result-card">
			{#if celebration}
				<Celebration kind={celebration} name={opponent ? nameOf(opponent) : ''} />
			{/if}
			<span class="result-title">{headline}</span>
			{#if battle.closing}
				<span class="result-text">{messageWords(battle.closing)}</span>
			{/if}
			<span class="button" class:idle={!battle.ready}>
				{t('battle.result.button')}
				{#if !touch.on}<kbd>{t('keys.enter')}</kbd>{/if}
			</span>
		</span>
	</button>
{/if}

<style>
	/*
	 * Where the status boxes stand, and how wide: wide enough for a
	 * twelve-letter nickname of the widest letters (WWWWWWWWWWWW is 242 px).
	 * The box itself is `StatusBox`.
	 */
	.status {
		position: absolute;
		width: 280px;
		max-width: calc(50vw - 24px);
	}
	/*
	 * The leash's loop flies in under this box, never behind it:
	 * `WILD_STATUS_BOX` in `render/battle-scene.ts` mirrors where it is and how
	 * big (with `.status` above and `StatusBox`'s height). Change both together.
	 */
	.status.opponent {
		top: calc(16px + var(--safe-top));
		left: calc(16px + var(--safe-left));
	}
	.status.player {
		right: calc(16px + var(--safe-right));
		bottom: calc(var(--battle-panel) + 72px);
	}

	.battle-line {
		position: absolute;
		bottom: calc(var(--battle-panel) + 12px);
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: min(calc(100vw - 32px), 640px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 10px 20px;
		font-weight: 800;
		font-size: 18px;
		text-align: center;
		/* A line too long for one (a long nickname) breaks into even halves, not a lone word. */
		text-wrap: balance;
	}
	/* A sentence stays whole on a line when it fits. */
	.sentence {
		display: inline-block;
	}

	.panel {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--battle-panel);
		display: grid;
		grid-template-columns: minmax(300px, 2fr) 3fr;
		gap: 12px;
		padding: 0 calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom))
			calc(16px + var(--safe-left));
		box-sizing: border-box;
	}
	/*
	 * The party list takes the wider side: each row holds a name of up to
	 * twelve letters, an HP bar and a tag, and the card beside it only a
	 * sentence and two buttons.
	 */
	.panel.listing {
		grid-template-columns: 3fr minmax(300px, 2fr);
	}
	/* Below the supported sizes, give the attack names the room before the puzzle. */
	@media (max-width: 900px) {
		.panel,
		.panel.listing {
			grid-template-columns: 1fr 1fr;
		}
	}
	.card {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		box-sizing: border-box;
		min-height: 0;
	}

	.actions {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		padding: 10px 12px;
		overflow: hidden;
	}
	/*
	 * The menu: the attack tiles over the row of other moves. Every tile and
	 * move of a bear (four attacks and three moves) fits the card at
	 * 1024×768 with the touch controls on, each a finger tall.
	 */
	.menu {
		gap: 8px;
	}
	.attacks {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-height: 0;
	}
	:global(.touch) .attacks {
		gap: 6px;
	}
	.moves {
		display: flex;
		justify-content: space-evenly;
		align-items: flex-start;
		gap: 6px;
		padding-top: 8px;
		border-top: 2px dashed rgba(45, 42, 50, 0.12);
	}
	/* A turn playing, or a puzzle up: the menu waits, dimmed, its pick still lit. */
	.actions.dim .attacks,
	.actions.dim .moves {
		opacity: 0.55;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 40px;
		width: 100%;
		box-sizing: border-box;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
	}
	/* Touch: every row a finger tall. */
	:global(.touch) .actions.party {
		gap: 0;
		padding: 6px 12px;
	}
	:global(.touch) .row {
		flex: 0 0 var(--tap);
		min-height: var(--tap);
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.actions:not(.dim) .row:not(.selected):hover {
			background: rgba(255, 159, 67, 0.1);
		}
	}
	.caret {
		width: 16px;
		visibility: hidden;
		color: var(--accent);
	}
	.row.selected .caret {
		visibility: visible;
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.how {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.75;
		white-space: nowrap;
	}
	/* An animal that can't step in: still readable, clearly out. */
	.row.off > :not(.caret) {
		opacity: 0.45;
	}
	.hp-cell {
		flex: 0 1 150px;
		min-width: 100px;
	}
	/*
	 * The party list lines its rows up in shared columns — caret, name, HP bar,
	 * tag — sized by the longest name there, so every name shows whole (up to
	 * twelve letters of the widest, at 1024 px) and the bars start together.
	 * A row is a subgrid of the list; a browser without subgrid lays each row
	 * out on its own, in the same columns. A subgrid's padding counts as a
	 * margin on the items at its edges, so the caret's column is `auto`, to
	 * hold the row's 10 px beside the caret's 16 (a fixed 16 px pushed the
	 * caret into the gap, against the name).
	 */
	.party {
		display: grid;
		grid-template-columns: auto minmax(0, max-content) minmax(100px, 1fr) auto;
		grid-auto-rows: minmax(32px, 40px);
		/* Centred while it fits; a long team starts at the top and scrolls. */
		align-content: safe center;
		gap: 2px 8px;
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		scrollbar-width: thin;
		/* The highlighted row, scrolled into view, stops short of the card's edge. */
		scroll-padding-block: 8px;
	}
	/* The first of a kind's group, scrolled into view from below, brings its heading with it. */
	.party .row.heads {
		scroll-margin-top: 40px;
	}
	/* The heading over several animals of one kind: their name and how many. */
	.party .group {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 10px;
		font-weight: 800;
		font-size: 16px;
		opacity: 0.7;
	}
	.party .count {
		font-size: 15px;
		padding: 0 7px;
		border-radius: 8px;
		background: rgba(45, 42, 50, 0.08);
		font-variant-numeric: tabular-nums;
	}
	:global(.touch) .party {
		grid-auto-rows: var(--tap);
		gap: 0 8px;
	}
	.party .row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: 16px minmax(0, max-content) minmax(100px, 1fr) auto;
		grid-template-columns: subgrid;
		min-height: 0;
	}
	.party .how {
		min-width: 4.6em;
		text-align: right;
	}
	.row.nudge {
		animation: nudge 0.35s ease-out;
	}

	/* Centred while it fits; what could not fit would run off the bottom, never over the top. */
	.puzzle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: safe center;
		gap: 8px;
		padding: 12px 20px;
		text-align: center;
		overflow: hidden;
		transition: background-color 0.3s;
	}
	.puzzle.correct {
		background: color-mix(in srgb, var(--good) 22%, var(--panel-bg));
	}
	.soft {
		font-weight: 800;
		font-size: 32px;
		opacity: 0.45;
	}
	.detail {
		font-weight: 600;
		font-size: 18px;
		max-width: 30em;
	}
	.keys {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
	/*
	 * Go (and Back on the party list), the highlighted row's Enter and the
	 * list's Escape, above the key reminder; with the touch controls on, beside
	 * the reminder at the card's right edge, under the right thumb.
	 */
	.footer {
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 10px;
	}
	/*
	 * Under the preview card, a row: the key reminder, then Go! at the right
	 * edge, where it is at the doctor's and under the right thumb on touch.
	 */
	.footer.choosing,
	:global(.touch) .footer {
		flex-direction: row;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		align-self: stretch;
		gap: 8px 10px;
		text-align: left;
	}
	:global(.touch) .footer {
		margin-top: 6px;
	}
	.footer.choosing .keys,
	:global(.touch) .footer .keys {
		flex: 1 1 12em;
	}
	.footer.choosing .buttons,
	:global(.touch) .buttons {
		margin-left: auto;
	}
	.buttons {
		display: flex;
		flex: none;
		gap: 12px;
	}
	/* A chunky toy button: its darker edge squashes flat when it is pressed. */
	.pill-button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--tap);
		padding: 0 24px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 18px;
		box-shadow: 0 var(--press) 0 var(--edge);
		margin-bottom: var(--press);
	}
	.pill-button kbd {
		background: rgba(0, 0, 0, 0.08);
	}
	.pill-button.go {
		min-width: 120px;
		justify-content: center;
		background: var(--accent);
		color: white;
		box-shadow: 0 var(--press) 0 var(--accent-edge);
	}
	/* The preview card's Go!: big, the thing to press once the move is set. */
	.pill-button.go.big {
		min-width: 150px;
		min-height: 50px;
		font-size: 22px;
		border-radius: 25px;
	}
	.pill-button.go kbd {
		background: rgba(255, 255, 255, 0.3);
	}
	/*
	 * Pressing it now would do nothing (a greyed Switch, a turn playing, the
	 * quiet moment before a new choice takes a pick), as Enter would.
	 */
	.pill-button.idle,
	.button.idle {
		opacity: 0.45;
	}
	.pill-button.go,
	.button {
		transition:
			opacity 0.2s ease-out,
			transform 0.08s ease-out,
			box-shadow 0.08s ease-out;
	}
	.pill-button:active {
		transform: translateY(calc(var(--press) - 1px));
		box-shadow: 0 1px 0 var(--edge);
	}
	.pill-button.go:active {
		box-shadow: 0 1px 0 var(--accent-edge);
	}
	.result {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		width: 100%;
		background: rgba(45, 42, 50, 0.25);
	}
	.result-card {
		display: block;
		padding: 28px 40px 32px;
		max-width: min(calc(100vw - 32px), 520px);
		text-align: center;
	}
	.result-title {
		display: block;
		font-weight: 800;
		font-size: 40px;
		line-height: 1.1;
	}
	.result-text {
		display: block;
		margin-top: 10px;
		font-weight: 600;
		font-size: 18px;
	}
	.button {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin-top: 22px;
		min-height: 48px;
		padding: 0 26px;
		border-radius: 24px;
		background: var(--accent);
		color: white;
		font-weight: 800;
		font-size: 18px;
		box-shadow: 0 var(--press) 0 var(--accent-edge);
	}
	kbd {
		font-family: inherit;
		font-size: 16px;
		padding: 2px 8px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.3);
	}

	@keyframes nudge {
		20% {
			transform: translateX(-6px);
		}
		40% {
			transform: translateX(6px);
		}
		60% {
			transform: translateX(-4px);
		}
		80% {
			transform: translateX(3px);
		}
	}

	/* Less motion: a refused pick barely nudges. */
	@keyframes nudge-small {
		30% {
			transform: translateX(-2px);
		}
		60% {
			transform: translateX(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.row.nudge {
			animation-name: nudge-small;
		}
	}
</style>
