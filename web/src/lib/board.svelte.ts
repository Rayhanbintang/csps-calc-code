// The board: a pan-and-zoom surface where site frames, region boxes and the cards at the
// top of each box sit where the SA puts them, like a diagram tool. What sits inside a card
// (a VPC's VMs, a VM's disks) still stacks inside it, so nesting and totals work as before.
import { tick } from 'svelte';
import type { Account, At, Estimate, Item, RegionBox } from './types';

export const GRID = 16;
export const BOX_W = 336;
export const BOX_W_WIDE = 608;
export const BOX_MIN_W = 272;
export const SITE_PAD = 16;
export const SITE_GAP = 48;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

/** Pan (x, y in screen pixels) and zoom of the board on screen. Not saved with the estimate.
 *  `reserve` is the width the right drawer covers, so "fit" keeps sites clear of it. */
export const view = $state({ x: 24, y: 24, z: 1, reserve: 0 });

export function snap(n: number): number {
  return Math.round(n / GRID) * GRID;
}

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Zooms to `z` keeping the board point under (cx, cy) in place. cx, cy are relative to the viewport. */
export function zoomAt(cx: number, cy: number, z: number): void {
  const next = clampZoom(z);
  const bx = (cx - view.x) / view.z, by = (cy - view.y) / view.z;
  view.z = next;
  view.x = cx - bx * next;
  view.y = cy - by * next;
}

/** Padding and border around the cards inside a box. */
export const BOX_INSET = 18;
export const CARD_GAP = 8;
export const CARD_MIN_W = 208;

/** Width of a box: as set, or by content, and never narrower than its rightmost card. */
export function boxWidth(box: RegionBox): number {
  const base = box.at?.w ?? (box.items.some((i) => i.children?.length) ? BOX_W_WIDE : BOX_W);
  return box.items.reduce((m, i) => (i.at ? Math.max(m, i.at.x + (i.at.w ?? 0) + BOX_INSET) : m), base);
}

export interface Slot { x: number; y: number; w: number }

/** Where each top-level card of a box sits. Placed cards keep their spot; the others
 *  stack at the left, below every placed card they would overlap. `h` gives a card's
 *  measured height. */
export function layoutCards(items: Item[], inner: number, h: (id: string) => number): { slots: Map<string, Slot>; height: number } {
  const slots = new Map<string, Slot>();
  const taken: (Slot & { h: number })[] = [];
  for (const it of items) {
    if (!it.at) continue;
    const s = { x: it.at.x, y: it.at.y, w: it.at.w ?? inner };
    slots.set(it.id, s);
    taken.push({ ...s, h: h(it.id) });
  }
  // Once the SA has placed cards, new ones take a card's usual width instead of
  // stretching across a box that grew to hold cards side by side.
  const w = taken.length ? Math.min(inner, BOX_W - BOX_INSET) : inner;
  for (const it of items) {
    if (it.at) continue;
    const y = taken.filter((t) => t.x < w && t.x + t.w > 0).reduce((m, t) => Math.max(m, t.y + t.h + CARD_GAP), 0);
    const s = { x: 0, y, w };
    slots.set(it.id, s);
    taken.push({ ...s, h: h(it.id) });
  }
  const height = taken.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  return { slots, height };
}

/** Gives every card of the box its current spot, so moving one leaves the others put. */
export function freezeCards(items: Item[], slots: Map<string, Slot>): void {
  for (const it of items) {
    const s = slots.get(it.id);
    if (!it.at && s) it.at = { x: s.x, y: s.y, w: s.w };
  }
}

/** Puts placed cards in reading order: top to bottom, then left to right. */
export function orderCards(items: Item[]): void {
  items.sort((a, b) => (a.at?.y ?? 0) - (b.at?.y ?? 0) || (a.at?.x ?? 0) - (b.at?.x ?? 0));
}

/** Arrow keys move a frame or card one grid step, four with Shift. Returns the step, or
 *  null for any other key. */
export function arrowStep(e: KeyboardEvent): { dx: number; dy: number } | null {
  const n = (e.shiftKey ? 4 : 1) * GRID;
  const d = ({ ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] } as Record<string, [number, number]>)[e.key];
  return d ? { dx: d[0], dy: d[1] } : null;
}

/** Moves a dropped card down until it overlaps no other card, then puts the cards in
 *  reading order (top to bottom, left to right) so lists and exports follow the layout. */
export function settleCards(items: Item[], id: string, h: (id: string) => number): void {
  const me = items.find((i) => i.id === id);
  if (!me?.at) return;
  const others = items.filter((i) => i.id !== id && i.at);
  const hit = () => others.find((o) => {
    const a = me.at!, b = o.at!;
    return a.x < b.x + (b.w ?? 0) && b.x < a.x + (a.w ?? 0) && a.y < b.y + h(o.id) && b.y < a.y + h(me.id);
  });
  for (let o = hit(), n = 0; o && n < 50; o = hit(), n++) me.at = { ...me.at!, y: snap(o.at!.y + h(o.id) + CARD_GAP + GRID / 2) };
  orderCards(items);
}

/** Width of a site frame: room for its rightmost box. */
export function siteWidth(acc: Account): number {
  const right = acc.regions.reduce((m, b) => Math.max(m, (b.at?.x ?? 0) + boxWidth(b)), BOX_W);
  return right + SITE_PAD * 2;
}

/** Gives every site and box without a position one: sites left to right, boxes left to
 *  right inside their site. Returns true when anything changed. */
