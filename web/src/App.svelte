<script lang="ts">
  import Editor from './components/Editor.svelte';
  import SharedView from './components/SharedView.svelte';

  const m = /^\/e\/([A-Za-z0-9_-]{6,40})\/?$/.exec(location.pathname);
  const slug = m?.[1];
</script>

{#if slug}
  <SharedView {slug} />
{:else}
  <Editor />
{/if}
