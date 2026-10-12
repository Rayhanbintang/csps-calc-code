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

  // One screenshot per feature, each made for that feature. No slide sets the same
  // workload on two clouds side by side: the site shows prices, it does not pick a winner.
  const FEATURES = [
    {
      img: 'board.webp', chip: 'Board',
      title: 'Every site of a design on one board',
      text: 'Put an on-premises data centre, an AWS production site and an Azure recovery site on one board. Each region box keeps a running total, and the summary adds the sites up.',
    },
    {
      img: 'nesting.webp', chip: 'Nesting',
      title: 'Cards nest like the real thing',
      text: 'Disks sit inside a VM, VMs inside a cluster, the cluster inside a VPC. Set three nodes and two disks each, and the card shows six disks in total.',
    },
    {
      img: 'switch.webp', chip: 'Cloud switch',
      title: 'Move a site to another cloud',
      text: 'Pick another provider for a site. The calculator picks the nearest region and a matching machine size, prices every card again and flags each card to check. This animation leaves the prices out: it shows the matching.',
    },
    {
      img: 'commit.webp', chip: 'Commitments',
      title: 'Commitments next to on-demand',
      text: "Select a card to see its on-demand price beside each Savings Plan and Reserved Instance term and payment option. Click one to use it.",
    },
    {
      img: 'copy.webp', chip: 'Copy',
      title: 'Copy a site at any size',
      text: 'Copy a card, a region box or a whole site, as it is or scaled. A recovery site at 50% keeps the machine types and halves the counts and storage.',
    },
    {
      img: 'honest.webp', chip: 'What each cloud sells',
      title: 'Only what the cloud sells',
      text: 'One real gap on each cloud. A card that asks for something its cloud does not sell shows the reason instead of a stand-in price, and the option is greyed out in the card settings.',
    },
    {
      img: 'aws.webp', chip: 'AWS imports',
      title: 'Bring in your AWS Pricing Calculator work',
      text: "Import an estimate's CSV export or the EC2 and EBS bulk upload templates. Each imported card notes AWS's own figure, and services this calculator does not price keep AWS's figure.",
    },
    {
      img: 'share.webp', chip: 'Share link',
      title: "Share a link that shows today's price",
      text: "A share link opens a read-only page with the numbers as saved and a Today column priced with today's list. Excel and PDF exports come from the same report.",
    },
    {
      img: 'advise.webp', chip: 'AI review (beta)',
      title: 'AI review (beta)',
      text: 'A language model reads the tab and points out risks and savings, naming the cards. It gives advice only and never changes the estimate. AI can make mistakes.',
    },
  ];

  // Carousel: a scroll-snap track, so a swipe on a phone moves one slide. The buttons,
  // chips and arrow keys scroll the same track.
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
      <div class="chips" role="tablist" aria-label="Choose a feature">
        {#each FEATURES as f, i (f.img)}
          <button role="tab" aria-selected={at === i} class:on={at === i} onclick={() => go(i)}>{f.chip}</button>
        {/each}
      </div>
      <div class="frame">
        <!-- A focusable scroll region that takes arrow keys is the carousel pattern. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div class="track" role="region" aria-label="Feature slides, use the arrow keys" bind:this={track} onscroll={onScroll} onkeydown={onKey} tabindex="0">
          {#each FEATURES as f, i (f.img)}
            <figure class="slide" aria-roledescription="slide" aria-label={`${i + 1} of ${FEATURES.length}: ${f.title}`}>
              <img src={`/landing/${f.img}`} alt={f.title} loading={i === 0 ? 'eager' : 'lazy'} width="1600" height="1000" />
              <figcaption>
                <span class="count">{i + 1} / {FEATURES.length}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </figcaption>
            </figure>
          {/each}
        </div>
        <button class="nav prev" aria-label="Previous feature" onclick={() => go(at - 1)}><span aria-hidden="true">‹</span></button>
        <button class="nav next" aria-label="Next feature" onclick={() => go(at + 1)}><span aria-hidden="true">›</span></button>
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
  .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-bottom: 14px; }
  .chips button {
    border-radius: 999px;
    padding: 6px 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    font-size: 13px;
  }
  .chips button.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
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
  .count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  h3 { margin: 2px 0 4px; font-size: 18px; }
  figcaption p { margin: 0; color: var(--muted); max-width: 860px; }
  /* Big, solid arrows in the middle of the picture, so nobody misses that there is more. */
  .nav {
    position: absolute;
    top: calc((100% - 96px) / 2);
    transform: translateY(-50%);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 3px solid var(--panel);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 34px;
    line-height: 1;
    display: grid;
    place-items: center;
    padding: 0 0 4px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
  }
  .nav:hover { filter: brightness(1.1); }
  .prev { left: 12px; }
  .next { right: 12px; }
  @media (max-width: 760px) {
    .hero { padding-top: 40px; }
    .prev { left: 6px; }
    .next { right: 6px; }
    .nav { width: 40px; height: 40px; font-size: 26px; top: 30%; }
    .chips button { padding: 4px 10px; font-size: 12px; }
    .or { display: none; }
  }
</style>
