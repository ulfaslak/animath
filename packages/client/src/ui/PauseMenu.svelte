<script lang="ts">
	import {
		MAX_NICKNAME_LENGTH,
		bookOrder,
		bundles,
		canFightIn,
		getAnimal,
		leadIndex,
		normalizeNickname,
		parseWorldNumber
	} from '@mathgame/engine';
	import { flip } from 'svelte/animate';
	import { sfx } from '../audio/sfx.svelte';
	import { LANGUAGES, language, languageName, t } from '../copy';
	import { stackSummary } from '../hp';
	import { landKey, languageKey, optionKey, rowKey, unfocusable } from '../input/press';
	import { touch } from '../input/touch.svelte';
	import { motion } from '../motion';
	import { animalWords, nameOf, speciesName } from '../names';
	import { account } from '../state/account.svelte';
	import { book, bookLands } from '../state/book.svelte';
	import { game } from '../state/game.svelte';
	import { presence } from '../state/presence.svelte';
	import {
		menuItems,
		lineOf,
		cardRows,
		partyOptions,
		pause,
		whyCardNotFirst,
		whyNoGo,
		whyNotFirst,
		worldRows,
		type BundleOption,
		type MenuItem,
		type PartyOption,
		type WorldOption
	} from '../state/pause.svelte';
	import BookIcon from './BookIcon.svelte';
	import PuzzlesIcon from './PuzzlesIcon.svelte';
	import PuzzleStats, { statRows } from './PuzzleStats.svelte';
	import FreeStamp from './FreeStamp.svelte';
	import BundleAnimals from './BundleAnimals.svelte';
	import HpBar from './HpBar.svelte';
	import NumberPad from './NumberPad.svelte';
	import Switch from './Switch.svelte';
	import Tick from './Tick.svelte';

	/**
	 * The pause menu: the team's cards in battle order on the left (one per
	 * species; a card of several animals shows how many, and how many can
	 * play), then the menu items (Worlds, the settings — Language with every
	 * language in its own words, Sound with its switch — then "Keep playing"
	 * and "Start screen" side by side); on the
	 * right, what can be done with the picked card or animal — a card's
	 * options and its animals, an animal's options, or the name box. The
	 * Worlds row (the world the kid is in beside it) opens the Worlds screen in
	 * the menu's place: where the kid is and their home, the number being
	 * typed, Go, Go home and Back, and a big number pad. It reads
	 * `game.party`, `game.world`, `game.home`, `pause`, `language` and
	 * `sfx.on`; keys are `PauseController`'s, so nothing here dispatches. The name box binds
	 * `pause.draft` and keeps the focus while it is open, so typing lands in it.
	 * Every word comes from the copy files (`pause.*`, `hud.*`, `team.*`).
	 *
	 * A click or a tap is a key press (`data-press`, `input/taps.ts`, which
	 * draws what the tap did before the tap is over, so the name box can bring
	 * up a tablet's keyboard): a row on the left is its `row:<i>` key and a row
	 * on the right (an option, or an animal of the open card) its `option:<i>`
	 * key, each done at once (the rows on the left stay live beside the right
	 * side, so the two lists never share a key); a language on the Language
	 * row is its `language:<code>` key; the name box's Save and Back are Enter
	 * and Escape. With the touch controls on, the key reminder goes, and while
	 * naming the menu moves to the top of the screen, clear of the tablet's
	 * own keyboard.
	 *
	 * The animal book's row stands on the menu's title line, beside "Paused",
	 * so the menu keeps its height; it opens the book in the menu's place: a
	 * card for every species of a land in the book's order (`bookOrder`), a
	 * page per land with a tab for each over the cards (`bookLands`), in a grid
	 * that scrolls — a "?" for one never seen, the figure's picture and name
	 * for one seen, and a green tick on its corner for one caught — the
	 * count beside the title, and under the grid what the lit card says. A
	 * card is its `option:<i>` key. The grid says how many cards it lays to a
	 * row (`book.columns`), which the keys walk by; the pictures are
	 * `book.portraits`, drawn as the book asks (`main.ts`).
	 */
	const cards = $derived(bundles(game.party));
	const leadId = $derived(game.party[leadIndex(game.party, game.realm)]?.id ?? null);
	const pickedIndex = $derived(
		pause.picked === null ? -1 : game.party.findIndex((a) => a.id === pause.picked)
	);
	const picked = $derived(pickedIndex >= 0 ? game.party[pickedIndex]! : null);
	const options = $derived(
		pickedIndex >= 0 ? partyOptions(game.party, pickedIndex, game.realm) : []
	);
	/** Why the picked animal's "Go first" is greyed, said under its options; null when it isn't. */
	const pickedNotFirst = $derived(
		pickedIndex >= 0 ? whyNotFirst(game.party, pickedIndex, game.realm) : null
	);
	/** The card open on the right, when it holds several animals. */
	const card = $derived(
		pause.screen === 'bundle' ? (cards.find((c) => c.speciesId === pause.species) ?? null) : null
	);
	const rows = $derived(card ? cardRows(game.party, card.speciesId, game.realm) : []);
	/** How many of the card's rows are options, before its animals. */
	const cardOptions = $derived(rows.filter((r) => r.kind === 'option').length);
	/** Why the open card's "Go first" is greyed; null when it isn't. */
	const cardNotFirst = $derived(
		card ? whyCardNotFirst(game.party, card.speciesId, game.realm) : null
	);
	/** The animal whose row the cursor is on, on a card's screen. */
	const litAnimal = $derived.by(() => {
		const row = rows[pause.option];
		return row?.kind === 'animal' ? row.animal.id : null;
	});
	/** The menu's rows under the team, as they are now (the account's follow who is playing). */
	const items = $derived(menuItems());
	/** The card that is lit on the left: the cursor, or the card whose options or animals are open. */
	const lit = $derived.by(() => {
		if (pause.screen === 'list') return pause.cursor;
		const species = pause.species ?? picked?.speciesId;
		return cards.findIndex((c) => c.speciesId === species);
	});
	/** The cursor is on the Sound row: the right side says what it does (and with a keyboard, that M does it too). */
	const soundLit = $derived(items[pause.cursor - cards.length] === 'sound');
	/** The cursor is on the animal book's row: the right side says what the book is. */
	const bookLit = $derived(items[pause.cursor - cards.length] === 'book');
	/** The cursor is on "My puzzles"' row: the right side says what the page is. */
	const puzzlesLit = $derived(items[pause.cursor - cards.length] === 'puzzles');
	/** "My puzzles"' rows: every topic, the most tried first (`statRows`). */
	const stats = $derived(statRows(game.puzzles));

	/** The animal book: what the kid has seen, caught and set free, and the kinds on their team now. */
	const seen = $derived(new Set(game.seen));
	const caught = $derived(new Set(game.caught));
	const freed = $derived(new Set(game.freed));
	const onTeam = $derived(new Set(game.party.map((a) => a.speciesId)));
	/** The lands with a page, a tab each when there are two or more (#191). */
	const pages = $derived(bookLands(game.land, game.unlocked));
	/** The page open in the book: its land's kinds. The row on the list counts the land the kid is in. */
	const page = $derived(bookOrder(pause.screen === 'book' ? book.land : game.land));
	/** How many kinds of `page` are in `kinds`. */
	const ofPage = (kinds: ReadonlySet<string>) => page.filter((a) => kinds.has(a.id)).length;
	/** The book's count: kinds caught, kinds seen, every kind there is, in the land of the page. */
	const bookCount = $derived(
		t('book.count', { caught: ofPage(caught), seen: ofPage(seen), all: page.length })
	);
	/** The kinds set free, of every kind there is in the land of the page: the way to the next land. */
	const freedCount = $derived(t('book.freed', { freed: ofPage(freed), all: page.length }));
	/** What the lit card says, under the book; on the land tabs, what the tabs are. */
	const bookCaption = $derived.by(() => {
		if (pause.screen !== 'book') return '';
		if (book.tabs) return t('book.lands');
		const spec = page[Math.min(pause.option, page.length - 1)];
		if (!spec) return '';
		const animal = animalWords({ speciesId: spec.id });
		if (caught.has(spec.id)) {
			if (!onTeam.has(spec.id)) return t('book.caughtHome', { animal });
			return freed.has(spec.id)
				? t('book.freedTeam', { animal })
				: t('book.caughtTeam', { animal });
		}
		if (freed.has(spec.id)) return t('book.seenFree', { animal });
		return seen.has(spec.id) ? t('book.seen', { animal }) : t('book.unseen');
	});

	/**
	 * The book's grid: how many cards it lays to a row, told to `book.columns`
	 * as the screen's width changes it, so up and down go a row.
	 */
	function bookGrid(grid: HTMLElement) {
		const measure = () => {
			const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
			if (columns > 0 && columns !== book.columns) book.columns = columns;
		};
		const watch = new ResizeObserver(measure);
		watch.observe(grid);
		measure();
		return () => watch.disconnect();
	}

	/**
	 * The cards' order before its latest change and after it, noted before the
	 * list is redrawn (`$effect.pre`), for `slide`, which runs once it has been.
	 */
	let orderBefore: string[] = [];
	let orderNow: string[] = [];
	$effect.pre(() => {
		const order = cards.map((c) => c.speciesId);
		orderBefore = orderNow;
		orderNow = order;
	});

	/** How long a card's slide takes. */
	const SLIDE_MS = 180;
	/** When each card's slide ends, so one cut short by the next move carries on to its place. */
	const slidingUntil = new Map<string, number>();

	/**
	 * The short slide of a card that changes place in the team (Move up,
	 * Move down, Go first), or is still on its way from the last change. A row
	 * whose card kept its place moves with the menu at once: on a tablet,
	 * Save puts the menu back in the middle in the frame the new name arrives,
	 * and a row sliding down behind it took a tap meant for the animal it
	 * passed (#52).
	 */
	function slide(node: Element, rects: { from: DOMRect; to: DOMRect }, id: string) {
		const now = performance.now();
		const moved = orderBefore.indexOf(id) !== orderNow.indexOf(id);
		const going = moved || now < (slidingUntil.get(id) ?? 0);
		const duration = motion.reduced || !going ? 0 : SLIDE_MS;
		if (duration > 0) slidingUntil.set(id, now + duration);
		return flip(node, rects, { duration });
	}

	/** What the typed name will turn into, when that is not just what the box shows. */
	const preview = $derived.by(() => {
		if (pause.screen !== 'naming' || !picked) return '';
		const clean = normalizeNickname(pause.draft) ?? speciesName(picked.speciesId);
		return clean === pause.draft.trim().replace(/\s+/g, ' ') ? '' : clean;
	});

	/**
	 * The menu's rows as they are drawn: one to a line, or two side by side
	 * (`MENU_LINES`, of the rows shown: `PauseController` steps between them).
	 */
	type MenuLine = MenuItem | readonly MenuItem[];
	const menuLines = $derived(
		// "My puzzles" and the animal book's rows stand on the title line, not under the team.
		items.flatMap((item): MenuLine[] => {
			if (item === 'book' || item === 'puzzles') return [];
			const line = lineOf(item, items);
			if (line.length < 2) return [item];
			return line[0] === item ? [line] : [];
		})
	);

	/** The Worlds screen's rows, and why Go is greyed when it is. */
	const worldOptions = $derived(worldRows(pause.worldDraft, game.world, game.home));
	const noGo = $derived(whyNoGo(pause.worldDraft, game.world));
	const typedWorld = $derived(parseWorldNumber(pause.worldDraft));

	function worldLabel(option: WorldOption): string {
		switch (option) {
			case 'go':
				return typedWorld === null ? t('worlds.goNowhere') : t('worlds.go', { world: typedWorld });
			case 'home':
				return t('worlds.goHome');
			case 'back':
				return t('pause.back');
		}
	}

	function itemLabel(item: MenuItem): string {
		switch (item) {
			case 'players':
				return t('pause.players');
			case 'worlds':
				return t('worlds.title');
			case 'language':
				return t('pause.language');
			case 'resume':
				return t('pause.resume');
			case 'quit':
				return t('pause.quit');
			case 'sound':
				return t('pause.sound');
			case 'makeAccount':
				return t('pause.makeAccount');
			case 'logIn':
				return t('pause.logIn');
			case 'logOut':
				return account.leaving ? t('account.busy') : t('pause.logOut');
			case 'puzzles':
				return t('puzzles.title');
			case 'book':
				return t('book.title');
		}
	}

	function optionLabel(option: PartyOption | BundleOption): string {
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

	/** The lit animal of a long card stays in view as the cursor walks it. */
	function showRow(row: HTMLElement) {
		row.scrollIntoView({ block: 'nearest' });
	}

	/** The player lit in Who's here: the cursor, kept on the list as it shrinks. */
	const litPlayer = $derived(Math.min(pause.option, presence.roster.length - 1));

	/** How far away a player is, in words: exactly for a few steps, roughly further. */
	function away(steps: number): string {
		if (steps === 0) return t('pause.rightHere');
		return steps <= 20
			? t('pause.stepsAway', { count: steps })
			: t('pause.aboutStepsAway', { count: steps });
	}

	/** Instead of the list, when the others can't be listed: why. */
	const unlisted = $derived.by(() => {
		switch (presence.status) {
			case 'on':
				return presence.roster.length === 0 ? t('pause.nobody') : null;
			case 'connecting':
			case 'waiting':
				// Back in a moment (a deploy, a hiccup): the list stays while the others are held.
				return presence.roster.length === 0 ? t('pause.looking') : null;
			case 'elsewhere':
				return t('pause.elsewhere');
			case 'outdated':
				return t('pause.newVersion');
			default:
				return t('pause.unseen');
		}
	});
</script>

<!-- A row of the menu under the team: a setting, Worlds, Who's here, or a button. -->
{#snippet menuRow(item: MenuItem)}
	{@const row = cards.length + items.indexOf(item)}
	<button
		type="button"
		class="row item"
		class:lit={(pause.screen === 'list' && lit === row) ||
			(pause.screen === 'players' && item === 'players')}
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
		{:else if item === 'players'}
			<!-- Who else is in this world: how many, when anyone is. -->
			<span class="setting">{itemLabel(item)}</span>
			{#if unlisted === null}
				<span class="count-badge">{presence.roster.length}</span>
			{/if}
		{:else if item === 'worlds'}
			<!-- The world the kid is in, beside the row: the number to tell a friend. -->
			<span class="setting">{itemLabel(item)}</span>
			<span class="setting-value">{t('worlds.world', { world: game.world })}</span>
		{:else if item === 'sound'}
			<!-- A setting: its name, a switch, and the switch's state in words. -->
			<span class="setting">{itemLabel(item)}</span>
			<Switch on={sfx.on} />
			<span class="setting-state">{sfx.on ? t('pause.soundOn') : t('pause.soundOff')}</span>
		{:else if item === 'puzzles'}
			<!-- "My puzzles": its picture, its name, and how many puzzles are solved, as the HUD counts. -->
			<PuzzlesIcon />
			<span class="setting">{itemLabel(item)}</span>
			<span class="setting-value">{game.solved}</span>
		{:else if item === 'book'}
			<!-- The animal book: its picture, its name, and how many kinds are caught of all there are. -->
			<BookIcon />
			<span class="setting">{itemLabel(item)}</span>
			<span class="setting-value"
				>{t('book.row', { caught: ofPage(caught), all: page.length })}</span
			>
		{:else}
			<span class="button" class:secondary={item !== 'resume'}>{itemLabel(item)}</span>
		{/if}
	</button>
{/snippet}

<div class="backdrop" class:typing={touch.on && pause.screen === 'naming'}>
	<div class="menu" class:book-open={pause.screen === 'book' || pause.screen === 'puzzles'}>
		<div class="title-line">
			<div class="title">
				{pause.screen === 'worlds'
					? t('worlds.title')
					: pause.screen === 'book'
						? t('book.title')
						: pause.screen === 'puzzles'
							? t('puzzles.title')
							: t('pause.title')}
			</div>
			{#if pause.screen === 'book'}
				<!-- The counts, side by side or one over the other where there is no room, and Back
				     (Escape), for a finger or a mouse. -->
				<span class="book-counts">
					<span class="book-count">{bookCount}</span>
					<span class="book-freed"><FreeStamp size={22} />{freedCount}</span>
				</span>
				<button type="button" class="pill back" data-press="Escape" {@attach unfocusable}>
					{t('pause.back')}
				</button>
			{:else if pause.screen === 'puzzles'}
				<!-- How many solved in all, as the HUD counts them, and Back (Escape). -->
				<span class="book-counts">
					<span class="book-count">{t('puzzles.solved', { count: game.solved })}</span>
				</span>
				<button type="button" class="pill back" data-press="Escape" {@attach unfocusable}>
					{t('pause.back')}
				</button>
			{:else if pause.screen !== 'worlds'}
				{#if items.includes('puzzles')}{@render menuRow('puzzles')}{/if}
				{#if items.includes('book')}{@render menuRow('book')}{/if}
			{/if}
		</div>
		{#if pause.screen === 'worlds'}
			<!-- The Worlds screen, in the menu's place: where the kid is, the number, the rows; the pad. -->
			<div class="worlds">
				<div class="world-side">
					<div class="here">{t('worlds.here', { world: game.world })}</div>
					<div class="note home-line">
						{game.world === game.home ? t('worlds.atHome') : t('worlds.home', { home: game.home })}
					</div>
					<div class="dial">
						<span class="dial-label">{t('worlds.typed')}</span>
						<span class="dial-number" class:empty={pause.worldDraft === ''}
							>{pause.worldDraft === '' ? '····' : pause.worldDraft}</span
						>
					</div>
					{#each worldOptions as option, i (option.id)}
						<button
							type="button"
							class="row option"
							class:lit={pause.option === i}
							class:off={!option.enabled}
							data-press={optionKey(i)}
							{@attach unfocusable}
						>
							<span class="caret">▸</span>{worldLabel(option.id)}
						</button>
					{/each}
					<!-- Why Go is greyed, when it is; else what a number is. -->
					<div class="note">
						{noGo === 'notAWorld'
							? t('worlds.notAWorld')
							: noGo === 'here'
								? t('worlds.alreadyHere', { world: game.world })
								: noGo === 'type'
									? t('worlds.typeOne')
									: t('worlds.tip')}
					</div>
				</div>
				<!-- The pad's Go is the Go row: it goes to the world typed, or waits, greyed. -->
				<NumberPad
					active
					minus={false}
					ok={t('worlds.ok')}
					okKey={optionKey(0)}
					ready={worldOptions[0]!.enabled}
					big
				/>
			</div>
		{:else if pause.screen === 'book'}
			<!-- The animal book, in the menu's place: a tab per land, and every kind of the land open,
			     in a grid that scrolls. -->
			{#if pages.length > 1}
				<div class="book-lands">
					{#each pages as land (land)}
						<button
							type="button"
							class="land-tab"
							class:open={book.land === land}
							class:lit={book.tabs && book.land === land}
							data-press={landKey(land)}
							{@attach unfocusable}
						>
							{t(`lands.${land}.name`)}
						</button>
					{/each}
				</div>
			{/if}
			<div class="book-grid" {@attach bookGrid}>
				{#each page as spec, i (spec.id)}
					{@const kind = caught.has(spec.id) ? 'caught' : seen.has(spec.id) ? 'seen' : 'unseen'}
					{@const picture = book.portraits[spec.id]}
					<button
						type="button"
						class="card {kind}"
						class:lit={!book.tabs && pause.option === i}
						class:sea={!canFightIn(spec.id, 'land')}
						data-press={optionKey(i)}
						{@attach unfocusable}
						{@attach (card) => {
							if (pause.option === i) card.scrollIntoView({ block: 'nearest' });
						}}
					>
						{#if kind === 'unseen'}
							<!-- Never met: a question mark, and nothing else that could give it away. -->
							<span class="portrait mystery" aria-hidden="true">?</span>
						{:else}
							<span class="portrait">
								{#key book.hopping === spec.id ? book.hops : 0}
									{#if picture}
										<img
											src={picture}
											alt=""
											draggable="false"
											class:hop={book.hopping === spec.id && book.hops > 0}
										/>
									{/if}
								{/key}
							</span>
							<span class="card-name">{speciesName(spec.id)}</span>
							{#if kind === 'caught'}
								<!-- Caught, for good: a green tick on the card's corner. -->
								<span class="stamp"><Tick size={30} /></span>
							{/if}
							{#if freed.has(spec.id)}
								<!-- Set free at the witch doctor's, for good: a rose heart on the other corner. -->
								<span class="stamp free"><FreeStamp size={30} /></span>
							{/if}
						{/if}
					</button>
				{/each}
			</div>
			<div class="book-caption">{bookCaption}</div>
		{:else if pause.screen === 'puzzles'}
			<!-- "My puzzles", in the menu's place: a row per topic, the most tried first, in a list that scrolls. -->
			<PuzzleStats rows={stats} lit={pause.option} press={optionKey} />
			<div class="book-caption">{t('puzzles.caption')}</div>
		{:else}
			<div class="columns">
				<div class="team">
					<div class="heading">{t('pause.team')}</div>
					{#each cards as bundle, i (bundle.speciesId)}
						{@const first = bundle.animals[0]!}
						{@const single = bundle.animals.length === 1}
						{@const name = single ? nameOf(first) : speciesName(first.speciesId)}
						{@const allTired = bundle.animals.every((a) => a.hp === 0)}
						{@const leads = cards.length > 1 && bundle.animals.some((a) => a.id === leadId)}
						<button
							type="button"
							class="row animal"
							class:stack={!single}
							class:lit={lit === i}
							class:picked={pause.screen !== 'list' && lit === i}
							class:tired={allTired}
							animate:slide={bundle.speciesId}
							data-press={rowKey(i)}
							{@attach unfocusable}
						>
							<span class="slot">{i + 1}</span>
							<span class="who">
								<span class="name">{name}</span>
								{#if single && name !== speciesName(first.speciesId)}
									<span class="species">{speciesName(first.speciesId)}</span>
								{:else if !single}
									<span class="count">{t('team.count', { count: bundle.animals.length })}</span>
									<span class="summary">
										{#each stackSummary(bundle.animals) as part, j (j)}
											{#if j > 0}{' · '}{/if}<span class="part">{part}</span>
										{/each}
									</span>
								{/if}
							</span>
							{#if single}
								<span class="bar"
									><HpBar hp={first.hp} max={getAnimal(first.speciesId).maxHp} /></span
								>
							{/if}
							<span class="tags">
								{#if allTired}
									<span class="tag">{t('party.tired')}</span>
								{:else if leads}
									<span class="tag lead">{t('hud.goesFirst')}</span>
								{/if}
							</span>
						</button>
					{/each}
					{#each menuLines as line (typeof line === 'string' ? line : line.join('+'))}
						{#if typeof line === 'string'}
							{@render menuRow(line)}
						{:else}
							<!-- Rows side by side, one line of the menu's height. -->
							<div class="pair" class:halves={line[0] === 'worlds' || line[0] === 'language'}>
								{#each line as item (item)}
									{@render menuRow(item)}
								{/each}
							</div>
						{/if}
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
								data-press={optionKey(i)}
								{@attach unfocusable}
							>
								<span class="caret">▸</span>{optionLabel(option.id)}
							</button>
						{/each}
						<!-- Why "Go first" is greyed, when it is: a kid can't tell from the grey alone. -->
						{#if pickedNotFirst === 'cantSwim'}
							<div class="note">{t('pause.cantSwimHelp', { animal: animalWords(picked) })}</div>
						{:else if pickedNotFirst === 'inTheSea'}
							<div class="note">{t('pause.inTheSeaHelp', { animal: animalWords(picked) })}</div>
						{:else if pickedNotFirst === 'tired'}
							<div class="note">{t('pause.tiredHelp', { animal: animalWords(picked) })}</div>
						{:else if pickedNotFirst === 'already'}
							<div class="note">{t('pause.leadHelp', { animal: animalWords(picked) })}</div>
						{/if}
					{:else if pause.screen === 'bundle' && card}
						<div class="side-title">
							{speciesName(card.speciesId)}
							<span class="count">{t('team.count', { count: card.animals.length })}</span>
						</div>
						{#each rows as row, i (row.kind === 'option' ? row.id : row.animal.id)}
							{#if row.kind === 'option'}
								<button
									type="button"
									class="row option"
									class:lit={pause.option === i}
									class:off={!row.enabled}
									data-press={optionKey(i)}
									{@attach unfocusable}
								>
									<span class="caret">▸</span>{optionLabel(row.id)}
								</button>
							{/if}
						{/each}
						<!-- Why "Go first" is greyed, when they can't go first here or are all tired; else what the list below is for. -->
						<div class="note">
							{cardNotFirst === 'cantSwim'
								? t('pause.allCantSwimHelp')
								: cardNotFirst === 'inTheSea'
									? t('pause.allInTheSeaHelp')
									: cardNotFirst === 'tired'
										? t('pause.allTiredHelp')
										: t('pause.pickOne')}
						</div>
						<BundleAnimals
							animals={card.animals}
							leadId={game.party.length > 1 ? leadId : null}
							press={(_, i) => optionKey(cardOptions + i)}
							lit={litAnimal}
							stacked
							class="members"
							onlit={showRow}
						/>
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
					{:else if pause.screen === 'players'}
						<div class="side-title">{t('pause.players')}</div>
						{#if unlisted !== null}
							<div class="note">{unlisted}</div>
						{:else}
							<div class="players">
								{#each presence.roster as player, i (player.pid)}
									<button
										type="button"
										class="row option player"
										class:lit={litPlayer === i}
										data-press={optionKey(i)}
										{@attach unfocusable}
										{@attach (row) => {
											if (litPlayer === i) showRow(row);
										}}
									>
										<span class="caret">▸</span>
										<span class="who">
											<span class="name">{t('pause.goTo', { name: player.name })}</span>
											<span class="where">
												{#if player.steps > 0 && presence.compass.length > 0}
													<span
														class="compass"
														aria-hidden="true"
														style:transform="rotate({presence.compass[player.bearing] ?? 0}rad)"
														>↑</span
													>
												{/if}
												{away(player.steps)}{#if player.busy !== 'explore'}{' · '}{t(
														`presence.busy.${player.busy}`
													)}{/if}
											</span>
										</span>
									</button>
								{/each}
							</div>
							<div class="note">{t('pause.playersHelp')}</div>
						{/if}
					{:else if pause.screen === 'list' && soundLit}
						<div class="side-title">{t('pause.sound')}</div>
						<!-- With the touch controls on, what a tap does; the keys only with a keyboard (#53). -->
						<div class="note">
							{touch.on ? t('pause.soundHelpTouch') : t('pause.soundHelp')}
						</div>
					{:else if pause.screen === 'list' && puzzlesLit}
						<div class="side-title">{t('puzzles.title')}</div>
						<div class="note">{t('puzzles.help')}</div>
						<div class="note">{t('puzzles.solved', { count: game.solved })}</div>
					{:else if pause.screen === 'list' && bookLit}
						<div class="side-title">{t('book.title')}</div>
						<div class="note">{t('book.help')}</div>
						<div class="note">{bookCount}</div>
						<div class="note">{freedCount}</div>
					{:else}
						<div class="soft">{t('pause.pick')}</div>
						<div class="note">{t('pause.pickHelp')}</div>
					{/if}
				</div>
			</div>
		{/if}
		<!-- The keys; with the touch controls on, every row is its own button and needs no reminder. -->
		{#if !touch.on}
			<div class="keys">
				{#if pause.screen === 'list' && items[pause.cursor - cards.length] === 'language'}
					{t('pause.keysLanguage')}
				{:else if pause.screen === 'list' && soundLit}
					{t('pause.keysSound')}
				{:else if pause.screen === 'list'}
					{t('pause.keysList')}
				{:else if pause.screen === 'options' || pause.screen === 'bundle'}
					{t('pause.keysOptions')}
				{:else if pause.screen === 'worlds'}
					{t('worlds.keys')}
				{:else if pause.screen === 'book'}
					{t('book.keys')}
				{:else if pause.screen === 'puzzles'}
					{t('puzzles.keys')}
				{:else if pause.screen === 'players'}
					{t('pause.keysPlayers')}
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
		box-sizing: border-box;
		padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
		background: rgba(45, 42, 50, 0.3);
	}
	/* Naming on a touch screen: at the top, so the tablet's keyboard, which rises from the bottom, leaves the name box in view. */
	.backdrop.typing {
		align-items: start;
		padding-top: calc(16px + var(--safe-top));
	}
	/*
	 * Wide enough, at 1024 px, for a team of twelve-letter names of the widest
	 * letters beside the picked one's name in the side panel.
	 */
	.menu {
		width: min(1000px, calc(100vw - 32px - var(--safe-left) - var(--safe-right)));
		max-height: calc(100vh - 32px - var(--safe-top) - var(--safe-bottom));
		box-sizing: border-box;
		overflow: auto;
		/* The one thing a finger may scroll, on a screen too short for it. */
		touch-action: pan-y;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 18px 22px 16px;
	}
	/*
	 * The spacing is trimmed, and rows share lines (`MENU_LINES`: Worlds and
	 * Who's here, Language and Sound, the account's rows, Keep playing and Start
	 * screen), so a team of all eight kinds, with those under it, fits 1024×768
	 * without the menu scrolling. A new row goes beside another, or the budget is
	 * measured again.
	 */
	/* The title, and beside it the animal book's row; in the book, its count and Back. */
	.title-line {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}
	.title {
		flex: 1;
		min-width: 0;
		font-weight: 800;
		font-size: 32px;
		line-height: 1.1;
	}
	/*
	 * The book's row keeps the title's line as tall as the title: a finger tall itself,
	 * it reaches up into the menu's padding and down into the line's margin, so the
	 * menu keeps its height budget.
	 */
	.title-line .row.item {
		flex: none;
		width: auto;
		margin: -6px 0 -7px;
	}
	/* A soft blue, the book's own, until the cursor or a mouse lights it (the rules below). */
	.title-line .item {
		background: rgba(61, 123, 232, 0.12);
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
	/* How many animals a card holds, beside its kind's name. */
	.count {
		flex: none;
		font-size: 16px;
		font-weight: 800;
		padding: 0 7px;
		border-radius: 8px;
		background: rgba(45, 42, 50, 0.08);
		font-variant-numeric: tabular-nums;
	}
	/*
	 * How a card of several is, on its own line under its kind's name, as on
	 * the HUD's card, running on where one animal's HP bar would be, so the
	 * row keeps its 48 px with three counts of three figures in Danish. A
	 * line that runs out of room breaks between the parts, never inside one
	 * ("3 tired soon").
	 */
	.summary {
		flex-basis: 100%;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.8;
	}
	.part {
		white-space: nowrap;
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
		margin-top: 4px;
	}
	.pair {
		display: flex;
		gap: 8px;
	}
	.pair .row {
		width: auto;
	}
	/* Worlds and Who's here, and Language and Sound, share their line half and half. */
	.pair.halves .row {
		flex: 1;
		min-width: 0;
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
	/* The Worlds row's value: the world the kid is in. */
	.setting-value {
		font-size: 16px;
		padding: 2px 10px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.08);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* The Worlds screen: where the kid is, the number and the rows on the left, the pad on the right. */
	.worlds {
		display: flex;
		gap: 24px;
		align-items: flex-start;
		justify-content: center;
	}
	.world-side {
		flex: 1;
		max-width: 520px;
		min-width: 0;
	}
	.here {
		font-weight: 800;
		font-size: 26px;
		margin: 2px 2px 0;
	}
	.home-line {
		margin-top: 2px;
	}
	/* The number being typed: big, in a box like an answer's. */
	.dial {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin: 14px 0 10px;
		padding: 8px 16px;
		border: 3px solid var(--accent);
		border-radius: 12px;
		background: white;
	}
	.dial-label {
		font-weight: 800;
		font-size: 18px;
		opacity: 0.7;
	}
	.dial-number {
		font-weight: 800;
		font-size: 36px;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
	}
	.dial-number.empty {
		opacity: 0.25;
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
	/*
	 * A card's animals, under its options: as many as it holds, in a box that
	 * scrolls, so a card of a hundred keeps the menu on the screen.
	 */
	.side :global(.members) {
		margin-top: 8px;
		max-height: max(120px, calc(100vh - 500px));
	}
	/* Who's here: everyone in the world, in a box that scrolls when there are many. */
	.players {
		max-height: max(150px, calc(100vh - 420px));
		overflow-y: auto;
		touch-action: pan-y;
	}
	.player {
		min-height: max(var(--tap), 54px);
	}
	.player .who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* "Go to <name>" breaks before a name too long for the line, never through it. */
	.player .name {
		white-space: normal;
		overflow: visible;
		overflow-wrap: anywhere;
	}
	.player .where {
		font-weight: 600;
		font-size: 16px;
		opacity: 0.75;
	}
	.compass {
		display: inline-block;
		margin-right: 4px;
		font-weight: 800;
		color: var(--accent);
	}
	/* How many others are in the world, beside Who's here. */
	.count-badge {
		min-width: 28px;
		padding: 2px 8px;
		box-sizing: border-box;
		border-radius: 999px;
		background: var(--accent);
		color: var(--panel-ink);
		font-size: 16px;
		text-align: center;
	}
	.keys {
		margin-top: 10px;
		font-weight: 600;
		font-size: 16px;
		opacity: 0.7;
		text-align: center;
	}

	/*
	 * The animal book takes the menu's whole height, so its grid scrolls inside it and
	 * the count, Back and the lit card's line stay in view, at any size.
	 */
	.menu.book-open {
		height: calc(100vh - 32px - var(--safe-top) - var(--safe-bottom));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	/*
	 * The book's two counts share what the title and Back leave of the line: side by side
	 * when they fit, else the kinds set free under the rest, so the line keeps its height.
	 */
	.book-open .title {
		flex: none;
	}
	.book-counts {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		column-gap: 12px;
		line-height: 1.2;
	}
	.book-count {
		font-weight: 800;
		font-size: 18px;
		opacity: 0.75;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	/* The kinds set free, with their heart: the count a kid works towards. */
	.book-freed {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 18px;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	/* The lands' tabs over the cards: the open one filled, the lit one ringed as a card is. */
	.book-lands {
		flex: none;
		display: flex;
		gap: 10px;
		margin-bottom: 8px;
	}
	.land-tab {
		min-height: 44px;
		padding: 0 20px;
		border-radius: 22px;
		background: rgba(0, 0, 0, 0.06);
		color: var(--panel-ink);
		font-weight: 800;
		font-size: 18px;
		outline: 3px solid transparent;
		outline-offset: 2px;
	}
	.land-tab.open {
		background: var(--accent);
		color: white;
	}
	.land-tab.lit {
		outline-color: var(--accent);
	}
	.book-grid {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* A finger scrolls it; nothing else on the page moves. */
		touch-action: pan-y;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		/* Every row as tall as its cards: the grid scrolls, it never squeezes them. */
		grid-auto-rows: max-content;
		align-content: start;
		gap: 10px;
		padding: 8px;
		border-radius: 12px;
		background: rgba(0, 0, 0, 0.04);
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		min-height: 148px;
		padding: 10px 6px;
		box-sizing: border-box;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.55);
		font-weight: 800;
		font-size: 16px;
		line-height: 1.2;
		text-align: center;
	}
	/* Caught: a card of its own, lifted on the toy button's edge. */
	.card.caught {
		background: white;
		box-shadow: 0 3px 0 var(--edge);
	}
	/* Never met: an empty place, waiting for its animal. */
	.card.unseen {
		background: transparent;
		border: 2px dashed rgba(45, 42, 50, 0.2);
	}
	.card.lit {
		box-shadow: 0 0 0 3px var(--accent);
	}
	.card.caught.lit {
		box-shadow:
			0 0 0 3px var(--accent),
			0 3px 0 var(--edge);
	}
	@media (hover: hover) and (pointer: fine) {
		.card:not(.lit):hover {
			background: rgba(255, 159, 67, 0.12);
		}
	}
	/* The figure on a disc: plain for one met, the meadow's grass (the water, at sea) for one caught. */
	.portrait {
		width: min(100%, 92px);
		aspect-ratio: 1;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: rgba(45, 42, 50, 0.07);
	}
	.card.caught .portrait {
		background:
			radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.45), transparent 70%), #8bd66b;
	}
	.card.caught.sea .portrait {
		background:
			radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.45), transparent 70%), #5ec8f2;
	}
	.portrait img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		animation: appear 0.25s ease-out;
	}
	/* Met but not caught: the figure a little faded, as if seen from afar. */
	.card.seen .portrait img {
		filter: saturate(0.45);
		opacity: 0.8;
	}
	.mystery {
		font-size: 52px;
		font-weight: 800;
		color: rgba(45, 42, 50, 0.3);
	}
	/* A long one-word name (kæmpestormfugl, halsbåndlemming) breaks where the language
	   hyphenates it (the page's lang is the game's), and only failing that anywhere. */
	.card-name {
		max-width: 100%;
		overflow-wrap: break-word;
		-webkit-hyphens: auto;
		hyphens: auto;
	}
	/* Caught, for good: the right answer's green tick, ringed in cream over the disc's corner. */
	.stamp {
		position: absolute;
		top: 6px;
		right: 8px;
		border-radius: 50%;
		box-shadow: 0 0 0 3px white;
	}
	/* Set free: the rose heart, on the disc's other corner. */
	.stamp.free {
		right: auto;
		left: 8px;
	}
	.book-caption {
		flex: none;
		min-height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 8px 8px 0;
		font-weight: 800;
		font-size: 18px;
		text-align: center;
	}
	.portrait img.hop {
		animation: hop 0.5s ease-out;
	}
	@keyframes appear {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
	}
	@keyframes hop {
		30% {
			transform: translateY(-16%) scale(1.04);
		}
		55% {
			transform: translateY(0) scale(1.06, 0.94);
		}
		75% {
			transform: translateY(-4%);
		}
	}
	@keyframes nod {
		40% {
			transform: scale(1.06);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.portrait img {
			animation: none;
		}
		.portrait img.hop {
			animation: nod 0.3s ease-out;
		}
	}
	/* A phone held sideways: less round the book, and smaller cards, so two rows show. */
	@media (max-height: 500px) {
		.menu.book-open {
			height: calc(100vh - 16px - var(--safe-top) - var(--safe-bottom));
			padding: 10px 14px;
		}
		.book-open .title {
			font-size: 26px;
		}
		.land-tab {
			min-height: 36px;
			font-size: 16px;
		}
		.book-lands {
			margin-bottom: 4px;
		}
		.book-grid {
			grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
			gap: 8px;
			padding: 6px;
		}
		.card {
			min-height: 108px;
			padding: 6px 4px 8px;
			gap: 4px;
		}
		.portrait {
			width: min(100%, 64px);
		}
		.stamp {
			top: 4px;
			right: 4px;
		}
		.stamp.free {
			left: 4px;
		}
		.book-count,
		.book-freed {
			font-size: 16px;
		}
		.book-caption {
			min-height: 40px;
			padding-top: 4px;
			font-size: 16px;
		}
	}
</style>
