import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { hostKind, pointsHome } from '../src/moved';

/**
 * Old addresses point home ([[DECISIONS]] § Deployment): a page on any address
 * that is neither the game's domain nor a developer's machine shows the moved
 * card before the game. `location.hostname` as a browser gives it: lower case,
 * an IPv6 address in brackets.
 */

const DOMAIN = 'animath.xyz';

describe('hostKind', () => {
	it.each(['animath.xyz', 'www.animath.xyz', 'ANIMATH.XYZ', 'animath.xyz.', 'Www.Animath.Xyz'])(
		'%s is home',
		(host) => {
			expect(hostKind(host, DOMAIN)).toBe('home');
			expect(hostKind(host, 'Animath.XYZ')).toBe('home');
		}
	);

	it.each([
		'localhost',
		'LOCALHOST',
		'game.localhost',
		'127.0.0.1',
		'127.8.9.10',
		'0.0.0.0',
		'[::1]',
		'::1',
		'[::]',
		'10.0.0.5',
		'172.16.0.1',
		'172.31.255.254',
		'192.168.1.42',
		'169.254.10.20',
		'100.64.0.1',
		'100.127.255.254',
		'ulfs-macbook.local',
		'[fd12:3456:789a::1]',
		'[fc00::1]',
		'[fe80::1]',
		'[febf::2]',
		''
	])('%s is a developer’s machine', (host) => {
		expect(hostKind(host, DOMAIN)).toBe('local');
	});

	it.each([
		// The old tunnel's, and any other.
		'lively-otter-12.ngrok-free.dev',
		'quiet-fox.trycloudflare.com',
		'animath.xyz.example.com',
		'notanimath.xyz',
		'www2.animath.xyz',
		'games.animath.xyz',
		'localhost.example.com',
		'mylocal',
		// Public addresses, the ones just past each private range among them.
		'91.98.203.234',
		'8.8.8.8',
		'11.0.0.1',
		'172.15.255.255',
		'172.32.0.1',
		'192.169.0.1',
		'169.253.0.1',
		'100.63.255.255',
		'100.128.0.1',
		'128.0.0.1',
		'[2001:db8::1]',
		// 0x00fc and 0xfec0 are outside fc00::/7 and fe80::/10.
		'[fc::1]',
		'[fec0::1]',
		'[fe8::1]'
	])('%s is elsewhere', (host) => {
		expect(hostKind(host, DOMAIN)).toBe('elsewhere');
	});

	it('knows no home without a domain', () => {
		expect(hostKind('animath.xyz', '')).toBe('elsewhere');
		expect(hostKind('localhost', '')).toBe('local');
	});
});

describe('pointsHome', () => {
	it('points home from elsewhere only, and only when the build knows the domain', () => {
		expect(pointsHome('lively-otter-12.ngrok-free.dev', DOMAIN)).toBe(true);
		expect(pointsHome('lively-otter-12.ngrok-free.dev', '')).toBe(false);
		expect(pointsHome('lively-otter-12.ngrok-free.dev', '  ')).toBe(false);
		expect(pointsHome('animath.xyz', DOMAIN)).toBe(false);
		expect(pointsHome('www.animath.xyz', DOMAIN)).toBe(false);
		expect(pointsHome('localhost', DOMAIN)).toBe(false);
		expect(pointsHome('192.168.1.42', DOMAIN)).toBe(false);
	});
});

describe("the build's domain", () => {
	it("is deploy.env's, the one place the domain is set (or the image build's copy of it)", () => {
		const file = readFileSync(new URL('../../../deploy.env', import.meta.url), 'utf8');
		const expected = process.env.MATHGAME_DOMAIN || parseEnv(file).MATHGAME_DOMAIN;
		expect(expected).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
		expect(import.meta.env.VITE_GAME_DOMAIN).toBe(expected);
	});
});
