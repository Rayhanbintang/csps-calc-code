<script lang="ts">
  import type { Provider } from '../lib/types';
  import { app, prices, addAccount, addRegion, removeAccount, removeRegion, addItem, moveItems } from '../lib/store.svelte';
  import { accountTotals, boxTotals, providerNames } from '../lib/engine';
  import { money } from '../lib/report';
  import ItemCard from './ItemCard.svelte';
  import RegionSelect from './RegionSelect.svelte';

  let over = $state<string | null>(null);

  function onDrop(e: DragEvent, boxId: string) {
    e.preventDefault();
    over = null;
    const svc = e.dataTransfer?.getData('application/x-csps-svc');
    if (svc) return addItem(boxId, svc);
    const ids = e.dataTransfer?.getData('application/x-csps-items');
    if (ids) moveItems(JSON.parse(ids), boxId);
  }

  function onOver(e: DragEvent, boxId: string) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-csps-svc') ? 'copy' : 'move';
    over = boxId;
  }

  const boxes = $derived(
    app.est.accounts.flatMap((a) => a.regions.map((r) => ({ id: r.id, label: `${a.label || providerNames[a.provider]} · ${r.label || r.region}` }))),
  );
  let moveTo = $state('');

  const providers: Provider[] = ['aws', 'gcp', 'oci', 'onprem'];
</script>

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
    <section class="account {acc.provider}" aria-label="{providerNames[acc.provider]} {acc.label}">
      <header>
        <span class="tag {acc.provider}">{providerNames[acc.provider]}</span>
        <label class="lbl editable">
          <span class="sr-only">Site label</span>
          <input bind:value={acc.label} placeholder="Label, for example DC" maxlength="60" />
        </label>
        <span class="total num">{money(t.monthly)}<span class="muted small"> / mo</span></span>
        {#if acc.provider !== 'onprem'}
          <button class="ghost small" onclick={() => addRegion(acc.id)}>+ Region</button>
        {/if}
        <button class="ghost small" aria-label="Remove {acc.label}" onclick={() => { if (confirm(`Remove ${acc.label || 'this site'} and everything in it?`)) removeAccount(acc.id); }}>✕</button>
      </header>
      <div class="regions">
        {#each acc.regions as box (box.id)}
          {@const bt = boxTotals(box, prices)}
          <div
            class="box"
            class:over={over === box.id}
            role="group"
            aria-label="Region box {box.label || box.region}"
            ondragover={(e) => onOver(e, box.id)}
            ondragleave={() => (over = over === box.id ? null : over)}
            ondrop={(e) => onDrop(e, box.id)}
          >
            <div class="boxhead">
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
            <div class="items">
              {#each box.items as item (item.id)}
                <ItemCard {item} provider={acc.provider} />
              {/each}
              <div class="drop small muted">{box.items.length ? 'Drop here to add or move' : 'Drag services here, or click one in the list'}</div>
            </div>
          </div>
        {/each}
      </div>
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
  header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lbl { flex: 1 1 140px; }
  .lbl { max-width: 260px; }
  .lbl input { width: 100%; font-weight: 700; }
  .total { font-weight: 700; }
  .regions { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-top: 10px; }
  .box {
    border: 1px dashed var(--line);
    border-radius: 9px;
    background: var(--panel-2);
    padding: 8px;
    min-height: 120px;
    transition: border-color 0.1s, background 0.1s;
  }
  .box.over { border-color: var(--accent); border-style: solid; background: color-mix(in srgb, var(--accent) 8%, var(--panel-2)); }
  .boxhead { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .boxlabel { flex: 1 1 80px; font-size: 12px; padding: 4px 6px; }
  .items { display: grid; gap: 6px; }
  .drop { text-align: center; padding: 8px 4px; border-radius: 7px; }
  .add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--onprem); }
  .dot.aws { background: var(--aws); } .dot.gcp { background: var(--gcp); } .dot.oci { background: var(--oci); }
  .bulk {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 8px 12px; margin-bottom: 10px;
    background: var(--panel); border: 1px solid var(--accent); border-radius: var(--radius);
  }
  .bulk label { display: flex; gap: 6px; align-items: center; }
</style>
