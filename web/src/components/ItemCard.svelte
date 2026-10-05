<script lang="ts">
  import ItemCard from './ItemCard.svelte';
  import type { Item, Provider } from '../lib/types';
  import { app, prices, addItem, moveItems } from '../lib/store.svelte';
  import { service } from '../lib/catalog';
  import { money } from '../lib/report';
  import { QUICK, isContainer, subtotal } from '../lib/tree';
  import { accepts, drag, endDrag, startItems } from '../lib/drag';

  let {
    item,
    provider,
    boxId,
    mult = 1,
    parentId,
    index,
    depth = 0,
  }: { item: Item; provider: Provider; boxId: string; mult?: number; parentId?: string; index: number; depth?: number } = $props();

  // Each kind of service has a colour and a short tag, so nested cards are told apart by
  // kind at a glance, not only by indentation.
  const KIND: Record<string, [string, string]> = {
    vpc: ['VPC', 'network'], lb: ['LB', 'network'], egress: ['TRANSFER', 'network'], vpn: ['VPN', 'network'],
    interconnect: ['LINK', 'network'], dns: ['DNS', 'network'], nat: ['NAT', 'network'], ip: ['IP', 'network'], endpoint: ['ENDPOINT', 'network'],
    k8s: ['CLUSTER', 'cluster'], containers: ['CONTAINERS', 'cluster'],
    vm: ['VM', 'compute'], functions: ['FUNCTIONS', 'compute'],
    disk: ['DISK', 'storage'], object: ['OBJECT', 'storage'], file: ['FILES', 'storage'],
    db: ['DATABASE', 'data'], cache: ['CACHE', 'data'],
  };
  const kind = $derived(KIND[item.svc] ?? [service(item.svc)?.label.toUpperCase() ?? '', 'other']);

  const svc = $derived(service(item.svc));
  const p = $derived(prices.get(item.id));
  const ticked = $derived(app.ticked.includes(item.id));
  const container = $derived(isContainer(item.svc));
  const kids = $derived(item.children ?? []);
  const total = $derived(kids.length ? subtotal(item, (id) => prices.get(id)) : undefined);
  const effective = $derived(item.qty * mult);
  const quick = $derived(QUICK[item.svc] ?? []);

  // Drop on the card itself = place before or after it (reorder or insert as a sibling).
  let edge = $state<'before' | 'after' | null>(null);
  // Drop on the inside area = put it inside this card.
  let over = $state<'yes' | 'no' | null>(null);

  function dragStart(e: DragEvent) {
    e.stopPropagation();
    startItems(e, ticked ? [...app.ticked] : [item.id]);
  }

  function tick(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    app.ticked = on ? [...app.ticked, item.id] : app.ticked.filter((t) => t !== item.id);
  }

  function onCardOver(e: DragEvent) {
    e.stopPropagation();
    if (drag.ids?.includes(item.id) || !accepts(parentId)) {
      edge = null;
      return;
    }
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    edge = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  }

  function onCardDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const at = index + (edge === 'after' ? 1 : 0);
    edge = null;
    const svcId = e.dataTransfer?.getData('application/x-csps-svc');
    if (svcId) addItem(boxId, svcId, undefined, parentId, at);
    const ids = e.dataTransfer?.getData('application/x-csps-items');
    if (ids) moveItems(JSON.parse(ids), { boxId, parentId }, at);
    endDrag();
  }

  function onInsideOver(e: DragEvent) {
    e.stopPropagation();
    if (accepts(item.id)) {
      e.preventDefault();
      over = 'yes';
    } else over = 'no';
  }

  function onInsideDrop(e: DragEvent) {
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

<div class="wrap" class:container class:odd={depth % 2 === 1} style:--tc="var(--t-{kind[1]})">
  <div
    class="card"
    class:sel={app.selected === item.id}
    class:bad={!!p?.unavailable}
    class:check={!!item.check}
    class:before={edge === 'before'}
    class:after={edge === 'after'}
    draggable="true"
    ondragstart={dragStart}
    ondragend={endDrag}
    ondragover={onCardOver}
    ondragleave={() => (edge = null)}
    ondrop={onCardDrop}
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
        <span class="ktag">{kind[0]}</span>
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
      {#if total}<div class="small subtotal" title="Total per month of this card plus everything inside it">{money(total.monthly)}</div>{/if}
    </div>
  </div>

  {#if container && !item.folded}
    <div
      class="inside"
      class:over={over === 'yes'}
      class:nope={over === 'no'}
      role="group"
      aria-label="Inside {item.name || svc?.label}"
      ondragover={onInsideOver}
      ondragleave={(e) => { e.stopPropagation(); over = null; }}
      ondrop={onInsideDrop}
    >
      {#each kids as child, i (child.id)}
        <ItemCard item={child} {provider} {boxId} mult={effective} parentId={item.id} index={i} depth={depth + 1} />
      {/each}
      {#if over === 'no'}
        <div class="hint small nope-text">{svc?.label} cannot hold that.</div>
      {:else if over === 'yes'}
        <div class="hint small muted">Drop to put it inside</div>
      {:else}
        <div class="quick">
          {#each quick as [childSvc, label]}
            <button class="add small" onclick={(e) => { e.stopPropagation(); addItem(boxId, childSvc, undefined, item.id, undefined, childSvc === 'vm' && item.svc === 'k8s' ? label : undefined); }}>+ {label}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap { display: grid; gap: 0; }
  .card {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    background: var(--panel);
    border: 1px solid var(--line);
    border-left: 4px solid var(--tc);
    border-radius: 8px;
    padding: 7px 9px;
    cursor: grab;
  }
  /* A container's header carries a wash of its colour so it reads as a header. */
  .container > .card {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    background: color-mix(in srgb, var(--tc) 12%, var(--panel));
    border-color: color-mix(in srgb, var(--tc) 45%, var(--line));
    border-left-color: var(--tc);
  }
  .ktag {
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--tc);
    background: color-mix(in srgb, var(--tc) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--tc) 40%, transparent);
  }
  .card:hover { border-color: var(--accent); }
  .card.sel { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
  .card.bad { border-color: var(--danger); }
  .card.check { background: var(--warn-bg); border-color: var(--warn-line); }
  /* Where a dragged card will land: a bar above or below this card. */
  .card.before::before, .card.after::after {
    content: '';
    position: absolute;
    left: -2px;
    right: -2px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .card.before::before { top: -5px; }
  .card.after::after { bottom: -5px; }
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
  .subtotal { color: var(--accent); font-weight: 600; cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
  /* Levels alternate between a dark and a light well; the rail takes the container's colour. */
  .inside {
    display: grid;
    gap: 6px;
    padding: 8px 8px 8px 12px;
    border: 1px solid color-mix(in srgb, var(--tc) 45%, var(--line));
    border-top: 0;
    border-left: 4px solid var(--tc);
    border-radius: 0 0 8px 8px;
    background: var(--bg);
    transition: background 0.1s, border-color 0.1s;
  }
  .odd > .inside { background: var(--panel-2); }
  .inside.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--panel-2)); }
  .inside.nope { border-color: var(--danger); }
  .hint { text-align: center; padding: 4px; }
  .nope-text { color: var(--danger); }
  .quick { display: flex; flex-wrap: wrap; gap: 5px; }
  .add {
    padding: 3px 9px;
    font-size: 12px;
    border-style: dashed;
    background: transparent;
    color: var(--muted);
  }
  .add:hover { color: var(--accent); border-color: var(--accent); border-style: solid; }
</style>
