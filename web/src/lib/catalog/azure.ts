// Microsoft Azure pricers, one per neutral service. Prices come from the Azure Retail
// Prices API (etl/internal/azure): <region>.json for regional meters and global.json for
// meters priced once ("Global") or per billing zone ("Zone 1", "Zone 2", ...).
import type { Item, Line, Priced, Spec } from '../types';
import { azure } from '../prices';
import type { AzRow } from '../prices';
import { continent, H, line, must, num, opts, priced, str, tierLine, unavailable } from './util';
import type { Ctx, Field, ModelOption, ProviderImpl } from './util';
import { azCost, azMeter, azRate, azReservedHourly } from './azutil';
import { ctUsage, fnUsage } from './compute';
import { customPrice, POINTS } from './more';
import { destField, vpcPrice } from './network';
import { azureInstanceFee, geoOf } from './addons';

const reg = (ctx: Ctx) => azure.region(ctx.region);
const svc = (rows: AzRow[], service: string) => rows.filter((r) => r.s === service);

// =====================================================================================
// Virtual machines
// =====================================================================================

interface AzSize {
  sku: string; // Standard_D2s_v5
  fam: string; // D
  vcpu: number;
  mem: number;
  arm: boolean;
  linux: AzRow;
  windows?: AzRow;
  ri: AzRow[];
}

/** GiB of memory per vCPU by family. The Retail API has no vCPU or memory attributes,
 *  so sizes are read from their names: Standard_D2s_v5 = D family, 2 vCPU, v5.
 *  "l" sizes (Dlsv5) carry 2 GiB per vCPU. */
const MEM_PER_VCPU: Record<string, number> = { D: 4, E: 8, F: 2 };
const SIZE = /^Standard_([A-Z]+)(\d+)([a-z]*)_v(\d+)$/;

/** Families the "pick for me" choice uses: general-purpose D, memory E and compute F
 *  sizes on remote premium disks (no local disk, no burstable, no confidential). */
function auto(fam: string, feat: string, ver: number): boolean {
  if (!(fam in MEM_PER_VCPU)) return false;
  if (!feat.includes('s') || /[dbcni]/.test(feat)) return false;
  return fam === 'F' ? ver >= 2 : ver >= 5;
}

function sizes(rows: AzRow[]): AzSize[] {
  const vm = svc(rows, 'Virtual Machines');
  const by = new Map<string, AzSize>();
  for (const r of vm) {
    const m = r.a ? SIZE.exec(r.a) : null;
    if (!m) continue;
    const [, fam, n, feat, v] = m;
    let s = by.get(r.a!);
    if (!s) {
      const per = feat.includes('l') ? 2 : MEM_PER_VCPU[fam];
      if (!per) continue;
      s = { sku: r.a!, fam: `${fam}${feat}v${v}`, vcpu: Number(n), mem: Number(n) * per, arm: feat.includes('p'), linux: undefined as unknown as AzRow, ri: [] };
      by.set(r.a!, s);
    }
    const win = r.p.endsWith(' Windows');
    if (r.t === 'c' && r.u === '1 Hour') {
      if (win) s.windows = r;
      else s.linux = r;
    } else if (r.t === 'r' && !win) s.ri.push(r);
  }
  return [...by.values()].filter((s) => s.linux);
}

function pickSize(list: AzSize[], vcpu: number, mem: number, arm: boolean): AzSize | undefined {
  return list
    .filter((s) => {
      const m = SIZE.exec(s.sku)!;
      return auto(m[1], m[3], Number(m[4])) && s.arm === arm && s.vcpu >= vcpu && s.mem >= mem;
    })
    .sort((a, b) => a.linux.r - b.linux.r)[0];
}

async function azVmFields(ctx: Ctx, spec: Spec): Promise<Field[]> {
  const arm = str(spec, 'arch', 'x86') === 'arm';
  const list = sizes(await reg(ctx)).filter((s) => s.arm === arm).sort((a, b) => a.fam.localeCompare(b.fam) || a.vcpu - b.vcpu);
  return [{
    key: 'azure.size', label: 'VM size', type: 'select',
    options: [{ value: '', label: 'Pick the closest match for me' }, ...list.map((s) => ({ value: s.sku, label: `${s.sku.replace('Standard_', '')} · ${s.vcpu} vCPU · ${s.mem} GiB` }))],
  }];
}

/** Reserved Instances: the term's price paid up front, or the same total in monthly
 *  instalments. Savings Plan: an hourly commitment at the plan rate. */
const azModels: ModelOption[] = [
  { model: 'od', label: 'Pay as you go' },
  { model: 'ri', label: 'Reservation', terms: [1, 3], pays: ['all', 'no'] },
  { model: 'sp', label: 'Savings Plan', terms: [1, 3], pays: ['no'] },
];

/** Licence products for Linux distributions sold with the VM. */
const OS_LICENCE: Record<string, string> = { rhel: 'Red Hat Enterprise Linux', suse: 'SUSE Linux Enterprise Server Standard', 'ubuntu-pro': 'Ubuntu Pro' };

/** Hourly licence for a VM of `vcpu` vCPUs. Meters name either an exact size ("8 vCPU VM
 *  License", "52-vCPU VM License") or a band in the SKU ("1-4 vCPU VM", "5+ vCPU VM");
 *  an exact size wins over a band. Bring-your-own-subscription and free meters are skipped. */
export function osLicence(rows: AzRow[], vcpu: number): number | undefined {
  const hourly = rows.filter((r) => r.u === '1 Hour' && !/BYOS|Free/.test(r.m + r.k));
  const lic = hourly.some((r) => /License/.test(r.m)) ? hourly.filter((r) => /License/.test(r.m)) : hourly;
  const exact = lic.find((r) => new RegExp(`(^|VM )${vcpu}[ -]vCPU VM (License|Support)$`).test(r.m));
  if (exact) return exact.r;
  const band = (s: string): [number, number] | undefined => {
    let m = /^(\d+)-(\d+) vCPU VM$/.exec(s);
    if (m) return [Number(m[1]), Number(m[2])];
    m = /^(\d+)\+ vCPU VM$/.exec(s);
    if (m) return [Number(m[1]), Infinity];
    m = /^(\d+) vCPU VM$/.exec(s);
    if (m) return [Number(m[1]), Number(m[1])];
    return undefined;
  };
  const hit = lic.find((r) => {
    const b = band(r.k);
    return !!b && vcpu >= b[0] && vcpu <= b[1] && /^(\d+[-+]?\d* )?vCPU VM (License|Support)$|VM (License|Support)$/.test(r.m);
  });
  return hit?.r;
}

