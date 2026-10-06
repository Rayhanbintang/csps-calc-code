// Virtual machines: EC2, Compute Engine, OCI Compute.
import type { Item, Line, Priced, Provider, Spec } from '../types';
import { aws, gcp, oci } from '../prices';
import type { AwsInstance, GcpRow, OciRow } from '../prices';
import {
  H, line, must, num, ociPart, ociRate, ociCost, opts, priced, str, tierLine, unavailable, gcpFind, gcpRate, escapeRe,
} from './util';
import { zonesField } from '../zones';
import type { Ctx, Field, Service } from './util';

// ---- neutral spec ----
const osOptions = opts(
  ['linux', 'Linux'],
  ['windows', 'Windows Server'],
  ['rhel', 'Red Hat Enterprise Linux'],
  ['suse', 'SUSE Linux Enterprise'],
  ['ubuntu-pro', 'Ubuntu Pro'],
);
const swOptions = opts(['none', 'None'], ['sql-web', 'SQL Server Web'], ['sql-std', 'SQL Server Standard'], ['sql-ent', 'SQL Server Enterprise']);

const awsOS: Record<string, string> = { linux: 'Linux', windows: 'Windows', rhel: 'RHEL', suse: 'SUSE', 'ubuntu-pro': 'Ubuntu Pro' };
const awsSW: Record<string, string> = { none: '', 'sql-web': 'SQL Web', 'sql-std': 'SQL Std', 'sql-ent': 'SQL Ent' };

function hours(spec: Spec): number {
  return Math.min(H, Math.max(0, num(spec, 'hours', H)));
}

function byol(spec: Spec): boolean {
  return str(spec, 'licence', 'included') === 'byol';
}

// =====================================================================================
// AWS
// =====================================================================================

// Families picked automatically when the SA gives only vCPU and memory: general purpose,
// compute and memory optimised, current generations. Burstable (t*) and special
// families stay selectable by hand.
const awsAutoFamily = /^(m[5-8][a-z]*|c[5-8][a-z]*|r[5-8][a-z]*)\.(?!metal)/;

function awsCandidates(all: AwsInstance[], spec: Spec): AwsInstance[] {
  const os = awsOS[str(spec, 'os', 'linux')] ?? 'Linux';
  const sw = awsSW[str(spec, 'sw', 'none')] ?? '';
  const wantByol = byol(spec) && os === 'Windows' && !sw;
  return all.filter((i) => i.os === os && (i.sw ?? '') === sw && !!i.byol === wantByol);
}

export function awsNearest(list: AwsInstance[], vcpu: number, mem: number, arch: string): AwsInstance | undefined {
  const fits = list.filter(
    (i) => awsAutoFamily.test(i.t) && i.c >= vcpu && i.m >= mem && (arch === 'arm' ? i.ar === 'arm' : i.ar !== 'arm'),
  );
  fits.sort((a, b) => a.od - b.od || a.c - b.c || a.m - b.m);
  return fits[0];
}

async function awsPick(ctx: Ctx, spec: Spec): Promise<{ inst?: AwsInstance; list: AwsInstance[] }> {
  const list = awsCandidates(await aws.instances(ctx.region), spec);
  const chosen = str(spec, 'aws.type');
  if (chosen) return { inst: list.find((i) => i.t === chosen), list };
  return { inst: awsNearest(list, num(spec, 'vcpu', 2), num(spec, 'mem', 8), str(spec, 'arch', 'x86')), list };
}

