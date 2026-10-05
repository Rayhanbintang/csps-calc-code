<script lang="ts">
  import { app, prices } from '../lib/store.svelte';
  import { accountTotals, boxTotals, estimateTotals, providerNames } from '../lib/engine';
  import { DISCLAIMER, money } from '../lib/report';

  const t = $derived(estimateTotals(app.est, prices));
  const regionName = (provider: string, code: string) =>
    app.manifest?.providers[provider]?.regions.find((r) => r.code === code)?.name ?? code;
</script>

<div class="sum">
  <h2>Estimate total</h2>
  <dl class="big">
    <div><dt>Per month</dt><dd class="num">{money(t.monthly)}</dd></div>
    <div><dt>Upfront</dt><dd class="num">{money(t.upfront)}</dd></div>
    <div><dt>First 12 months</dt><dd class="num">{money(t.monthly * 12 + t.upfront)}</dd></div>
    <div><dt>36 months</dt><dd class="num">{money(t.monthly * 36 + t.upfront)}</dd></div>
  </dl>

  <h3>By site</h3>
  <table>
    <tbody>
      {#each app.est.accounts as acc (acc.id)}
        {@const at = accountTotals(acc, prices)}
        <tr class="acc">
          <td><span class="tag {acc.provider}">{providerNames[acc.provider]}</span> {acc.label}</td>
          <td class="num">{money(at.monthly)}</td>
        </tr>
        {#each acc.regions as box (box.id)}
          <tr>
            <td class="muted indent">{acc.provider === 'onprem' ? 'On-premises' : regionName(acc.provider, box.region)}{box.label ? ` · ${box.label}` : ''}</td>
            <td class="num muted">{money(boxTotals(box, prices).monthly)}</td>
          </tr>
        {/each}
      {/each}
    </tbody>
  </table>

  <p class="hint small muted">Select an item to edit its size and compare pricing options side by side.</p>
  <p class="disc small">{DISCLAIMER}</p>
</div>

<style>
  .sum { padding: 14px; }
  h2 { margin: 0 0 10px; font-size: 15px; }
  h3 { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .big { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0; }
  .big div { background: var(--panel-2); border-radius: 8px; padding: 8px 10px; }
  dt { font-size: 11.5px; color: var(--muted); }
  dd { margin: 2px 0 0; font-size: 18px; font-weight: 800; text-align: left; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 2px; border-bottom: 1px solid var(--line); }
  .acc td { font-weight: 700; }
  .indent { padding-left: 14px; }
  .disc { margin-top: 14px; padding: 8px 10px; border-radius: 8px; background: var(--panel-2); color: var(--muted); }
</style>
