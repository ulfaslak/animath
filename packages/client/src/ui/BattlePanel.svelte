<script lang="ts">
	import {
		ATTACK_LEVELS,
		attackDamage,
		catchProbability,
		getAnimal,
		puzzleDifficulty,
		puzzleTopics,
		type PuzzleTopic
	} from '@mathgame/engine';
	import { actionAt, attackRows, levelWord, rowOf } from '../battle/menu';
	import { language, t } from '../copy';
	import { messageWords, words } from '../lines';
	import { animalWords, nameOf } from '../names';
	import { battle } from '../state/battle.svelte';
	import HpBar from './HpBar.svelte';
	import PuzzlePanel from './PuzzlePanel.svelte';

	/**
	 * The battle screen's overlay: status boxes over the scene, a narration
	 * line, the two-column bottom panel (actions or the party list | puzzle)
	 * and the result card. Everything it shows comes from `battle` (the
	 * presentation view) and every word from the copy files; keys are handled
	 * by `BattleController`, so nothing here dispatches.
	 */
	const front = $derived(battle.party[battle.front] ?? null);
	const spec = $derived(front ? getAnimal(front.speciesId) : null);
	const opponent = $derived(battle.opponent);
	const opponentSpec = $derived(opponent ? getAnimal(opponent.speciesId) : null);
	/** Each attack with its own level and that level's word. */
	const rows = $derived(spec ? attackRows(spec, battle.levels) : []);
	/** Someone could step in; with nobody, the Switch row is greyed and says why. */
	const canSwitch = $derived(battle.pickable.some(Boolean));

	/** What a kind of puzzle looks like to the kid, in the language on screen. */
	function kindWord(topic: PuzzleTopic): string {
		switch (topic) {
			case 'add':
				return t('battle.kinds.add');
			case 'sub':
				return t('battle.kinds.sub');
			case 'mul':
				return t('battle.kinds.mul');
			case 'div':
				return t('battle.kinds.div');
			case 'missing':
				return t('battle.kinds.missing');
			case 'sequence':
				return t('battle.kinds.sequence');
			case 'sqrt':
				return t('battle.kinds.sqrt');
		}
	}

	/** "adding, taking away, or missing numbers": the language's own "or" list. */
	function kindWords(topics: readonly PuzzleTopic[]): string {
		const list = new Intl.ListFormat(language.current, { type: 'disjunction' });
		return list.format(topics.map(kindWord));
	}

	/** What the highlighted row will do, in words a kid can read. */
	const detail = $derived.by(() => {
		if (!spec) return '';
		const action = actionAt(battle.cursor, spec.attacks.length);
		if (action.kind === 'attack') {
			const row = rows[action.index - 1]!;
			const damage = attackDamage(spec, row.index, row.level, true);
			// What the puzzles at this level can actually be, from the engine: a hard
			// missing number can sit in a times table, and then it says so.
			const difficulty = puzzleDifficulty(spec.tier, row.index, row.level);
			const kinds = kindWords(puzzleTopics(spec.attacks[row.index - 1]!.kinds, difficulty));
			return t('battle.attackDetail', { attack: row.name, level: row.word, kinds, damage });
		}
		if (action.kind === 'leash') return t('battle.leash.detail');
		if (action.kind === 'switch') {
			if (canSwitch) return t('battle.switch.detail');
			return battle.party.length < 2 ? t('battle.switch.alone') : t('battle.switch.allTired');
		}
		return t('battle.run.detail');
	});

	/** What picking the highlighted animal of the party list would do. */
	const partyDetail = $derived.by(() => {
		const animal = battle.party[battle.partyCursor];
		if (!animal || !opponent) return '';
		const params = { animal: animalWords(animal) };
		if (battle.pickable[battle.partyCursor]) {
			return battle.mustPick
				? t('battle.switch.sendInFree', params)
				: t('battle.switch.sendIn', params);
		}
		return animal.hp === 0 ? t('battle.switch.tired', params) : t('battle.switch.inBattle', params);
	});

	/**
	 * The leash row hints at the real odds — the engine's `catchProbability`
	 * for this animal at the HP on screen, with this leash — never as a number
	 * (UI_SPEC): at least one in two is a good chance, at least one in five is
	 * a maybe, anything less is hard. The word says what the colour says.
	 */
	const leashBand = $derived.by(() => {
		if (!opponent || !opponentSpec) return 'bad';
		const hp = opponent.hp / opponentSpec.maxHp;
		const chance = catchProbability(hp, opponentSpec.catchRate, battle.leashQuality);
		return chance >= 0.5 ? 'good' : chance >= 0.2 ? 'warn' : 'bad';
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
	<div class="status opponent">
		<div class="name">{t('battle.wildName', { animal: animalWords(opponent) })}</div>
		<HpBar hp={opponent.hp} max={opponentSpec.maxHp} />
		{#if battle.hit?.side === 'opponent'}
			{#key battle.hit.n}
				<div class="damage">−{battle.hit.damage}</div>
			{/key}
		{/if}
	</div>
{/if}

{#if front && spec}
	<div class="status player">
		<div class="name">{nameOf(front)}</div>
		<!-- A fresh bar per animal: the one that left must not slide into the newcomer's. -->
		{#key front.id}
			<HpBar hp={front.hp} max={spec.maxHp} />
		{/key}
		{#if battle.hit?.side === 'player'}
			{#key battle.hit.n}
				<div class="damage">−{battle.hit.damage}</div>
			{/key}
		{/if}
	</div>
{/if}

{#if battle.line}
	<div class="battle-line">{words(battle.line)}</div>
{/if}

<div class="panel">
	{#if battle.screen === 'party'}
		<div class="card actions party">
			{#key battle.refused}
				{#each battle.party as animal, i (animal.id)}
					{@const selected = battle.partyCursor === i}
					<div
						class="row"
						class:selected
						class:off={!battle.pickable[i]}
						class:nudge={selected && battle.refused > 0}
					>
						<span class="caret">▸</span>
						<span class="label">{nameOf(animal)}</span>
						<span class="hp-cell"
							><HpBar hp={animal.hp} max={getAnimal(animal.speciesId).maxHp} /></span
						>
						<span class="how">
							{#if animal.hp === 0}
								{t('battle.switch.tiredTag')}
							{:else if i === battle.front}
								{t('battle.switch.inBattleTag')}
							{/if}
						</span>
					</div>
				{/each}
			{/key}
		</div>
	{:else}
		<div class="card actions" class:dim={battle.screen !== 'actions'}>
			{#if spec}
				{#each rows as row, i (row.index)}
					<div class="row" class:selected={battle.cursor === i}>
						<span class="caret">▸</span>
						<span class="label">{row.name}</span>
						{#if battle.cursor === i}
							<span class="levels">
								{#each ATTACK_LEVELS as level (level)}
									<span class="pill" class:on={row.level === level}>{levelWord(level)}</span>
								{/each}
							</span>
						{:else}
							<span class="how">{row.word}</span>
						{/if}
					</div>
				{/each}
				<div class="row" class:selected={battle.cursor === spec.attacks.length}>
					<span class="caret">▸</span>
					<span class="label">{t('battle.leash.row')}</span>
					<span class="how">
						{#if leashBand === 'good'}
							{t('battle.leash.good')}
						{:else if leashBand === 'warn'}
							{t('battle.leash.maybe')}
						{:else}
							{t('battle.leash.hard')}
						{/if}
					</span>
					<span class="dot {leashBand}"></span>
				</div>
				<div
					class="row"
					class:selected={battle.cursor === rowOf('switch', spec.attacks.length)}
					class:off={!canSwitch}
				>
					<span class="caret">▸</span>
					<span class="label">{t('battle.switch.row')}</span>
				</div>
				<div class="row" class:selected={battle.cursor === rowOf('run', spec.attacks.length)}>
					<span class="caret">▸</span>
					<span class="label">{t('battle.run.row')}</span>
				</div>
			{/if}
		</div>
	{/if}

	<div class="card puzzle" class:correct={battle.judged?.correct === true}>
		{#if battle.puzzle}
			<PuzzlePanel
				puzzle={battle.puzzle}
				input={battle.input}
				judged={battle.judged}
				typing={battle.screen === 'puzzle'}
			/>
		{:else if battle.screen === 'party'}
			<div class="soft">{t('battle.switch.title')}</div>
			<div class="detail">{partyDetail}</div>
			<div class="keys">
				{battle.mustPick ? t('battle.switch.mustPickKeys') : t('battle.switch.keys')}
			</div>
		{:else}
			<div class="soft">{t('battle.pickAttack')}</div>
			<div class="detail">{detail}</div>
			<div class="keys">{t('battle.menuKeys')}</div>
		{/if}
	</div>
</div>

{#if battle.screen === 'result'}
	<div class="result">
		<div class="card result-card">
			<div class="result-title">{headline}</div>
			{#if battle.closing}
				<div class="result-text">{messageWords(battle.closing)}</div>
			{/if}
			<div class="button">{t('battle.result.button')} <kbd>{t('keys.enter')}</kbd></div>
		</div>
	</div>
{/if}

<style>
	.status {
		position: absolute;
		width: 240px;
		max-width: calc(50vw - 24px);
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 10px 16px 12px;
	}
	.status.opponent {
		top: 16px;
		left: 16px;
	}
	.status.player {
		right: 16px;
		bottom: calc(var(--battle-panel) + 72px);
	}
	.status .name {
		font-weight: 800;
		font-size: 18px;
		margin-bottom: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.damage {
		position: absolute;
		right: 14px;
		top: -6px;
		font-weight: 800;
		font-size: 28px;
		color: var(--bad);
		text-shadow:
			0 2px 0 white,
			0 0 6px white;
		pointer-events: none;
		animation: pop 1.1s ease-out forwards;
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
		padding: 0 16px 16px;
		box-sizing: border-box;
	}
	/* Below the supported sizes, give the attack names the room before the puzzle. */
	@media (max-width: 900px) {
		.panel {
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
	.actions.dim .row {
		opacity: 0.55;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 1 40px;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	.row.selected {
		background: rgba(255, 159, 67, 0.22);
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
	.levels {
		display: flex;
		gap: 4px;
	}
	.pill {
		display: grid;
		place-items: center;
		height: 28px;
		padding: 0 7px;
		border-radius: 14px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 16px;
	}
	.row.selected .pill.on {
		background: var(--accent);
		color: white;
	}
	/* Nobody to switch to, or an animal that can't step in: still readable, clearly out. */
	.row.off > :not(.caret) {
		opacity: 0.45;
	}
	.hp-cell {
		flex: 0 1 150px;
		min-width: 100px;
	}
	.party .how {
		min-width: 4.6em;
		text-align: right;
	}
	.row.nudge {
		animation: nudge 0.35s ease-out;
	}
	.dot {
		width: 16px;
		height: 16px;
		margin: 0 6px;
		border-radius: 8px;
	}
	.dot.good {
		background: var(--good);
	}
	.dot.warn {
		background: var(--warn);
	}
	.dot.bad {
		background: var(--bad);
	}

	.puzzle {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
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
	.result {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.25);
	}
	.result-card {
		padding: 28px 40px 32px;
		max-width: min(calc(100vw - 32px), 520px);
		text-align: center;
	}
	.result-title {
		font-weight: 800;
		font-size: 40px;
		line-height: 1.1;
	}
	.result-text {
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

	@keyframes pop {
		0% {
			opacity: 0;
			transform: translateY(8px) scale(0.8);
		}
		15% {
			opacity: 1;
			transform: translateY(0) scale(1.15);
		}
		70% {
			opacity: 1;
			transform: translateY(-10px) scale(1);
		}
		100% {
			opacity: 0;
			transform: translateY(-22px) scale(1);
		}
	}

	/* Less motion: the damage fades in and out where it is; a refused pick barely nudges. */
	@keyframes pop-still {
		0%,
		100% {
			opacity: 0;
		}
		15%,
		70% {
			opacity: 1;
		}
	}
	@keyframes nudge-small {
		30% {
			transform: translateX(-2px);
		}
		60% {
			transform: translateX(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.damage {
			animation-name: pop-still;
		}
		.row.nudge {
			animation-name: nudge-small;
		}
	}
</style>