async function azVmPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const list = sizes(await reg(ctx));
  const arm = str(item.spec, 'arch', 'x86') === 'arm';
  const chosen = str(item.spec, 'azure.size');
  const size = chosen ? list.find((s) => s.sku === chosen) : pickSize(list, num(item.spec, 'vcpu', 2), num(item.spec, 'mem', 8), arm);
  if (!size) return unavailable(chosen ? `${chosen} is not sold in ${ctx.info?.name ?? ctx.region}.` : 'No VM size in this region fits the vCPU and memory asked for.');
  const os = str(item.spec, 'os', 'linux');
  const sw = str(item.spec, 'sw', 'none');
  const byol = str(item.spec, 'licence', 'included') === 'byol';
  const q = item.qty;
  const hrs = Math.min(H, num(item.spec, 'hours', H));
  const notes: string[] = [];
  const windows = os === 'windows';
  if (windows && !size.windows) return unavailable(`${size.sku} has no Windows price here.`);
  // The Windows licence is the difference between the Windows and the Linux rate.
  const licence = windows && !byol ? size.windows!.r - size.linux.r : 0;
  if (windows && byol) notes.push('Azure Hybrid Benefit: your own Windows licence, so the Linux rate applies.');
  // RHEL, SUSE and Ubuntu Pro bill a licence per VM size on their own meter.
  let osRate = 0, osName = '';
  if (os !== 'linux' && os !== 'windows') {
    osName = OS_LICENCE[os] ?? '';
    const r = osName ? osLicence((await azure.global()).filter((x) => x.t === 'c' && x.s === 'Virtual Machines Licenses' && x.p === osName), size.vcpu) : undefined;
    if (r === undefined) return unavailable(`No ${osName || os} licence price for ${size.vcpu} vCPU.`);
    osRate = r;
  }
  // SQL Server licences are sold per VM size: one price up to 4 vCPU, then per vCPU.
  let sqlRate = 0, sqlName = '';
  if (sw !== 'none' && !byol) {
    sqlName = ({ 'sql-web': 'Web', 'sql-std': 'Standard', 'sql-ent': 'Enterprise' } as Record<string, string>)[sw] ?? '';
    const lic = (await azure.global()).filter((r) => r.t === 'c' && r.s === 'Virtual Machines Licenses' && r.p === `SQL Server ${sqlName}`);
    const row = size.vcpu <= 4 ? lic.find((r) => r.k === '1-4 vCPU VM') : lic.find((r) => r.k === `${size.vcpu} vCPU VM`);
    const perCore = lic.find((r) => r.k === '1 vCore');
    sqlRate = row ? row.r : perCore ? perCore.r * Math.max(4, size.vcpu) : NaN;
    if (!Number.isFinite(sqlRate)) return unavailable(`No SQL Server ${sqlName} licence price for ${size.vcpu} vCPU.`);
  }
  if (sw !== 'none' && byol) notes.push('Your own SQL Server licence (Azure Hybrid Benefit): no licence charge.');

  const p = item.pricing ?? { model: 'od' };
  const name = size.sku.replace('Standard_', '');
  const lines: Line[] = [];
  let upfront = 0;
  if (p.model === 'ri') {
    const r = size.ri.find((x) => x.y === (p.term ?? 1));
    if (!r) return unavailable('No reservation for this size and term here.');
    if (p.pay === 'all') upfront = r.r * q;
    else lines.push(line(`${name}, reservation (${p.term ?? 1} yr, paid monthly)`, H * q, 'hours', azReservedHourly(r)));
    if (hrs < H) notes.push('A reservation is billed for every hour of the term.');
  } else if (p.model === 'sp') {
    const r = size.linux.sp?.find(([y]) => y === (p.term ?? 1));
    if (!r) return unavailable('No Savings Plan rate for this size and term here.');
    lines.push(line(`${name}, Savings Plan (${p.term ?? 1} yr)`, H * q, 'hours', r[1]));
  } else {
    lines.push(line(`${name}${arm ? ' (Arm)' : ''}`, hrs * q, 'hours', size.linux.r));
  }
  // Reservations and Savings Plans cover compute only; the Windows licence stays pay as you go.
  if (licence > 0) lines.push(line('Windows Server licence', hrs * q, 'hours', licence));
  if (sqlRate > 0) lines.push(line(`SQL Server ${sqlName} licence${size.vcpu <= 4 ? ' (4-core minimum)' : ''}`, hrs * q, 'hours', sqlRate));
  if (osRate > 0) lines.push(line(`${osName} licence`, hrs * q, 'hours', osRate));
  return priced(lines, { upfront, sku: `${name} · ${size.vcpu} vCPU · ${size.mem} GiB`, notes });
}

// =====================================================================================
// Disks, blobs, files
// =====================================================================================

/** Managed disk tiers: the number in P10 / E10 / S10 and its size in GiB. */
const DISK_TIERS: [number, number][] = [[1, 4], [2, 8], [3, 16], [4, 32], [6, 64], [10, 128], [15, 256], [20, 512], [30, 1024], [40, 2048], [50, 4096], [60, 8192], [70, 16384], [80, 32767]];

