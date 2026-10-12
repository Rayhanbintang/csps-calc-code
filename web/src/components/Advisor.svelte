<script lang="ts">
  import { tick } from 'svelte';
  import { app, prices } from '../lib/store.svelte';
  import { buildReport } from '../lib/report';
  import { askReviewer } from '../lib/api';
  import type { Turn } from '../lib/api';
  import { blocks } from '../lib/plaintext';

  let { open = $bindable(false) }: { open: boolean } = $props();

  // One conversation per tab; a new tab starts fresh. The panel stays mounted while
  // collapsed, so closing it keeps the conversation.
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

  const SUGGESTED = [
    'Review my design: the main risks, then the main savings.',
    'Which commitments would cut the most?',
    'What is missing for high availability?',
  ];
  const LABEL: Record<string, string> = { [SUGGESTED[0]]: 'Review my design' };

  const empty = $derived(!app.est.accounts.some((a) => a.regions.some((r) => r.items.length)));

  let list = $state<HTMLDivElement>();
  async function toEnd() {
    await tick();
    list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }

  async function ask(q: string) {
    const text = q.trim();
    if (working || !text) return;
    working = true;
    problem = '';
    turns = [...turns, { role: 'user', content: text }];
    question = '';
    void toEnd();
    try {
      const report = buildReport($state.snapshot(app.est), prices, app.manifest);
      const answer = await askReviewer(report, text, turns.slice(-5, -1));
      turns = [...turns, { role: 'assistant', content: answer }];
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      turns = turns.slice(0, -1);
      question = text;
    } finally {
      working = false;
      void toEnd();
    }
  }

  function key(e: KeyboardEvent) {
    // Enter sends; Shift+Enter starts a new line.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(question);
    }
  }
</script>

<section class="chat" class:open aria-label="AI review" aria-hidden={!open}>
  <div class="head">
    <h2>AI review <span class="beta">Beta</span></h2>
    <button class="ghost" onclick={() => (open = false)} aria-label="Collapse the AI review" title="Collapse">⇥</button>
  </div>

  <div class="list" bind:this={list}>
    <p class="intro small muted">
      Ask about this tab: risks, savings, what is missing. The model gives advice only and never changes your cards.
      A summary of the tab (card names, sizes, regions and prices) goes to Groq to answer. Leave confidential names out.
      For people aged 18 and over. <a href="/privacy">Privacy</a>
    </p>
    {#each turns as t, i (i)}
      {#if t.role === 'user'}
        <p class="q">{LABEL[t.content] ?? t.content}</p>
      {:else}
        <div class="a">
          {#each blocks(t.content) as b, j (j)}
            {#if b.kind === 'h'}
              <h3>{#each b.runs as r}{#if r.bold}<strong>{r.text}</strong>{:else}{r.text}{/if}{/each}</h3>
            {:else if b.kind === 'li'}
              <div class="li">{#each b.runs as r}{#if r.bold}<strong>{r.text}</strong>{:else}{r.text}{/if}{/each}</div>
            {:else}
              <p>{#each b.runs as r}{#if r.bold}<strong>{r.text}</strong>{:else}{r.text}{/if}{/each}</p>
            {/if}
          {/each}
        </div>
      {/if}
    {/each}
    {#if working}<p class="muted small" role="status">The model is reading the estimate…</p>{/if}
    {#if problem}<p class="err small" role="alert">{problem}</p>{/if}
  </div>

  <div class="foot">
    <div class="chips" aria-label="Suggested questions">
      {#each SUGGESTED as s (s)}
        <button class="chip" onclick={() => ask(s)} disabled={working || empty}>{LABEL[s] ?? s}</button>
      {/each}
    </div>
    <form onsubmit={(e) => { e.preventDefault(); void ask(question); }}>
      <label for="ask" class="sr-only">Ask about this estimate</label>
      <textarea id="ask" bind:value={question} onkeydown={key} maxlength="500" rows="2" placeholder={empty ? 'Add some cards first' : 'Ask about this estimate…'} disabled={empty}></textarea>
      <button type="submit" class="primary" disabled={working || empty || !question.trim()}>Send</button>
    </form>
    <p class="mistakes">AI can make mistakes. Check figures and advice before you rely on them.</p>
  </div>
</section>

<style>
  .chat {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 92%);
    z-index: 8;
    display: none;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: 0 10px 30px rgb(0 0 0 / 16%);
    overflow: hidden;
  }
  .chat.open { display: flex; }
  .head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px 8px 16px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .beta { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: var(--warn-bg); border: 1px solid var(--warn-line); }
  /* Only the conversation scrolls; the head and the input stay put. */
  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; display: grid; align-content: start; gap: 10px; }
  .intro { margin: 0; }
  .intro a { color: var(--accent); }
  .q { margin: 0; justify-self: end; max-width: 85%; background: var(--accent); color: var(--accent-ink); padding: 8px 12px; border-radius: 12px 12px 2px 12px; }
  .a { background: var(--panel-2); border-radius: 12px 12px 12px 2px; padding: 10px 12px; display: grid; gap: 6px; font-size: 13px; }
  .a p, .a h3 { margin: 0; }
  .a h3 { font-size: 14px; margin-top: 4px; }
  .li { padding-left: 14px; position: relative; }
  .li::before { content: '•'; position: absolute; left: 3px; color: var(--muted); }
  .err { color: var(--danger); margin: 0; }
  .foot { border-top: 1px solid var(--line); padding: 10px 12px 8px; display: grid; gap: 8px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { border-radius: 999px; font-size: 12px; padding: 4px 10px; }
  .chip:first-child { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  form { display: flex; gap: 8px; align-items: flex-end; }
  textarea { flex: 1; resize: none; padding: 8px 10px; min-width: 0; }
  .mistakes { margin: 0; font-size: 11px; color: var(--muted); }
  @media (max-width: 760px) {
    .chat { position: static; width: auto; margin-top: 12px; max-height: 80vh; }
  }
</style>
