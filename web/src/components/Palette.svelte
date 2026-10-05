<script lang="ts">
  import { services } from '../lib/catalog';
  import { app, addItem, find } from '../lib/store.svelte';

  const groups = ['Compute', 'Storage', 'Database', 'Networking', 'Security', 'Integration', 'Operations', 'Other'] as const;
  let q = $state('');

  // Collapsed groups are remembered in this browser.
  const KEY = 'csps-calc:collapsed-groups';
  let collapsed = $state<string[]>([]);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(saved)) collapsed = saved.filter((g) => typeof g === 'string');
  } catch {
    /* storage blocked: all groups open */
  }
  function toggle(g: string) {
    collapsed = collapsed.includes(g) ? collapsed.filter((x) => x !== g) : [...collapsed, g];
    try { localStorage.setItem(KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
  }
  const allClosed = $derived(collapsed.length === groups.length);
  function toggleAll() {
    collapsed = allClosed ? [] : [...groups];
    try { localStorage.setItem(KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
  }

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
  <div class="bar">
    <p class="hint small muted">Drag a service into a region box, or click to add it to the selected box.</p>
    <button class="ghost small all" onclick={toggleAll}>{allClosed ? 'Expand all' : 'Collapse all'}</button>
  </div>
  {#each groups as g}
    {@const list = shown.filter((s) => s.group === g)}
    {#if list.length}
      {@const open = q !== '' || !collapsed.includes(g)}
      <section>
        <h3>
          <button class="grp" aria-expanded={open} onclick={() => toggle(g)}>
            <span class="chev" class:open aria-hidden="true">▸</span>
            {g}
            <span class="count">{list.length}</span>
          </button>
        </h3>
        {#if open}
          <ul>
            {#each list as s (s.id)}
              <li>
                <button class="svc" draggable="true" ondragstart={(e) => drag(e, s.id)} onclick={() => add(s.id)} title={s.blurb}>
                  <span class="label">{s.label}</span>
                  <span class="blurb">{s.blurb}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/each}
</nav>

<style>
  nav {
    max-height: calc(100vh - 110px);
    overflow: auto;
    padding-right: 4px;
  }
  .search { width: 100%; }
  .bar { display: flex; gap: 6px; align-items: start; justify-content: space-between; margin: 6px 0 2px; }
  .hint { margin: 0 2px; }
  .all { flex: none; padding: 2px 6px; font-size: 11px; color: var(--muted); }
  section { margin-top: 6px; }
  h3 { margin: 0; }
  .grp {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 0;
    border-radius: 6px;
    padding: 6px 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .grp:hover { background: var(--panel-2); color: var(--text); }
  .chev { display: inline-block; transition: transform 0.12s; font-size: 10px; }
  .chev.open { transform: rotate(90deg); }
  .count { margin-left: auto; font-weight: 600; letter-spacing: 0; opacity: 0.8; }
  ul { list-style: none; margin: 2px 0 4px; padding: 0; display: grid; gap: 4px; }
  .svc {
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
    nav { max-height: none; }
    ul { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .blurb { display: none; }
  }
</style>
