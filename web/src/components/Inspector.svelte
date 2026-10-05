<script lang="ts">
  import type { Priced, Pricing } from '../lib/types';
  import { app, prices, find, duplicateItem, removeItem, priceVariant } from '../lib/store.svelte';
  import { service } from '../lib/catalog';
  import type { Field } from '../lib/catalog';
  import { afterEdit, ctxFor, effectiveMonthly, modelChoices, providerNames, samePricing } from '../lib/engine';
  import { money, qty, rate } from '../lib/report';
  import FieldInput from './FieldInput.svelte';

  let { itemId }: { itemId: string } = $props();

  const f = $derived(find(itemId));
  const svc = $derived(f ? service(f.item.svc) : undefined);
  const impl = $derived(f && svc ? svc.providers[f.acc.provider] : undefined);
  const p = $derived(prices.get(itemId));
  const ctx = $derived(f ? ctxFor(app.manifest, f.acc.provider, f.box.region) : undefined);

  // Provider-specific fields (instance type pickers) depend on region data.
  let extra = $state<Field[]>([]);
  $effect(() => {
    const spec = f ? JSON.parse(JSON.stringify(f.item.spec)) : {};
    const c = ctx;
    if (!impl?.fields || !c || (c.provider !== 'onprem' && !c.info)) {
      extra = [];
      return;
    }
    let stale = false;
    impl.fields(c, spec).then((fs) => { if (!stale) extra = fs; }).catch(() => { if (!stale) extra = []; });
    return () => { stale = true; };
  });

  // Every pricing option of this item, priced, for the comparison matrix.
  const choices = $derived(f ? modelChoices(f.acc.provider, f.item.svc) : []);
  let compare = $state<{ label: string; pricing: Pricing; res?: Priced }[]>([]);
  $effect(() => {
    const key = f ? JSON.stringify([f.acc.provider, f.box.region, f.item.spec, f.item.qty]) : '';
    void key;
    const list = choices.map((c) => ({ ...c, res: undefined as Priced | undefined }));
    compare = list;
    if (list.length < 2) return;
    let stale = false;
    Promise.all(list.map((c) => priceVariant(itemId, c.pricing))).then((rs) => {
      if (!stale) compare = list.map((c, i) => ({ ...c, res: rs[i] }));
    });
    return () => { stale = true; };
  });

  const odMonthly = $derived(compare.find((c) => c.pricing.model === 'od')?.res?.monthly);

  // The matrix: one row per plan type, one column per term, filtered by payment option.
  const payOptions = [
    { value: 'no', label: 'No upfront' },
    { value: 'partial', label: 'Partial upfront' },
    { value: 'all', label: 'All upfront' },
  ] as const;
  let pay = $state<'no' | 'partial' | 'all'>('no');
  $effect(() => {
    const chosen = f?.item.pricing?.pay;
    if (chosen) pay = chosen;
  });
  const hasPays = $derived(compare.some((c) => c.pricing.pay));
  const rowKey = (pr: Pricing) => `${pr.model}|${pr.kind ?? ''}|${pr.cls ?? ''}`;
  const rowLabel = (label: string) => label.split(', ').filter((x) => !/yr$|upfront$/.test(x)).join(', ');
  const rowsOf = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const c of compare) if (!seen.has(rowKey(c.pricing))) seen.set(rowKey(c.pricing), rowLabel(c.label));
    return [...seen].map(([key, label]) => ({ key, label }));
  });
  const terms = $derived.by(() => {
    const t = [...new Set(compare.filter((c) => c.pricing.model !== 'od').map((c) => c.pricing.term ?? 1))].sort();
    return t.length ? t : [1];
  });
  function cellOf(key: string, term: number) {
    const inRow = compare.filter((c) => rowKey(c.pricing) === key);
    if (inRow[0]?.pricing.model === 'od') return term === terms[0] ? inRow[0] : undefined;
    return inRow.find((c) => (c.pricing.term ?? 1) === term && (!c.pricing.pay || c.pricing.pay === pay));
  }

  // Size fields that make a hand-picked type stale when changed.
  const sizeKeys = ['vcpu', 'mem', 'arch', 'os', 'sw', 'licence', 'engine', 'gb', 'ha'];
  const typeKeys = ['aws.type', 'gcp.type', 'oci.shape', 'aws.class', 'aws.node'];

  async function setField(key: string, value: string | number | boolean) {
    if (!f || !ctx) return;
    f.item.spec[key] = value;
    if (sizeKeys.includes(key) && f.item.svc !== 'disk') for (const k of typeKeys) if (k in f.item.spec) f.item.spec[k] = '';
    const next = await afterEdit(f.acc.provider, ctx, $state.snapshot(f.item));
    const g = find(itemId);
    if (g) {
      g.item.spec = next.spec;
      g.item.check = undefined;
    }
  }

  function setPricing(pr: Pricing) {
    if (f) f.item.pricing = pr;
  }

  const visible = (fl: Field) => !fl.show || (f ? fl.show(f.item.spec) : true);
</script>

