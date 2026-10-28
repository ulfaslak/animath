/**
 * Who plays on production, and how they are doing: one read-only trip to the
 * server, one short table. Run it with the server package's tsx, which the
 * root script does:
 *
 *   pnpm roster               # production, over SSH
 *   pnpm roster --from <file> # what an earlier run fetched (`--keep <file>` writes one)
 *
 * It reads three things on the server, changing none of them: every account
 * with its save (the database, in a read-only transaction), the error reports
 * of the last 7 days (counted only), and the web server's log, which holds no
 * address and no name, so it counts the whole site, guests too, by the
 * requests a page makes: a page on screen asks `/api/account/ready` every
 * 30 s (`account/ready.ts`), so 120 of them are an hour on screen, and a page
 * opened joins `/api/ws` once.
 *
 * A save says where a player stands, never when they played, so each run
 * keeps what it read (numbers only, no save) in
 * `~/Library/Application Support/mathgame/roster/<day>.json`, and says what
 * moved since the latest earlier day's. Times are this Mac's.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LANDS, RECENT_ANSWERS } from '../packages/engine/src/index.ts';

const HOST = 'deploy@animath.xyz';
const KEY = join(homedir(), '.ssh', 'mathgame_deploy');
const SNAPSHOTS = join(homedir(), 'Library', 'Application Support', 'mathgame', 'roster');
const DAYS = 7;
/** A topic shows under Math once tried this many times. */
const SHOWN_AFTER = 5;
/** Under this share right, overall or lately, a topic is marked `!`. */
const WEAK = 0.7;

/** The SQL's answer: everything about accounts in one JSON document. */
const SQL = `
select json_build_object(
  'now', now(),
  'errors', (select json_build_object('reports', count(*), 'kinds', count(distinct message))
               from client_errors where not test and created_at > now() - interval '${DAYS} days'),
  'accounts', coalesce((select json_agg(json_build_object(
      'name', u.name,
      'made', u.created_at,
      'password', u.password_hash <> '!',
      'savedAt', a.updated_at,
      'setAside', (select count(*) from account_save_backups b where b.user_id = u.id),
      'save', a.data
    ) order by u.created_at) from users u left join account_saves a on a.user_id = u.id), '[]'::json)
);`;

/**
 * Run on the server: the database's answer after `@@db`, then the log's
 * counts after `@@web` (day, what, how many), and the log's first day.
 */
const REMOTE = `set -e
cd ~/mathgame
C="docker compose -f docker-compose.prod.yml"
echo @@db
$C exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \\
  sh -c 'psql -X -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "\${POSTGRES_DB:-$POSTGRES_USER}"' <<'SQL'
${SQL}
SQL
echo @@web
$C logs --no-log-prefix nginx 2>/dev/null | awk '
  NR == 1 { print "first", substr($1, 2, 11) }
  { path = $4; sub(/\\?.*/, "", path); day = substr($1, 2, 11) }
  path == "/api/account/ready" && $6 == 200 { n[day " ready"]++ }
  path == "/api/ws" && $6 == 101 { n[day " opened"]++ }
  $3 == "\\"PUT" && path == "/api/account/save" && $6 == 200 { n[day " saves"]++ }
  END { for (k in n) print k, n[k] }'
`;

interface TopicRecord {
	tried: number;
	right: number;
	recent: string;
}

/** The save's fields this reads, each maybe missing: a save of any version, or a newer build's. */
interface LooseSave {
	version?: number;
	land?: string;
	world?: number;
	party?: unknown[];
	tokens?: number;
	items?: string[];
	solved?: number;
	puzzles?: Record<string, TopicRecord>;
	caught?: string[];
	unlocked?: string[];
}

interface Account {
	name: string;
	made: string;
	password: boolean;
	savedAt: string | null;
	setAside: number;
	save: LooseSave | null;
}

interface Fetched {
	now: string;
	errors: { reports: number; kinds: number };
	accounts: Account[];
}

/** What a day's snapshot keeps of a player. */
interface Kept {
	solved: number;
	caught: number;
	tried: number;
	right: number;
}

function option(name: string): string | undefined {
	const at = process.argv.indexOf(name);
	return at < 0 ? undefined : process.argv[at + 1];
}

function fetchRaw(): string {
	const from = option('--from');
	if (from) return readFileSync(from, 'utf8');
	const raw = execFileSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', HOST, 'bash -s'], {
		input: REMOTE,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
	const keep = option('--keep');
	if (keep) writeFileSync(keep, raw, { mode: 0o600 });
	return raw;
}