async function azDiskPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Storage');
  const gb = num(item.spec, 'gb', 100);
  const q = item.qty;
  const kind = str(item.spec, 'azure.disk') || ({ ssd: 'premium', 'ssd-fast': 'premium-v2', hdd: 'standard-hdd', 'hdd-cold': 'standard-hdd' } as Record<string, string>)[str(item.spec, 'type', 'ssd')];
  if (kind === 'premium-v2') {
    const cap = azMeter(rows, (r) => r.p === 'Azure Premium SSD v2' && r.m === 'Premium LRS Provisioned Capacity');
    const iops = azMeter(rows, (r) => r.p === 'Azure Premium SSD v2' && r.m === 'Premium LRS Provisioned IOPS');
    const mbps = azMeter(rows, (r) => r.p === 'Azure Premium SSD v2' && r.m === 'Premium LRS Provisioned Throughput (MBps)');
    // Capacity, IOPS and MB/s are billed per hour; the first 3,000 IOPS and 125 MB/s are free.
    return priced([
      line('Premium SSD v2 capacity', gb * H * q, 'GiB-hours', must(azRate(cap), 'Premium SSD v2 capacity')),
      tierLine('IOPS (first 3,000 free)', num(item.spec, 'iops', 3000) * H * q, 'IOPS-hours', must(azCost(iops, num(item.spec, 'iops', 3000)) * H * q, 'Premium SSD v2 IOPS')),
      tierLine('Throughput (first 125 MB/s free)', num(item.spec, 'mbps', 125) * H * q, 'MBps-hours', must(azCost(mbps, num(item.spec, 'mbps', 125)) * H * q, 'Premium SSD v2 throughput')),
    ], { sku: 'Premium SSD v2' });
  }
  const [prefix, product] = kind === 'standard-hdd' ? ['S', 'Standard HDD Managed Disks'] : kind === 'standard-ssd' ? ['E', 'Standard SSD Managed Disks'] : ['P', 'Premium SSD Managed Disks'];
  const tier = DISK_TIERS.find(([n, size]) => size >= gb && rows.some((r) => r.t === 'c' && r.p === product && r.m === `${prefix}${n} LRS Disk`));
  if (!tier) return unavailable(`No ${product.replace(' Managed Disks', '')} disk of ${gb} GiB here.`);
  const row = rows.find((r) => r.t === 'c' && r.p === product && r.m === `${prefix}${tier[0]} LRS Disk`)!;
  const notes = [`Managed disks come in fixed sizes: ${gb} GiB is billed as ${prefix}${tier[0]} (${tier[1]} GiB).`];
  const lines: Line[] = [line(`${prefix}${tier[0]} LRS disk (${tier[1]} GiB)`, q, 'disk-months', row.r)];
  if (prefix !== 'P') {
    // Standard disks bill each 10,000 operations (reads and writes up to 256 KiB each).
    const ops = num(item.spec, 'azure.ops', 0) * q;
    const meter = azMeter(rows, (r) => r.p === product && r.m === `${prefix}${tier[0]} LRS Disk Operations`);
    if (ops) lines.push(line('Disk operations', ops, 'operations', must(azRate(meter), 'disk operations')));
    else notes.push('Standard disks also bill operations per 10,000; enter operations a month to include them.');
  }
  return priced(lines, { sku: `${product.replace(' Managed Disks', '')} ${prefix}${tier[0]}`, notes });
}

async function azObjectPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Storage').filter((r) => r.p === 'General Block Blob v2');
  const cls = str(item.spec, 'class', 'hot');
  const C = ({ hot: 'Hot', cool: 'Cool', cold: 'Cold', archive: 'Archive' } as Record<string, string>)[cls] ?? 'Hot';
  const gb = num(item.spec, 'gb', 1000) * item.qty;
  const puts = num(item.spec, 'puts', 0) * item.qty, gets = num(item.spec, 'gets', 0) * item.qty;
  const stored = azMeter(rows, (r) => new RegExp(`^${C} LRS Data Stored$`).test(r.m));
  const writes = azMeter(rows, (r) => new RegExp(`^${C} LRS Write Operations$`).test(r.m));
  const reads = azMeter(rows, (r) => new RegExp(`^${C}( LRS)? Read Operations$`).test(r.m));
  return priced([
    tierLine(`${C} storage`, gb, 'GB-month', must(azCost(stored, gb), `${C} blob storage`)),
    tierLine('Write operations', puts, 'requests', must(azCost(writes, puts), 'blob writes')),
    tierLine('Read operations', gets, 'requests', must(azCost(reads, gets), 'blob reads')),
  ], { sku: `Blob Storage ${C}, LRS` });
}

async function azFilePrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Storage');
  const gb = num(item.spec, 'gb', 500) * item.qty;
  const tier = str(item.spec, 'tier', 'standard');
  if (tier === 'performance') {
    const r = azMeter(rows, (x) => x.p === 'Premium Files' && x.m === 'Premium LRS Provisioned');
    return priced([line('Premium Files, provisioned', gb, 'GiB-month', must(azRate(r), 'Premium Files'))], { sku: 'Azure Files Premium, LRS', notes: ['Premium Files bills the capacity provisioned.'] });
  }
  const C = tier === 'infrequent' ? 'Cool' : 'Hot';
  const r = azMeter(rows, (x) => x.p === 'Files v2' && x.m === `${C} LRS Data Stored`);
  return priced([line(`Azure Files ${C}`, gb, 'GB-month', must(azRate(r), `Azure Files ${C}`))], { sku: `Azure Files ${C}, LRS`, notes: ['Transactions are billed on top; not included.'] });
}

// =====================================================================================
// Kubernetes, containers, functions
// =====================================================================================

async function azK8sPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Azure Kubernetes Service');
  const ext = str(item.spec, 'support') === 'extended';
  const r = azMeter(rows, (x) => x.p === 'Azure Kubernetes Service' && x.m === (ext ? 'Standard Long Term Support' : 'Standard Uptime SLA'));
  return priced([line(`AKS Standard tier${ext ? ', long-term support' : ''}`, H * item.qty, 'cluster-hours', must(azRate(r), 'AKS cluster'))], {
    sku: 'AKS Standard', notes: ['The AKS Free tier has no uptime SLA and costs nothing; nodes are priced as VMs.'],
  });
}

async function azContainersPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Container Instances');
  const { tasks, hrs, vcpu, gb } = ctUsage(item);
  const cpu = azMeter(rows, (r) => r.p === 'Container Instances' && r.m === 'Standard vCPU Duration');
  const mem = azMeter(rows, (r) => r.p === 'Container Instances' && r.m === 'Standard Memory Duration');
  const notes = str(item.spec, 'arch') === 'arm' ? ['Container Instances runs x86 only; priced as x86.'] : [];
  return priced([
    line('vCPU', tasks * vcpu * hrs, 'vCPU-hours', must(azRate(cpu), 'Container Instances vCPU')),
    line('Memory', tasks * gb * hrs, 'GB-hours', must(azRate(mem), 'Container Instances memory')),
  ], { sku: 'Container Instances, Linux', notes });
}

