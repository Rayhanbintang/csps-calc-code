<script lang="ts">
  import { loadEstimate } from '../lib/api';
  import type { Saved } from '../lib/api';
  import { DISCLAIMER, dateOnly, money, qty, rate } from '../lib/report';
  import { saveDraft } from '../lib/store.svelte';
  import { buildReport } from '../lib/report';
  import type { Report } from '../lib/report';
  import { loadManifest } from '../lib/prices';
  import { priceEstimate } from '../lib/engine';

  let { slug }: { slug: string } = $props();
  let saved = $state<Saved | undefined>();
  let problem = $state('');

  /** The same estimate priced with today's price list. The link keeps showing the saved
   *  numbers; today's column sits next to them. */
  let today = $state<Report | undefined>();
  let todayProblem = $state('');

  loadEstimate(slug)
    .then(async (s) => {
      saved = s;
      try {
        const m = await loadManifest();
        today = buildReport(s.estimate, await priceEstimate(s.estimate, m), m);
      } catch (e) {
        todayProblem = e instanceof Error ? e.message : String(e);
      }
    })
    .catch((e) => (problem = e instanceof Error ? e.message : String(e)));

  /** Change from the saved number, as text, or '' when the same to the cent. */
  function delta(now: number | undefined, then: number): string {
    if (now === undefined) return '';
    const d = Math.round((now - then) * 100) / 100;
    if (d === 0) return '';
    return `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`;
  }
  const changed = $derived(!!today && Math.round((today.monthly - (saved?.report.monthly ?? 0)) * 100) !== 0);

  /** Opens the shared estimate in the editor as a new draft, priced with today's prices. */
  function editCopy() {
    if (!saved) return;
    saveDraft({ ...saved.estimate, name: `${saved.estimate.name} (copy)` });
    location.href = '/';
  }

  let open = $state<Record<string, boolean>>({});
</script>

<div class="page">
  <header>
    <a class="brand" href="/">csps-calc</a>
    {#if saved}<button class="primary" onclick={editCopy}>Edit a copy with today's prices</button>{/if}
  </header>

  {#if problem}
    <p class="err" role="alert">This estimate could not be opened: {problem}</p>
  {:else if !saved}
    <p class="muted">Loading…</p>
  {:else}
    {@const r = saved.report}
    <h1>{r.name}</h1>
    <p class="muted small">Saved {dateOnly(saved.created)} · prices as of {dateOnly(r.pricesAsOf)} · this link shows the numbers as saved</p>
    {#if today}
      <div class="today" class:changed role="status">
        {#if changed}
          With today's prices ({dateOnly(today.pricesAsOf)}) this estimate costs <strong>{money(today.monthly)}</strong> a month,
          {delta(today.monthly, r.monthly)} against the saved {money(r.monthly)}. The "Today" column shows each change.
        {:else}
          Today's prices ({dateOnly(today.pricesAsOf)}) give the same total: {money(today.monthly)} a month.
        {/if}
      </div>
    {:else if todayProblem}
      <p class="small muted">Today's prices did not load ({todayProblem}). The saved numbers below are complete.</p>
    {/if}

    <dl class="big">
      <div><dt>Per month</dt><dd>{money(r.monthly)}</dd></div>
      <div><dt>Upfront</dt><dd>{money(r.upfront)}</dd></div>
      <div><dt>First 12 months</dt><dd>{money(r.firstYear)}</dd></div>
      <div><dt>36 months</dt><dd>{money(r.threeYear)}</dd></div>
    </dl>

    {#each r.accounts as acc, ai}
      <section class="acc {acc.provider}">
        <h2><span class="tag {acc.provider}">{acc.providerName}</span> {acc.label} <span class="small muted kind">{acc.kind ?? ''}{acc.ref ? ` ${acc.ref}` : ''}</span> <span class="num">{money(acc.monthly)} / mo</span></h2>
        {#each acc.boxes as box, bi}
          {@const tbox = today?.accounts[ai]?.boxes[bi]}
          <h3>{box.regionName}{box.label ? ` · ${box.label}` : ''} <span class="num muted">{money(box.monthly)} / mo</span></h3>
          <div class="scroll">
            <table>
              <thead><tr><th>Item</th><th>Type / SKU</th><th class="num">Qty</th><th>Pricing</th><th class="num">Per month</th>{#if changed}<th class="num">Today</th>{/if}<th class="num">Upfront</th></tr></thead>
              <tbody>
                {#each box.items as it, ii}
                  {@const k = `${ai}-${bi}-${ii}`}
                  {@const now = tbox?.items[ii]}
                  <tr class="item" onclick={() => (open[k] = !open[k])}>
                    <td style:padding-left="{6 + (it.depth ?? 0) * 18}px">{(it.depth ?? 0) > 0 ? '└ ' : ''}{it.name} <span class="muted small">{it.product}</span></td>
                    <td class="small">{it.unavailable ?? it.sku}</td>
                    <td class="num">{it.qty}{#if it.ownQty && it.ownQty !== it.qty}<span class="muted small"> ({it.ownQty} each)</span>{/if}</td>
                    <td class="small">{it.pricing}</td>
                    <td class="num">{money(it.monthly)}{#if it.subtotal !== undefined}<div class="small sub" title="Total per month of this item plus everything inside it">{money(it.subtotal)}</div>{/if}</td>
                    {#if changed}
                      <td class="num">{#if now}{@const d = delta(now.monthly, it.monthly)}<span class:up={d.startsWith('+')} class:down={d.startsWith('−')}>{d ? money(now.monthly) : 'same'}</span>{#if d}<div class="small muted">{d}</div>{/if}{/if}</td>
                    {/if}
                    <td class="num">{it.upfront ? money(it.upfront) : ''}</td>
                  </tr>
                  {#if open[k]}
                    <tr><td colspan={changed ? 7 : 6} class="detail">
                      {#each it.lines as l}<div class="ln"><span>{l.label}</span><span class="num">{qty(l.qty)} {l.unit} × {rate(l.rate)} = {money(l.monthly)}</span></div>{/each}
                      {#each it.notes as n}<div class="small muted">{n}</div>{/each}
                    </td></tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {/each}
      </section>
    {/each}
    <p class="disc small">{DISCLAIMER}</p>
  {/if}
</div>

<style>
  .page { max-width: 1040px; margin: 0 auto; padding: 16px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .brand { font-weight: 800; font-size: 17px; color: var(--text); text-decoration: none; }
  h1 { margin: 6px 0 2px; font-size: 22px; }
  h2 { font-size: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  h2 .num { margin-left: auto; }
  h3 { font-size: 13px; margin: 12px 0 6px; display: flex; justify-content: space-between; gap: 8px; }
  .big { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 12px 0; }
  .big div { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
  dt { font-size: 12px; color: var(--muted); }
  dd { margin: 2px 0 0; font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .acc { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px 14px 12px; margin-top: 12px; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11.5px; color: var(--muted); padding: 6px; border-bottom: 1px solid var(--line); }
  td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .item { cursor: pointer; }
  .detail { background: var(--panel-2); }
  .ln { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .err { color: var(--danger); }
  .kind { font-weight: 500; }
  .sub { color: var(--accent); font-weight: 600; cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; }
  .disc { margin-top: 16px; color: var(--muted); }
  .today { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); font-size: 13.5px; }
  .today.changed { border-color: var(--warn-line); background: var(--warn-bg); }
  .up { color: var(--danger); font-weight: 600; }
  .down { color: var(--ok); font-weight: 600; }
</style>
