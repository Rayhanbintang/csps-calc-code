<script lang="ts">
  import type { Provider } from '../lib/types';
  import { app, prices, setRegion } from '../lib/store.svelte';
  import { boxTotals, pricingLabel, providerNames } from '../lib/engine';
  import { service } from '../lib/catalog';
  import { money } from '../lib/report';
  import RegionSelect from './RegionSelect.svelte';

  const used = $derived([...new Set(app.est.accounts.map((a) => a.provider))].filter((p) => p !== 'onprem') as Provider[]);
  let pickedBoxes = $state<string[]>([]);
  let bulk = $state<Record<string, string>>({});

  function apply(p: Provider) {
    const target = bulk[p];
    if (!target) return;
    const ids = app.est.accounts.filter((a) => a.provider === p).flatMap((a) => a.regions.map((r) => r.id));
    const chosen = pickedBoxes.filter((id) => ids.includes(id));
    setRegion(chosen.length ? chosen : ids, target);
  }

  const regionName = (provider: string, code: string) =>
    app.manifest?.providers[provider]?.regions.find((r) => r.code === code)?.name ?? code;
</script>

<div class="review">
  {#if used.length}
    <div class="bulk">
      <strong class="small">Change region in bulk</strong>
      <span class="small muted">Tick boxes below to limit the change; with none ticked it applies to every box of that cloud.</span>
      {#each used as p}
        <div class="row">
          <span class="tag {p}">{providerNames[p]}</span>
          <select bind:value={bulk[p]} aria-label="New region for {providerNames[p]}">
            <option value="">Choose a region</option>
            {#each app.manifest?.providers[p]?.regions ?? [] as r (r.code)}<option value={r.code}>{r.name} · {r.code}</option>{/each}
          </select>
          <button disabled={!bulk[p]} onclick={() => apply(p)}>Apply</button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="scroll">
    <table>
      <thead>
        <tr><th></th><th>Site</th><th>Region</th><th>Item</th><th>Type / SKU</th><th class="num">Qty</th><th>Pricing</th><th class="num">Per month</th><th class="num">Upfront</th></tr>
      </thead>
      <tbody>
        {#each app.est.accounts as acc (acc.id)}
          {#each acc.regions as box (box.id)}
            <tr class="boxrow">
              <td>
                {#if acc.provider !== 'onprem'}
                  <input type="checkbox" aria-label="Pick this box for a bulk region change" checked={pickedBoxes.includes(box.id)}
                    onchange={(e) => (pickedBoxes = (e.target as HTMLInputElement).checked ? [...pickedBoxes, box.id] : pickedBoxes.filter((x) => x !== box.id))} />
                {/if}
              </td>
              <td><span class="tag {acc.provider}">{providerNames[acc.provider]}</span> {acc.label}</td>
              <td>
                {#if acc.provider === 'onprem'}On-premises{:else}<RegionSelect provider={acc.provider} bind:value={box.region} />{/if}
                {#if box.label}<div class="small muted">{box.label}</div>{/if}
              </td>
              <td colspan="4" class="muted small">{box.items.length} item{box.items.length === 1 ? '' : 's'}</td>
              <td class="num"><strong>{money(boxTotals(box, prices).monthly)}</strong></td>
              <td class="num">{money(boxTotals(box, prices).upfront)}</td>
            </tr>
            {#each box.items as it (it.id)}
              {@const p = prices.get(it.id)}
              <tr class:bad={!!p?.unavailable} onclick={() => (app.selected = it.id)}>
                <td></td><td></td>
                <td class="muted small">{acc.provider === 'onprem' ? '' : regionName(acc.provider, box.region)}</td>
                <td>{it.name || service(it.svc)?.label}{#if it.check}<span class="flag" title={it.check}> ⚑</span>{/if}</td>
                <td class="small">{p?.unavailable ?? p?.sku ?? ''}</td>
                <td class="num">{it.qty}</td>
                <td class="small">{pricingLabel(acc.provider, it.svc, it.pricing)}</td>
                <td class="num">{p ? money(p.monthly) : '…'}</td>
                <td class="num">{p?.upfront ? money(p.upfront) : ''}</td>
              </tr>
            {/each}
          {/each}
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .review { display: grid; gap: 12px; }
  .bulk { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; display: grid; gap: 6px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .row select { min-width: 240px; }
  .scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11.5px; color: var(--muted); padding: 8px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .boxrow td { background: var(--panel-2); }
  tbody tr:not(.boxrow) { cursor: pointer; }
  tbody tr:not(.boxrow):hover td { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  tr.bad td { color: var(--danger); }
  .flag { color: var(--aws); }
</style>
