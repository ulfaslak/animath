<script lang="ts">
	import { MAX_NICKNAME_LENGTH, getAnimal, leadIndex, normalizeNickname } from '@mathgame/engine';
	import { flip } from 'svelte/animate';
	import { sfx } from '../audio/sfx.svelte';
	import { LANGUAGES, language, languageName, t } from '../copy';
	import { languageKey, rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { animalWords, nameOf, speciesName } from '../names';
	import { game } from '../state/game.svelte';
	import {
		MENU_ITEMS,
		partyOptions,
		pause,
		type MenuItem,
		type PartyOption
	} from '../state/pause.svelte';
	import HpBar from './HpBar.svelte';
	import Switch from './Switch.svelte';

	/**
	 * The pause menu: the team in battle order on the left, then the menu
	 * items (the settings — Language with every language in its own words,
	 * Sound with its switch — then "Keep playing"); on the right, what can be
	 * done with the picked animal — the options, or the name box. It reads
	 * `game.party`, `pause`, `language` and `sfx.on`; keys are
	 * `PauseController`'s, so nothing here dispatches. The name box binds
	 * `pause.draft` and keeps the focus while it is open, so typing lands in it.
	 * Every word comes from the copy files (`pause.*`, `hud.*`).
	 *
	 * A click or a tap is a key press (`data-press`, `input/taps.ts`, which
	 * draws what the tap did before the tap is over, so the name box can bring
	 * up a tablet's keyboard): a row or an option is its `row:<i>` key, which
	 * does it at once; a language on the Language row is its `language:<code>`
	 * key; the name box's Save and Back are Enter and Escape. With the touch
	 * controls on, the key reminder goes, and while
	 * naming the menu moves to the top of the screen, clear of the tablet's
	 * own keyboard.
	 */
	const lead = $derived(leadIndex(game.party));
	const pickedIndex = $derived(
		pause.picked === null ? -1 : game.party.findIndex((a) => a.id === pause.picked)
	);
	const picked = $derived(pickedIndex >= 0 ? game.party[pickedIndex]! : null);
	const options = $derived(pickedIndex >= 0 ? partyOptions(game.party, pickedIndex) : []);
	/** The team row that is lit: the cursor, or the picked animal while its options are open. */
	const lit = $derived(pause.screen === 'list' ? pause.cursor : pickedIndex);
	/** The cursor is on the Sound row: the right side says what it does, and that M does it too. */
	const soundLit = $derived(MENU_ITEMS[pause.cursor - game.party.length] === 'sound');

	/** What the typed name will turn into, when that is not just what the box shows. */
	const preview = $derived.by(() => {
		if (pause.screen !== 'naming' || !picked) return '';
		const clean = normalizeNickname(pause.draft) ?? speciesName(picked.speciesId);
		return clean === pause.draft.trim().replace(/\s+/g, ' ') ? '' : clean;
	});

	function itemLabel(item: MenuItem): string {
		switch (item) {
			case 'language':
				return t('pause.language');
			case 'resume':
				return t('pause.resume');
			case 'quit':
				return t('pause.quit');
			case 'sound':
				return t('pause.sound');
		}
	}

	function optionLabel(option: PartyOption): string {
		switch (option) {
			case 'first':
				return t('pause.goFirst');
			case 'up':
				return t('pause.moveUp');
			case 'down':
				return t('pause.moveDown');
			case 'name':
				return t('pause.newName');
			case 'back':
				return t('pause.back');
		}
	}

	/** Focus the name box with its text selected (typing replaces it), and keep the focus there. */
	function nameBox(input: HTMLInputElement) {
		input.focus();
		input.select();
		const refocus = () =>
			requestAnimationFrame(() => {
				if (pause.screen === 'naming' && input.isConnected) input.focus();
			});
		input.addEventListener('blur', refocus);
		return () => {
			input.removeEventListener('blur', refocus);
			// A tablet's keyboard may have slid the page up to show the box; put it back.
			window.scrollTo(0, 0);
		};
	}
</script>

<div class="backdrop" class:typing={touch.on && pause.screen === 'naming'}>
	<div class="menu">
		<div class="title">{t('pause.title')}</div>
		<div class="columns">
			<div class="team">
				<div class="heading">{t('pause.team')}</div>
				{#each game.party as animal, i (animal.id)}
					{@const spec = getAnimal(animal.speciesId)}
					{@const name = nameOf(animal)}
					<button
						type="button"
						class="row animal"
						class:lit={lit === i}
						class:picked={pickedIndex === i}
						class:tired={animal.hp === 0}
						animate:flip={{ duration: 180 }}
						data-press={rowKey(i)}
						{@attach unfocusable}
					>
						<span class="slot">{i + 1}</span>
						<span class="who">
							<span class="name">{name}</span>
							{#if name !== speciesName(animal.speciesId)}
								<span class="species">{speciesName(animal.speciesId)}</span>
							{/if}
						</span>
						<span class="bar"><HpBar hp={animal.hp} max={spec.maxHp} /></span>
						<span class="tags">
							{#if animal.hp === 0}
								<span class="tag">{t('party.tired')}</span>
							{:else if i === lead && game.party.length > 1}
								<span class="tag lead">{t('hud.goesFirst')}</span>
							{/if}
						</span>
					</button>
				{/each}
				{#each MENU_ITEMS as item, j (item)}
					{@const row = game.party.length + j}
					<button
						type="button"
						class="row item"
						class:lit={pause.screen === 'list' && lit === row}
						data-press={rowKey(row)}
						{@attach unfocusable}
					>
						{#if item === 'language'}
							<!-- Each language in its own words, so a kid finds theirs in any language;
							     a tap on one is that language, anywhere else on the row the row. -->
							<span class="setting">{itemLabel(item)}</span>
							<span class="choices">
								{#each LANGUAGES as code (code)}
									<span
										class="choice"
										class:on={language.current === code}
										lang={code}
										data-press={languageKey(code)}
									>
										{languageName(code)}
									</span>
								{/each}
							</span>
						{:else if item === 'sound'}
							<!-- A setting: its name, a switch, and the switch's state in words. -->
							<span class="setting">{itemLabel(item)}</span>
							<Switch on={sfx.on} />
							<span class="setting-state">{sfx.on ? t('pause.soundOn') : t('pause.soundOff')}</span>
						{:else}
							<span class="button" class:secondary={item !== 'resume'}>{itemLabel(item)}</span>
						{/if}
					</button>
				{/each}
			</div>

			<div class="side">
				{#if pause.screen === 'options' && picked}
					<div class="side-title">{nameOf(picked)}</div>
					{#each options as option, i (option.id)}
						<button
							type="button"
							class="row option"
							class:lit={pause.option === i}
							class:off={!option.enabled}
							data-press={rowKey(i)}
							{@attach unfocusable}
						>
							<span class="caret">▸</span>{optionLabel(option.id)}
						</button>
					{/each}
					{#if picked.hp === 0}
						<div class="note">{t('pause.tiredHelp', { animal: animalWords(picked) })}</div>
					{/if}
				{:else if pause.screen === 'naming' && picked}
					<div class="side-title wraps">
						{t('pause.nameTitle', { animal: animalWords(picked) })}
					</div>
					<input
						class="name-box"
						type="text"
						bind:value={pause.draft}
						maxlength={MAX_NICKNAME_LENGTH}
						placeholder={speciesName(picked.speciesId)}
						autocomplete="off"
						autocapitalize="words"
						autocorrect="off"
						spellcheck="false"
						enterkeyhint="done"
						aria-label={t('pause.newName')}
						{@attach nameBox}
					/>
					<div class="note">{t('pause.nameRule', { max: MAX_NICKNAME_LENGTH })}</div>
					{#if preview}
						<div class="note preview">{t('pause.willBe', { name: preview })}</div>
					{/if}
					<!-- Enter and Escape, for a finger or a mouse. -->
					<div class="name-buttons">
						<button type="button" class="pill back" data-press="Escape" {@attach unfocusable}>
							{t('pause.back')}
						</button>
						<button type="button" class="pill save" data-press="Enter" {@attach unfocusable}>
							{t('pause.save')}
						</button>
					</div>
				{:else if pause.screen === 'list' && soundLit}
					<div class="side-title">{t('pause.sound')}</div>
					<div class="note">{t('pause.soundHelp')}</div>
				{:else}
					<div class="soft">{t('pause.pick')}</div>
					<div class="note">{t('pause.pickHelp')}</div>
				{/if}
			</div>
		</div>
		<!-- The keys; with the touch controls on, every row is its own button and needs no reminder. -->
		{#if !touch.on}
			<div class="keys">
				{#if pause.screen === 'list' && MENU_ITEMS[pause.cursor - game.party.length] === 'language'}
					{t('pause.keysLanguage')}
				{:else if pause.screen === 'list' && soundLit}
					{t('pause.keysSound')}
				{:else if pause.screen === 'list'}
					{t('pause.keysList')}
				{:else if pause.screen === 'options'}
					{t('pause.keysOptions')}
				{:else}
					{t('pause.keysNaming')}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.3);
	}
	/* Naming on a touch screen: at the top, so the tablet's keyboard, which rises from the bottom, leaves the name box in view. */
	.backdrop.typing {
		align-items: start;
		padding-top: 16px;
	}
	/*
	 * Wide enough, at 1024 px, for a team of twelve-letter names of the widest
	 * letters beside the picked one's name in the side panel.
	 */
	.menu {
		width: min(1000px, calc(100vw - 32px));
		max-height: calc(100vh - 32px);
		box-sizing: border-box;
		overflow: auto;
		/* The one thing a finger may scroll, on a screen too short for it. */
		touch-action: pan-y;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 18px 22px 16px;
	}
	.title {
		font-weight: 800;
		font-size: 32px;
		line-height: 1.1;
		margin-bottom: 12px;
	}
	/*
	 * The team takes what its longest name needs; the side panel has the rest
	 * and never pushes the menu wider than the screen (a name too wide for it
	 * ends in "…" there, never in the list).
	 */
	.columns {
		display: grid;
		grid-template-columns: 3fr minmax(0, 2fr);
		gap: 16px;
		align-items: start;
	}
	.heading {
		font-weight: 800;
		font-size: 18px;
		opacity: 0.7;
		margin: 0 0 6px 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		box-sizing: border-box;
		min-height: var(--tap);
		padding: 0 12px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		.row:not(.lit):not(.off):hover {
			background: rgba(255, 159, 67, 0.1);
		}
	}
	.row.lit {
		background: rgba(255, 159, 67, 0.22);
	}
	.row.picked {
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	.animal.tired .who,
	.animal.tired .bar {
		opacity: 0.55;
		filter: grayscale(1);
	}
	.slot {
		width: 18px;
		text-align: right;
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
	/*
	 * The species beside a nickname, or under it when a long one leaves no
	 * room: two lines fit a row's 48 px at the font's own line height. Never a
	 * tighter one: the name clips its box for the "…", and a tight line cuts
	 * the ring off an Å.
	 */
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 8px;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.species {
		flex: none;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
	}
	.bar {
		width: 150px;
		flex: none;
	}
	.tags {
		width: 104px;
		flex: none;
		display: flex;
		justify-content: flex-end;
	}
	.tag {
		font-size: 16px;
		font-weight: 800;
		padding: 1px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.1);
		white-space: nowrap;
	}
	.tag.lead {
		background: color-mix(in srgb, var(--accent) 40%, white);
	}
	.item {
		margin-top: 6px;
	}
	.setting {
		flex: 1;
	}
	/* The Language row: every language in its own words, the one on screen lit. */
	.choices {
		display: flex;
		gap: 6px;
	}
	.choice {
		display: grid;
		place-items: center;
		height: 32px;
		padding: 0 12px;
		border-radius: 16px;
		background: rgba(0, 0, 0, 0.08);
		font-size: 16px;
	}
	/* Touch: each language a finger's height, so a tap near one lands on it, not on the row. */
	:global(.touch) .choice {
		height: var(--tap);
		min-width: 64px;
		box-sizing: border-box;
		border-radius: 24px;
	}
	.choice.on {
		background: var(--accent);
		color: white;
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 22px;
		border-radius: 20px;
		background: var(--accent);
		color: white;
	}
	/* The name box's Back and Save. */
	.name-buttons {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 12px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 22px;
		border-radius: 24px;
		background: rgba(0, 0, 0, 0.08);
		font-weight: 800;
		font-size: 18px;
	}
	.pill.save {
		background: var(--accent);
		color: white;
	}
	/* The primary action is Keep playing; the others are quieter pills. */
	.button.secondary {
		background: rgba(0, 0, 0, 0.08);
		color: var(--panel-ink);
	}
	.setting-state {
		min-width: 3em;
		text-align: left;
	}
	.side {
		background: rgba(0, 0, 0, 0.04);
		border-radius: 12px;
		padding: 12px 14px 14px;
		min-height: 180px;
		box-sizing: border-box;
	}
	.side-title {
		font-weight: 800;
		font-size: 22px;
		margin: 0 0 8px 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A sentence round a name ("New name for …") breaks between its words. */
	.side-title.wraps {
		white-space: normal;
	}
	.option {
		gap: 6px;
		padding-left: 6px;
	}
	.option.off {
		opacity: 0.35;
	}
	.caret {
		width: 16px;
		visibility: hidden;
		color: var(--accent);
	}
	.option.lit .caret {
		visibility: visible;
	}
	.name-box {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-weight: 800;
		font-size: 28px;
		color: var(--panel-ink);
		padding: 8px 14px;
		border: 3px solid var(--accent);
		border-radius: 12px;
		background: white;
		outline: none;
	}
	.name-box::placeholder {
		color: var(--panel-ink);
		opacity: 0.35;
	}
	.soft {
		font-weight: 800;
		font-size: 24px;
		opacity: 0.45;
		margin: 6px 0 8px 2px;
	}
	.note {
		font-weight: 600;
		font-size: 16px;
		margin: 10px 2px 0;
	}
	.preview {
		font-weight: 800;
	}
	.keys {
		margin-top: 14px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
		text-align: center;
	}
</style>
