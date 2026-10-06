<script lang="ts">
  import { drag } from '../lib/drag.svelte';
</script>

{#if drag.active}
  <div class="ghost" class:bad={drag.target !== null && !drag.target.ok} style:transform="translate({drag.x + 12}px, {drag.y + 12}px)" aria-hidden="true">
    {drag.svc ? '+ ' : ''}{drag.label}
  </div>
{/if}

<style>
  .ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 100;
    pointer-events: none;
    padding: 5px 10px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--panel);
    box-shadow: var(--shadow);
    font-weight: 600;
    font-size: 13px;
    max-width: 240px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ghost.bad { border-color: var(--danger); color: var(--danger); }
</style>
