<script lang="ts">
  import { untrack } from 'svelte';
  import { app, find, repriceAll, saveTabs } from '../lib/store.svelte';
  import Header from './Header.svelte';
  import Tabs from './Tabs.svelte';
  import Palette from './Palette.svelte';
  import Canvas from './Canvas.svelte';
  import Review from './Review.svelte';
  import Inspector from './Inspector.svelte';
  import Summary from './Summary.svelte';
  import Reminders from './Reminders.svelte';
  import Footer from './Footer.svelte';

  // Price again and keep the draft whenever the estimate or the price list changes.
  // The pricing run itself is untracked: it reads and writes state (prices, the busy
  // counter) that must not trigger this effect again.
  $effect(() => {
    void JSON.stringify(app.est);
    void app.tab;
    void app.tabs.length;
    void app.manifest;
    untrack(() => {
      saveTabs();
      repriceAll();
    });
  });

  // Sidebar width: dragged by the handle, remembered in this browser.
  const NAV_KEY = 'csps-calc:nav-width';
  const NAV_MIN = 170, NAV_MAX = 440, NAV_DEFAULT = 230;
  let navW = $state(NAV_DEFAULT);
  try {
    const saved = Number(localStorage.getItem(NAV_KEY));
    if (saved >= NAV_MIN && saved <= NAV_MAX) navW = saved;
  } catch {
    /* storage blocked: default width */
  }
  function setNav(w: number) {
    navW = Math.round(Math.min(NAV_MAX, Math.max(NAV_MIN, w)));
    try { localStorage.setItem(NAV_KEY, String(navW)); } catch { /* ignore */ }
  }
  let dragging = $state(false);
  function startDrag(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    dragging = true;
    const startX = e.clientX, startW = navW;
    const move = (ev: PointerEvent) => setNav(startW + ev.clientX - startX);
    const up = () => {
      dragging = false;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }
  function keyResize(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') { setNav(navW - 20); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setNav(navW + 20); e.preventDefault(); }
    if (e.key === 'Home') { setNav(NAV_DEFAULT); e.preventDefault(); }
  }

  // find() searches the whole tree, so items inside a VPC, cluster or VM open too.
  const selectedExists = $derived(app.selected !== null && find(app.selected) !== undefined);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') app.selected = null;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
  <Header />
  <Tabs />
  {#if app.manifestError}
    <div class="error" role="alert">The price list did not load ({app.manifestError}). Reload the page in a minute.</div>
  {/if}
  <div class="layout" class:dragging style:--nav-w="{navW}px">
    <div class="navcol">
      <Palette />
      <!-- A focusable separator is the ARIA window-splitter pattern; the linter does not know it. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the service list"
        aria-valuemin={NAV_MIN}
        aria-valuemax={NAV_MAX}
        aria-valuenow={navW}
        tabindex="0"
        title="Drag to resize. Double-click to reset."
        onpointerdown={startDrag}
        ondblclick={() => setNav(NAV_DEFAULT)}
        onkeydown={keyResize}
      ></div>
    </div>
    <main>
      <div class="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected={app.view === 'canvas'} class:on={app.view === 'canvas'} onclick={() => (app.view = 'canvas')}>Canvas</button>
        <button role="tab" aria-selected={app.view === 'review'} class:on={app.view === 'review'} onclick={() => (app.view = 'review')}>Review table</button>
        <span class="status small muted" aria-live="polite">{app.busy > 0 ? 'Pricing…' : ''}</span>
      </div>
      <Reminders />
      {#if app.view === 'canvas'}
        <Canvas />
      {:else}
        <Review />
      {/if}
    </main>
    <aside class:open={selectedExists}>
      {#if selectedExists}
        <Inspector itemId={app.selected!} />
      {:else}
        <Summary />
      {/if}
    </aside>
  </div>
  <Footer />
</div>

<style>
  .shell { min-height: 100vh; display: flex; flex-direction: column; }
  .layout {
    flex: 1;
    display: grid;
    /* The sidebar never takes more than 35% of the window, whatever width was saved. */
    grid-template-columns: min(var(--nav-w, 230px), 35vw) minmax(0, 1fr) minmax(360px, 560px);
    gap: 16px;
    padding: 16px;
    align-items: start;
  }
  main { min-width: 0; }
  .navcol { position: sticky; top: 16px; min-width: 0; }
  .resizer {
    position: absolute;
    top: 0;
    right: -11px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    border-radius: 4px;
    touch-action: none;
  }
  .resizer::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 2px;
    background: var(--line);
  }
  .resizer:hover::after, .resizer:focus-visible::after, .dragging .resizer::after { background: var(--accent); }
  .dragging { cursor: col-resize; user-select: none; }
  aside {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 110px);
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
  .tabs button { border-radius: 999px; }
  .tabs button.on { background: var(--text); color: var(--bg); border-color: var(--text); }
  .status { margin-left: auto; }
  .error { margin: 12px 16px 0; padding: 10px 12px; border: 1px solid var(--danger); border-radius: 8px; color: var(--danger); }
  @media (max-width: 1180px) {
    .layout { grid-template-columns: min(var(--nav-w, 230px), 35vw) minmax(0, 1fr); }
    aside { grid-column: 1 / -1; position: static; max-height: none; }
  }
  @media (max-width: 760px) {
    /* On a phone the estimate comes first; the service list follows it. */
    .layout { grid-template-columns: minmax(0, 1fr); padding: 12px 16px; }
    main { order: 1; }
    aside { order: 2; }
    .navcol { order: 3; position: static; }
    .resizer { display: none; }
  }
</style>
