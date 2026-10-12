<script lang="ts">
  import SiteFooter from './SiteFooter.svelte';

  // A share link is /e/<code>; people paste the whole URL or only the code.
  const CODE = /^[A-Za-z0-9_-]{6,40}$/;
  let link = $state('');
  let problem = $state('');

  function codeOf(text: string): string | undefined {
    const t = text.trim();
    if (CODE.test(t)) return t;
    const m = /\/e\/([A-Za-z0-9_-]{6,40})\/?(?:[?#].*)?$/.exec(t);
    return m?.[1];
  }

  function open(e: SubmitEvent) {
    e.preventDefault();
    const code = codeOf(link);
    if (!code) {
      problem = 'Paste a share link such as https://csps-calc.vercel.app/e/ijrsxWeSUDo2, or only its code.';
      return;
    }
    location.href = `/e/${code}`;
  }

  // Drafts live in this browser's storage; offer to go back to them.
  const hasDraft = (() => {
    try {
      return !!localStorage.getItem('csps-calc:tabs') || !!localStorage.getItem('csps-calc:draft');
    } catch {
      return false; // storage blocked
    }
  })();

  const FEATURES = [
    {
      img: 'board',
      title: 'One board, four clouds',
      text: 'Lay out AWS, Google Cloud, Oracle Cloud and Azure sites side by side. Each region gets its own box with a running total, and the summary compares the clouds.',
    },
    {
      img: 'nesting',
      title: 'Cards nest like the real thing',
      text: 'Put disks inside a VM, VMs inside a cluster and the cluster inside a VPC. Set the node count once and the disks inside multiply with it.',
    },
    {
      img: 'switch',
      title: 'Switch clouds in one click',
      text: 'Convert a whole site to another provider. The calculator picks the nearest region and a matching machine size, prices every card again and flags what to check.',
    },
    {
      img: 'commit',
      title: 'Commitments next to on-demand',
      text: 'Compare on-demand with Reserved Instances, Savings Plans and committed-use discounts for one card, side by side. Upfront payments show apart from the monthly bill.',
    },
    {
      img: 'advise',
      title: 'An AI review of your design',
      text: 'A language model reads the tab and points out risks and savings, naming the cards. It gives advice only and never changes the estimate.',
    },
    {
      img: 'aws',
      title: 'Bring in your AWS work',
      text: "Import the AWS Pricing Calculator's EC2 and EBS bulk upload templates or an estimate's CSV export, and fill AWS's EC2 template from your estimate.",
    },
    {
      img: 'share',
      title: 'Share a link, export a file',
      text: "Send a read-only link or download Excel and PDF. A shared link keeps the numbers you saved and shows today's price beside them.",
    },
  ];

  // Carousel: a scroll-snap track, so a swipe on a phone moves one slide. The buttons,
  // dots and arrow keys scroll the same track.
  let track = $state<HTMLDivElement>();
  let at = $state(0);
  function go(i: number) {
    if (!track) return;
    const n = FEATURES.length;
    const to = (i + n) % n;
    track.scrollTo({ left: to * track.clientWidth, behavior: 'smooth' });
  }
  function onScroll() {
    if (track) at = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
  }
</script>

<div class="page">
  <main>
    <section class="hero">
      <h1>Cloud Service Provider<span class="s">S</span> Calculator</h1>
      <p class="lead">
        Price one workload on AWS, Google Cloud, Oracle Cloud and Azure on the same board. Prices come from each
        provider's public price list, refreshed every day.
      </p>

      <div class="actions">
        <form class="open" onsubmit={open}>
          <label for="link">Open a saved estimate</label>
          <div class="row">
            <input id="link" bind:value={link} oninput={() => (problem = '')} placeholder="Paste a share link or code" autocomplete="off" spellcheck="false" />
            <button type="submit">Open</button>
          </div>
          {#if problem}<p class="err small" role="alert">{problem}</p>{/if}
        </form>
        <div class="or muted small">or</div>
        <div class="new">
          <a class="btn primary" href="/app?new">Create a new estimate</a>
          {#if hasDraft}<a class="small" href="/app">Continue where you left off</a>{/if}
        </div>
      </div>
    </section>

    <section class="why">
      <h2>What it does</h2>
      <p>
        Solution architects quote one design on several clouds. Doing that in each provider's own calculator
        means four tabs, four layouts and a spreadsheet to compare them. This calculator keeps the design in one place
        and prices it on every cloud with list prices in USD, before tax.
      </p>
    </section>

    <section class="features" aria-roledescription="carousel" aria-label="What the calculator does">
      <div class="frame">
        <!-- A focusable scroll region that takes arrow keys is the carousel pattern. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div class="track" role="region" aria-label="Feature slides, use the arrow keys" bind:this={track} onscroll={onScroll} onkeydown={onKey} tabindex="0">
          {#each FEATURES as f, i (f.img)}
            <figure class="slide" aria-roledescription="slide" aria-label={`${i + 1} of ${FEATURES.length}: ${f.title}`}>
              <img src={`/landing/${f.img}.webp`} alt={f.title} loading={i === 0 ? 'eager' : 'lazy'} width="1600" height="1000" />
              <figcaption>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </figcaption>
            </figure>
          {/each}
        </div>
        <button class="nav prev" aria-label="Previous feature" onclick={() => go(at - 1)}>‹</button>
        <button class="nav next" aria-label="Next feature" onclick={() => go(at + 1)}>›</button>
      </div>
      <div class="dots" role="tablist" aria-label="Choose a feature">
        {#each FEATURES as f, i (f.img)}
          <button role="tab" aria-selected={at === i} aria-label={f.title} class:on={at === i} onclick={() => go(i)}></button>
        {/each}
      </div>
    </section>
  </main>
  <SiteFooter />
</div>

<style>
  .page { min-height: 100vh; display: flex; flex-direction: column; }
  main { flex: 1; width: 100%; max-width: 1240px; margin: 0 auto; padding: 0 16px; }
  .hero { text-align: center; padding: 72px 0 40px; }
  h1 { font-size: clamp(30px, 5.5vw, 52px); line-height: 1.1; margin: 0 0 16px; letter-spacing: -0.02em; }
  .s {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-radius: 8px;
    padding: 0 0.08em;
  }
  .lead { font-size: 17px; color: var(--muted); max-width: 640px; margin: 0 auto 32px; }
  .actions {
    display: flex;
    gap: 20px;
    align-items: flex-end;
    justify-content: center;
    flex-wrap: wrap;
  }
  .open { text-align: left; width: min(420px, 100%); }
  .open label { display: block; font-weight: 600; margin-bottom: 6px; }
  .row { display: flex; gap: 8px; }
  .row input { flex: 1; min-width: 0; padding: 9px 10px; }
  .or { padding-bottom: 10px; }
  .new { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .btn {
    display: inline-block;
    padding: 10px 18px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
  }
  .btn.primary { background: var(--accent); color: var(--accent-ink); }
  .err { color: var(--danger); margin: 6px 0 0; }
  .new a.small { color: var(--accent); }
  .why { max-width: 720px; margin: 24px auto 40px; text-align: center; }
  .why h2 { font-size: 22px; margin: 0 0 8px; }
  .why p { color: var(--muted); margin: 0; font-size: 15px; }
  .features { padding-bottom: 56px; }
  .frame { position: relative; }
  .track {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .track::-webkit-scrollbar { display: none; }
  .track:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .slide { flex: 0 0 100%; scroll-snap-align: start; margin: 0; }
  img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--line); background: var(--panel-2); }
  figcaption { padding: 14px 18px 18px; }
  h3 { margin: 0 0 4px; font-size: 18px; }
  figcaption p { margin: 0; color: var(--muted); max-width: 820px; }
  .nav {
    position: absolute;
    top: 40%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 26px;
    line-height: 1;
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .prev { left: -14px; }
  .next { right: -14px; }
  .dots { display: flex; justify-content: center; gap: 8px; margin-top: 14px; }
  .dots button { width: 10px; height: 10px; padding: 0; border-radius: 50%; border: 1px solid var(--field-line); background: transparent; }
  .dots button.on { background: var(--accent); border-color: var(--accent); }
  @media (max-width: 760px) {
    .hero { padding-top: 40px; }
    .prev { left: 4px; }
    .next { right: 4px; }
    .nav { width: 36px; height: 36px; font-size: 22px; }
    .or { display: none; }
  }
</style>
