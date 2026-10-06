<script lang="ts">
  import type { Provider } from '../lib/types';
  import { app, prices, addAccount, addRegion, removeAccount, removeRegion, addItem, moveItems } from '../lib/store.svelte';
  import { accountKinds, accountTotals, boxTotals, providerNames } from '../lib/engine';
  import { QUICK, walk } from '../lib/tree';
  import { money } from '../lib/report';
  import ItemCard from './ItemCard.svelte';
  import RegionSelect from './RegionSelect.svelte';
  import { drag } from '../lib/drag.svelte';
  import { blockerMessage, swapAccount, swapBlockers } from '../lib/swap';
  import type { Account } from '../lib/types';

  /** The box a drag hovers over (only drops on the box itself, not on a card in it). */
  const over = $derived(drag.active && drag.target?.kind === 'box' && drag.target.ok ? drag.target.boxId : null);

  const boxes = $derived(
    app.est.accounts.flatMap((a) => a.regions.map((r) => ({ id: r.id, label: `${a.label || providerNames[a.provider]} · ${r.label || r.region}` }))),
  );
  let moveTo = $state('');

  const providers: Provider[] = ['aws', 'gcp', 'oci', 'onprem'];
  const clouds: Provider[] = ['aws', 'gcp', 'oci'];

  /** Shown in the middle of the screen when a site cannot switch cloud. */
  let blocked = $state<{ text: string; list: { name: string; reason: string }[] } | null>(null);
  let switching = $state('');
  /** Short note after a switch: where each region box went. */
  let swapped = $state<{ accId: string; text: string } | null>(null);

  async function swap(acc: Account, to: Provider, sel: HTMLSelectElement) {
    sel.value = acc.provider;
    if (to === acc.provider) return;
    const missing = swapBlockers(acc, to);
    if (missing.length) {
      blocked = { text: blockerMessage(to, missing), list: [] };
      return;
    }
    const from = acc.provider;
    const priced = new Set([...prices].filter(([, p]) => !p.unavailable).map(([id]) => id));
    switching = acc.id;
    let res;
    try {
      res = await swapAccount($state.snapshot(acc) as Account, to, app.manifest, priced);
    } finally {
      switching = '';
    }
    const { acc: next, moves, blockers } = res;
    if (blockers.length) {
      blocked = {
        text: `${providerNames[to]} has no match for ${blockers.length === 1 ? 'one item' : `${blockers.length} items`} in this site, so the site cannot switch to ${providerNames[to]}. The site stays on ${providerNames[from]}.`,
        list: blockers,
      };
      return;
    }
    const i = app.est.accounts.findIndex((a) => a.id === acc.id);
    if (i < 0) return;
    app.est.accounts[i] = next;
    app.selected = null;
    const where = [...new Set(moves.map(([a, b]) => `${a} → ${b}`))].join(', ');
    swapped = { accId: acc.id, text: `Switched from ${providerNames[from]} to ${providerNames[to]}. Regions: ${where}. Items marked ⚑ need a check.` };
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && blocked) blocked = null; }} />