async function azFunctionsPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Functions').filter((r) => r.p === 'Functions');
  const { req, gbs } = fnUsage(item);
  const exec = azMeter(rows, (r) => r.m === 'Standard Total Executions');
  const time = azMeter(rows, (r) => r.m === 'Standard Execution Time');
  return priced([
    tierLine('Executions (first 1M free)', req, 'executions', must(azCost(exec, req), 'Functions executions')),
    tierLine('Execution time (first 400,000 GB-s free)', gbs, 'GB-seconds', must(azCost(time, gbs), 'Functions execution time')),
  ], { sku: 'Functions, Consumption plan' });
}

// =====================================================================================
// Databases and Redis
// =====================================================================================

/** vCore sizes Azure sells for flexible servers. */
const VCORES = [2, 4, 8, 16, 32, 48, 64, 96];

async function azDbPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await reg(ctx);
  const engine = str(item.spec, 'engine', 'mysql');
  const vcpu = num(item.spec, 'vcpu', 2), mem = num(item.spec, 'mem', 8);
  const ha = str(item.spec, 'ha', 'single') === 'multi';
  const hrs = Math.min(H, num(item.spec, 'hours', H));
  const q = item.qty;
  const gb = num(item.spec, 'gb', 100) * q;
  if (engine.startsWith('sqlserver')) {
    const sql = svc(rows, 'SQL Database');
    const v = Math.max(1, Math.ceil(vcpu));
    // Enterprise maps to Business Critical (local SSD, three replicas, high availability built in).
    const bc = engine === 'sqlserver-ent';
    const tier = bc ? 'Business Critical' : 'General Purpose';
    const ahb = str(item.spec, 'azure.ahb') === 'yes';
    const core = azMeter(sql, (r) => r.p === `SQL Database Single/Elastic Pool ${tier} - Compute Gen5` && r.m === 'vCore' && /^1 vCore$|^vCore$/.test(r.k));
    const zr = azMeter(sql, (r) => r.p === 'SQL Database Single/Elastic Pool General Purpose - Compute Gen5' && r.m === 'Zone Redundancy vCore' && /^1 vCore/.test(r.k));
    const disk = azMeter(sql, (r) => r.p === `SQL Database Single/Elastic Pool ${tier} - Storage` && r.m === (bc ? 'Business Critical Data Stored' : ha ? 'General Purpose Zone Redundancy Data Stored' : 'General Purpose Data Stored'));
    const lic = azMeter((await azure.global()).filter((r) => r.s === 'SQL Database'), (r) => r.p === `SQL Database Single/Elastic Pool ${tier} - SQL License` && r.m === 'vCore');
    const lines: Line[] = [line(`${tier}, ${v} vCore (compute)`, v * hrs * q, 'vCore-hours', must(azRate(core), 'SQL Database vCore'))];
    if (!ahb) lines.push(line('SQL Server licence', v * hrs * q, 'vCore-hours', must(azRate(lic), 'SQL Database licence')));
    if (ha && !bc) lines.push(line('Zone redundancy', v * hrs * q, 'vCore-hours', must(azRate(zr), 'SQL Database zone redundancy')));
    if (gb) lines.push(line(`Storage${ha && !bc ? ', zone redundant' : ''}`, gb, 'GB-month', must(azRate(disk), 'SQL Database storage')));
    const notes = [`Azure SQL Database, ${tier} (Gen5). Memory comes with the vCore count (about 5.1 GB each).`];
    notes.push(ahb ? 'Azure Hybrid Benefit: your own SQL Server licence, so no licence line.' : 'The SQL Server licence is included; Azure Hybrid Benefit removes it.');
    if (bc) notes.push('Business Critical keeps three replicas, so high availability is in the price.');
    if (engine === 'sqlserver-web') notes.push('Azure SQL Database has no Web edition; priced as General Purpose.');
    return priced(lines, { sku: `Azure SQL Database ${bc ? 'BC' : 'GP'} · ${v} vCore`, notes });
  }
  if (engine.startsWith('oracle') || engine.startsWith('aurora')) return unavailable(engine.startsWith('oracle') ? 'Oracle Database@Azure is bought through Oracle; not priced here.' : 'Aurora has no Azure equivalent; pick MySQL or PostgreSQL.');
  const pg = engine === 'postgres';
  const service = pg ? 'Azure Database for PostgreSQL' : 'Azure Database for MySQL';
  const base = pg ? 'Azure Database for PostgreSQL Flexible Server' : 'Azure Database for MySQL Flexible Server';
  // General Purpose sizes give 4 GiB per vCore, Memory Optimized 8.
  const memOpt = mem > vcpu * 4;
  const v = VCORES.find((n) => n >= vcpu && n * (memOpt ? 8 : 4) >= mem) ?? VCORES[VCORES.length - 1];
  const product = memOpt ? `${base} Memory Optimized Edsv5 Series Compute` : `${base} General Purpose Ddsv5 Series Compute`;
  const all = svc(rows, service);
  const core = azMeter(all, (r) => r.p === product && r.m === 'vCore' && /^(1 )?vCore$/.test(r.k));
  const store = azMeter(all, (r) => r.p === (pg ? 'Azure Database for PostgreSQL Flex Server Storage' : 'Azure Database for MySQL Flexible Server Storage') && r.m === 'Storage Data Stored');
  const nodes = ha ? 2 : 1;
  const lines: Line[] = [line(`${memOpt ? 'Memory Optimized' : 'General Purpose'}, ${v} vCore${ha ? ' × 2 (zone-redundant HA)' : ''}`, v * nodes * hrs * q, 'vCore-hours', must(azRate(core), 'flexible server vCore'))];
  if (gb) lines.push(line(`Storage${ha ? ' × 2' : ''}`, gb * nodes, 'GB-month', must(azRate(store), 'flexible server storage')));
  const notes = engine === 'mariadb' ? ['Azure has no managed MariaDB; priced as MySQL.'] : [];
  return priced(lines, { sku: `${pg ? 'PostgreSQL' : 'MySQL'} Flexible Server · ${v} vCore · ${v * (memOpt ? 8 : 4)} GiB`, notes });
}

