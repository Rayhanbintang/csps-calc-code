<script lang="ts">
  import type { Item, Provider } from '../lib/types';
  import { app, prices } from '../lib/store.svelte';
  import { service } from '../lib/catalog';
  import { money } from '../lib/report';

  let { item, provider }: { item: Item; provider: Provider } = $props();
  const svc = $derived(service(item.svc));
  const p = $derived(prices.get(item.id));
  const ticked = $derived(app.ticked.includes(item.id));

  function drag(e: DragEvent) {
    const ids = ticked ? [...app.ticked] : [item.id];
    e.dataTransfer?.setData('application/x-csps-items', JSON.stringify(ids));
    e.dataTransfer!.effectAllowed = 'move';
  }

  function tick(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    app.ticked = on ? [...app.ticked, item.id] : app.ticked.filter((t) => t !== item.id);
  }
</script>

<div
  class="card"
  class:sel={app.selected === item.id}
  class:bad={!!p?.unavailable}
  class:check={!!item.check}
  draggable="true"
  ondragstart={drag}
  role="button"
  tabindex="0"
  aria-label="{item.name || svc?.label}, {p ? money(p.monthly) : 'pricing'} a month"
  onclick={() => (app.selected = item.id)}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.selected = item.id; } }}
>
  <input type="checkbox" checked={ticked} onchange={tick} onclick={(e) => e.stopPropagation()} aria-label="Select for bulk move" />
  <div class="main">
    <div class="title">
      {#if item.qty > 1}<span class="qty">{item.qty}×</span>{/if}
      {item.name || svc?.label}
    </div>
    <div class="sub small muted">
      {#if p?.unavailable}<span class="err">{p.unavailable}</span>
      {:else}{p?.sku ?? svc?.providers[provider]?.product ?? ''}{/if}
    </div>
    {#if item.check}<div class="flag small">⚑ {item.check}</div>{/if}
  </div>
  <div class="cost num">
    {#if p}{money(p.monthly)}{:else}<span class="muted">…</span>{/if}
    {#if p?.upfront}<div class="small muted">+{money(p.upfront)} once</div>{/if}
  </div>
</div>

<style>
  .card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 7px 9px;
    cursor: grab;
  }
  .card:hover { border-color: var(--accent); }
  .card.sel { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
  .card.bad { border-color: var(--danger); }
  .card.check { background: var(--warn-bg); border-color: var(--warn-line); }
  input[type='checkbox'] { margin-top: 3px; }
  .title { font-weight: 600; overflow-wrap: anywhere; }
  .qty { color: var(--accent); margin-right: 2px; }
  .sub { overflow-wrap: anywhere; }
  .err { color: var(--danger); }
  .flag { color: var(--text); margin-top: 3px; }
  .cost { font-weight: 700; }
</style>
