<script lang="ts">
  import { untrack } from 'svelte';
  import { app, repriceAll, saveDraft } from '../lib/store.svelte';
  import Header from './Header.svelte';
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
    const json = JSON.stringify(app.est);
    void app.manifest;
    untrack(() => {
      saveDraft(JSON.parse(json));
      repriceAll();
    });
  });

  const selectedExists = $derived(
    app.selected !== null && app.est.accounts.some((a) => a.regions.some((r) => r.items.some((i) => i.id === app.selected))),
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') app.selected = null;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
  <Header />
  {#if app.manifestError}
    <div class="error" role="alert">The price list did not load ({app.manifestError}). Reload the page in a minute.</div>
  {/if}
  <div class="layout">
    <Palette />
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
    grid-template-columns: 220px minmax(0, 1fr) minmax(360px, 560px);
    gap: 16px;
    padding: 16px;
    align-items: start;
  }
  main { min-width: 0; }
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
    .layout { grid-template-columns: 200px minmax(0, 1fr); }
    aside { grid-column: 1 / -1; position: static; max-height: none; }
  }
  @media (max-width: 760px) {
    /* On a phone the estimate comes first; the service list follows it. */
    .layout { grid-template-columns: minmax(0, 1fr); padding: 12px 16px; }
    main { order: 1; }
    aside { order: 2; }
    .layout > :global(nav) { order: 3; }
  }
</style>