export function place(est: Estimate): boolean {
  let changed = false;
  let right = 0;
  for (const acc of est.accounts) {
    let boxRight = 0;
    for (const box of acc.regions) {
      if (!box.at) {
        box.at = { x: boxRight ? boxRight + GRID : 0, y: 0 };
        changed = true;
      }
      boxRight = Math.max(boxRight, box.at.x + boxWidth(box));
    }
    if (!acc.at) {
      acc.at = { x: right ? right + SITE_GAP : 0, y: 0 };
      changed = true;
    }
    right = Math.max(right, acc.at.x + siteWidth(acc));
  }
  return changed;
}

/** Whether any site or box still needs a position. */
export function needsPlace(est: Estimate): boolean {
  return est.accounts.some((a) => !a.at || a.regions.some((r) => !r.at));
}

/** A free spot to the right of everything on the board, for a new or copied site. */
export function freeSpot(est: Estimate): At {
  const right = est.accounts.reduce((m, a) => Math.max(m, (a.at?.x ?? 0) + siteWidth(a)), 0);
  return { x: right ? snap(right + SITE_GAP) : 0, y: 0 };
}

/** A free spot to the right of the site's boxes, for a new or copied box. */
export function freeBoxSpot(acc: Account): At {
  const right = acc.regions.reduce((m, b) => Math.max(m, (b.at?.x ?? 0) + boxWidth(b)), 0);
  return { x: right ? snap(right + GRID) : 0, y: 0 };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Distance in board pixels at which an edge or centre lines up with a neighbour's. */
export const ALIGN = 6;

/** The guide line shown while a frame or card lines up with a neighbour. `scope` names the
 *  container whose coordinates x and y use: a box id for cards, "acc:<id>" for boxes,
 *  "world" for sites. */
export const guide = $state({ scope: '', x: null as number | null, y: null as number | null });

/** Snaps a moving rectangle to its neighbours' left, right and centre lines (and top,
 *  bottom, middle) when one of its own lines comes within ALIGN pixels. */
export function align(r: Rect, others: Rect[]): { x: number; y: number; gx: number | null; gy: number | null } {
  const pick = (mine: number[], theirs: number[]) => {
    let best = ALIGN + 1, d = 0, line: number | null = null;
    for (const m of mine) for (const t of theirs) {
      if (Math.abs(t - m) < best) { best = Math.abs(t - m); d = t - m; line = t; }
    }
    return line === null ? { d: 0, line } : { d, line };
  };
  const px = pick([r.x, r.x + r.w, r.x + r.w / 2], others.flatMap((o) => [o.x, o.x + o.w, o.x + o.w / 2]));
  const py = pick([r.y, r.y + r.h, r.y + r.h / 2], others.flatMap((o) => [o.y, o.y + o.h, o.y + o.h / 2]));
  return { x: Math.max(0, r.x + px.d), y: Math.max(0, r.y + py.d), gx: px.line, gy: py.line };
}

/** Neighbours to line up with while moving, and the moving thing's size. */
export interface Guides { scope: string; size: () => { w: number; h: number }; others: () => Rect[] }

/** Moves a frame with the pointer, snapped to the grid, and to a neighbour's lines when
 *  `guides` is given. Call from onpointerdown on its handle. */
export function grab(e: PointerEvent, get: () => At, set: (at: At) => void, done?: () => void, guides?: Guides): void {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const start = { ...get() };
  const sx = e.clientX, sy = e.clientY;
  document.documentElement.classList.add('moving-frame');
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const at = { x: Math.max(0, snap(start.x + (ev.clientX - sx) / view.z)), y: Math.max(0, snap(start.y + (ev.clientY - sy) / view.z)) };
    if (!guides) return set(at);
    const a = align({ ...at, ...guides.size() }, guides.others());
    guide.scope = guides.scope;
    guide.x = a.gx;
    guide.y = a.gy;
    set({ x: a.x, y: a.y });
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    document.documentElement.classList.remove('moving-frame');
    guide.scope = '';
    done?.();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** Resizes a box's width with the pointer. */
export function grabWidth(e: PointerEvent, get: () => number, set: (w: number) => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const start = get();
  const sx = e.clientX;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === e.pointerId) set(Math.max(BOX_MIN_W, snap(start + (ev.clientX - sx) / view.z)));
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

/** The card that just flashed to show where it is. */
export const flash = $state({ id: null as string | null });
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Pans (and zooms in, when far out) so the card sits in the middle of the free board, then
 *  flashes it. In the stacked phone layout it scrolls the page instead. */
export async function focusItem(id: string): Promise<void> {
  await tick();
  const el = document.querySelector<HTMLElement>(`.card[data-item="${CSS.escape(id)}"]`);
  if (!el) return;
  flash.id = id;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.id = null), 1600);
  const vp = el.closest<HTMLElement>('.viewport.free');
  if (!vp) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const v = vp.getBoundingClientRect();
  let r = el.getBoundingClientRect();
  if (view.z < 0.8) {
    zoomAt(r.left + r.width / 2 - v.left, r.top + r.height / 2 - v.top, 0.8);
    await tick();
    r = el.getBoundingClientRect();
  }
  // Centre the card in the part of the board not under the drawer; a card wider than
  // that shows its left edge, where its name is.
  const avail = v.width - view.reserve;
  const dx = r.width > avail - 48 ? 24 - (r.left - v.left) : avail / 2 - (r.left + r.width / 2 - v.left);
  const dy = v.height / 2 - (r.top + r.height / 2 - v.top);
  const x0 = view.x, y0 = view.y, t0 = performance.now(), ms = 280;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    view.x = x0 + dx * e;
    view.y = y0 + dy * e;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
