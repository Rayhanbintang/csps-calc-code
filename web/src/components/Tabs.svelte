<script lang="ts">
  import { app, prices, closeTab, duplicateTab, newTab, openTab, tabName } from '../lib/store.svelte';
  import { estimateTotals } from '../lib/engine';
  import { money } from '../lib/report';

  const live = $derived(estimateTotals(app.est, prices).monthly);

  function close(id: string, name: string) {
    if (confirm(`Close "${name}"? It stays only if you saved a link.`)) closeTab(id);
  }
</script>

<div class="bar" role="tablist" aria-label="Open estimates">
  {#each app.tabs as t (t.id)}
    {@const on = t.id === app.tab}
    {@const name = tabName(t)}
    {@const m = on ? live : t.monthly}
    <div class="tab" class:on>
      <button class="open" role="tab" aria-selected={on} onclick={() => openTab(t.id)} title={name}>
        <span class="nm">{name}</span>
        {#if m !== undefined}<span class="num small">{money(m)}</span>{/if}
      </button>
      <button class="ghost small ic" title="Copy this estimate into a new tab" aria-label="Copy {name}" onclick={() => duplicateTab(t.id)}>⧉</button>
      <button class="ghost small ic" title="Close this tab" aria-label="Close {name}" onclick={() => close(t.id, name)}>✕</button>
    </div>
  {/each}
  <button class="ghost add" onclick={newTab} title="Open a new, empty estimate">+ New tab</button>
</div>

<style>
  .bar {
    display: flex;
    gap: 4px;
    align-items: end;
    padding: 8px 16px 0;
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--line);
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    background: var(--bg);
    max-width: 280px;
    flex: 0 0 auto;
  }
  .tab.on { background: var(--panel); border-color: var(--accent); box-shadow: inset 0 2px 0 var(--accent); margin-bottom: -1px; padding-bottom: 1px; }
  .open { display: flex; gap: 8px; align-items: baseline; border: 0; background: transparent; padding: 6px 4px 6px 10px; min-width: 0; }
  .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
  .tab:not(.on) .nm { font-weight: 500; color: var(--muted); }
  .ic { padding: 2px 5px; border: 0; }
  .add { flex: 0 0 auto; margin-bottom: 4px; font-size: 13px; }
</style>