/** Azure Cache for Redis sizes: name and GB. Standard and Premium run a primary and a replica. */
const REDIS_C: [string, number][] = [['C0', 0.25], ['C1', 1], ['C2', 2.5], ['C3', 6], ['C4', 13], ['C5', 26], ['C6', 53]];
const REDIS_P: [string, number][] = [['P1', 6], ['P2', 13], ['P3', 26], ['P4', 53], ['P5', 120]];

async function azCachePrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Redis Cache');
  const gb = Math.max(0.25, num(item.spec, 'gb', 6));
  const nodes = Math.max(1, num(item.spec, 'nodes', 2));
  const replicated = nodes > 1;
  let tier = replicated ? 'Standard' : 'Basic';
  let size = REDIS_C.find(([, g]) => g >= gb);
  if (!size) {
    tier = 'Premium';
    size = REDIS_P.find(([, g]) => g >= gb);
  }
  if (!size) return unavailable('Azure Cache for Redis tops out at 120 GB per cache here; split the data.');
  const r = azMeter(rows, (x) => x.p === `Azure Redis Cache ${tier}` && x.m === `${size![0]} Cache`);
  const notes = [replicated || tier === 'Premium' ? `${tier} runs a primary and a replica; the price covers both.` : 'Basic has no replica.'];
  if (nodes > 2) notes.push('Standard and Premium have one replica; more nodes need Premium clustering, not priced here.');
  return priced([line(`Azure Cache for Redis ${tier} ${size[0]} (${size[1]} GB)`, H * item.qty, 'cache-hours', must(azRate(r), 'Redis cache'))], { sku: `Redis ${tier} ${size[0]}` });
}

// =====================================================================================
// Networking
// =====================================================================================

const glob = async () => azure.global();
const g = (rows: AzRow[], service: string, product: string, meter: string) =>
  azMeter(rows, (r) => r.s === service && r.p === product && r.m === meter && (r.z === 'Global' || !r.z));

async function azLbPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const type = str(item.spec, 'type', 'app');
  const q = item.qty;
  const gb = num(item.spec, 'gb', 0) * q;
  if (type === 'app' || type === 'classic') {
    const rows = svc(await reg(ctx), 'Application Gateway');
    const fixed = azMeter(rows, (r) => r.p === 'Application Gateway Standard v2' && r.m === 'Standard Fixed Cost');
    const cu = azMeter(rows, (r) => r.p === 'Application Gateway Standard v2' && r.m === 'Standard Capacity Units');
    const units = num(item.spec, 'lcu', 1);
    return priced([
      line('Application Gateway v2', H * q, 'gateway-hours', must(azRate(fixed), 'Application Gateway')),
      line('Capacity units', units * H * q, 'CU-hours', must(azRate(cu), 'capacity units')),
    ], { sku: 'Application Gateway Standard v2', notes: ['Capacity units: the "LCU" field is used as the average capacity units in use.'] });
  }
  const rows = await glob();
  if (type === 'gw') {
    return priced([
      line('Gateway Load Balancer', H * q, 'hours', must(azRate(g(rows, 'Load Balancer', 'Load Balancer', 'Gateway')), 'Gateway Load Balancer')),
      line('Data processed', gb, 'GB', must(azRate(g(rows, 'Load Balancer', 'Load Balancer', 'Gateway Data Processed')), 'Gateway LB data')),
    ], { sku: 'Gateway Load Balancer' });
  }
  return priced([
    line('Standard Load Balancer, first 5 rules', H * q, 'hours', must(azRate(g(rows, 'Load Balancer', 'Load Balancer', 'Standard Included LB Rules and Outbound Rules')), 'Load Balancer rules')),
    line('Data processed', gb, 'GB', must(azRate(g(rows, 'Load Balancer', 'Load Balancer', 'Standard Data Processed')), 'Load Balancer data')),
  ], { sku: 'Standard Load Balancer', notes: ['Rules beyond the first five are billed per rule-hour; not included.'] });
}

async function azNatPrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await glob();
  const gb = num(item.spec, 'gb', 0);
  return priced([
    line('NAT gateway', H * item.qty, 'hours', must(azRate(g(rows, 'NAT Gateway', 'NAT Gateway', 'Standard Gateway')), 'NAT gateway')),
    line('Data processed', gb * item.qty, 'GB', must(azRate(g(rows, 'NAT Gateway', 'NAT Gateway', 'Standard Data Processed')), 'NAT data')),
  ], { sku: 'Azure NAT Gateway' });
}

async function azIpPrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await glob();
  return priced([line('Standard static public IPv4', H * item.qty, 'IP-hours', must(azRate(g(rows, 'Virtual Network', 'IP Addresses', 'Standard IPv4 Static Public IP')), 'public IP'))], {
    sku: 'Standard public IP', notes: ['Azure charges the same whether the address is attached or not.'],
  });
}

async function azEndpointPrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await glob();
  const gb = num(item.spec, 'gb', 0) * item.qty;
  const data = g(rows, 'Virtual Network', 'Virtual Network Private Link', 'Standard Data Processed - Ingress');
  return priced([
    line('Private endpoint', H * item.qty, 'endpoint-hours', must(azRate(g(rows, 'Virtual Network', 'Virtual Network Private Link', 'Standard Private Endpoint')), 'private endpoint')),
    tierLine('Data processed', gb, 'GB', must(azCost(data, gb), 'Private Link data')),
  ], { sku: 'Azure Private Link', notes: ['Azure bills data in both directions; the data entered is priced once.'] });
}

async function azEgressPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Bandwidth').filter((r) => r.p === 'Rtn Preference: MGN');
  const gb = num(item.spec, 'gb', 0) * item.qty;
  const to = str(item.spec, 'to', 'internet');
  if (to === 'internet') {
    const out = azMeter(rows, (r) => r.m === 'Standard Data Transfer Out');
    return priced([tierLine('Data transfer out to the internet', gb, 'GB', must(azCost(out, gb), 'internet data transfer'))], { sku: 'Bandwidth, Microsoft network routing' });
  }
  const r = azMeter(rows, (x) => x.m === 'Standard Inter-Region Data Transfer');
  const dest = ctx.regions.find((x) => x.code === to);
  return priced([line(`Inter-region to ${dest?.name ?? to}`, gb, 'GB', must(azRate(r), 'inter-region transfer'))], { sku: 'Inter-region data transfer' });
}

