<script lang="ts">
  const REPO = 'https://github.com/Rayhanbintang/csps-calc-code';
</script>

<footer>
  <nav aria-label="Site">
    <a href="/changelog">Changelog</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
    <a href="/legal">Trademarks and credits</a>
    <a href={`${REPO}/issues`} target="_blank" rel="noopener">Contact (GitHub Issues)</a>
    <a href={REPO} target="_blank" rel="noopener">Source code</a>
  </nav>
  <p class="small muted">
    Made by Rayhan as a free community project. Not affiliated with or endorsed by Amazon Web Services,
    Google Cloud, Oracle, Microsoft or Red Hat.
  </p>
</footer>

<style>
  footer {
    border-top: 1px solid var(--line);
    background: var(--panel);
    padding: 20px 16px 28px;
    text-align: center;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 20px;
    margin-bottom: 10px;
  }
  a { color: var(--text); }
  p { margin: 0 auto; max-width: 640px; }
</style>