/** Prices a per-hour resource under the AWS pricing model chosen on the item. */
export function awsCommitted(
  item: Item,
  label: string,
  od: number,
  hrs: number,
  ri?: { y: number; k: string; p: string; h: number; u: number }[],
  sp?: { k: string; y: number; p: string; h: number }[],
): { lines: Line[]; upfront: number; note?: string } {
  const q = item.qty;
  const p = item.pricing ?? { model: 'od' };
  if (p.model === 'ri') {
    const r = ri?.find((x) => x.y === (p.term ?? 1) && x.k === (p.cls ?? 's') && x.p === (p.pay ?? 'no'));
    if (!r) throw new Error('This Reserved Instance option is not sold for this type in this region.');
    const lines = r.h > 0 ? [line(`${label}, reserved`, H * q, 'hours', r.h)] : [];
    return { lines, upfront: r.u * q, note: hrs < H ? 'Reserved capacity is billed for every hour of the term.' : undefined };
  }
  if (p.model === 'sp') {
    const r = sp?.find((x) => x.k === (p.kind ?? 'c') && x.y === (p.term ?? 1) && x.p === (p.pay ?? 'no'));
    if (!r) throw new Error('This Savings Plan option has no rate for this type in this region.');
    // Savings Plan rates are effective hourly rates. Partial upfront pays half the term
    // ahead and half monthly; all upfront pays the whole term ahead.
    const termHours = 8760 * (p.term ?? 1);
    const share = p.pay === 'all' ? 1 : p.pay === 'partial' ? 0.5 : 0;
    const lines = share < 1 ? [line(`${label}, Savings Plan`, H * q, 'hours', r.h * (1 - share))] : [];
    return { lines, upfront: r.h * termHours * share * q };
  }
  return { lines: [line(label, hrs * q, 'hours', od)], upfront: 0 };
}

async function awsVmFields(ctx: Ctx, spec: Spec): Promise<Field[]> {
  const list = awsCandidates(await aws.instances(ctx.region), spec);
  const seen = new Set<string>();
  const options = [{ value: '', label: 'Pick the closest match for me' }];
  // Family first (c5, c6g, m5 ...), then size by vCPU, so c5.large sits before c5.xlarge.
  const fam = (t: string) => t.split('.')[0];
  const sorted = [...list].sort((a, b) => fam(a.t).localeCompare(fam(b.t), 'en', { numeric: true }) || a.c - b.c || a.m - b.m);
  for (const i of sorted) {
    if (seen.has(i.t)) continue;
    seen.add(i.t);
    options.push({ value: i.t, label: `${i.t} · ${i.c} vCPU · ${i.m} GiB` });
  }
  return [{ key: 'aws.type', label: 'Instance type', type: 'select', options }];
}

async function awsVmPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const { inst } = await awsPick(ctx, item.spec);
  if (!inst) {
    return str(item.spec, 'aws.type')
      ? unavailable(`${str(item.spec, 'aws.type')} with this OS is not sold in ${ctx.info?.name ?? ctx.region}.`)
      : unavailable('No instance type in this region fits the vCPU and memory asked for.');
  }
  const os = awsOS[str(item.spec, 'os', 'linux')];
  const sw = awsSW[str(item.spec, 'sw', 'none')];
  const label = `${inst.t} (${os}${sw ? ' + ' + sw : ''})`;
  const c = awsCommitted(item, label, inst.od, hours(item.spec), inst.ri, inst.sp);
  const notes: string[] = [];
  if (c.note) notes.push(c.note);
  if (byol(item.spec) && os === 'Windows' && !sw) notes.push('Windows licence not included (bring your own licence).');
  if (byol(item.spec) && (os !== 'Windows' || sw)) notes.push('AWS sells this OS or SQL Server only with the licence included; the price includes it.');
  return priced(c.lines, { upfront: c.upfront, sku: `${inst.t} · ${inst.c} vCPU · ${inst.m} GiB`, notes });
}

// =====================================================================================
// Google Cloud
// =====================================================================================

interface GcpFamily {
  sku: string; // label inside SKU descriptions, e.g. "N2D AMD"
  cud: string; // label inside commitment descriptions; "" for N1
  arch: 'x86' | 'arm';
  sud?: 'n1' | 'n2'; // sustained use discount schedule
  series: [string, number, number[]][]; // [series, GiB per vCPU, vCPU sizes]
}