function parse(raw: string): {
	db: Fetched;
	web: Map<string, Record<string, number>>;
	first: string;
} {
	const [, rest = ''] = raw.split('@@db\n');
	const [dbText = '', webText = ''] = rest.split('@@web\n');
	const db = JSON.parse(dbText.trim()) as Fetched;
	const web = new Map<string, Record<string, number>>();
	let first = '';
	for (const line of webText.trim().split('\n')) {
		const [day = '', what = '', count = ''] = line.split(' ');
		if (day === 'first') {
			first = what;
			continue;
		}
		if (!what) continue;
		const counts = web.get(day) ?? {};
		counts[what] = Number(count);
		web.set(day, counts);
	}
	return { db, web, first };
}

/** `nginx`'s `28/Oct/2026`, or a date, as `2026-10-28` in this Mac's time zone where it is a moment. */
function isoDay(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

function nginxDay(date: Date): string {
	return `${String(date.getUTCDate()).padStart(2, '0')}/${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
}

/** How long ago, in its largest unit: `12m`, `3h`, `9d`. */
function ago(at: string | null, now: Date): string {
	if (!at) return '-';
	const minutes = Math.max(0, (now.getTime() - new Date(at).getTime()) / 60_000);
	if (minutes < 60) return `${Math.round(minutes)}m`;
	if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
	return `${Math.round(minutes / 1440)}d`;
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function percent(part: number, whole: number): string {
	return whole === 0 ? '-' : `${Math.round((100 * part) / whole)}%`;
}

function sumTopics(save: LooseSave | null): {
	tried: number;
	right: number;
	recentRight: number;
	recent: number;
} {
	const total = { tried: 0, right: 0, recentRight: 0, recent: 0 };
	for (const record of Object.values(save?.puzzles ?? {})) {
		total.tried += record.tried ?? 0;
		total.right += record.right ?? 0;
		total.recent += record.recent?.length ?? 0;
		total.recentRight += [...(record.recent ?? '')].filter((c) => c === '1').length;
	}
	return total;
}

/** The animal book by land, unlocked lands only: `N 34/50 · A 3/40`. */
function book(save: LooseSave | null): { text: string; caught: number } {
	const caught = new Set(save?.caught ?? []);
	const unlocked = new Set(save?.unlocked ?? ['nordland']);
	const parts = LANDS.filter((land) => unlocked.has(land.id)).map((land) => {
		const n = land.species.filter((id) => caught.has(id)).length;
		return `${land.id[0]!.toUpperCase()}${n}/${land.species.length}`;
	});
	return { text: parts.join(' '), caught: caught.size };
}

/** A player's topics tried `SHOWN_AFTER` times or more, the most tried first, `!` on a weak one. */
function topics(save: LooseSave | null): string {
	return Object.entries(save?.puzzles ?? {})
		.filter(([, r]) => r.tried >= SHOWN_AFTER)
		.sort(([, a], [, b]) => b.tried - a.tried)
		.map(([topic, r]) => {
			const recent = r.recent ?? '';
			const lately = [...recent].filter((c) => c === '1').length / Math.max(1, recent.length);
			const weak = r.right / r.tried < WEAK || (recent.length >= SHOWN_AFTER && lately < WEAK);
			return `${topic} ${percent(r.right, r.tried)}/${r.tried}${weak ? '!' : ''}`;
		})
		.join(' ');
}

function readSnapshots(today: string): { day: string; players: Record<string, Kept> } | null {
	let days: string[];
	try {
		days = readdirSync(SNAPSHOTS).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f));
	} catch {
		return null;
	}
	const earlier = days
		.map((f) => f.slice(0, 10))
		.filter((d) => d < today)
		.sort();
	const day = earlier.at(-1);
	if (!day) return null;
	return { day, players: JSON.parse(readFileSync(join(SNAPSHOTS, `${day}.json`), 'utf8')) };
}

function table(rows: string[][]): string[] {
	const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
	return rows.map((r) =>
		r
			.map((cell, i) =>
				i === 0 || i === r.length - 1 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)
			)
			.join('  ')
			.trimEnd()
	);
}

const { db, web, first } = parse(fetchRaw());
const now = new Date(db.now);
const today = isoDay(now);
const before = readSnapshots(today);
const accounts = [...db.accounts].sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));

const within = (hours: number) =>
	accounts.filter(
		(a) => a.savedAt && now.getTime() - new Date(a.savedAt).getTime() < hours * 3_600_000
	).length;
const made = accounts.filter(
	(a) => now.getTime() - new Date(a.made).getTime() < DAYS * 86_400_000
).length;
const out: string[] = [
	`Animath on production, ${today} ${now.toTimeString().slice(0, 5)}: ${accounts.length} accounts, ` +
		`${within(24)} played in the last 24 h, ${within(DAYS * 24)} in ${DAYS} days, ${made} new in ${DAYS} days. ` +
		`Errors in ${DAYS} days: ${plural(db.errors.reports, 'report')} of ${plural(db.errors.kinds, 'kind')}.`,
	''
];

// The whole site, guests too, by day, from the web server's log.
const days = Array.from(
	{ length: DAYS },
	(_, i) => new Date(now.getTime() - (DAYS - 1 - i) * 86_400_000)
);
const siteRows = [['day (UTC)', 'on screen', 'pages opened', 'account saves']];
for (const day of days) {
	const counts = web.get(nginxDay(day)) ?? {};
	const partial = nginxDay(day) === first ? ' (log starts)' : '';
	siteRows.push([
		`${day.toUTCString().slice(0, 3)} ${day.toISOString().slice(5, 10)}${partial}`,
		`${(((counts.ready ?? 0) * 30) / 3600).toFixed(1)} h`,
		String(counts.opened ?? 0),
		String(counts.saves ?? 0)
	]);
}
out.push('Whole site, guests too:', ...table(siteRows).map((l) => `  ${l}`), '');

// One row a player, the latest played first.
const kept: Record<string, Kept> = {};
const header = [
	'name',
	'last',
	'made',
	'solved',
	'right',
	'lately',
	'book',
	'at',
	'team',
	'money',
	'tools',
	before ? `since ${before.day.slice(5)}` : 'since'
];
const playerRows = [header];
const notes: string[] = [];
for (const a of accounts) {
	const s = a.save;
	const sums = sumTopics(s);
	const caught = book(s);
	kept[a.name] = {
		solved: s?.solved ?? 0,
		caught: caught.caught,
		tried: sums.tried,
		right: sums.right
	};
	const was = before?.players[a.name];
	// A count that fell is a new game: the old one is among the games set aside.
	const change = (n: number, what: string) => (n === 0 ? '' : `${n > 0 ? '+' : ''}${n} ${what}`);
	const moved = !was
		? before
			? 'new'
			: ''
		: [
				change(kept[a.name]!.solved - was.solved, 'solved'),
				change(caught.caught - was.caught, 'caught')
			]
				.filter(Boolean)
				.join(' ') || '-';
	playerRows.push([
		a.name,
		ago(a.savedAt, now),
		ago(a.made, now),
		String(s?.solved ?? 0),
		percent(sums.right, sums.tried),
		sums.recent < SHOWN_AFTER ? '-' : percent(sums.recentRight, sums.recent),
		caught.text,
		s ? `${(s.land ?? 'nordland')[0]!.toUpperCase()}w${s.world ?? 1}` : '-',
		String(s?.party?.length ?? 0),
		String(s?.tokens ?? 0),
		String(s?.items?.length ?? 0),
		moved
	]);
	const flags = [
		!a.password && 'no password yet (welcome link waiting)',
		a.setAside > 0 && `${plural(a.setAside, 'game')} set aside`,
		!s && 'no save',
		s && s.version !== 5 && `save version ${s.version}`
	].filter(Boolean);
	const math = topics(s);
	if (math || flags.length > 0)
		notes.push(`  ${a.name}: ${[math, ...flags].filter(Boolean).join(' · ')}`);
}
out.push('Players, latest first:', ...table(playerRows).map((l) => `  ${l}`), '');
out.push(
	`Math by topic (% right/tried, tried ${SHOWN_AFTER}+; ! under ${WEAK * 100}% overall or in the last ${RECENT_ANSWERS}):`,
	...notes
);
out.push(
	'',
	`Key: last = last save; right = all answers; lately = the last ${RECENT_ANSWERS} per topic; ` +
		'book = species caught per unlocked land (N Nordland, A Arctic); at = land and world; team = animals with them; ' +
		(before
			? `since = moved since the snapshot of ${before.day}.`
			: 'since = first snapshot today, deltas from the next day on.')
);
console.log(out.join('\n'));

if (!option('--from')) {
	mkdirSync(SNAPSHOTS, { recursive: true, mode: 0o700 });
	writeFileSync(join(SNAPSHOTS, `${today}.json`), JSON.stringify(kept), { mode: 0o600 });
}
