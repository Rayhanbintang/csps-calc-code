import { describe, expect, it } from 'vitest';
import { BOX_W, BOX_W_WIDE, GRID, SITE_GAP, SITE_PAD, boxWidth, freeSpot, layoutCards, needsPlace, place, settleCards, siteWidth, snap } from './board.svelte';
import type { Estimate, Item } from './types';

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

describe('cards placed freely inside a box', () => {
  const card = (id: string, at?: Item['at']): Item => ({ id, svc: 'vpc', qty: 1, spec: {}, at });
  const h = () => 100;
  it('cards without a spot stack at the left, full width, as before', () => {
    const { slots, height } = layoutCards([card('a'), card('b')], 318, h);
    expect(slots.get('a')).toEqual({ x: 0, y: 0, w: 318 });
    expect(slots.get('b')).toEqual({ x: 0, y: 108, w: 318 });
    expect(height).toBe(208);
  });
  it('two VPCs side by side; a new card stacks below them at the usual width', () => {
    const items = [card('a', { x: 0, y: 0, w: 400 }), card('b', { x: 416, y: 0, w: 400 }), card('c')];
    const { slots } = layoutCards(items, 816, h);
    expect(slots.get('c')).toEqual({ x: 0, y: 108, w: 318 });
  });
  it('a dropped card that overlaps another moves below it, and order follows the layout', () => {
    const items = [card('a', { x: 0, y: 0, w: 300 }), card('b', { x: 0, y: 200, w: 300 }), card('c', { x: 100, y: 40, w: 300 })];
    settleCards(items, 'c', h);
    expect(items.find((i) => i.id === 'c')!.at!.y).toBeGreaterThanOrEqual(308);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
  it('a box is never narrower than its rightmost card', () => {
    expect(boxWidth({ id: 'r', region: 'x', items: [card('a', { x: 416, y: 0, w: 400 })] })).toBe(416 + 400 + 18);
  });
});