const gcpFamilies: Record<string, GcpFamily> = {
  e2: { sku: 'E2', cud: 'E2', arch: 'x86', series: [['standard', 4, [2, 4, 8, 16, 32]], ['highmem', 8, [2, 4, 8, 16]], ['highcpu', 1, [2, 4, 8, 16, 32]]] },
  n2: { sku: 'N2', cud: 'N2', arch: 'x86', sud: 'n2', series: [['standard', 4, [2, 4, 8, 16, 32, 48, 64, 80, 96, 128]], ['highmem', 8, [2, 4, 8, 16, 32, 48, 64, 80, 96, 128]], ['highcpu', 1, [2, 4, 8, 16, 32, 48, 64, 80, 96]]] },
  n2d: { sku: 'N2D AMD', cud: 'N2D AMD', arch: 'x86', sud: 'n2', series: [['standard', 4, [2, 4, 8, 16, 32, 48, 64, 80, 96, 128, 224]], ['highmem', 8, [2, 4, 8, 16, 32, 48, 64, 80, 96]], ['highcpu', 1, [2, 4, 8, 16, 32, 48, 64, 80, 96, 128, 224]]] },
  n4: { sku: 'N4', cud: 'N4', arch: 'x86', series: [['standard', 4, [2, 4, 8, 16, 32, 48, 64, 80]], ['highmem', 8, [2, 4, 8, 16, 32, 48, 64, 80]], ['highcpu', 2, [2, 4, 8, 16, 32, 48, 64, 80]]] },
  c3: { sku: 'C3', cud: 'C3', arch: 'x86', series: [['standard', 4, [4, 8, 22, 44, 88, 176]], ['highmem', 8, [4, 8, 22, 44, 88, 176]], ['highcpu', 2, [4, 8, 22, 44, 88, 176]]] },
  c3d: { sku: 'C3D', cud: 'C3D', arch: 'x86', series: [['standard', 4, [4, 8, 16, 30, 60, 90, 180, 360]], ['highmem', 8, [4, 8, 16, 30, 60, 90, 180, 360]], ['highcpu', 2, [4, 8, 16, 30, 60, 90, 180, 360]]] },
  c4: { sku: 'C4', cud: 'C4', arch: 'x86', series: [['standard', 3.75, [2, 4, 8, 16, 32, 48, 96, 144, 192, 288]], ['highmem', 7.75, [2, 4, 8, 16, 32, 48, 96, 144, 192, 288]], ['highcpu', 2, [2, 4, 8, 16, 32, 48, 96, 144, 192, 288]]] },
  c4d: { sku: 'C4D', cud: 'C4D', arch: 'x86', series: [['standard', 3.875, [2, 4, 8, 16, 32, 48, 64, 96, 192, 384]], ['highmem', 7.875, [2, 4, 8, 16, 32, 48, 64, 96, 192, 384]], ['highcpu', 1.875, [2, 4, 8, 16, 32, 48, 64, 96, 192, 384]]] },
  c4a: { sku: 'C4A Arm', cud: 'C4A Arm', arch: 'arm', series: [['standard', 4, [1, 2, 4, 8, 16, 32, 48, 64, 72]], ['highmem', 8, [1, 2, 4, 8, 16, 32, 48, 64, 72]], ['highcpu', 2, [1, 2, 4, 8, 16, 32, 48, 64, 72]]] },
  n1: { sku: 'N1 Predefined', cud: '', arch: 'x86', sud: 'n1', series: [['standard', 3.75, [1, 2, 4, 8, 16, 32, 64, 96]], ['highmem', 6.5, [2, 4, 8, 16, 32, 64, 96]], ['highcpu', 0.9, [2, 4, 8, 16, 32, 64, 96]]] },
};
const gcpAuto = ['e2', 'n2', 'n2d', 'n4', 'c3', 'c4', 'c4d', 'c4a'];

export interface GcpType {
  name: string;
  fam: string;
  vcpu: number;
  mem: number;
}

export function gcpTypes(): GcpType[] {
  const out: GcpType[] = [];
  for (const [fam, f] of Object.entries(gcpFamilies)) {
    for (const [series, per, sizes] of f.series) {
      for (const n of sizes) out.push({ name: `${fam}-${series}-${n}`, fam, vcpu: n, mem: Math.round(n * per * 100) / 100 });
    }
  }
  return out;
}

