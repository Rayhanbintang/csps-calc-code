<script lang="ts">
  import SiteFooter from './SiteFooter.svelte';
  import { CHANGELOG } from '../lib/changelog';

  const long = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  $effect(() => {
    document.title = 'Changelog · Cloud Service ProviderS Calculator';
  });
</script>

<div class="page">
  <header>
    <a class="brand" href="/">Cloud Service Provider<span class="s">S</span> Calculator</a>
    <a class="small" href="/app">Open the calculator</a>
  </header>
  <main>
    <h1>Changelog</h1>
    <p class="muted small">Each version is the date it went live.</p>
    {#each CHANGELOG as r (r.date)}
      <section id={r.date}>
        <h2><a href={`#${r.date}`}>{r.date}</a> <span class="muted small">{long(r.date)}</span></h2>
        <ul>
          {#each r.items as t}<li>{t}</li>{/each}
        </ul>
      </section>
    {/each}
  </main>
  <SiteFooter />
</div>

<style>
  .page { min-height: 100vh; display: flex; flex-direction: column; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .brand { font-weight: 700; color: var(--text); text-decoration: none; }
  .s { color: var(--accent); }
  header a.small { color: var(--accent); }
  main { flex: 1; width: 100%; max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { margin: 0 0 4px; }
  section { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 12px; }
  h2 { font-size: 18px; margin: 0 0 8px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  h2 a { color: var(--text); text-decoration: none; font-family: var(--mono); }
  li { margin-bottom: 6px; }
</style>
