<script lang="ts">
  import { app, prices, newTab } from '../lib/store.svelte';
  import { buildReport, dateOnly } from '../lib/report';
  import { download, saveEstimate } from '../lib/api';

  let shareUrl = $state('');
  let working = $state('');
  let problem = $state('');

  const asOf = $derived.by(() => {
    const m = app.manifest;
    if (!m) return '';
    const all = Object.values(m.providers).flatMap((p) => p.regions.map((r) => r.fetched)).sort();
    return all[0] ?? m.generated;
  });

  async function run(label: string, fn: () => Promise<void>) {
    working = label;
    problem = '';
    try {
      await fn();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      working = '';
    }
  }

  function report() {
    return buildReport($state.snapshot(app.est), prices, app.manifest);
  }

  const share = () =>
    run('Saving…', async () => {
      const slug = await saveEstimate($state.snapshot(app.est), report());
      shareUrl = `${location.origin}/e/${slug}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        /* clipboard blocked; the link stays on screen */
      }
    });

</script>

<header>
  <div class="brand">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent)" /><path d="M9 21.5a5 5 0 0 1 .6-10 6.5 6.5 0 0 1 12.3 1.6A4.2 4.2 0 0 1 22 21.5z" fill="#fff" /></svg>
    <span class="name">csps-calc</span>
  </div>
  <label class="est editable">
    <span class="sr-only">Estimate name</span>
    <input bind:value={app.est.name} maxlength="120" />
  </label>
  <span class="asof small muted" title="Prices refresh every day from each provider's public price list.">Prices as of {dateOnly(asOf)}</span>
  <div class="actions">
    <button onclick={newTab} title="Open a new, empty estimate in another tab">New</button>
    <button onclick={() => run('Building the spreadsheet…', () => download(report(), 'xlsx'))} disabled={!!working}>Excel</button>
    <button onclick={() => run('Building the PDF…', () => download(report(), 'pdf'))} disabled={!!working}>PDF</button>
    <button class="primary" onclick={share} disabled={!!working}>Share link</button>
  </div>
</header>
{#if working || problem || shareUrl}
  <div class="flash" role="status">
    {#if working}{working}{/if}
    {#if problem}<span class="bad">{problem}</span>{/if}
    {#if shareUrl && !working}
      Link copied: <a href={shareUrl} target="_blank" rel="noopener">{shareUrl}</a>
      <span class="muted">Anyone with the link can view this version. Editing makes a new link.</span>
      <button class="ghost small" onclick={() => (shareUrl = '')} aria-label="Dismiss">✕</button>
    {/if}
  </div>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; }
  .name { font-size: 16px; letter-spacing: -0.01em; }
  .est { flex: 1 1 220px; max-width: 420px; }
  .est input { width: 100%; font-weight: 600; }
  .actions { display: flex; gap: 8px; margin-left: auto; flex-wrap: wrap; }
  .flash {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 8px 16px; background: var(--panel-2); border-bottom: 1px solid var(--line);
  }
  .flash a { word-break: break-all; }
  .bad { color: var(--danger); }
</style>