{#if f && svc}
  <div class="insp">
    <div class="top">
      <div>
        <div class="kicker small muted"><span class="tag {f.acc.provider}">{providerNames[f.acc.provider]}</span> {impl?.product ?? ''} · {f.box.region}</div>
        <label class="editable namewrap"><span class="sr-only">Item name</span><input class="name" value={f.item.name ?? ''} placeholder={svc.label} oninput={(e) => (f.item.name = (e.target as HTMLInputElement).value)} maxlength="80" /></label>
      </div>
      <button class="ghost" aria-label="Close" onclick={() => (app.selected = null)}>✕</button>
    </div>

    {#if f.item.check}
      <div class="flag">⚑ {f.item.check} <button class="ghost small" onclick={() => (f.item.check = undefined)}>Looks right</button></div>
    {/if}

    <div class="cols">
      <section aria-label="Specification">
        <h4>Specification</h4>
        <label class="field">
          <span>Quantity</span>
          <input type="number" min="1" step="1" value={f.item.qty} oninput={(e) => (f.item.qty = Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 1)))} />
        </label>
        {#each svc.fields.filter(visible) as fl (fl.key)}
          <FieldInput field={fl} value={f.item.spec[fl.key]} onchange={(v) => setField(fl.key, v)} />
        {/each}
        {#each extra as fl (fl.key)}
          <FieldInput field={fl} value={f.item.spec[fl.key] ?? ''} onchange={(v) => setField(fl.key, v)} />
        {/each}
      </section>

      <section aria-label="Pricing model">
        <h4>Pricing model</h4>
        {#if compare.length > 1}
          {#if hasPays}
            <div class="pays" role="group" aria-label="Payment">
              {#each payOptions as po}
                <button class:on={pay === po.value} aria-pressed={pay === po.value} onclick={() => (pay = po.value)}>{po.label}</button>
              {/each}
            </div>
          {/if}
          <table class="cmp">
            <thead><tr><th>Plan</th>{#each terms as t}<th class="num">{t} year{t > 1 ? 's' : ''}</th>{/each}</tr></thead>
            <tbody>
              {#each rowsOf as row (row.key)}
                <tr>
                  <td class="plan">{row.label}</td>
                  {#each terms as t}
                    {@const c = cellOf(row.key, t)}
                    <td class="num cell" class:on={!!c && samePricing(c.pricing, f.item.pricing)} class:na={!c || !!c.res?.unavailable}>
                      {#if c}
                        <button class="pick" disabled={!!c.res?.unavailable} onclick={() => setPricing(c.pricing)} aria-pressed={samePricing(c.pricing, f.item.pricing)}>
                          {#if !c.res}…
                          {:else if c.res.unavailable}n/a
                          {:else}
                            <span class="m">{money(effectiveMonthly(c.res, c.pricing))}</span>
                            {#if odMonthly && c.pricing.model !== 'od'}<span class="s">saves {Math.round((1 - effectiveMonthly(c.res, c.pricing) / odMonthly) * 100)}%</span>{/if}
                          {/if}
                        </button>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="small muted">Average cost per month over the term, upfront included. Click a price to use it.</p>
        {:else}
          <p class="small muted">{f.acc.provider === 'oci' ? 'OCI lists one pay-as-you-go price.' : 'This service has one pricing model.'}</p>
        {/if}
      </section>
    </div>

    <section class="cost" aria-label="Cost breakdown">
      <h4>Cost breakdown</h4>
      {#if !p}
        <p class="muted">Pricing…</p>
      {:else if p.unavailable}
        <p class="err">{p.unavailable}</p>
      {:else}
        <table class="lines">
          <thead><tr><th>Line</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Per month</th></tr></thead>
          <tbody>
            {#each p.lines as l}
              <tr><td>{l.label}</td><td class="num">{qty(l.qty)} <span class="muted small">{l.unit}</span></td><td class="num">{rate(l.rate)}</td><td class="num">{money(l.monthly)}</td></tr>
            {/each}
          </tbody>
          <tfoot>
            <tr><th colspan="3">Total per month</th><th class="num">{money(p.monthly)}</th></tr>
            {#if p.upfront}<tr><th colspan="3">Upfront, once</th><th class="num">{money(p.upfront)}</th></tr>{/if}
          </tfoot>
        </table>
      {/if}
      {#if p?.notes.length}
        <ul class="notes small">{#each p.notes as n}<li>{n}</li>{/each}</ul>
      {/if}
    </section>

    <div class="foot">
      <button onclick={() => duplicateItem(itemId)}>Duplicate</button>
      <button class="danger" onclick={() => removeItem(itemId)}>Delete</button>
    </div>
  </div>
{/if}

<style>
  .insp { padding: 12px 14px 14px; display: grid; gap: 12px; }
  .top { display: flex; justify-content: space-between; gap: 8px; align-items: start; }
  .kicker { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .namewrap { margin-top: 6px; }
  .name { font-size: 15px; font-weight: 700; width: 100%; }
  .flag { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 8px; padding: 8px 10px; }
  .cols { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 14px; }
  h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .field { display: grid; gap: 3px; margin-bottom: 8px; }
  .field > span { font-size: 12px; color: var(--muted); }
  .field input { width: 100%; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; font-weight: 600; color: var(--muted); font-size: 11.5px; padding: 4px 4px; border-bottom: 1px solid var(--line); }
  td { padding: 5px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .pays { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
  .pays button { padding: 3px 9px; font-size: 12px; border-radius: 999px; }
  .pays button.on { background: var(--text); color: var(--bg); border-color: var(--text); }
  .plan { font-size: 12px; }
  .cell { padding: 3px; }
  .pick { width: 100%; display: grid; justify-items: end; gap: 0; padding: 4px 6px; border-color: transparent; background: transparent; font-variant-numeric: tabular-nums; }
  .pick:hover { border-color: var(--accent); }
  .cell.on .pick { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: var(--accent); font-weight: 700; }
  .cell.na { opacity: 0.5; }
  .m { font-size: 12.5px; }
  .s { font-size: 11px; color: var(--ok); }
  .lines td { vertical-align: top; }
  .lines tfoot th { color: var(--text); border-bottom: 0; padding-top: 6px; }
  .notes { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
  .err { color: var(--danger); }
  .foot { display: flex; gap: 8px; justify-content: flex-end; }
  .danger:hover { border-color: var(--danger); color: var(--danger); }
  @media (max-width: 560px) { .cols { grid-template-columns: 1fr; } }
</style>
