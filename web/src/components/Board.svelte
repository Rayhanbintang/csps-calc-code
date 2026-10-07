<script lang="ts">
  import type { Snippet } from 'svelte';
  import { view, zoomAt, clampZoom } from '../lib/board.svelte';
  import { drag, setScroller } from '../lib/drag.svelte';

  let { children, overlay, free }: { children: Snippet; overlay?: Snippet; free: boolean } = $props();

  let vp = $state<HTMLDivElement>();
  let world = $state<HTMLDivElement>();
  let panning = $state(false);

  // While the board is on screen, a drag near its edge pans the board.
  $effect(() => {
    if (!free || !vp) return;
    const el = vp;
    setScroller({
      rect: () => el.getBoundingClientRect(),
      by: (dx, dy) => { view.x -= dx; view.y -= dy; },
    });
    return () => setScroller(null);
  });

  // Wheel: scroll pans, Ctrl or pinch on a trackpad zooms. Attached by hand because
  // Svelte adds wheel handlers as passive, and a passive handler cannot stop the page zoom.
  $effect(() => {
    if (!free || !vp) return;
    const el = vp;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, view.z * Math.exp(-e.deltaY * 0.0025));
      else if (e.shiftKey && !e.deltaX) view.x -= e.deltaY;
      else { view.x -= e.deltaX; view.y -= e.deltaY; }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  // Panning: a mouse on empty board, the middle button anywhere, or a finger anywhere
  // (a long press on a card starts a card drag instead). Two fingers pinch to zoom.
  const pts = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; z: number } | null = null;

  function blocks(t: HTMLElement): boolean {
    return !!t.closest('input, select, textarea, button, a, label, [role="separator"], .grip, .resize, .cresize, .zoombar');
  }

  function down(e: PointerEvent) {
    if (!free) return;
    const t = e.target as HTMLElement;
    const touch = e.pointerType === 'touch';
    const empty = !t.closest('.account');
    if (!(e.button === 1 || (touch && !blocks(t)) || (e.button === 0 && empty && !blocks(t)))) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z };
    }
    if (pts.size > 1) return;
    if (!touch) e.preventDefault();
    let lx = e.clientX, ly = e.clientY, moved = false;
    const move = (ev: PointerEvent) => {
      if (!pts.has(ev.pointerId)) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (drag.active) return; // a long press turned this touch into a card drag
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const r = vp!.getBoundingClientRect();
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        return;
      }
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      panning = true;
      view.x += ev.clientX - lx;
      view.y += ev.clientY - ly;
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = (ev: PointerEvent) => {
      pts.delete(ev.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size) return;
      panning = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // A pan that moved should not also count as a click on what lies under it.
      // The blocker expires right after, so it never eats a later, real click.
      if (moved) {
        const stop = (c: Event) => c.stopPropagation();
        window.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function zoomBy(f: number) {
    const r = vp!.getBoundingClientRect();
    zoomAt(r.width / 2, r.height / 2, view.z * f);
  }

  /** Zooms and pans so every site fits on screen. */
  export function fit() {
    if (!vp || !world) return;
    const frames = [...world.querySelectorAll<HTMLElement>(':scope > .account')];
    if (!frames.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of frames) {
      x0 = Math.min(x0, f.offsetLeft);
      y0 = Math.min(y0, f.offsetTop);
      x1 = Math.max(x1, f.offsetLeft + f.offsetWidth);
      y1 = Math.max(y1, f.offsetTop + f.offsetHeight);
    }
    const r = vp.getBoundingClientRect();
    const pad = 32;
    const w = r.width - view.reserve;
    const z = clampZoom(Math.min((w - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0), 1));
    view.z = z;
    view.x = pad - x0 * z;
    view.y = pad - y0 * z;
  }

  // ---- Minimap: every site and box in small, and the part of the board on screen ----
  const MM_W = 180, MM_H = 120;
  type R = { x: number; y: number; w: number; h: number; kind: string; cls: string };
  let shapes = $state<R[]>([]);
  let vpSize = $state({ w: 0, h: 0 });
  let showMap = $state(true);

  function measure() {
    if (!vp || !world) return;
    const wr = world.getBoundingClientRect();
    const z = view.z || 1;
    const list: R[] = [];
    for (const el of world.querySelectorAll<HTMLElement>('.account, .box')) {
      const r = el.getBoundingClientRect();
      const kind = el.classList.contains('account') ? 'site' : 'box';
      const cls = kind === 'site' ? ['aws', 'gcp', 'oci', 'azure', 'onprem'].find((c) => el.classList.contains(c)) ?? '' : '';
      list.push({ x: (r.left - wr.left) / z, y: (r.top - wr.top) / z, w: r.width / z, h: r.height / z, kind, cls });
    }
    shapes = list;
    const v = vp.getBoundingClientRect();
    vpSize = { w: v.width, h: v.height };
  }

  // Re-measure when anything on the board moves, grows or changes.
  $effect(() => {
    if (!free || !world) return;
    const w = world;
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const mo = new MutationObserver(later);
    mo.observe(w, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    const ro = new ResizeObserver(later);
    ro.observe(w);
    if (vp) ro.observe(vp);
    later();
    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  });

  /** The visible part of the board, in board pixels. */
  const seen = $derived({ x: -view.x / view.z, y: -view.y / view.z, w: (vpSize.w - view.reserve) / view.z, h: vpSize.h / view.z });
  const bounds = $derived.by(() => {
    const all = [...shapes, seen];
    if (!shapes.length) return null;
    const x0 = Math.min(...all.map((r) => r.x)), y0 = Math.min(...all.map((r) => r.y));
    const x1 = Math.max(...all.map((r) => r.x + r.w)), y1 = Math.max(...all.map((r) => r.y + r.h));
    const k = Math.min(MM_W / (x1 - x0), MM_H / (y1 - y0));
    return { x0, y0, k };
  });

  /** Click or drag on the minimap: that point moves to the middle of the board. */
  function mapDown(e: PointerEvent) {
    if (!bounds) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = e.currentTarget as SVGSVGElement;
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const go = (ev: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const wx = bounds.x0 + (ev.clientX - r.left) / bounds.k;
      const wy = bounds.y0 + (ev.clientY - r.top) / bounds.k;
      view.x = (vpSize.w - view.reserve) / 2 - wx * view.z;
      view.y = vpSize.h / 2 - wy * view.z;
    };
    go(e);
    const up = () => {
      svg.removeEventListener('pointermove', go);
      svg.removeEventListener('pointerup', up);
    };
    svg.addEventListener('pointermove', go);
    svg.addEventListener('pointerup', up);
  }

  function onKey(e: KeyboardEvent) {
    if (!free || (e.target as HTMLElement).closest('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.2); }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); view.z = 1; }
    if (e.shiftKey && e.key === '!') fit();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if overlay}<div class="toolbar">{@render overlay()}</div>{/if}

<div class="viewport" class:free class:panning bind:this={vp} onpointerdown={down} style:--z={free ? view.z : undefined} style:background-position={free ? `${view.x}px ${view.y}px` : undefined} role="application" aria-label="Estimate board">
  <div class="world" bind:this={world} style:transform={free ? `translate(${view.x}px, ${view.y}px) scale(${view.z})` : undefined}>
    {@render children()}
  </div>
  {#if free}
    <div class="zoombar" role="toolbar" aria-label="Zoom">
      <button class="ghost small" onclick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" title="Zoom out (Ctrl −)">−</button>
      <button class="ghost small pct" onclick={() => (view.z = 1)} title="Back to 100% (Ctrl 0)">{Math.round(view.z * 100)}%</button>
      <button class="ghost small" onclick={() => zoomBy(1.2)} aria-label="Zoom in" title="Zoom in (Ctrl +)">+</button>
      <button class="ghost small" onclick={fit} title="Fit every site on screen (Shift 1)">Fit</button>
      <button class="ghost small" class:on={showMap} onclick={() => (showMap = !showMap)} aria-pressed={showMap} title="Show or hide the minimap">Map</button>
    </div>
    {#if showMap && bounds}
      <svg class="minimap" width={MM_W} height={MM_H} style:right="{view.reserve + 10}px" role="img" aria-label="Minimap of the board; click to move there" onpointerdown={mapDown}>
        {#each shapes as r}
          <rect class="{r.kind} {r.cls}" x={(r.x - bounds.x0) * bounds.k} y={(r.y - bounds.y0) * bounds.k} width={Math.max(1, r.w * bounds.k)} height={Math.max(1, r.h * bounds.k)} rx="1.5" />
        {/each}
        <rect class="seen" x={(seen.x - bounds.x0) * bounds.k} y={(seen.y - bounds.y0) * bounds.k} width={seen.w * bounds.k} height={seen.h * bounds.k} />
      </svg>
    {/if}
  {/if}
</div>

<style>
  .viewport { position: relative; }
  .viewport.free {
    flex: 1;
    min-height: 360px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    touch-action: none;
    cursor: default;
    /* A dot grid, like a diagram tool. It moves with the pan and scales with the zoom. */
    background-color: var(--bg);
    background-image: radial-gradient(circle, var(--line) 1px, transparent 1.2px);
    background-size: calc(16px * var(--z, 1)) calc(16px * var(--z, 1));
  }
  .viewport.panning { cursor: grabbing; }
  .free .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 8px; }
  .zoombar {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    z-index: 5;
  }
  .zoombar button { min-width: 30px; padding: 3px 7px; border: 0; }
  .pct { font-variant-numeric: tabular-nums; min-width: 48px; }
  .zoombar .on { color: var(--accent); }
  .minimap {
    position: absolute; bottom: 10px; z-index: 5;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow);
    cursor: pointer; touch-action: none;
  }
  .minimap .site { fill: color-mix(in srgb, var(--onprem) 18%, transparent); stroke: var(--onprem); stroke-width: 1; }
  .minimap .site.aws { fill: color-mix(in srgb, var(--aws) 18%, transparent); stroke: var(--aws); }
  .minimap .site.gcp { fill: color-mix(in srgb, var(--gcp) 18%, transparent); stroke: var(--gcp); }
  .minimap .site.oci { fill: color-mix(in srgb, var(--oci) 18%, transparent); stroke: var(--oci); }
  .minimap .site.azure { fill: color-mix(in srgb, var(--azure) 18%, transparent); stroke: var(--azure); }
  .minimap .box { fill: var(--panel-2); stroke: var(--line); stroke-width: 0.5; }
  .minimap .seen { fill: color-mix(in srgb, var(--accent) 10%, transparent); stroke: var(--accent); stroke-width: 1.5; }
  @media (max-width: 760px) { .minimap { display: none; } }
</style>