function gcpCoreRam(rows: GcpRow[], fam: GcpFamily) {
  const core = gcpFind(rows, new RegExp(`^${escapeRe(fam.sku)} Instance Core running in `));
  const ram = gcpFind(rows, new RegExp(`^${escapeRe(fam.sku)} Instance Ram running in `));
  return { core: gcpRate(core), ram: gcpRate(ram) };
}

function gcpCud(rows: GcpRow[], fam: GcpFamily, years: 1 | 3) {
  const lbl = fam.cud ? `${escapeRe(fam.cud)} ` : '';
  const usage = years === 1 ? 'Commit1Yr' : 'Commit3Yr';
  const core = gcpFind(rows, new RegExp(`^Commitment v1: ${lbl}Cpu in .* for ${years} Years?$`), usage);
  const ram = gcpFind(rows, new RegExp(`^Commitment v1: ${lbl}Ram in .* for ${years} Years?$`), usage);
  return { core: gcpRate(core), ram: gcpRate(ram) };
}

/** Average price factor under Google's sustained use discount for a month of `hrs`. */
export function sudFactor(schedule: 'n1' | 'n2' | undefined, hrs: number): number {
  if (!schedule || hrs <= 0) return 1;
  const mult = schedule === 'n1' ? [1, 0.8, 0.6, 0.4] : [1, 0.8678, 0.733, 0.6];
  const f = Math.min(1, hrs / H);
  let paid = 0;
  for (let q = 0; q < 4; q++) paid += Math.max(0, Math.min(0.25, f - q * 0.25)) * mult[q];
  return paid / f;
}

export function gcpNearest(rows: GcpRow[], vcpu: number, mem: number, arch: string): GcpType | undefined {
  let best: { t: GcpType; price: number } | undefined;
  for (const t of gcpTypes()) {
    const fam = gcpFamilies[t.fam];
    if (!gcpAuto.includes(t.fam) || fam.arch !== (arch === 'arm' ? 'arm' : 'x86')) continue;
    if (t.vcpu < vcpu || t.mem < mem) continue;
    const { core, ram } = gcpCoreRam(rows, fam);
    const price = t.vcpu * core + t.mem * ram;
    if (!Number.isFinite(price)) continue;
    if (!best || price < best.price) best = { t, price };
  }
  return best?.t;
}

async function gcpLicence(spec: Spec, vcpu: number): Promise<{ lines: Line[]; notes: string[] }> {
  const os = str(spec, 'os', 'linux');
  const sw = str(spec, 'sw', 'none');
  const g = await gcp.global();
  const lines: Line[] = [];
  const notes: string[] = [];
  const hrs = hours(spec);
  const find = (re: RegExp) => g.find((r) => r.u === 'OnDemand' && re.test(r.d));
  if (byol(spec)) {
    notes.push('Licence not included (bring your own licence).');
    return { lines, notes };
  }
  if (os === 'windows') {
    const r = must(gcpRate(find(/^Licensing Fee for Windows Server 2022 Datacenter Edition on VM$/)), 'Windows Server licence');
    lines.push(line('Windows Server licence', vcpu * hrs, 'vCPU-hours', r));
  }
  if (os === 'rhel') {
    const band = vcpu <= 8 ? 'up to 8 VCPU' : vcpu < 128 ? '9 to 127 VCPU' : '128 VCPU or more';
    const r = must(gcpRate(find(new RegExp(`^Licensing Fee for Red Hat Enterprise Linux 9 on VM with ${band}$`))), 'RHEL licence');
    lines.push(line('RHEL licence', vcpu * hrs, 'vCPU-hours', r));
  }
  if (os === 'suse') {
    const band = vcpu <= 3 ? '1 to 3 VCPU' : vcpu === 4 ? '4 VCPU' : '6 or more VCPU';
    const row = find(new RegExp(`^Licensing Fee for SLES .*${band}`)) ?? find(new RegExp(`SUSE Linux Enterprise Server.*${band}`));
    if (row) lines.push(line('SUSE licence', hrs, 'VM-hours', gcpRate(row)));
    else notes.push('SUSE licence price not found in Google\'s catalog; not included.');
  }
  if (os === 'ubuntu-pro') notes.push('Ubuntu Pro on Google Cloud is billed separately; not included.');
  if (sw !== 'none') {
    const ed = { 'sql-web': 'Web', 'sql-std': 'Standard', 'sql-ent': 'Enterprise' }[sw]!;
    const onLinux = os === 'windows' ? '' : 'on Linux ';
    const small = vcpu <= 4;
    const re = new RegExp(`^Licensing Fee for SQL Server 2022 ${ed} ${onLinux}on VM with ${small ? 'up to 4' : 'more than 4'} VCPU$`);
    const r = must(gcpRate(find(re)), `SQL Server ${ed} licence`);
    // Up to 4 vCPU the SKU is a flat hourly fee (4-core minimum); above 4 it is per vCPU.
    if (small) lines.push(line(`SQL Server ${ed} licence (4-core minimum)`, hrs, 'VM-hours', r));
    else lines.push(line(`SQL Server ${ed} licence`, vcpu * hrs, 'vCPU-hours', r));
  }
  return { lines, notes };
}

