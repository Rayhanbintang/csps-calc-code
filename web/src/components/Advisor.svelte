<script lang="ts">
  import { app, prices } from '../lib/store.svelte';
  import { buildReport } from '../lib/report';
  import { askReviewer } from '../lib/api';
  import type { Turn } from '../lib/api';
  import { blocks } from '../lib/plaintext';

  // One conversation per tab; a new tab starts fresh.
  let turns = $state<Turn[]>([]);
  let question = $state('');
  let working = $state(false);
  let problem = $state('');
  let tab = app.tab;
  $effect(() => {
    if (app.tab !== tab) {
      tab = app.tab;
      turns = [];
      problem = '';
    }
  });

  const empty = $derived(!app.est.accounts.some((a) => a.regions.some((r) => r.items.length)));

  async function ask(q: string) {
    if (working) return;
    working = true;
    problem = '';
    try {
      const report = buildReport($state.snapshot(app.est), prices, app.manifest);
      const answer = await askReviewer(report, q, turns.slice(-4));
      turns = [...turns, { role: 'user', content: q || 'Review this estimate.' }, { role: 'assistant', content: answer }];
      question = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      working = false;
    }
  }
</script>

<section class="advisor" aria-label="AI review">
  <div class="intro">
    <h2>AI review</h2>
    <p>
      A language model reads this tab and points out risks and savings. It gives advice only and never changes your
      cards. Its answers can be wrong: check them before you act.
    </p>
    <p class="small muted">
      A summary of this tab (card names, sizes, regions and prices) goes to Groq, which runs the model. Leave confidential
      names out of your cards. For people aged 18 and over. See <a href="/privacy">Privacy</a>.
    </p>
    <button class="primary" onclick={() => ask('')} disabled={working || empty}>
      {turns.length ? 'Review again' : 'Review this estimate'}
    </button>
    {#if empty}<span class="small muted">Add some cards first.</span>{/if}
  </div>

  {#each turns as t, i (i)}
    <div class="turn {t.role}">
      {#if t.role === 'user'}
        <p class="q">{t.content}</p>
      {:else}
        {#each blocks(t.content) as b, j (j)}
          {#if b.kind === 'h'}
            <h3>{#each b.runs as r}{#if r.bold}<strong>{r.text}</strong>{:else}{r.text}{/if}{/each}</h3>
          {:else if b.kind === 'li'}
            <div class="li">{#each b.runs as r}{#if r.bold}<strong>{r.text}</strong>{:else}{r.text}{/if}{/each}</div>
          {:else}
            <p>{#each b.runs as r}{#if r.bold}<strong>{r.text}</strong>{:else}{r.text}{/if}{/each}</p>
          {/if}
        {/each}
      {/if}
    </div>
  {/each}

  {#if working}<p class="muted" role="status">The model is reading the estimate…</p>{/if}
  {#if problem}<p class="err" role="alert">{problem}</p>{/if}

  {#if turns.length}
    <form onsubmit={(e) => { e.preventDefault(); if (question.trim()) ask(question.trim()); }}>
      <label for="followup" class="small muted">Ask a follow-up about this estimate</label>
      <textarea id="followup" bind:value={question} maxlength="500" rows="2" placeholder="For example: which commitments would cut the most?"></textarea>
      <button type="submit" disabled={working || !question.trim()}>Ask</button>
    </form>
  {/if}
</section>

<style>
  .advisor { max-width: 760px; display: grid; gap: 14px; }
  .intro { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; display: grid; gap: 8px; justify-items: start; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 0; }
  a { color: var(--accent); }
  .turn { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 16px; display: grid; gap: 6px; }
  .turn.user { background: var(--panel-2); }
  .q { font-weight: 600; }
  h3 { margin: 6px 0 0; font-size: 15px; }
  .li { padding-left: 16px; position: relative; }
  .li::before { content: '•'; position: absolute; left: 4px; color: var(--muted); }
  form { display: grid; gap: 6px; justify-items: start; }
  textarea { width: 100%; resize: vertical; padding: 8px; }
  .err { color: var(--danger); }
</style>