async function azVpnPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'VPN Gateway');
  const tunnels = num(item.spec, 'tunnels', 2) * item.qty;
  const gw = azMeter(rows, (r) => r.k === 'VpnGw1AZ' && r.m === 'VpnGw1AZ');
  const s2s = azMeter(rows, (r) => r.k === 'VpnGw1AZ' && r.m === 'S2S Connection');
  const lines: Line[] = [line('VPN Gateway VpnGw1AZ', H * item.qty, 'gateway-hours', must(azRate(gw), 'VPN gateway'))];
  // VpnGw1 includes 10 site-to-site connections.
  const extra = Math.max(0, tunnels - 10 * item.qty);
  if (extra) lines.push(line('Site-to-site connections above 10', extra * H, 'connection-hours', must(azRate(s2s), 'S2S connection')));
  return priced(lines, { sku: 'VPN Gateway VpnGw1AZ', notes: ['VpnGw1AZ includes 10 site-to-site connections; data out is priced under data transfer.'] });
}

async function azDdosPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Azure DDOS Protection');
  if (str(item.spec, 'on')) {
    // One resource: DDoS IP Protection on its public IP, instead of a plan for the network.
    const ipp = azMeter(rows, (r) => r.m === 'IP Protection Resource');
    return priced([line('DDoS IP Protection, one public IP', H * item.qty, 'IP-hours', must(azRate(ipp), 'DDoS IP Protection'))], {
      sku: 'Azure DDoS IP Protection', notes: ['Past about 15 protected IPs, one Network Protection plan (a DDoS card on its own) costs less.'],
    });
  }
  const res = num(item.spec, 'resources', 2);
  const plan = azMeter(rows, (r) => r.m === 'Network Protection Plan');
  const over = azMeter(rows, (r) => r.m === 'Network Protection Resource');
  // A Network Protection plan covers 100 public IPs; each one above that is billed on its own.
  const lines: Line[] = [line('DDoS Network Protection plan (100 public IPs)', H * item.qty, 'plan-hours', must(azRate(plan), 'DDoS plan'))];
  if (res > 100) lines.push(line('Public IPs above 100', (res - 100) * H * item.qty, 'IP-hours', must(azRate(over), 'DDoS resource')));
  return priced(lines, { sku: 'Azure DDoS Network Protection' });
}

/** ExpressRoute circuit sizes as Azure names them. */
const ER_CAP: Record<string, string> = { '50M': '50 Mbps', '100M': '100 Mbps', '200M': '200 Mbps', '500M': '500 Mbps', '1G': '1 Gbps', '2G': '2 Gbps', '5G': '5 Gbps', '10G': '10 Gbps' };

/** Azure prices ExpressRoute data out by the billing zone of the peering location
 *  (learn.microsoft.com, "Locations and connectivity providers"). Default: the zone of the
 *  peering locations near the region; the SA can pick another. Zone 1: North America,
 *  Europe, Canberra. Zone 2: Asia, India, Japan, Korea, Oceania, Israel. Zone 3: South
 *  America, Middle East, Africa. Zone 4: Mexico. */
export function erZone(ctx: Ctx, spec: Spec): string {
  const z = str(spec, 'azure.zone');
  if (z) return z;
  const r = ctx.region;
  if (r.startsWith('mexico')) return 'Zone 4';
  if (r.startsWith('australiacentral')) return 'Zone 1';
  if (r.startsWith('israel')) return 'Zone 2';
  return { na: 'Zone 1', eu: 'Zone 1', apac: 'Zone 2', sa: 'Zone 3', me: 'Zone 3', af: 'Zone 3' }[continent('azure', r)];
}

async function azInterconnectPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = (await glob()).filter((r) => r.s === 'ExpressRoute' && r.p === 'ExpressRoute');
  const cap = ER_CAP[str(item.spec, 'cap', '1G')];
  if (!cap) return unavailable('ExpressRoute circuits run from 50 Mbps to 10 Gbps; 100 Gbps needs ExpressRoute Direct.');
  const zone = erZone(ctx, item.spec);
  const ports = num(item.spec, 'ports', 1) * item.qty;
  const circuit = azMeter(rows, (r) => r.z === zone && r.k === `${cap} Metered Data` && r.m === `Standard Metered Data ${cap} Circuit`);
  const out = azMeter(rows, (r) => r.z === zone && r.k === `${cap} Metered Data` && r.m === 'Metered Data - Data Transfer Out');
  const gw = azMeter(svc(await reg(ctx), 'ExpressRoute'), (r) => r.k === 'ErGw1AZ' && r.m === 'ErGw1AZ Gateway');
  const gb = num(item.spec, 'gb', 0) * item.qty;
  const notes = [`Data out priced at ${zone} rates; the zone follows the peering location, so check it on Azure's ExpressRoute pricing page.`];
  if (str(item.spec, 'kind') === 'hosted') notes.push('Partner (provider) port fees are billed by the partner; not included.');
  return priced([
    line(`ExpressRoute ${cap} circuit, metered data`, ports, 'circuit-months', must(azRate(circuit), 'ExpressRoute circuit')),
    line(`Data out, ${zone}`, gb, 'GB', must(azRate(out), 'ExpressRoute data')),
    line('ExpressRoute gateway ErGw1AZ', H * item.qty, 'gateway-hours', must(azRate(gw), 'ExpressRoute gateway')),
  ], { sku: `ExpressRoute ${cap} Standard`, notes });
}

async function azDnsPrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = (await glob()).filter((r) => r.s === 'Azure DNS' && r.z === 'Global');
  const zones = num(item.spec, 'zones', 0) * item.qty, qs = num(item.spec, 'queries', 0) * item.qty;
  return priced([
    tierLine('Public zones', zones, 'zones', must(azCost(azMeter(rows, (r) => r.k === 'Public' && r.m === 'Public Zone'), zones), 'DNS zones')),
    tierLine('Queries', qs, 'queries', must(azCost(azMeter(rows, (r) => r.k === 'Public' && r.m === 'Public Queries'), qs), 'DNS queries')),
  ], { sku: 'Azure DNS' });
}

// =====================================================================================
// Security, integration, operations
// =====================================================================================

