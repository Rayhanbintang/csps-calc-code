<script lang="ts">
  let { open = $bindable(false), onimport, onfill }: { open: boolean; onimport: (f: File) => void; onfill: (f: File) => void } = $props();

  let importer = $state<HTMLInputElement>();
  let filler = $state<HTMLInputElement>();

  function take(e: Event, then: (f: File) => void) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    open = false;
    then(file);
  }
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false; }} />

{#if open}
  <div class="veil" role="presentation" onclick={() => (open = false)}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="aws-files-title" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="top">
        <h2 id="aws-files-title">AWS files</h2>
        <button class="ghost" aria-label="Close" onclick={() => (open = false)}>✕</button>
      </div>

      <section>
        <h3>Import the EC2 bulk upload template</h3>
        <p class="small muted">
          The AWS Pricing Calculator offers this .xlsx file in its Amazon EC2 bulk upload. Each row becomes a VM card,
          with its EBS disk and snapshots inside it. The file stays in this browser.
        </p>
        <p class="small links">
          <a href="https://calculator.aws/" target="_blank" rel="noopener">Open the AWS Pricing Calculator</a>
          <a href="/templates/csps-ec2-sample.xlsx" download>Download a sample file</a>
        </p>
        <button class="primary" onclick={() => importer?.click()}>Choose a file…</button>
        <input bind:this={importer} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onchange={(e) => take(e, onimport)} />
      </section>

      <section>
        <h3>Fill AWS's EC2 template from this tab</h3>
        <p class="small muted">
          Choose your copy of AWS's template. The AWS virtual machines of this tab go into its rows, ready to upload back
          in the AWS Pricing Calculator. The site's server fills the file and keeps nothing.
        </p>
        <button onclick={() => filler?.click()}>Choose AWS's template…</button>
        <input bind:this={filler} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onchange={(e) => take(e, onfill)} />
      </section>
    </div>
  </div>
{/if}

<style>
  .veil { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); display: grid; place-items: center; z-index: 60; padding: 16px; }
  .modal { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 18px 20px; width: min(480px, 100%); display: grid; gap: 14px; }
  .top { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-size: 17px; }
  h3 { margin: 0 0 4px; font-size: 14px; }
  section { display: grid; gap: 6px; justify-items: start; border-top: 1px solid var(--line); padding-top: 12px; }
  p { margin: 0; }
  .links { display: flex; gap: 14px; flex-wrap: wrap; }
  .links a { color: var(--accent); }
</style>
