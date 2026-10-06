// The board: a pan-and-zoom surface where site frames and region boxes sit where the SA
// puts them, like a diagram tool. Cards inside a box still stack on their own, so nesting
// and totals work as before.
import type { Account, At, Estimate, RegionBox } from './types';

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

export function boxWidth(box: RegionBox): number {
  if (box.at?.w) return box.at.w;
  return box.items.some((i) => i.children?.length) ? BOX_W_WIDE : BOX_W;
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

/** Moves a frame with the pointer, snapped to the grid. Call from onpointerdown on its handle. */
export function grab(e: PointerEvent, get: () => At, set: (at: At) => void, done?: () => void): void {
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
    set({ x: Math.max(0, snap(start.x + (ev.clientX - sx) / view.z)), y: Math.max(0, snap(start.y + (ev.clientY - sy) / view.z)) });
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    document.documentElement.classList.remove('moving-frame');
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