async function azWafPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const on = str(item.spec, 'on');
  if (on === 'cdn') {
    const g = (await glob()).filter((r) => r.s === 'Azure Front Door Service' && r.k === 'Standard' && r.z === 'Global');
    const q = item.qty;
    const req = num(item.spec, 'requests', 0) * q;
    return priced([
      line('WAF policies', num(item.spec, 'acls', 1) * q, 'policy-months', must(azRate(azMeter(g, (r) => r.m === 'Standard Policy')), 'Front Door WAF policy')),
      line('Custom rules', num(item.spec, 'rules', 0) * q, 'rule-months', must(azRate(azMeter(g, (r) => r.m === 'Standard Rule')), 'Front Door WAF rule')),
      line('Requests', req, 'requests', must(azRate(azMeter(g, (r) => r.m === 'Standard Requests')), 'Front Door WAF requests')),
    ], { sku: 'WAF policy on Front Door Standard' });
  }
  const rows = svc(await reg(ctx), 'Application Gateway');
  if (on === 'lb') {
    // The load balancer card already prices an Application Gateway; WAF adds the step from Standard v2 to WAF v2.
    const fixed = (p: string) => azRate(azMeter(rows, (r) => r.p === p && r.m === 'Standard Fixed Cost'));
    const cu = (p: string) => azRate(azMeter(rows, (r) => r.p === p && r.m === 'Standard Capacity Units'));
    const n = item.qty;
    return priced([
      line('WAF v2 over Standard v2, fixed', n * H, 'gateway-hours', must(fixed('Application Gateway WAF v2') - fixed('Application Gateway Standard v2'), 'WAF gateway')),
      line('WAF v2 over Standard v2, 1 capacity unit', n * H, 'CU-hours', must(cu('Application Gateway WAF v2') - cu('Application Gateway Standard v2'), 'WAF capacity units')),
    ], { sku: 'Application Gateway WAF v2 (step-up)', notes: ['Priced as the difference between WAF v2 and Standard v2 on the load balancer above. Azure does not charge per rule here.'] });
  }
  const fixed = azMeter(rows, (r) => r.p === 'Application Gateway WAF v2' && r.m === 'Standard Fixed Cost');
  const cu = azMeter(rows, (r) => r.p === 'Application Gateway WAF v2' && r.m === 'Standard Capacity Units');
  const n = Math.max(1, num(item.spec, 'acls', 1)) * item.qty;
  return priced([
    line('Application Gateway WAF v2', n * H, 'gateway-hours', must(azRate(fixed), 'WAF gateway')),
    line('Capacity units (1 per gateway)', n * H, 'CU-hours', must(azRate(cu), 'WAF capacity units')),
  ], { sku: 'Application Gateway WAF v2', notes: ['Azure WAF on Application Gateway bills the gateway, not rules or requests.'] });
}

async function azApigwPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'API Management');
  const req = num(item.spec, 'requests', 0) * item.qty;
  const calls = azMeter(rows, (r) => r.k === 'Consumption' && r.m === 'Consumption Calls');
  return priced([tierLine('API calls (first 1M free)', req, 'calls', must(azCost(calls, req), 'API Management calls'))], { sku: 'API Management, Consumption tier' });
}

async function azQueuePrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Service Bus');
  const req = num(item.spec, 'requests', 0) * item.qty;
  // Some regions list the base charge per month, others only per hour.
  const monthly = azMeter(rows, (r) => r.k === 'Standard' && r.m === 'Standard Base Unit' && r.u === '1/Month');
  const hourly = azMeter(rows, (r) => r.k === 'Standard' && r.m === 'Standard Base Unit' && r.u === '1/Hour');
  const base = monthly.length ? azRate(monthly) : azRate(hourly) * H;
  const ops = azMeter(rows, (r) => r.k === 'Standard' && r.m === 'Standard Messaging Operations');
  return priced([
    line('Service Bus Standard base', item.qty, 'namespace-months', must(base, 'Service Bus base')),
    tierLine('Messaging operations (first 13M included)', req, 'operations', must(azCost(ops, req), 'Service Bus operations')),
  ], { sku: 'Service Bus Standard' });
}

async function azNotifyPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Event Grid');
  const opsN = (num(item.spec, 'publishes', 0) + num(item.spec, 'http', 0)) * item.qty;
  const ops = azMeter(rows, (r) => r.m === 'Standard Operations');
  const notes = num(item.spec, 'email', 0) ? ['Event Grid does not send email; Azure Communication Services does, not priced here.'] : [];
  return priced([tierLine('Event Grid operations (first 100,000 free)', opsN, 'operations', must(azCost(ops, opsN), 'Event Grid operations'))], { sku: 'Event Grid, Basic', notes });
}

async function azMonitoringPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await reg(ctx);
  const q = item.qty;
  const la = svc(rows, 'Log Analytics');
  const mon = svc(rows, 'Azure Monitor');
  const logs = num(item.spec, 'logs', 0) * q, stored = num(item.spec, 'stored', 0) * q, alarms = num(item.spec, 'alarms', 0) * q;
  const samples = num(item.spec, 'metrics', 0) * POINTS * q;
  const ingest = azMeter(la, (r) => r.m === 'Analytics Logs Data Ingestion');
  const retain = azMeter(la, (r) => r.m === 'Analytics Logs Data Retention');
  const alert = azMeter(mon, (r) => r.m === 'Alerts Metric Monitored');
  const metric = azMeter(mon, (r) => r.m === 'Metrics ingestion Metric samples');
  return priced([
    tierLine('Custom metric samples', samples, 'samples', must(azCost(metric, samples), 'metric ingestion')),
    tierLine('Metric alert rules', alarms, 'time series-months', must(azCost(alert, alarms), 'metric alerts')),
    tierLine('Logs ingested (first 5 GB free)', logs, 'GB', must(azCost(ingest, logs), 'log ingestion')),
    line('Logs kept past 31 days', stored, 'GB-month', must(azRate(retain), 'log retention')),
  ], { sku: 'Azure Monitor + Log Analytics', notes: ['Metric samples assume one a minute per custom metric.'] });
}

