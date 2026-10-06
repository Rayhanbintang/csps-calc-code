// Drag and drop on Pointer Events, so mouse, touch and pen take one path. HTML5 drag and
// drop never fires on touch screens.
//
// Drop zones mark themselves with data attributes; the engine finds the one under the
// pointer with elementFromPoint and publishes it in `drag.target`, so each zone can draw
// its own highlight. A mouse or pen drag starts after a few pixels of movement. A touch
// drag starts after a long press, so a swipe still scrolls the page.
import { addItem, find, moveItems } from './store.svelte';
import { canHold, contains } from './tree';

/** A place a drag can land. */
export interface DropTarget {
  kind: 'box' | 'card' | 'inside';
  boxId: string;
  /** Container the item lands in (cards: the card's parent; inside: the card itself). */
  parentId?: string;
  /** The card under the pointer (card and inside zones). */
  itemId?: string;
  /** Position in the list; undefined = the end. */
  index?: number;
  edge?: 'before' | 'after';
  ok: boolean;
}

export const drag = $state({
  active: false,
  svc: undefined as string | undefined,
  ids: undefined as string[] | undefined,
  label: '',
  x: 0,
  y: 0,
  target: null as DropTarget | null,
});

const MOVE_PX = 5;
const PRESS_MS = 350;
const PRESS_SLOP = 8;

/** Whether the current drag may drop into a container (parentId) or a box (none). */
export function accepts(parentId?: string): boolean {
  const parent = parentId ? find(parentId)?.item : undefined;
  const parentSvc = parent?.svc ?? null;
  if (drag.svc) return canHold(parentSvc, drag.svc);
  if (drag.ids?.length) {
    return drag.ids.some((id) => {
      const f = find(id);
      if (!f) return false;
      if (parent && contains(f.item, parent.id)) return false;
      return canHold(parentSvc, f.item.svc);
    });
  }
  return false;
}

/** Reads the drop zone under a point. */
function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return null;
  const d = el.dataset;
  const boxId = d.box ?? '';
  if (d.drop === 'box') return { kind: 'box', boxId, ok: accepts(undefined) };
  if (d.drop === 'inside') return { kind: 'inside', boxId, parentId: d.item, itemId: d.item, ok: accepts(d.item) };
  if (d.drop === 'card') {
    const itemId = d.item!;
    const parentId = d.parent || undefined;
    if (drag.ids?.includes(itemId)) return null;
    const r = el.getBoundingClientRect();
    const edge = y < r.top + r.height / 2 ? 'before' : 'after';
    const index = Number(d.index) + (edge === 'after' ? 1 : 0);
    return { kind: 'card', boxId, parentId, itemId, index, edge, ok: accepts(parentId) };
  }
  return null;
}

/** Scroll speed near the window edges, in pixels per frame. */
function edgeSpeed(p: number, size: number): number {
  const zone = 48;
  if (p < zone) return -Math.ceil((zone - p) / 4);
  if (p > size - zone) return Math.ceil((p - (size - zone)) / 4);
  return 0;
}

let frame = 0;
function autoScroll() {
  if (!drag.active) return;
  const dy = edgeSpeed(drag.y, window.innerHeight);
  if (dy) window.scrollBy(0, dy);
  if (dy) drag.target = targetAt(drag.x, drag.y);
  frame = requestAnimationFrame(autoScroll);
}

function drop() {
  const t = drag.target;
  if (!t?.ok) return;
  if (drag.svc) addItem(t.boxId, drag.svc, undefined, t.parentId, t.index);
  else if (drag.ids) moveItems([...drag.ids], { boxId: t.boxId, parentId: t.parentId }, t.index);
  if (t.kind === 'inside' && t.itemId) {
    const f = find(t.itemId);
    if (f?.item.folded) f.item.folded = false;
  }
}

function reset() {
  cancelAnimationFrame(frame);
  drag.active = false;
  drag.svc = undefined;
  drag.ids = undefined;
  drag.target = null;
  document.documentElement.classList.remove('dragging-item');
}

/** A click fires after a drag ends on the same element; swallow that one click. */
function swallowClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

// While a touch drag runs, the page must not scroll under the finger.
if (typeof window !== 'undefined') {
  window.addEventListener('touchmove', (e) => { if (drag.active && e.cancelable) e.preventDefault(); }, { passive: false });
  window.addEventListener('contextmenu', (e) => { if (drag.active || pending) e.preventDefault(); });
}
let pending = false;

/** What a pointerdown should drag: a service from the list or items on the canvas. */
export interface Payload {
  svc?: string;
  ids?: string[];
  label: string;
}

/** Call from onpointerdown. `payload` is read when the drag actually starts. */
export function press(e: PointerEvent, payload: () => Payload): void {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea, button:not([data-drag-handle]), a')) {
    // Controls inside a card keep working; only the palette buttons are handles.
    if (!target.closest('[data-drag-handle]')) return;
  }
  const el = e.currentTarget as HTMLElement;
  const touch = e.pointerType === 'touch';
  const sx = e.clientX, sy = e.clientY;
  let timer = 0;
  pending = true;

  const begin = () => {
    const p = payload();
    drag.svc = p.svc;
    drag.ids = p.ids;
    drag.label = p.label;
    drag.active = true;
    drag.x = sx;
    drag.y = sy;
    drag.target = targetAt(sx, sy);
    document.documentElement.classList.add('dragging-item');
    try { el.setPointerCapture(e.pointerId); } catch { /* element gone */ }
    if (touch) navigator.vibrate?.(15);
    frame = requestAnimationFrame(autoScroll);
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
    if (!drag.active) {
      if (touch) {
        if (far > PRESS_SLOP) end(); // a swipe: let the page scroll
        return;
      }
      if (far < MOVE_PX) return;
      begin();
    }
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    drag.target = targetAt(ev.clientX, ev.clientY);
  };

  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const was = drag.active;
    if (was) {
      // Drop where the highlight was shown. Reading the point again could hit another
      // zone if the layout moved since the last pointermove.
      drop();
      swallowClick();
    }
    end();
  };

  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId === e.pointerId) end();
  };

  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') end();
  };

  function end() {
    clearTimeout(timer);
    pending = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
    reset();
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key);
  if (touch) timer = window.setTimeout(begin, PRESS_MS);
}
