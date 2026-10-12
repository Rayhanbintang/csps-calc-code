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
      text: 'Lay out AWS, Google Cloud, Oracle Cloud and Azure sites side by side. Each region gets its own box with a running total, and the summary adds them up.',
    },
    {
      img: 'nesting',
      title: 'Cards nest like the real thing',
      text: 'Put disks inside a VM, VMs inside a cluster and the cluster inside a VPC. Set the node count once and the disks inside multiply with it.',
    },
    {
      img: 'switch',
      title: 'Switch clouds in one click',
      text: 'Convert a whole site to another provider. The calculator picks the nearest region and a matching machine size, then prices every card again.',
    },
    {
      img: 'commit',
      title: 'Commitments next to on-demand',
      text: 'Compare on-demand with Reserved Instances, Savings Plans and committed-use discounts on the same card. Upfront payments show apart from the monthly bill.',
    },
    {
      img: 'import',
      title: 'Bring in your AWS estimate',
      text: "Import the EC2 bulk upload template from the AWS Pricing Calculator. Each row lands as a VM with its disk, grouped the way you grouped it.",
    },
    {
      img: 'share',
      title: 'Share a link, export a file',
      text: "Send a read-only link or download Excel and PDF. A shared link keeps the numbers you saved and shows today's price beside them.",
    },
  ];
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

    <section class="features">
      {#each FEATURES as f}
        <article>
          <img src={`/landing/${f.img}.webp`} alt={f.title} loading="lazy" width="1440" height="900" />
          <h3>{f.title}</h3>
          <p>{f.text}</p>
        </article>
      {/each}
    </section>
  </main>
  <SiteFooter />
</div>

<style>
  .page { min-height: 100vh; display: flex; flex-direction: column; }
  main { flex: 1; width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 16px; }
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
  .features {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
    padding-bottom: 56px;
  }
  article {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 12px 18px;
    box-shadow: var(--shadow);
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--panel-2);
  }
  h3 { margin: 14px 4px 4px; font-size: 17px; }
  article p { margin: 0 4px; color: var(--muted); }
  @media (max-width: 760px) {
    .hero { padding-top: 40px; }
    .features { grid-template-columns: 1fr; }
    .or { display: none; }
  }
</style>
