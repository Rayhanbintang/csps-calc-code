// Imports the AWS Pricing Calculator "EC2 Instances" bulk upload template
// (Amazon_EC2_Instances_BulkUpload_Template_Commercial.xlsx, sheet "Inputs"). Each row
// becomes a VM card with the instance count, a block disk inside it when the row has EBS
// storage, and a backup card for its EBS snapshots. Rows land in region boxes per AWS
// region and group.
import type { Item, Pricing, Spec } from './types';
import { HOURS_PER_MONTH } from './types';
import { newItem } from './engine';
import { attachSpec } from './tree';

export const SHEET = 'Inputs';

/** One region box to create or fill: AWS region plus the template's group. */
export interface ImportBox {
  region: string;
  group: string;
  items: Item[];
  /** A row in this box runs on dedicated tenancy. */
  dedicated?: boolean;
}

export interface ImportResult {
  boxes: ImportBox[];
  rows: number;
  instances: number;
  /** Rows not imported, with the reason, e.g. "Row 7: ...". */
  skipped: string[];
}

const COLS = {
  group: /^group/i,
  description: /^description/i,
  region: /^aws region/i,
  os: /^operating system/i,
  type: /^instance type/i,
  tenancy: /^tenancy/i,
  count: /^number of instances/i,
  usage: /^assumed usage/i,
  usageType: /^usage type/i,
  purchase: /^purchasing option/i,
  storage: /^storage type/i,
  gb: /^storage amount/i,
  iops: /^provisioning iops/i,
  mbps: /^ebs throughput/i,
  snapFreq: /^snapshot frequency/i,
  snapGb: /^ebs snapshot amount/i,
};
type Col = keyof typeof COLS;

/** Operating system names in the template → our OS and database licence fields. */
function os(name: string): { os: string; sw: string; note?: string } | undefined {
  const n = name.trim();
  const sw = /SQL Server Enterprise/i.test(n) ? 'sql-ent' : /SQL Server Standard/i.test(n) ? 'sql-std' : /SQL Server Web/i.test(n) ? 'sql-web' : 'none';
  if (/^Windows Server/i.test(n)) return { os: 'windows', sw };
  if (/^Red Hat Enterprise Linux/i.test(n)) return { os: /with HA/i.test(n) ? 'rhel-ha' : 'rhel', sw };
  if (/^SUSE/i.test(n)) return { os: 'suse', sw };
  if (/^Ubuntu Pro/i.test(n)) return { os: 'ubuntu-pro', sw };
  if (/^Linux/i.test(n)) return { os: 'linux', sw };
  return undefined;
}

/** Snapshots a month for each frequency the template offers. */
const SNAPS: Record<string, number> = { hourly: 730, '2x daily': 60, daily: 30, weekly: 4, monthly: 1 };

/** "3 Yr All Upfront Compute Savings Plan" and the other purchasing options → our pricing. */
export function purchase(label: string): { pricing: Pricing; note?: string } | undefined {
  const s = label.trim();
  if (/^on-demand$/i.test(s)) return { pricing: { model: 'od' } };
  if (/^spot$/i.test(s)) return { pricing: { model: 'od' }, note: 'Spot in the template; priced on-demand (Spot prices change by the minute).' };
  const m = /^([13])\s*Yr\s+(All|Partial|No)\s+Upfront\s+(.+)$/i.exec(s);
  if (!m) return undefined;
  const term = Number(m[1]) as 1 | 3;
  const pay = m[2].toLowerCase() as 'all' | 'partial' | 'no';
  const kind = m[3].toLowerCase();
  if (kind.startsWith('compute savings plan')) return { pricing: { model: 'sp', term, pay, kind: 'c' } };
  if (kind.startsWith('ec2 instance savings plan')) return { pricing: { model: 'sp', term, pay, kind: 'e' } };
  if (kind.startsWith('standard reserved')) return { pricing: { model: 'ri', term, pay, cls: 's' } };
  if (kind.startsWith('convertible reserved')) return { pricing: { model: 'ri', term, pay, cls: 'c' } };
  return undefined;
}

const VOLUMES: Record<string, [string, string]> = {
  gp3: ['ssd', 'gp3'], gp2: ['ssd', 'gp2'], io2: ['ssd-fast', 'io2'], io1: ['ssd-fast', 'io1'], st1: ['hdd', 'st1'], sc1: ['hdd-cold', 'sc1'],
};

function volume(label: string): [string, string] | undefined {
  const code = /\(([a-z]+)\s*(\d)\)/i.exec(label);
  return code ? VOLUMES[(code[1] + code[2]).toLowerCase()] : undefined;
}