async function gcpVmFields(): Promise<Field[]> {
  const options = [{ value: '', label: 'Pick the closest match for me' }];
  for (const t of gcpTypes()) options.push({ value: t.name, label: `${t.name} · ${t.vcpu} vCPU · ${t.mem} GiB` });
  return [{ key: 'gcp.type', label: 'Machine type', type: 'select', options }];
}

async function gcpVmPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await gcp.region(ctx.region);
  const chosen = str(item.spec, 'gcp.type');
  const t = chosen
    ? gcpTypes().find((x) => x.name === chosen)
    : gcpNearest(rows, num(item.spec, 'vcpu', 2), num(item.spec, 'mem', 8), str(item.spec, 'arch', 'x86'));
  if (!t) return unavailable('No machine type fits the vCPU and memory asked for.');
  const fam = gcpFamilies[t.fam];
  const { core, ram } = gcpCoreRam(rows, fam);
  if (!Number.isFinite(core) || !Number.isFinite(ram)) return unavailable(`${t.fam.toUpperCase()} is not sold in ${ctx.info?.name ?? ctx.region}.`);

  const q = item.qty;
  const hrs = hours(item.spec);
  const p = item.pricing ?? { model: 'od' };
  const lines: Line[] = [];
  const notes: string[] = [];
  if (p.model === 'cud') {
    const years = (p.term ?? 1) as 1 | 3;
    const cud = gcpCud(rows, fam, years);
    if (!Number.isFinite(cud.core) || !Number.isFinite(cud.ram)) return unavailable(`No ${years}-year commitment price for ${t.fam.toUpperCase()} here.`);
    lines.push(line(`${t.name} vCPU, ${years}-year commitment`, t.vcpu * H * q, 'vCPU-hours', cud.core));
    lines.push(line(`${t.name} memory, ${years}-year commitment`, t.mem * H * q, 'GiB-hours', cud.ram));
    if (hrs < H) notes.push('Committed use is billed for every hour of the term.');
  } else {
    const f = sudFactor(fam.sud, hrs);
    lines.push(line(`${t.name} vCPU`, t.vcpu * hrs * q, 'vCPU-hours', core * f));
    lines.push(line(`${t.name} memory`, t.mem * hrs * q, 'GiB-hours', ram * f));
    if (f < 1) notes.push(`Includes Google's sustained use discount (${Math.round((1 - f) * 100)}% for ${hrs} hours a month).`);
  }
  const lic = await gcpLicence(item.spec, t.vcpu);
  for (const l of lic.lines) lines.push({ ...l, qty: l.qty * q, monthly: l.monthly * q });
  notes.push(...lic.notes);
  return priced(lines, { sku: `${t.name} · ${t.vcpu} vCPU · ${t.mem} GiB`, notes });
}

