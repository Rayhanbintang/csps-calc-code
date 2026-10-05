<script lang="ts">
  import { app, prices } from '../lib/store.svelte';
  import { estimateTotals } from '../lib/engine';
  import { DISCLAIMER, money } from '../lib/report';

  const t = $derived(estimateTotals(app.est, prices));
</script>

<footer>
  <div class="totals">
    <span><span class="muted small">Per month</span> <strong class="num">{money(t.monthly)}</strong></span>
    <span><span class="muted small">Upfront</span> <strong class="num">{money(t.upfront)}</strong></span>
    <span><span class="muted small">12 months</span> <strong class="num">{money(t.monthly * 12 + t.upfront)}</strong></span>
  </div>
  <p class="small muted">{DISCLAIMER} Made by Rayhan. Source on <a href="https://github.com/Rayhanbintang/csps-calc-code" target="_blank" rel="noopener">GitHub</a>.</p>
</footer>

<style>
  footer {
    position: sticky;
    bottom: 0;
    background: var(--panel);
    border-top: 1px solid var(--line);
    padding: 8px 16px;
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    z-index: 2;
  }
  .totals { display: flex; gap: 18px; flex-wrap: wrap; }
  strong { font-size: 15px; }
  p { margin: 0; flex: 1 1 320px; }
  @media (max-width: 760px) {
    p { display: none; }
    .totals { gap: 12px; }
    strong { font-size: 14px; }
  }
</style>
