/**
 * The game lives at its own domain now ([[DECISIONS]] § Deployment). Before
 * that, it was shared from the developer's machine through a tunnel, and a
 * kid's tablet still opens it at that old address, which the development
 * server still answers. A page there points the kid home first (`boot.ts`).
 * Whether a page is on such an address is decided here, from the page's
 * hostname and the game's domain (`VITE_GAME_DOMAIN`, deploy.env's).
 */

/**
 * - `home`: the game's domain, or its `www.`.
 * - `local`: a developer's machine: this one (`localhost`, a loopback
 *   address), or one on its network (a private or link-local address, an
 *   mDNS `.local` name).
 * - `elsewhere`: any other address, the old tunnel's among them.
 */
export type HostKind = 'home' | 'local' | 'elsewhere';

/** Where a page on `hostname` (`location.hostname`) runs, for the game at `domain`. */
export function hostKind(hostname: string, domain: string): HostKind {
	const host = bare(hostname);
	const home = bare(domain);
	if (home !== '' && (host === home || host === `www.${home}`)) return 'home';
	return isLocalHost(host) ? 'local' : 'elsewhere';
}

/**
 * Whether a page on `hostname` shows the moved card: only elsewhere, and only
 * when the build knows the game's domain, so there is somewhere to point.
 */
export function pointsHome(hostname: string, domain: string): boolean {
	return bare(domain) !== '' && hostKind(hostname, domain) === 'elsewhere';
}

/** A hostname as compared here: lower case, without IPv6 brackets or a trailing dot. */
function bare(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/, '$1')
		.replace(/\.$/, '');
}

/**
 * Whether `host` (bare) is a developer's machine. No name at all (a page
 * opened from a file) counts too: it is nobody's old address.
 */
function isLocalHost(host: string): boolean {
	if (host === '' || host === 'localhost') return true;
	if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
	if (v4) {
		const a = Number(v4[1]);
		const b = Number(v4[2]);
		return (
			a === 127 || // loopback
			a === 0 || // "this network": Chrome takes 0.0.0.0 to this machine
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254) || // link-local
			(a === 100 && b >= 64 && b <= 127) // shared address space: Tailscale's
		);
	}
	// IPv6, as a browser writes it (RFC 5952: lower case, no leading zeros): loopback,
	// unspecified, unique local (fc00::/7) and link-local (fe80::/10). Their first group
	// is four digits, or it is a smaller number outside those ranges.
	if (host.includes(':')) {
		return (
			host === '::1' ||
			host === '::' ||
			/^f[cd][0-9a-f]{2}:/.test(host) ||
			/^fe[89ab][0-9a-f]:/.test(host)
		);
	}
	return false;
}