// =====================================================================================
// Oracle Cloud
// =====================================================================================

interface OciShape {
  name: string;
  ocpu: string; // part number
  mem: string;
  arch: 'x86' | 'arm';
}

// Part numbers from Oracle's price list. x86 shapes: 1 OCPU = 2 vCPU; Ampere A1: 1 OCPU = 1 vCPU.
export const ociShapes: Record<string, OciShape> = {
  'VM.Standard.E5.Flex': { name: 'VM.Standard.E5.Flex', ocpu: 'B97384', mem: 'B97385', arch: 'x86' },
  'VM.Standard.E6.Flex': { name: 'VM.Standard.E6.Flex', ocpu: 'B111129', mem: 'B111130', arch: 'x86' },
  'VM.Standard.E4.Flex': { name: 'VM.Standard.E4.Flex', ocpu: 'B93113', mem: 'B93114', arch: 'x86' },
  'VM.Standard3.Flex': { name: 'VM.Standard3.Flex', ocpu: 'B94176', mem: 'B94177', arch: 'x86' },
  'VM.Optimized3.Flex': { name: 'VM.Optimized3.Flex', ocpu: 'B93311', mem: 'B93312', arch: 'x86' },
  'VM.Standard.A1.Flex': { name: 'VM.Standard.A1.Flex', ocpu: 'B93297', mem: 'B93298', arch: 'arm' },
};

export function ocpus(shape: OciShape, vcpu: number): number {
  return shape.arch === 'arm' ? Math.max(1, Math.ceil(vcpu)) : Math.max(1, Math.ceil(vcpu / 2));
}

async function ociVmFields(): Promise<Field[]> {
  return [{
    key: 'oci.shape', label: 'Shape', type: 'select',
    options: [{ value: '', label: 'Pick for me (E5 Flex, or A1 Flex for Arm)' }, ...Object.keys(ociShapes).map((s) => ({ value: s, label: s }))],
  }];
}

async function ociVmPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows: OciRow[] = await oci.all();
  const arch = str(item.spec, 'arch', 'x86');
  const shape = ociShapes[str(item.spec, 'oci.shape')] ?? ociShapes[arch === 'arm' ? 'VM.Standard.A1.Flex' : 'VM.Standard.E5.Flex'];
  const vcpu = num(item.spec, 'vcpu', 2);
  const mem = num(item.spec, 'mem', 8);
  const o = ocpus(shape, vcpu);
  const q = item.qty;
  const hrs = hours(item.spec);
  const os = str(item.spec, 'os', 'linux');
  const sw = str(item.spec, 'sw', 'none');
  const notes: string[] = [];
  if ((item.pricing?.model ?? 'od') !== 'od') notes.push('OCI lists one pay-as-you-go price; commitment discounts are negotiated in an Oracle contract.');

  const ocpuRow = ociPart(rows, shape.ocpu);
  const memRow = ociPart(rows, shape.mem);
  const ocpuHours = o * hrs * q;
  const memHours = mem * hrs * q;
  const lines: Line[] = [
    tierLine(`${shape.name} OCPU (${o} OCPU = ${shape.arch === 'arm' ? o : o * 2} vCPU)`, ocpuHours, 'OCPU-hours', must(ociCost(ocpuRow, ocpuHours), 'OCPU')),
    tierLine(`${shape.name} memory`, memHours, 'GB-hours', must(ociCost(memRow, memHours), 'memory')),
  ];
  if (os === 'windows' && !byol(item.spec)) {
    lines.push(line('Windows Server licence', ocpuHours, 'OCPU-hours', must(ociRate(ociPart(rows, 'B88318')), 'Windows licence')));
  }
  if (os === 'rhel' || os === 'suse' || os === 'ubuntu-pro') notes.push('OCI has no licence-included price for this OS; add the licence as a custom line if needed.');
  if (sw !== 'none') notes.push('OCI has no licence-included SQL Server on VMs; add the licence as a custom line.');
  if (mem > o * 64) notes.push(`${shape.name} allows at most 64 GB per OCPU; raise the vCPU count.`);
  return priced(lines, { sku: `${shape.name} · ${o} OCPU · ${mem} GB`, notes });
}

