<script lang="ts">
  import { app, prices, addItem } from '../lib/store.svelte';
  import { reminders } from '../lib/reminders';

  let dismissed = $state<string[]>([]);
  let all = $state(false);
  const list = $derived(reminders(app.est, prices).filter((r) => !dismissed.includes(r.id)));
  const shown = $derived(all ? list : list.slice(0, 2));
</script>

{#if list.length}
  <div class="rem" role="region" aria-label="Things to check">
    <ul>
      {#each shown as r (r.id)}
        <li>
          <span class="txt">{r.text}</span>
          <span class="act">
            {#if r.add}
              <button class="small" onclick={() => r.add && addItem(r.add.boxId, r.add.svc, r.add.spec, r.add.parentId)}>{r.add.label}</button>
            {/if}
            <button class="ghost small" aria-label="Dismiss" title="Dismiss" onclick={() => (dismissed = [...dismissed, r.id])}>✕</button>
          </span>
        </li>
      {/each}
    </ul>
    {#if list.length > 2}
      <button class="ghost small more" onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show ${list.length - 2} more to check`}</button>
    {/if}
  </div>
{/if}

<style>
  .rem { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: var(--radius); padding: 6px 10px; margin-bottom: 12px; font-size: 13px; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  li { display: flex; gap: 4px 10px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
  .txt { flex: 1 1 260px; }
  .txt::before { content: '⚑ '; color: var(--aws); }
  .act { display: flex; gap: 4px; flex: none; }
  .act button { padding: 2px 8px; font-size: 12px; }
  .more { padding: 2px 4px; margin-top: 2px; font-size: 12px; color: var(--muted); }
</style>
