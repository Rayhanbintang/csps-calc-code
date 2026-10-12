// Calls to the Go functions under /api.
import type { Estimate } from './types';
import type { Report } from './report';
import type { AwsRow } from './awsexport';

export interface Saved {
  slug: string;
  estimate: Estimate;
  report: Report;
  created: string;
}

async function fail(res: Response): Promise<never> {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    if (j?.error) msg = j.error;
  } catch {
    /* not JSON */
  }
  throw new Error(msg);
}

export async function saveEstimate(estimate: Estimate, report: Report): Promise<string> {
  const res = await fetch('/api/estimates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estimate, report }),
  });
  if (!res.ok) await fail(res);
  return (await res.json()).slug as string;
}

export async function loadEstimate(slug: string): Promise<Saved> {
  const res = await fetch(`/api/estimates?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) await fail(res);
  return res.json();
}

/** Asks the export function for a file and starts the download. */
export async function download(report: Report, format: 'xlsx' | 'pdf'): Promise<void> {
  const res = await fetch(`/api/export?format=${format}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) await fail(res);
  const safe = (report.name || 'estimate').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'estimate';
  save(await res.blob(), `${safe}.${format}`);
}

/** Sends the visitor's copy of AWS's EC2 template with the rows; downloads the filled file. */
export async function fillAwsTemplate(template: File, rows: AwsRow[]): Promise<void> {
  const form = new FormData();
  form.append('template', template);
  form.append('rows', JSON.stringify(rows));
  const res = await fetch('/api/export?format=awsec2', { method: 'POST', body: form });
  if (!res.ok) await fail(res);
  save(await res.blob(), template.name.replace(/\.xlsx$/i, '') + '-filled.xlsx');
}

function save(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
