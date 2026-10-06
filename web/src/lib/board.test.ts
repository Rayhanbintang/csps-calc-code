import { describe, expect, it } from 'vitest';
import { BOX_W, BOX_W_WIDE, GRID, SITE_GAP, SITE_PAD, freeSpot, needsPlace, place, siteWidth, snap } from './board.svelte';
import type { Estimate } from './types';

function est(): Estimate {
  return {
    v: 1,
    name: 'x',
    accounts: [
      { id: 'a1', provider: 'aws', label: 'DC', regions: [
        { id: 'r1', region: 'ap-southeast-3', items: [] },
        { id: 'r2', region: 'ap-southeast-1', items: [{ id: 'v', svc: 'vpc', qty: 1, spec: {}, children: [{ id: 'm', svc: 'vm', qty: 1, spec: {} }] }] },
      ] },
      { id: 'a2', provider: 'gcp', label: 'DRC', regions: [{ id: 'r3', region: 'asia-southeast2', items: [] }] },
    ],
  };
}

describe('board placement', () => {
  it('places v1 estimates: sites left to right, boxes left to right', () => {
    const e = est();
    expect(needsPlace(e)).toBe(true);
    expect(place(e)).toBe(true);
    const [dc, drc] = e.accounts;
    // r1 is a plain box (336 wide); r2 holds a tree, so it is wide (608) and starts after r1 + one grid step.
    expect(dc.regions[0].at).toEqual({ x: 0, y: 0 });
    expect(dc.regions[1].at).toEqual({ x: BOX_W + GRID, y: 0 }); // 352
    expect(siteWidth(dc)).toBe(BOX_W + GRID + BOX_W_WIDE + SITE_PAD * 2); // 352 + 608 + 32 = 992
    expect(dc.at).toEqual({ x: 0, y: 0 });
    expect(drc.at).toEqual({ x: 992 + SITE_GAP, y: 0 }); // 1040
    expect(needsPlace(e)).toBe(false);
    expect(place(e)).toBe(false);
  });

  it('keeps positions the SA set and puts a new site to the right of everything', () => {
    const e = est();
    place(e);
    e.accounts[1].at = { x: 2000, y: 400 };
    place(e);
    expect(e.accounts[1].at).toEqual({ x: 2000, y: 400 });
    // DRC: one plain box, 336 + 32 = 368 wide, so it ends at 2368; next spot 2368 + 48 = 2416.
    expect(freeSpot(e)).toEqual({ x: snap(2416), y: 0 });
  });
});
