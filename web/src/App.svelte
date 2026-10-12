<script lang="ts">
  // Hand-rolled routes; every link between pages is a full page load.
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const m = /^\/e\/([A-Za-z0-9_-]{6,40})$/.exec(path);
  const slug = m?.[1];
  const legal = path === '/privacy' || path === '/terms' || path === '/legal' ? (path.slice(1) as 'privacy' | 'terms' | 'legal') : undefined;
</script>

{#if slug}
  {#await import('./components/SharedView.svelte') then V}<V.default {slug} />{/await}
{:else if path === '/app'}
  {#await import('./components/Editor.svelte') then V}<V.default />{/await}
{:else if path === '/changelog'}
  {#await import('./components/Changelog.svelte') then V}<V.default />{/await}
{:else if legal}
  {#await import('./components/Legal.svelte') then V}<V.default page={legal} />{/await}
{:else}
  {#await import('./components/Landing.svelte') then V}<V.default />{/await}
{/if}