{#if blocked}
  <div class="veil" role="presentation" onclick={() => (blocked = null)}>
    <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="swap-title" aria-describedby="swap-text" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h2 id="swap-title">Cannot switch cloud</h2>
      <p id="swap-text">{blocked.text}</p>
      {#if blocked.list.length}
        <ul>
          {#each blocked.list as b}<li><strong>{b.name}</strong>: {b.reason}</li>{/each}
        </ul>
      {/if}
      <button class="primary" onclick={() => (blocked = null)}>OK</button>
    </div>
  </div>
{/if}

{#if app.ticked.length}
  <div class="bulk" role="region" aria-label="Bulk actions">
    <strong>{app.ticked.length} selected</strong>
    <label>
      Move to
      <select bind:value={moveTo}>
        <option value="">Choose a box</option>
        {#each boxes as b}<option value={b.id}>{b.label}</option>{/each}
      </select>
    </label>
    <button disabled={!moveTo} onclick={async () => { await moveItems([...app.ticked], moveTo); app.ticked = []; moveTo = ''; }}>Move</button>
    <button class="ghost" onclick={() => (app.ticked = [])}>Clear</button>
  </div>
{/if}

<div class="canvas">
  {#each app.est.accounts as acc (acc.id)}
    {@const t = accountTotals(acc, prices)}
    {@const k = accountKinds[acc.provider]}
    {@const n = acc.regions.reduce((s, r) => s + [...walk(r.items)].length, 0)}
    <section class="account {acc.provider}" aria-label="{k.kind} {acc.label}">
      <header>
        <div class="ident">
          <div class="kind">
            <button class="fold ghost" aria-expanded={!acc.folded} aria-label={acc.folded ? 'Show this site' : 'Fold this site'} title={acc.folded ? 'Show this site' : 'Fold this site'} onclick={() => (acc.folded = !acc.folded)}>
              <span class="chev" class:open={!acc.folded}>▸</span>
            </button>
            {#if acc.provider === 'onprem'}
              <span class="tag {acc.provider}">{providerNames[acc.provider]}</span>
            {:else}
              <select class="cloud {acc.provider}" value={acc.provider} title="Switch this site to another cloud" aria-label="Cloud of {acc.label}"
                onchange={(e) => swap(acc, (e.currentTarget as HTMLSelectElement).value as Provider, e.currentTarget as HTMLSelectElement)}>
                {#each clouds as c}<option value={c}>{providerNames[c]}</option>{/each}
              </select>
            {/if}
            <span class="small muted">{switching === acc.id ? 'Checking the new cloud…' : k.kind}</span>
          </div>
          <div class="names">
            <label class="lbl editable">
              <span class="sr-only">Site name</span>
              <input bind:value={acc.label} placeholder="Name, for example DC" maxlength="60" />
            </label>
            <label class="ref editable">
              <span class="sr-only">{k.ref}</span>
              <input bind:value={acc.ref} placeholder="{k.ref} (optional)" maxlength="80" />
            </label>
          </div>
        </div>
        <div class="figures">
          <span class="total num">{money(t.monthly)}<span class="muted small"> / mo</span></span>
          <span class="small muted">{acc.regions.length} region{acc.regions.length === 1 ? '' : 's'} · {n} item{n === 1 ? '' : 's'}{t.upfront ? ` · ${money(t.upfront)} upfront` : ''}</span>
        </div>
        <div class="acts">
          {#if acc.provider !== 'onprem'}
            <button class="small" onclick={() => addRegion(acc.id)}>+ Region</button>
          {/if}
          <button class="ghost small" aria-label="Remove {acc.label}" title="Remove this {k.kind.toLowerCase()}" onclick={() => { if (confirm(`Remove ${acc.label || 'this site'} and everything in it?`)) removeAccount(acc.id); }}>✕</button>
        </div>
      </header>
      {#if swapped?.accId === acc.id}
        <div class="note small" role="status">{swapped.text} <button class="ghost small" aria-label="Dismiss" onclick={() => (swapped = null)}>✕</button></div>
      {/if}
      {#if !acc.folded}
      <div class="regions">
        {#each acc.regions as box (box.id)}
          {@const bt = boxTotals(box, prices)}
          <div
            class="box"
            class:wide={box.items.some((i) => i.children?.length)}
            class:over={over === box.id}
            role="group"
            aria-label="Region box {box.label || box.region}"
            data-drop="box"
            data-box={box.id}
          >
            <div class="boxhead">
              <button class="fold ghost" aria-expanded={!box.folded} aria-label={box.folded ? 'Show this region' : 'Fold this region'} title={box.folded ? 'Show this region' : 'Fold this region'} onclick={() => (box.folded = !box.folded)}>
                <span class="chev" class:open={!box.folded}>▸</span>
              </button>
              {#if acc.provider === 'onprem'}
                <span class="small muted">On-premises</span>
              {:else}
                <RegionSelect provider={acc.provider} bind:value={box.region} />
              {/if}
              <input class="boxlabel" bind:value={box.label} placeholder="Note (optional)" maxlength="60" aria-label="Box note" />
              <span class="num small">{money(bt.monthly)}</span>
              {#if acc.regions.length > 1}
                <button class="ghost small" aria-label="Remove region box" onclick={() => removeRegion(box.id)}>✕</button>
              {/if}
            </div>
            {#if box.folded}
              <div class="small muted folded">{[...walk(box.items)].length} items folded</div>
            {:else}
            <div class="items">
              {#each box.items as item, i (item.id)}
                <ItemCard {item} provider={acc.provider} boxId={box.id} index={i} />
              {/each}
              {#if acc.provider === 'onprem'}
                <div class="quick"><button class="addq small" onclick={() => addItem(box.id, 'custom')}>+ Line item</button></div>
              {:else}
                <div class="quick">
                  {#each QUICK.box as [svc, label]}
                    <button class="addq small" onclick={() => addItem(box.id, svc)}>+ {label}</button>
                  {/each}
                </div>
                {#if !box.items.length}<div class="drop small muted">or drag any service from the list</div>{/if}
              {/if}
            </div>
            {/if}
          </div>
        {/each}
      </div>
      {/if}
    </section>
  {/each}

  <div class="add">
    <span class="small muted">Add a site:</span>
    {#each providers as p}
      <button onclick={() => addAccount(p)}><span class="dot {p}"></span>{providerNames[p]}</button>
    {/each}
  </div>
</div>

<style>
  .canvas { display: grid; gap: 14px; }
  .account {
    background: var(--panel);
    border: 1px solid var(--line);
    border-left: 4px solid var(--onprem);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 10px 12px 12px;
  }
  .account.aws { border-left-color: var(--aws); }
  .account.gcp { border-left-color: var(--gcp); }
  .account.oci { border-left-color: var(--oci); }
  header { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
  .ident { display: grid; gap: 6px; flex: 1 1 280px; min-width: 0; }
  .kind { display: flex; gap: 8px; align-items: center; }
  .names { display: flex; gap: 8px; flex-wrap: wrap; }
  .lbl { flex: 1 1 140px; max-width: 240px; }
  .lbl input { width: 100%; font-weight: 700; font-size: 15px; }
  .ref { flex: 1 1 140px; max-width: 220px; }
  .ref input { width: 100%; font-size: 12.5px; font-family: var(--mono); }
  .figures { display: grid; justify-items: end; gap: 2px; }
  .total { font-weight: 800; font-size: 17px; }
  .acts { display: flex; gap: 6px; align-items: center; }
  .regions { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-top: 10px; }
  .box {
    border: 1px dashed var(--line);
    border-radius: 9px;
    background: var(--panel-2);
    padding: 8px;
    min-height: 120px;
    transition: border-color 0.1s, background 0.1s;
  }
  /* A box holding a VPC, cluster or VM tree takes the full row so the tree has room. */
  .box.wide { grid-column: 1 / -1; }
  .box.over { border-color: var(--accent); border-style: solid; background: color-mix(in srgb, var(--accent) 8%, var(--panel-2)); }
  .boxhead { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .boxlabel { flex: 1 1 80px; font-size: 12px; padding: 4px 6px; }
  .items { display: grid; gap: 6px; }
  .drop { text-align: center; padding: 2px 4px 4px; }
  .quick { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 2px; }
  .addq { padding: 3px 9px; font-size: 12px; border-style: dashed; background: transparent; color: var(--muted); }
  .addq:hover { color: var(--accent); border-color: var(--accent); border-style: solid; }
  .add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--onprem); }
  .dot.aws { background: var(--aws); } .dot.gcp { background: var(--gcp); } .dot.oci { background: var(--oci); }
  .fold { width: 22px; height: 22px; padding: 0; display: inline-grid; place-items: center; border: 1px solid var(--line); border-radius: 6px; line-height: 1; background: var(--panel); }
  .fold:hover { border-color: var(--accent); }
  .fold:hover .chev { color: var(--accent); }
  .chev { display: inline-block; transition: transform 0.12s; font-size: 13px; color: var(--text); }
  .chev.open { transform: rotate(90deg); }
  .folded { padding: 2px 6px; }
  .box:has(.folded) { min-height: 0; }
  .account:has(> header .chev:not(.open)) header { border-bottom: 0; padding-bottom: 0; }
  select.cloud { font-weight: 700; font-size: 12px; padding: 2px 6px; border-radius: 999px; border: 1px solid var(--line); }
  select.cloud.aws { color: var(--aws); border-color: var(--aws); }
  select.cloud.gcp { color: var(--gcp); border-color: var(--gcp); }
  select.cloud.oci { color: var(--oci); border-color: var(--oci); }
  .note { margin-top: 8px; padding: 6px 10px; border: 1px solid var(--warn-line); background: var(--warn-bg); border-radius: 8px; display: flex; gap: 8px; align-items: center; }
  .note button { margin-left: auto; }
  .veil { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); display: grid; place-items: center; z-index: 50; padding: 16px; }
  .modal { background: var(--panel); border: 1px solid var(--danger); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px 20px; max-width: 440px; display: grid; gap: 10px; }
  .modal h2 { margin: 0; font-size: 17px; color: var(--danger); }
  .modal p, .modal ul { margin: 0; }
  .modal ul { padding-left: 18px; display: grid; gap: 4px; }
  .modal button { justify-self: end; }
  .bulk {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 8px 12px; margin-bottom: 10px;
    background: var(--panel); border: 1px solid var(--accent); border-radius: var(--radius);
  }
  .bulk label { display: flex; gap: 6px; align-items: center; }
</style>
