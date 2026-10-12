<script lang="ts">
  import { app, prices, newTab, importAwsFile } from '../lib/store.svelte';
  import { buildReport, dateOnly } from '../lib/report';
  import { download, fillAwsTemplate, saveEstimate } from '../lib/api';
  import { ec2Rows } from '../lib/awsexport';
  import AwsFiles from './AwsFiles.svelte';

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

  let awsOpen = $state(false);
  let imported = $state<{ text: string; skipped: string[] } | null>(null);

  /** Fills the visitor's copy of AWS's EC2 template with this tab's AWS VMs. */
  function fillTemplate(file: File) {
    imported = null;
    const res = ec2Rows($state.snapshot(app.est), prices);
    if (!res.rows.length) {
      problem = 'This tab has no AWS virtual machines to put in the template.';
      imported = res.skipped.length ? { text: '', skipped: res.skipped } : null;
      return;
    }
    run("Filling AWS's template…", async () => {
      await fillAwsTemplate(file, res.rows);
      imported = {
        text: `Filled ${res.rows.length} row${res.rows.length === 1 ? '' : 's'} of AWS's EC2 template. Upload the file in the AWS Pricing Calculator.`,
        skipped: [...res.skipped, ...res.changed],
      };
    });
  }

  function importFile(file: File) {
    imported = null;
    run('Reading the file…', async () => {
      const res = await importAwsFile(file.name, await file.arrayBuffer());
      const vms = res.instances ? ` (${res.instances} instance${res.instances === 1 ? '' : 's'})` : '';
      imported = {
        text: res.rows
          ? `Imported ${res.rows} row${res.rows === 1 ? '' : 's'}${vms} of the ${res.kind} into the AWS site. Cards marked ⚑ carry a note to check.`
          : 'No rows were imported.',
        skipped: res.skipped,
      };
    });
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
  <a class="brand" href="/" title="Home">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent)" /><path d="M9 21.5a5 5 0 0 1 .6-10 6.5 6.5 0 0 1 12.3 1.6A4.2 4.2 0 0 1 22 21.5z" fill="#fff" /></svg>
    <span class="name">csps-calc</span>
  </a>
  <label class="est editable">
    <span class="sr-only">Estimate name</span>
    <input bind:value={app.est.name} maxlength="120" />
  </label>
  <span class="asof small muted" title="Prices refresh every day from each provider's public price list.">Prices as of {dateOnly(asOf)}</span>
  <div class="actions">
    <button onclick={newTab} title="Open a new, empty estimate in another tab">New</button>
    <button onclick={() => (awsOpen = true)} disabled={!!working} title="Import or fill the AWS Pricing Calculator EC2 bulk upload template">AWS files</button>
    <button onclick={() => run('Building the spreadsheet…', () => download(report(), 'xlsx'))} disabled={!!working}>Excel</button>
    <button onclick={() => run('Building the PDF…', () => download(report(), 'pdf'))} disabled={!!working}>PDF</button>
    <button class="primary" onclick={share} disabled={!!working}>Share link</button>
  </div>
</header>
<AwsFiles bind:open={awsOpen} onimport={importFile} onfill={fillTemplate} />
{#if working || problem || shareUrl || imported}
  <div class="flash" role="status">
    {#if working}{working}{/if}
    {#if problem}<span class="bad">{problem}</span>{/if}
    {#if imported && !working}
      <span>{imported.text}</span>
      {#if imported.skipped.length}
        <details><summary>{imported.skipped.length} {imported.skipped.length === 1 ? 'note' : 'notes'}: left out or changed</summary><ul class="small">{#each imported.skipped as s}<li>{s}</li>{/each}</ul></details>
      {/if}
      <button class="ghost small" onclick={() => (imported = null)} aria-label="Dismiss">✕</button>
    {/if}
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
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 800; color: var(--text); text-decoration: none; }
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
