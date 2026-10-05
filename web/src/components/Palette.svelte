<script lang="ts">
  import { services } from '../lib/catalog';
  import { app, addItem, find } from '../lib/store.svelte';

  const groups = ['Compute', 'Storage', 'Database', 'Networking', 'Security', 'Integration', 'Operations', 'Other'] as const;
  let q = $state('');

  const shown = $derived(
    services.filter((s) => !q || `${s.label} ${s.blurb}`.toLowerCase().includes(q.toLowerCase())),
  );

  /** Clicking a service adds it to the box of the selected item, or to the first box. */
  function add(svc: string) {
    const target = (app.selected && find(app.selected)?.box.id) || app.est.accounts[0]?.regions[0]?.id;
    if (target) addItem(target, svc);
  }

  function drag(e: DragEvent, svc: string) {
    e.dataTransfer?.setData('application/x-csps-svc', svc);
    e.dataTransfer!.effectAllowed = 'copy';
  }
</script>

<nav aria-label="Services">
  <input class="search" type="search" placeholder="Find a service" bind:value={q} aria-label="Find a service" />
  <p class="hint small muted">Drag a service into a region box, or click to add it to the selected box.</p>
  {#each groups as g}
    {@const list = shown.filter((s) => s.group === g)}
    {#if list.length}
      <h3>{g}</h3>
      <ul>
        {#each list as s (s.id)}
          <li>
            <button draggable="true" ondragstart={(e) => drag(e, s.id)} onclick={() => add(s.id)} title={s.blurb}>
              <span class="label">{s.label}</span>
              <span class="blurb">{s.blurb}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/each}
</nav>

<style>
  nav {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 110px);
    overflow: auto;
    padding-right: 4px;
  }
  .search { width: 100%; }
  .hint { margin: 6px 2px 4px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 14px 2px 6px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  li button {
    width: 100%;
    text-align: left;
    display: grid;
    gap: 1px;
    padding: 6px 9px;
    background: var(--panel);
    cursor: grab;
  }
  .label { font-weight: 600; }
  .blurb { font-size: 11px; color: var(--muted); }
  @media (max-width: 760px) {
    nav { position: static; max-height: none; }
    ul { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .blurb { display: none; }
  }
</style>
