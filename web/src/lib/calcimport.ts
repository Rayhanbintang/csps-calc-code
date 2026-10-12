// Imports the CSV export of an AWS Pricing Calculator estimate (calculator.aws, "Export"
// → CSV). Each row is one service with a free-text "Configuration summary" such as
// "Tenancy (Shared Instances), Operating system (Linux), Advance EC2 instance (t4g.nano)".
// Services read here become priced cards; every other service becomes a custom card that
// keeps AWS's own monthly figure, flagged. Read against a real export from 2026-10-12.
import type { Item, Pricing, Spec } from './types';
import { HOURS_PER_MONTH } from './types';
import { newItem } from './engine';
import type { ImportBox, ImportResult } from './awsimport';

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** "A (1), B (x, y), C" → { A: '1', B: 'x, y', C: '' }, splitting only outside brackets. */
export function parseSummary(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0, part = '';
  const push = () => {
    const p = part.trim();
    part = '';
    if (!p) return;
    const open = p.indexOf('(');
    if (open < 0 || !p.endsWith(')')) { out[p] = ''; return; }
    out[p.slice(0, open).trim()] = p.slice(open + 1, -1).trim();
  };
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) push();
    else part += c;
  }
  push();
  return out;
}

const num = (s: string | undefined): number => {
  const m = /-?[\d,]*\.?\d+/.exec(s ?? '');
  return m ? Number(m[0].replace(/,/g, '')) : 0;
};

/** "10 TB per month" → GB (AWS's calculator counts 1 TB as 1,024 GB). */
function gbOf(s: string | undefined): number {
  const n = num(s);
  if (/\bTB\b/i.test(s ?? '')) return n * 1024;
  if (/\bGB\b/i.test(s ?? '')) return n;
  return n;
}

/** "Compute Savings Plans 3yr No Upfront" and friends → our pricing. */
export function strategy(s: string): Pricing | undefined {
  const t = s.trim();
  if (!t || /^on-?demand/i.test(t)) return { model: 'od' };
  const term = /(\d)\s*yr/i.exec(t)?.[1] === '3' ? 3 : 1;
  const pay = /all upfront/i.test(t) ? 'all' : /partial upfront/i.test(t) ? 'partial' : 'no';
  if (/compute savings plans?/i.test(t)) return { model: 'sp', term, pay, kind: 'c' };
  if (/ec2 instance savings plans?/i.test(t)) return { model: 'sp', term, pay, kind: 'e' };
  if (/convertible reserved/i.test(t)) return { model: 'ri', term, pay, cls: 'c' };
  if (/standard reserved|reserved instances?/i.test(t)) return { model: 'ri', term, pay, cls: 's' };
  return undefined;
}