// =====================================================================================

/** When a VM moves to another provider, keep the size and pick the equivalent type. */
async function adoptVm(ctx: Ctx, item: Item, from: Provider): Promise<Item> {
  const spec = { ...item.spec };
  delete spec['aws.type'];
  delete spec['gcp.type'];
  delete spec['oci.shape'];
  const before = item.spec[`${from === 'oci' ? 'oci.shape' : from + '.type'}`];
  return { ...item, spec, pricing: { model: 'od' }, check: `Matched by size from ${String(before || from.toUpperCase())}. Check the type.` };
}

/** Keeps vCPU and memory in step with a type the SA picked by hand. */
export async function syncVmSize(provider: Provider, ctx: Ctx, spec: Spec): Promise<Spec> {
  if (provider === 'aws' && str(spec, 'aws.type')) {
    const i = (await aws.instances(ctx.region)).find((x) => x.t === spec['aws.type']);
    if (i) return { ...spec, vcpu: i.c, mem: i.m, arch: i.ar === 'arm' ? 'arm' : 'x86' };
  }
  if (provider === 'gcp' && str(spec, 'gcp.type')) {
    const t = gcpTypes().find((x) => x.name === spec['gcp.type']);
    if (t) return { ...spec, vcpu: t.vcpu, mem: t.mem, arch: gcpFamilies[t.fam].arch };
  }
  if (provider === 'oci' && str(spec, 'oci.shape')) {
    return { ...spec, arch: ociShapes[str(spec, 'oci.shape')]?.arch ?? spec.arch };
  }
  return spec;
}

export const vm: Service = {
  id: 'vm',
  label: 'Virtual machine',
  group: 'Compute',
  blurb: 'EC2 · Compute Engine · OCI Compute',
  defaults: { vcpu: 2, mem: 8, os: 'linux', sw: 'none', licence: 'included', arch: 'x86', hours: H },
  fields: [
    { key: 'vcpu', label: 'vCPU', type: 'number', min: 1, step: 1 },
    { key: 'mem', label: 'Memory', type: 'number', unit: 'GiB', min: 0.5, step: 0.5 },
    { key: 'arch', label: 'CPU', type: 'select', options: opts(['x86', 'x86 (Intel / AMD)'], ['arm', 'Arm (Graviton, Axion, Ampere)']) },
    { key: 'os', label: 'Operating system', type: 'select', options: osOptions },
    { key: 'sw', label: 'Database licence', type: 'select', options: swOptions },
    { key: 'licence', label: 'Licence', type: 'select', options: opts(['included', 'Included in price'], ['byol', 'Bring your own']) },
    { key: 'hours', label: 'Running hours', type: 'number', unit: 'h / month', min: 0, step: 1, help: '730 = always on' },
    zonesField,
  ],
  providers: {
    aws: {
      product: 'Amazon EC2',
      fields: awsVmFields,
      models: [
        { model: 'od', label: 'On-demand' },
        { model: 'sp', label: 'Savings Plan', terms: [1, 3], pays: ['no', 'partial', 'all'], kinds: true },
        { model: 'ri', label: 'Reserved Instance', terms: [1, 3], pays: ['no', 'partial', 'all'], classes: true },
      ],
      price: awsVmPrice,
      adopt: adoptVm,
    },
    gcp: {
      product: 'Compute Engine',
      fields: gcpVmFields,
      models: [{ model: 'od', label: 'On-demand' }, { model: 'cud', label: 'Committed use', terms: [1, 3] }],
      price: gcpVmPrice,
      adopt: adoptVm,
    },
    oci: {
      product: 'OCI Compute',
      fields: ociVmFields,
      models: [{ model: 'od', label: 'Pay as you go' }],
      price: ociVmPrice,
      adopt: adoptVm,
    },
  },
};
