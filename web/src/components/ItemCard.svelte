<script lang="ts">
  import ItemCard from './ItemCard.svelte';
  import type { Item, Provider } from '../lib/types';
  import { app, prices, addItem, moveItems } from '../lib/store.svelte';
  import { service } from '../lib/catalog';
  import { money } from '../lib/report';
  import { HOLDS, isContainer, subtotal } from '../lib/tree';
  import { accepts, endDrag, startItems } from '../lib/drag';

  let { item, provider, boxId, mult = 1 }: { item: Item; provider: Provider; boxId: string; mult?: number } = $props();

  const svc = $derived(service(item.svc));
  const p = $derived(prices.get(item.id));
  const ticked = $derived(app.ticked.includes(item.id));
  const container = $derived(isContainer(item.svc));
  const kids = $derived(item.children ?? []);
  const total = $derived(kids.length ? subtotal(item, (id) => prices.get(id)) : undefined);
  const effective = $derived(item.qty * mult);
  const holdsLabel = $derived((HOLDS[item.svc] ?? []).map((s) => service(s)?.label.toLowerCase()).join(', '));

  let over = $state<'yes' | 'no' | null>(null);

  function dragStart(e: DragEvent) {
    e.stopPropagation();
    startItems(e, ticked ? [...app.ticked] : [item.id]);
  }

  function tick(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    app.ticked = on ? [...app.ticked, item.id] : app.ticked.filter((t) => t !== item.id);
  }

  function onOver(e: DragEvent) {
    e.stopPropagation();
    if (accepts(item.id)) {
      e.preventDefault();
      over = 'yes';
    } else over = 'no';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    over = null;
    const svcId = e.dataTransfer?.getData('application/x-csps-svc');
    if (svcId) addItem(boxId, svcId, undefined, item.id);
    const ids = e.dataTransfer?.getData('application/x-csps-items');
    if (ids) moveItems(JSON.parse(ids), { boxId, parentId: item.id });
    if (item.folded) item.folded = false;
    endDrag();
  }
</script>

<div class="wrap" class:container>
  <div
    class="card"
    class:sel={app.selected === item.id}
    class:bad={!!p?.unavailable}
    class:check={!!item.check}
    draggable="true"
    ondragstart={dragStart}
    ondragend={endDrag}
    role="button"
    tabindex="0"
    aria-label="{item.name || svc?.label}, {p ? money(p.monthly) : 'pricing'} a month"
    onclick={(e) => { e.stopPropagation(); app.selected = item.id; }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.selected = item.id; } }}
  >
    <input type="checkbox" checked={ticked} onchange={tick} onclick={(e) => e.stopPropagation()} aria-label="Select for bulk move" />
    <div class="main">
      <div class="title">
        {#if container}
          <button class="fold ghost" aria-expanded={!item.folded} aria-label={item.folded ? 'Show what is inside' : 'Hide what is inside'}
            onclick={(e) => { e.stopPropagation(); item.folded = !item.folded; }}>
            <span class="chev" class:open={!item.folded}>▸</span>
          </button>
        {/if}
        {#if item.qty > 1}<span class="qty">{item.qty}×</span>{/if}
        {item.name || svc?.label}
        {#if mult > 1}<span class="mult" title="Count inside its containers">= {effective} in total</span>{/if}
      </div>
      <div class="sub small muted">
        {#if p?.unavailable}<span class="err">{p.unavailable}</span>
        {:else}{p?.sku ?? svc?.providers[provider]?.product ?? ''}{/if}
        {#if item.folded && kids.length}<span> · {kids.length} inside</span>{/if}
      </div>
      {#if item.check}<div class="flag small">⚑ {item.check}</div>{/if}
    </div>
    <div class="cost num">
      {#if p}{money(p.monthly)}{:else}<span class="muted">…</span>{/if}
      {#if p?.upfront}<div class="small muted">+{money(p.upfront)} once</div>{/if}
      {#if total}<div class="small subtotal" title="This card plus everything inside it">{money(total.monthly)} with inside</div>{/if}
    </div>
  </div>

  {#if container && !item.folded}
    <div
      class="inside"
      class:over={over === 'yes'}
      class:nope={over === 'no'}
      role="group"
      aria-label="Inside {item.name || svc?.label}"
      ondragover={onOver}
      ondragleave={(e) => { e.stopPropagation(); over = null; }}
      ondrop={onDrop}
    >
      {#each kids as child (child.id)}
        <ItemCard item={child} {provider} {boxId} mult={effective} />
      {/each}
      <div class="hint small muted">
        {#if over === 'no'}{svc?.label} cannot hold that.{:else}Drop {holdsLabel} here{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap { display: grid; gap: 0; }
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
  .container > .card { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .card:hover { border-color: var(--accent); }
  .card.sel { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
  .card.bad { border-color: var(--danger); }
  .card.check { background: var(--warn-bg); border-color: var(--warn-line); }
  input[type='checkbox'] { margin-top: 3px; }
  .title { font-weight: 600; overflow-wrap: anywhere; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .fold { padding: 0 3px; border: 0; line-height: 1; }
  .chev { display: inline-block; transition: transform 0.12s; font-size: 11px; color: var(--muted); }
  .chev.open { transform: rotate(90deg); }
  .qty { color: var(--accent); }
  .mult { font-size: 11px; font-weight: 600; color: var(--muted); }
  .sub { overflow-wrap: anywhere; }
  .err { color: var(--danger); }
  .flag { color: var(--text); margin-top: 3px; }
  .cost { font-weight: 700; }
  .subtotal { color: var(--accent); font-weight: 600; }
  .inside {
    display: grid;
    gap: 6px;
    padding: 6px 6px 4px 10px;
    border: 1px solid var(--line);
    border-top: 0;
    border-left: 3px solid color-mix(in srgb, var(--accent) 45%, var(--line));
    border-radius: 0 0 8px 8px;
    background: color-mix(in srgb, var(--panel-2) 70%, var(--bg));
    transition: background 0.1s, border-color 0.1s;
  }
  .inside.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--panel-2)); }
  .inside.nope { border-color: var(--danger); }
  .hint { text-align: center; padding: 4px; }
</style>
