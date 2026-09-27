import { describe, expect, it } from 'vitest';
import { rateKey } from '../src/request.js';

describe('rateKey', () => {
	it('keeps an IPv4 address as it is, however it is written', () => {
		expect(rateKey('203.0.113.7')).toBe('203.0.113.7');
		expect(rateKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
	});

	it('gives every address of one IPv6 /64 one key, however it is written', () => {
		const key = '2001:db8:1:2::/64';
		for (const ip of [
			'2001:db8:1:2::1',
			'2001:db8:1:2:aaaa:bbbb:cccc:dddd',
			'2001:0DB8:0001:0002:ffff::',
			'2001:db8:1:2:0:0:0:0',
			'2001:db8:1:2::203.0.113.7',
			'2001:db8:1:2::1%eth0'
		]) {
			expect(rateKey(ip), ip).toBe(key);
		}
	});

	it('gives neighbouring /64s different keys', () => {
		expect(rateKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
		expect(rateKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
		expect(rateKey('::1')).toBe('0:0:0:0::/64');
	});

	it('leaves anything that is not an address as it is', () => {
		for (const text of ['unknown', '', '1:2:3', '1::2::3', '12345::1', 'fe80::zz']) {
			expect(rateKey(text), text).toBe(text);
		}
	});
});