function number(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Turns the rows of the "Inputs" sheet into region boxes. `regions` lists the AWS
 *  regions the price list has; Local Zones and Wavelength zones are not in it. */
export function parseTemplate(rows: string[][], regions: string[]): ImportResult {
  const headerAt = rows.findIndex((r) => r.some((c) => COLS.type.test(c?.trim() ?? '')) && r.some((c) => COLS.region.test(c?.trim() ?? '')));
  if (headerAt < 0) throw new Error('This is not the AWS "EC2 Instances" bulk upload template: the Inputs sheet has no Instance Type column.');
  const at: Partial<Record<Col, number>> = {};
  rows[headerAt].forEach((c, i) => {
    const t = (c ?? '').trim();
    for (const k of Object.keys(COLS) as Col[]) if (at[k] === undefined && COLS[k].test(t)) at[k] = i;
  });

  const boxes = new Map<string, ImportBox>();
  const skipped: string[] = [];
  let count = 0, instances = 0;
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const get = (k: Col) => (at[k] === undefined ? '' : (row[at[k]!] ?? '').trim());
    const type = get('type');
    const region = get('region');
    if (!type && !region) continue; // an empty row of the template
    const line = `Row ${r + 1}`;
    if (!region) { skipped.push(`${line}: no AWS region.`); continue; }
    if (!regions.includes(region)) { skipped.push(`${line}: ${region} is not in the AWS price list (Local Zones and Wavelength zones are not covered).`); continue; }
    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/i.test(type)) { skipped.push(`${line}: "${type}" is not an instance type such as m6i.large.`); continue; }
    const o = os(get('os') || 'Linux');
    if (!o) { skipped.push(`${line}: operating system "${get('os')}" is not supported.`); continue; }
    const p = purchase(get('purchase') || 'On-Demand');
    if (!p) { skipped.push(`${line}: purchasing option "${get('purchase')}" is not recognised.`); continue; }
    const qty = number(get('count')) ?? 1;
    if (qty < 1 || !Number.isInteger(qty)) { skipped.push(`${line}: number of instances must be a whole number of 1 or more.`); continue; }

    const notes: string[] = [];
    if (o.note) notes.push(o.note);
    if (p.note) notes.push(p.note);
    const dedicated = /dedicated/i.test(get('tenancy'));
    if (dedicated && p.pricing.model !== 'od') {
      notes.push(`Dedicated with "${get('purchase')}" in the template; this calculator prices Dedicated Instances on demand only.`);
      p.pricing = { model: 'od' };
    }
    let hours = HOURS_PER_MONTH;
    if (/hours\s*\/\s*week/i.test(get('usageType'))) {
      const perWeek = Math.min(168, Math.max(0, number(get('usage')) ?? 168));
      hours = Math.round((perWeek * HOURS_PER_MONTH) / 168);
    }

    const vm = newItem('vm');
    vm.qty = qty;
    vm.name = get('description') || type;
    vm.spec = { ...vm.spec, 'aws.type': type, os: o.os, sw: o.sw, licence: 'included', hours, tenancy: dedicated ? 'dedicated' : 'shared' } as Spec;
    vm.pricing = p.pricing;

    const storage = get('storage');
    const gb = number(get('gb'));
    if (storage && gb) {
      const vol = volume(storage);
      if (!vol) notes.push(`Storage type "${storage}" is not supported; no disk added.`);
      else {
        const disk = newItem('disk');
        disk.name = `EBS ${vol[1]}`;
        const spec: Spec = { ...disk.spec, gb, type: vol[0], 'aws.volume': vol[1] };
        const iops = number(get('iops'));
        const mbps = number(get('mbps'));
        if (iops !== undefined) spec.iops = iops;
        if (mbps !== undefined) spec.mbps = mbps;
        disk.spec = spec;
        vm.children = [disk];
      }
    }
    const snap = get('snapFreq');
    const perMonth = SNAPS[snap.toLowerCase()];
    if (snap && !/^no snapshot/i.test(snap)) {
      const each = number(get('snapGb'));
      if (!perMonth || each === undefined) notes.push(`EBS snapshots ("${snap}", ${get('snapGb') || '?'} GB) could not be read; add them by hand.`);
      else {
        // One month kept: the first snapshot copies the volume, each later one only its changes.
        const full = gb ?? each;
        const backup = newItem('backup');
        backup.name = 'EBS snapshots';
        backup.spec = { ...backup.spec, ...attachSpec('backup', vm), gb: Math.round(full + each * (perMonth - 1)) };
        backup.check = `From the template: ${snap.toLowerCase()} snapshots of ${each} GB, kept one month (a ${full} GB first copy plus ${perMonth - 1} × ${each} GB). Change the size for another retention.`;
        vm.children = [...(vm.children ?? []), backup];
      }
    }
    if (notes.length) vm.check = notes.join(' ');

    const group = get('group');
    const key = `${region}\u0000${group}`;
    if (!boxes.has(key)) boxes.set(key, { region, group, items: [] });
    boxes.get(key)!.items.push(vm);
    if (dedicated) boxes.get(key)!.dedicated = true;
    count++;
    instances += qty;
  }
  return { boxes: [...boxes.values()], rows: count, instances, skipped };
}
