import { describe, expect, it, vi } from 'vitest';

vi.mock('./db/index.js', () => ({ pingDb: async () => false }));

const { createApp } = await import('./app.js');

describe('GET /api/health', () => {
	it('reports db status and returns 503 when the db is down', async () => {
		const res = await createApp().request('/api/health');
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: true, db: false });
	});
});