function os(s: string): { os: string; sw: string } | undefined {
  const sw = /SQL Server Enterprise/i.test(s) ? 'sql-ent' : /SQL Server Standard/i.test(s) ? 'sql-std' : /SQL Server Web/i.test(s) ? 'sql-web' : 'none';
  if (/^Windows/i.test(s)) return { os: 'windows', sw };
  if (/Red Hat.*with HA/i.test(s)) return { os: 'rhel-ha', sw };
  if (/^Red Hat|^RHEL/i.test(s)) return { os: 'rhel', sw };
  if (/^SUSE/i.test(s)) return { os: 'suse', sw };
  if (/^Ubuntu Pro/i.test(s)) return { os: 'ubuntu-pro', sw };
  if (/^Linux/i.test(s)) return { os: 'linux', sw };
  return undefined;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The Workload setting → a steady count, plus a peak count and its hours a month. */
export function workload(s: string): { base: number; peak?: { count: number; hours: number }; note?: string } {
  const consistent = /^Consistent.*?Number of instances:\s*(\d+)/i.exec(s);
  if (consistent) return { base: Number(consistent[1]) };
  const daily = /^Daily/i.exec(s);
  if (daily) {
    const base = num(/Baseline:\s*([\d.]+)/i.exec(s)?.[1]);
    const peak = num(/Peak:\s*([\d.]+)/i.exec(s)?.[1]);
    const h = num(/Duration of peak:\s*(\d+)\s*Hr/i.exec(s)?.[1]) + num(/(\d+)\s*Min/i.exec(s)?.[1]) / 60;
    const days = DAYS.filter((d) => new RegExp(d, 'i').test(s)).length || 7;
    // Days a month for days a week: 730 h / 168 h = 4.345 weeks.
    const hours = Math.round(h * days * (HOURS_PER_MONTH / 168));
    return peak > base ? { base, peak: { count: peak - base, hours } } : { base };
  }
  const n = num(/Number of instances:\s*(\d+)/i.exec(s)?.[1]) || 1;
  return { base: n, note: `Workload "${s}" is read as ${n} instance${n === 1 ? '' : 's'} running all month.` };
}

export interface CalcRow {
  group: string;
  region: string;
  description: string;
  service: string;
  monthly: number;
  upfront: number;
  config: string;
}

/** Rows of the "Detailed Estimate" table. */
export function calcRows(rows: string[][]): CalcRow[] {
  const at = rows.findIndex((r) => r.some((c) => /^service$/i.test(c.trim())) && r.some((c) => /^configuration summary$/i.test(c.trim())));
  if (at < 0) throw new Error('This is not a CSV export of an AWS Pricing Calculator estimate: it has no Service and Configuration summary columns.');
  const col = (re: RegExp) => rows[at].findIndex((c) => re.test(c.trim()));
  const c = {
    group: col(/^group hierarchy$/i), region: col(/^region$/i), description: col(/^description$/i), service: col(/^service$/i),
    upfront: col(/^upfront$/i), monthly: col(/^monthly$/i), config: col(/^configuration summary$/i),
  };
  const out: CalcRow[] = [];
  for (const r of rows.slice(at + 1)) {
    const service = (r[c.service] ?? '').trim();
    if (!service) {
      if (r.every((x) => !x.trim())) continue;
      break; // the table ends at the "Acknowledgement" block
    }
    out.push({
      group: (r[c.group] ?? '').trim(), region: (r[c.region] ?? '').trim(), description: (r[c.description] ?? '').trim(), service,
      monthly: Number(r[c.monthly]) || 0, upfront: Number(r[c.upfront]) || 0, config: (r[c.config] ?? '').trim(),
    });
  }
  return out;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Region names in the export → codes, using the price list's names. "Europe (Paris)"
 *  in the calculator is "EU (Paris)" in the price list. */
function regionCode(name: string, regions: { code: string; name: string }[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/^europe\b/, 'eu').replace(/\s+/g, ' ').trim();
  return regions.find((r) => norm(r.name) === norm(name))?.code;
}

/** Turns an export into region boxes. `regions` are the AWS regions of the price list. */
export function parseCalcCsv(text: string, regions: { code: string; name: string }[]): ImportResult {
  const rows = calcRows(parseCsv(text));
  const boxes = new Map<string, ImportBox>();
  const vpcs = new Map<string, Item>();
  const skipped: string[] = [];
  let count = 0, instances = 0;

  for (const [i, row] of rows.entries()) {
    const line = `${row.service || 'Row'} (${i + 1})`;
    const region = regionCode(row.region, regions);
    if (!region) { skipped.push(`${line}: region "${row.region}" is not in the AWS price list.`); continue; }
    // The first level of the hierarchy is the estimate's own name.
    const group = row.group.split('>').map((s) => s.trim()).slice(1).join(' / ');
    const key = `${region}\u0000${group}`;
    if (!boxes.has(key)) boxes.set(key, { region, group, items: [] });
    const box = boxes.get(key)!;
    const cfg = parseSummary(row.config);
    const aws = `AWS's calculator: ${money(row.monthly)} a month${row.upfront ? ` and ${money(row.upfront)} upfront` : ''}.`;
    const vpc = () => {
      let v = vpcs.get(key);
      if (!v) {
        v = newItem('vpc');
        v.name = 'VPC';
        v.spec = { ...v.spec, nat: 0, endpoints: 0, ips: 0 };
        v.children = [];
        vpcs.set(key, v);
        box.items.push(v);
      }
      return v;
    };
    const add = (it: Item) => { box.items.push(it); done = true; };
    let done = false;
    const name = row.description || row.service;

    switch (row.service.replace(/\s+/g, ' ').trim()) {
      case 'Amazon EC2': {
        const type = cfg['Advance EC2 instance'] || cfg['EC2 instance'] || cfg['Instance type'];
        const o = os(cfg['Operating system'] ?? 'Linux');
        const pr = strategy(cfg['Pricing strategy'] ?? 'On-Demand');
        if (!type || !o || !pr) { skipped.push(`${line}: ${!type ? 'no instance type' : !o ? `operating system "${cfg['Operating system']}"` : `pricing strategy "${cfg['Pricing strategy']}"`} could not be read.`); break; }
        const w = workload(cfg['Workload'] ?? 'Consistent, Number of instances: 1');
        const notes = [aws];
        if (w.note) notes.push(w.note);
        const dedicated = /dedicated/i.test(cfg['Tenancy'] ?? '');
        if (/enabled/i.test(cfg['Enable monitoring'] ?? '')) notes.push('Detailed monitoring is on in the export; add a Monitoring card to price it.');
        const vm = (count: number, hours: number, label: string) => {
          const it = newItem('vm');
          it.qty = Math.max(1, count);
          it.name = label;
          it.spec = { ...it.spec, 'aws.type': type, os: o.os, sw: o.sw, licence: 'included', hours, tenancy: dedicated ? 'dedicated' : 'shared' } as Spec;
          it.pricing = dedicated ? { model: 'od' } : pr;
          const gb = gbOf(cfg['EBS Storage amount']);
          if (gb) {
            const disk = newItem('disk');
            disk.name = 'EBS gp3';
            disk.spec = { ...disk.spec, gb, type: 'ssd', 'aws.volume': 'gp3' };
            disk.check = "The export gives the size but not the volume type; gp3 is the AWS calculator's default.";
            it.children = [disk];
          }
          return it;
        };
        if (w.base > 0) {
          const it = vm(w.base, HOURS_PER_MONTH, name);
          it.check = notes.join(' ');
          add(it);
          instances += it.qty;
        }
        if (w.peak) {
          const it = vm(w.peak.count, w.peak.hours, `${name}, peak`);
          it.check = `The extra instances at peak, ${w.peak.hours} hours a month. ${w.base > 0 ? '' : aws}`.trim();
          add(it);
          instances += it.qty;
        }
        break;
      }
      case 'Network Address Translation (NAT) Gateway': {
        const nat = num(cfg['Number of NAT Gateways']);
        const regional = num(cfg['Number of Regional NAT Gateways']);
        if (regional) { add(customCard(row, name, aws, 'Regional NAT gateways are not priced here.')); break; }
        const v = vpc();
        v.spec = { ...v.spec, nat: Number(v.spec.nat) + nat, natGb: Number(v.spec.natGb ?? 0) };
        v.check = [v.check, `NAT gateways: ${aws}`].filter(Boolean).join(' ');
        done = true;
        break;
      }
      case 'AWS PrivateLink': {
        const v = vpc();
        v.spec = { ...v.spec, endpoints: Number(v.spec.endpoints) + num(cfg['Number of VPC Interface endpoints per AWS region']) };
        v.check = [v.check, `PrivateLink: ${aws}`].filter(Boolean).join(' ');
        done = true;
        break;
      }
      case 'Public IPv4 Address': {
        // AWS charges in-use and idle public IPv4 addresses at the same hourly rate.
        const v = vpc();
        const ips = num(cfg['Number of In-use public IPv4 addresses']) + num(cfg['Number of Idle public IPv4 addresses']);
        v.spec = { ...v.spec, ips: Number(v.spec.ips) + ips, ipState: 'used' };
        v.check = [v.check, `Public IPv4: ${aws}`].filter(Boolean).join(' ');
        done = true;
        break;
      }
      case 'Data Transfer': {
        const out = Object.entries(cfg).find(([k]) => /^DT Outbound: Internet/i.test(k));
        const gb = out ? gbOf(out[1]) : 0;
        const intra = Object.entries(cfg).find(([k]) => /^DT Intra-Region/i.test(k));
        if (!gb) { add(customCard(row, name, aws, 'Only internet egress is read from the export.')); break; }
        const e = newItem('egress');
        e.name = 'Data transfer out';
        e.spec = { ...e.spec, gb, to: 'internet' };
        e.check = `${aws}${intra && gbOf(intra[1]) ? ' Transfer inside the region is not priced on this card.' : ''}`;
        add(e);
        break;
      }
      case 'VPN Connection': {
        const n = num(cfg['Number of Site-to-Site VPN Connections']) || 1;
        const v = newItem('vpn');
        v.name = name;
        v.qty = n;
        v.check = `${aws}${cfg['Working days per month'] ? ` The export counts ${cfg['Working days per month']} working days; this card prices the whole month.` : ''}`;
        add(v);
        break;
      }
      default:
        add(customCard(row, name, aws, `This calculator does not price ${row.service.trim()}.`));
    }
    // Rows, not cards: one EC2 row can make two cards, and VPC rows share one card.
    if (done) count++;
  }
  // Empty VPC cards (every NAT went to a custom card) are dropped.
  for (const b of boxes.values()) b.items = b.items.filter((it) => it.svc !== 'vpc' || Number(it.spec.nat) || Number(it.spec.endpoints) || Number(it.spec.ips));
  return { boxes: [...boxes.values()].filter((b) => b.items.length), rows: count, instances, skipped };
}

/** A custom card that keeps AWS's own figure for a service this calculator does not price. */
function customCard(row: CalcRow, name: string, aws: string, why: string): Item {
  const it = newItem('custom');
  it.name = name;
  it.spec = { ...it.spec, what: row.service.trim(), unit: 'service', monthly: row.monthly, upfront: row.upfront };
  it.check = `${why} The card keeps ${aws.replace(/^AWS's calculator: /, "AWS's figure: ")}`;
  return it;
}
