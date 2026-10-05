<script lang="ts">
  import type { Provider } from '../lib/types';
  import { app } from '../lib/store.svelte';

  let { provider, value = $bindable() }: { provider: Provider; value: string } = $props();
  const regions = $derived(app.manifest?.providers[provider]?.regions ?? []);
</script>

<select bind:value aria-label="Region" class="rs">
  {#if !regions.some((r) => r.code === value)}<option value={value}>{value || 'Pick a region'}</option>{/if}
  {#each regions as r (r.code)}
    <option value={r.code}>{r.name} · {r.code}</option>
  {/each}
</select>

<style>
  .rs { max-width: 100%; font-size: 12px; padding: 4px 6px; font-weight: 600; }
</style>
