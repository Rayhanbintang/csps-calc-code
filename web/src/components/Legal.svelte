<script lang="ts">
  import SiteFooter from './SiteFooter.svelte';

  let { page }: { page: 'privacy' | 'terms' | 'legal' } = $props();
  const REPO = 'https://github.com/Rayhanbintang/csps-calc-code';
  const UPDATED = '12 October 2026';
  const TITLES = { privacy: 'Privacy', terms: 'Terms of use', legal: 'Trademarks and credits' };
  $effect(() => {
    document.title = `${TITLES[page]} · Cloud Service ProviderS Calculator`;
  });
</script>

<div class="page">
  <header>
    <a class="brand" href="/">Cloud Service Provider<span class="s">S</span> Calculator</a>
    <a class="small" href="/app">Open the calculator</a>
  </header>

  <main>
    <h1>{TITLES[page]}</h1>
    <p class="muted small">Last updated {UPDATED}.</p>

    {#if page === 'privacy'}
      <p>
        This site has no accounts, no cookies and no analytics. Rayhan runs it as a free community project. The table
        lists what the site keeps, where it keeps it and for how long.
      </p>
      <table>
        <thead><tr><th>What</th><th>Where</th><th>How long</th></tr></thead>
        <tbody>
          <tr>
            <td>Your open estimates and layout settings (storage keys <code>csps-calc:tabs</code>, <code>csps-calc:nav-width</code>, <code>csps-calc:panel</code>, <code>csps-calc:collapsed-groups</code>)</td>
            <td>Your browser's local storage. The site's server never receives them unless you share or export.</td>
            <td>Until you clear your browser's site data</td>
          </tr>
          <tr>
            <td>An estimate you share by link, with its priced figures</td>
            <td>A Supabase database in Singapore</td>
            <td>No expiry. Ask for deletion as described below.</td>
          </tr>
          <tr>
            <td>A salted hash of your IP address, stored with each shared estimate. The site uses it to cap saves at 30 an hour per visitor. Nobody can turn the hash back into the address.</td>
            <td>The same Supabase database</td>
            <td>As long as the estimate</td>
          </tr>
          <tr>
            <td>An estimate you export to Excel or PDF</td>
            <td>The site's server builds the file in memory and sends it back</td>
            <td>Not kept</td>
          </tr>
          <tr>
            <td>A summary of the tab you ask the AI review about: card names, sizes, regions and prices, plus your follow-up questions</td>
            <td>Sent to <a href="https://groq.com/privacy-policy/" target="_blank" rel="noopener">Groq</a>, which runs the model. Groq's services agreement says it does not train models on this data. The site keeps none of it.</td>
            <td>Set by Groq</td>
          </tr>
          <tr>
            <td>A salted hash of your IP address and the time of each AI review. The site uses it to cap reviews at 10 an hour per visitor.</td>
            <td>The Supabase database</td>
            <td>Two days</td>
          </tr>
          <tr>
            <td>Request logs (IP address, page, time, browser)</td>
            <td>Vercel, the hosting provider, under <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener">Vercel's privacy policy</a></td>
            <td>Set by Vercel</td>
          </tr>
        </tbody>
      </table>
      <h2>Deleting a shared estimate</h2>
      <p>
        Open an issue on <a href={`${REPO}/issues`} target="_blank" rel="noopener">GitHub</a> with the link's code
        (the part after <code>/e/</code>). GitHub issues are public, so include only the code. Rayhan deletes the
        estimate and closes the issue.
      </p>
      <h2>Questions</h2>
      <p>Send questions about this page through <a href={`${REPO}/issues`} target="_blank" rel="noopener">GitHub Issues</a>.</p>
    {:else if page === 'terms'}
      <h2>The service</h2>
      <p>
        Rayhan provides this calculator free of charge, without an account. Using the site means you accept these
        terms.
      </p>
      <h2>Estimates are estimates</h2>
      <ul>
        <li>The figures use public list prices in USD, before tax. They leave out discounts you negotiate with a provider.</li>
        <li>Totals don't subtract free-tier allowances. The ⓘ on a card shows the allowance.</li>
        <li>Price lists change and the calculator can get a figure wrong. Check the price with the provider before you buy, sign or quote.</li>
        <li>The AI review comes from a language model and can be wrong. It is for people aged 18 and over.</li>
        <li>The site comes as is, without warranty. Rayhan accepts no liability for losses that come from using its figures.</li>
      </ul>
      <h2>Share links</h2>
      <p>
        Anyone who has a share link can open that estimate. Keep passwords, keys and personal data out of estimate
        names and notes.
      </p>
      <h2>Fair use</h2>
      <p>
        Don't flood the site with automated requests, don't try to get around its limits and don't use it to attack
        anyone. Rayhan may block traffic that does.
      </p>
      <h2>Changes</h2>
      <p>
        Rayhan may change these terms and the site at any time. The date at the top shows the last change. Indonesian
        law governs these terms.
      </p>
    {:else}
      <h2>Trademarks</h2>
      <p>
        Amazon Web Services, AWS and related marks are trademarks of Amazon.com, Inc. or its affiliates. Google Cloud
        is a trademark of Google LLC. Oracle and OCI are registered trademarks of Oracle and its affiliates. Microsoft
        and Azure are trademarks of the Microsoft group of companies. Red Hat and OpenShift are trademarks of Red Hat,
        Inc. The site uses these names only to say which service a price belongs to. None of these companies made,
        sponsors or endorses this site.
      </p>
      <h2>Service icons</h2>
      <table>
        <thead><tr><th>Cloud</th><th>Source</th></tr></thead>
        <tbody>
          <tr><td>AWS</td><td><a href="https://aws.amazon.com/architecture/icons/" target="_blank" rel="noopener">AWS Architecture Icons</a></td></tr>
          <tr><td>Google Cloud</td><td><a href="https://cloud.google.com/icons" target="_blank" rel="noopener">Google Cloud icons</a></td></tr>
          <tr><td>Azure</td><td><a href="https://learn.microsoft.com/azure/architecture/icons/" target="_blank" rel="noopener">Azure architecture icons</a></td></tr>
          <tr><td>Oracle Cloud</td><td><a href="https://docs.oracle.com/en-us/iaas/Content/General/Reference/graphicsfordiagrams.htm" target="_blank" rel="noopener">OCI graphics for diagrams</a></td></tr>
        </tbody>
      </table>
      <p>Each provider publishes these icons for architecture diagrams and documentation. The site shows them on cards for the same purpose.</p>
      <h2>Price data</h2>
      <p>
        A daily job reads the AWS Price List API, the Google Cloud Billing Catalog API, Oracle's public price list and
        the Azure Retail Prices API. A few rates that the price lists leave out, such as support plans, come from the
        providers' pricing pages. The card notes name those rates.
      </p>
      <h2>Source code</h2>
      <p>The code is public on <a href={REPO} target="_blank" rel="noopener">GitHub</a>.</p>
    {/if}
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
  main { flex: 1; width: 100%; max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 28px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; display: block; overflow-x: auto; }
  th, td { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid var(--line); }
  th { font-weight: 600; }
  code { font-family: var(--mono); font-size: 12px; }
  li { margin-bottom: 4px; }
  main a, header a.small { color: var(--accent); }
</style>
