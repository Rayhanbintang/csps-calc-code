<script lang="ts">
  import type { Field } from '../lib/catalog';

  let { field, value, onchange }: { field: Field; value: unknown; onchange: (v: string | number | boolean) => void } = $props();
  const id = `f-${field.key.replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
</script>

<div class="field">
  <label for={id}>{field.label}{#if field.unit}<span class="unit"> ({field.unit})</span>{/if}</label>
  {#if field.type === 'select'}
    <select {id} value={String(value ?? '')} onchange={(e) => onchange((e.target as HTMLSelectElement).value)}>
      {#each field.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
    </select>
  {:else if field.type === 'number'}
    <input {id} type="number" min={field.min} step={field.step ?? 'any'} value={Number(value ?? 0)}
      oninput={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) onchange(field.min !== undefined ? Math.max(field.min, v) : v); }} />
  {:else if field.type === 'toggle'}
    <input {id} type="checkbox" checked={Boolean(value)} onchange={(e) => onchange((e.target as HTMLInputElement).checked)} />
  {:else}
    <input {id} type="text" value={String(value ?? '')} maxlength="120" oninput={(e) => onchange((e.target as HTMLInputElement).value)} />
  {/if}
  {#if field.help}<small>{field.help}</small>{/if}
</div>

<style>
  .field { display: grid; gap: 3px; margin-bottom: 8px; }
  label { font-size: 12px; color: var(--muted); }
  .unit { opacity: 0.85; }
  input:not([type='checkbox']), select { width: 100%; }
  small { color: var(--muted); font-size: 11px; }
</style>
