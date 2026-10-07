<script lang="ts">
  import { app, copyBox, copyItem, copySite, find, findBox, tabName } from '../lib/store.svelte';
  import { service } from '../lib/catalog';
  import { isContainer } from '../lib/tree';

  const req = $derived(app.copy);
  const what = $derived.by(() => {
    if (!req) return null;
    if (req.kind === 'item') {
      const f = find(req.id);
      if (!f) return null;
      return { name: f.item.name || service(f.item.svc)?.label || f.item.svc, inside: isContainer(f.item.svc) && !!f.item.children?.length };
    }
    if (req.kind === 'box') {
      const b = findBox(req.id);
      return b ? { name: `the ${b.box.label || b.box.region} box`, inside: false } : null;
    }
    const a = app.est.accounts.find((x) => x.id === req.id);
    return a ? { name: a.label || 'this site', inside: false } : null;
  });

  let mode = $state<'same' | 'scale'>('same');
  let pct = $state(50);
  let inside = $state(true);
  /** Where a copied site goes: this tab or another open one. */
  let into = $state('');
  const pctOk = $derived(Number.isFinite(pct) && pct > 0 && pct <= 1000);

  function close() {
    app.copy = null;
    mode = 'same';
    inside = true;
    into = '';
  }

  function run() {
    if (!req || (mode === 'scale' && !pctOk)) return;
    const f = mode === 'same' ? 1 : pct / 100;
    if (req.kind === 'item') copyItem(req.id, inside, f);
    else if (req.kind === 'box') copyBox(req.id, f);
    else copySite(req.id, f, into || app.tab);
    close();
  }
</script>

<svelte:window onkeydown={(e) => { if (req && e.key === 'Escape') close(); }} />

{#if req && what}
  <div class="veil" role="presentation" onclick={close}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="copy-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <form onsubmit={(e) => { e.preventDefault(); run(); }}>
      <h2 id="copy-title">Copy {what.name}</h2>
      <fieldset>
        <legend class="sr-only">Size of the copy</legend>
        <label class="opt"><input type="radio" bind:group={mode} value="same" /> Same size (1:1)</label>
        <label class="opt">
          <input type="radio" bind:group={mode} value="scale" />
          Scale to
          <input class="pct" type="number" min="1" max="1000" step="1" bind:value={pct} onfocus={() => (mode = 'scale')} aria-label="Percentage of the original" />
          %
        </label>
      </fieldset>
      {#if mode === 'scale'}
        <p class="small muted">Counts, storage, requests and data transfer change; machine types and sizes stay. Counts round up.</p>
      {/if}
      {#if req.kind === 'site' && app.tabs.length > 1}
        <label class="opt">Into
          <select bind:value={into} aria-label="Tab to copy the site into">
            <option value="">This tab</option>
            {#each app.tabs.filter((t) => t.id !== app.tab) as t (t.id)}<option value={t.id}>{tabName(t)}</option>{/each}
          </select>
        </label>
      {/if}
      {#if what.inside}
        <label class="opt"><input type="checkbox" bind:checked={inside} /> With what is inside</label>
      {/if}
      <p class="small muted">The copy does not follow later changes to the original. For another size, delete the copy and copy again.</p>
      <div class="acts">
        <button type="button" class="ghost" onclick={close}>Cancel</button>
        <button type="submit" class="primary" disabled={mode === 'scale' && !pctOk}>Copy</button>
      </div>
    </form>
    </div>
  </div>
{/if}

<style>
  .veil { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); display: grid; place-items: center; z-index: 60; padding: 16px; }
  .modal { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px 20px; width: min(420px, 100%); }
  form { display: grid; gap: 10px; }
  h2 { margin: 0; font-size: 17px; }
  fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
  .opt { display: flex; gap: 8px; align-items: center; }
  .pct { width: 76px; }
  p { margin: 0; }
  .acts { display: flex; gap: 8px; justify-content: end; }
</style>