async function azCdnPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = (await glob()).filter((r) => r.p === 'Azure Front Door' && r.k === 'Standard');
  const zone = geoOf(ctx, item.spec).azure;
  const gb = num(item.spec, 'gb', 0) * item.qty;
  const req = num(item.spec, 'requests', 0) * item.qty;
  const base = azMeter(rows, (r) => r.m === 'Standard Base Fees');
  return priced([
    line('Front Door Standard base fee', item.qty, 'profile-months', must(azRate(base), 'Front Door base fee')),
    tierLine(`Data out to viewers, ${zone}`, gb, 'GB', must(azCost(azMeter(rows, (r) => r.z === zone && r.m === 'Standard Data Transfer Out'), gb), 'Front Door data out')),
    tierLine(`Requests, ${zone}`, req, 'requests', must(azCost(azMeter(rows, (r) => r.z === zone && r.m === 'Standard Requests'), req), 'Front Door requests')),
  ], { sku: 'Azure Front Door Standard', notes: ['Data from an Azure origin to Front Door is billed on the origin side; not included.'] });
}

async function azBackupPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = svc(await reg(ctx), 'Backup');
  const gb = num(item.spec, 'gb', 0);
  const q = item.qty;
  const what = str(item.spec, 'what', 'vm');
  const stored = azMeter(rows, (r) => r.p === 'Backup' && r.m === 'Standard LRS Data Stored');
  const lines: Line[] = [];
  const notes = ['Backups kept in a locally redundant vault (LRS). Geo-redundant storage costs about twice as much.'];
  if (what === 'vm') {
    const fee = azureInstanceFee(gb);
    const pi = azMeter(rows, (r) => r.m === 'Azure VM Protected Instance');
    lines.push(line(`Protected instance fee (${fee.label})`, fee.count * q, 'instance-months', must(azRate(pi), 'protected instance')));
    notes.push('Azure sizes the instance fee by the disks protected; the backup size stands in for that here.');
  } else if (what === 'file') {
    lines.push(line('Protected file share fee', q, 'share-months', must(azRate(azMeter(rows, (r) => r.m === 'Azure Files Protected Instance')), 'file share instance')));
  } else {
    notes.push('Azure database services keep backups up to the database size at no charge; enter only the storage above that.');
  }
  lines.push(line('Backup storage', gb * q, 'GB-month', must(azRate(stored), 'backup storage')));
  return priced(lines, { sku: 'Azure Backup', notes });
}

/** Azure implementation of each neutral service. */
export const azureImpls: Record<string, ProviderImpl> = {
  vm: { product: 'Azure Virtual Machines', fields: azVmFields, models: azModels, price: azVmPrice, adopt: async (_c, item) => ({ ...item, spec: { ...item.spec, 'azure.size': '' }, pricing: { model: 'od' } }) },
  disk: {
    product: 'Azure Managed Disks',
    fields: async () => [
      { key: 'azure.disk', label: 'Disk type', type: 'select', options: opts(['', 'Match the disk class'], ['premium', 'Premium SSD'], ['premium-v2', 'Premium SSD v2'], ['standard-ssd', 'Standard SSD'], ['standard-hdd', 'Standard HDD']) },
      {
        key: 'azure.ops', label: 'Disk operations', type: 'number', unit: '/ month', min: 0, step: 1_000_000,
        help: 'Standard disks bill each 10,000 reads and writes. 100 IOPS all month is about 263M.',
        show: (s) => ['standard-ssd', 'standard-hdd'].includes(str(s, 'azure.disk')) || (!str(s, 'azure.disk') && String(s.type).startsWith('hdd')),
      },
    ],
    price: azDiskPrice,
  },
  object: { product: 'Azure Blob Storage', price: azObjectPrice },
  file: { product: 'Azure Files', price: azFilePrice },
  k8s: { product: 'Azure Kubernetes Service', price: azK8sPrice },
  containers: { product: 'Azure Container Instances', price: azContainersPrice },
  functions: { product: 'Azure Functions', price: azFunctionsPrice },
  db: {
    product: 'Azure Database / Azure SQL',
    fields: async (_c, spec) => (str(spec, 'engine').startsWith('sqlserver') ? [{ key: 'azure.ahb', label: 'Azure Hybrid Benefit (own SQL Server licence)', type: 'select', options: opts(['no', 'No'], ['yes', 'Yes']) }] : []),
    models: [{ model: 'od', label: 'Pay as you go' }], price: azDbPrice, adopt: async (_c, item) => ({ ...item, pricing: { model: 'od' } }) },
  cache: { product: 'Azure Cache for Redis', price: azCachePrice },
  vpc: { product: 'Azure Virtual Network', price: (ctx, item) => vpcPrice(ctx, item, 'Azure does not charge for virtual networks.') },
  lb: { product: 'Azure Load Balancer / Application Gateway', price: azLbPrice },
  nat: { product: 'Azure NAT Gateway', price: azNatPrice },
  ip: { product: 'Azure Public IP', price: azIpPrice },
  endpoint: { product: 'Azure Private Link', price: azEndpointPrice },
  egress: { product: 'Azure bandwidth', fields: async (ctx) => destField(ctx), price: azEgressPrice },
  vpn: { product: 'Azure VPN Gateway', price: azVpnPrice },
  interconnect: {
    product: 'Azure ExpressRoute',
    fields: async () => [{ key: 'azure.zone', label: 'ExpressRoute zone', type: 'select', options: opts(['', 'From the region'], ['Zone 1', 'Zone 1'], ['Zone 2', 'Zone 2'], ['Zone 3', 'Zone 3'], ['Zone 4', 'Zone 4']) }],
    price: azInterconnectPrice,
  },
  dns: { product: 'Azure DNS', price: azDnsPrice },
  ddos: { product: 'Azure DDoS Protection', price: azDdosPrice },
  waf: { product: 'Azure Web Application Firewall', price: azWafPrice },
  apigw: { product: 'Azure API Management', price: azApigwPrice },
  queue: { product: 'Azure Service Bus', price: azQueuePrice },
  notify: { product: 'Azure Event Grid', price: azNotifyPrice },
  monitoring: { product: 'Azure Monitor', price: azMonitoringPrice },
  cdn: { product: 'Azure Front Door', price: azCdnPrice },
  backup: { product: 'Azure Backup', price: azBackupPrice },
  custom: { product: 'Custom', price: customPrice },
};

