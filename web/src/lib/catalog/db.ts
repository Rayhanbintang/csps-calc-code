// Managed relational databases and managed Redis.
import type { Item, Line, Priced, Spec } from '../types';
import { aws, gcp, oci } from '../prices';
import type { AwsRow } from '../prices';
import { awsCommitted, ociSqlParts, ociShapes, ocpus } from './vm';
import {
  H, awsFind, awsRate, gcpFind, gcpRate, line, must, num, ociPart, ociRate, opts, priced, str, unavailable,
} from './util';
import { zonesField } from '../zones';
import type { Ctx, Field, Service } from './util';

const engines = opts(
  ['mysql', 'MySQL'],
  ['postgres', 'PostgreSQL'],
  ['mariadb', 'MariaDB'],
  ['sqlserver-std', 'SQL Server Standard'],
  ['sqlserver-ent', 'SQL Server Enterprise'],
  ['sqlserver-web', 'SQL Server Web'],
  ['oracle-se2', 'Oracle Standard Edition 2'],
  ['aurora-mysql', 'Aurora MySQL (AWS only)'],
  ['aurora-postgres', 'Aurora PostgreSQL (AWS only)'],
);

function ha(spec: Spec): boolean {
  return str(spec, 'ha', 'single') === 'multi';
}

// =====================================================================================
// Amazon RDS / Aurora
// =====================================================================================

const rdsEngine: Record<string, [string, string | undefined, string]> = {
  mysql: ['MySQL', undefined, 'No license required'],
  postgres: ['PostgreSQL', undefined, 'No license required'],
  mariadb: ['MariaDB', undefined, 'No license required'],
  'sqlserver-std': ['SQL Server', 'Standard', 'License included'],
  'sqlserver-ent': ['SQL Server', 'Enterprise', 'License included'],
  'sqlserver-web': ['SQL Server', 'Web', 'License included'],
  'oracle-se2': ['Oracle', 'Standard Two', 'License included'],
  'aurora-mysql': ['Aurora MySQL', undefined, 'No license required'],
  'aurora-postgres': ['Aurora PostgreSQL', undefined, 'No license required'],
};

/** Instance classes sorted by family, then vCPU and memory. */
function sortTypes(rows: AwsRow[]): string[] {
  const seen = new Map<string, AwsRow>();
  for (const r of rows) if (!seen.has(r.a!.instanceType)) seen.set(r.a!.instanceType, r);
  const fam = (t: string) => t.split('.').slice(0, 2).join('.');
  return [...seen.values()]
    .sort((a, b) => fam(a.a!.instanceType).localeCompare(fam(b.a!.instanceType), 'en', { numeric: true }) || Number(a.a!.vcpu) - Number(b.a!.vcpu) || gib(a.a!.memory) - gib(b.a!.memory))
    .map((r) => r.a!.instanceType);
}

function gib(s: string | undefined): number {
  return parseFloat(String(s ?? '').replace(/,/g, '')) || 0;
}

/** RDS Custom (the SA gets OS access) is sold for SQL Server and Oracle. */
function custom(spec: Spec): boolean {
  const e = str(spec, 'engine', 'mysql');
  return str(spec, 'aws.deploy') === 'custom' && (e.startsWith('sqlserver') || e.startsWith('oracle'));
}

function ioOptimized(spec: Spec): boolean {
  return str(spec, 'aws.aurora') === 'io';
}

function rdsInstances(rows: AwsRow[], spec: Spec): AwsRow[] {
  const [eng, edition, lic0] = rdsEngine[str(spec, 'engine', 'mysql')];
  const aurora = eng.startsWith('Aurora');
  const want = aurora || !ha(spec) ? 'Single-AZ' : 'Multi-AZ';
  const isCustom = custom(spec);
  // RDS Custom for Oracle is bring-your-own-licence only.
  const lic = isCustom && eng === 'Oracle' ? 'Bring your own license' : lic0;
  return rows.filter(
    (r) =>
      r.f === 'Database Instance' &&
      r.a?.databaseEngine === eng &&
      (edition === undefined || r.a?.databaseEdition === edition) &&
      // RDS Custom for SQL Server rows carry no licence model; the licence is included.
      (isCustom && eng === 'SQL Server' ? true : r.a?.licenseModel === lic) &&
      r.a?.deploymentOption === want &&
      (r.a?.deploymentModel === 'Custom') === isCustom &&
      r.k.startsWith('InstanceUsageIOOptimized') === (aurora && ioOptimized(spec)),
  );
}

async function rdsFields(ctx: Ctx, spec: Spec): Promise<Field[]> {
  const rows = rdsInstances(await aws.rows(ctx.region, 'rds'), spec);
  const types = sortTypes(rows);
  const engine = str(spec, 'engine', 'mysql');
  const extra: Field[] = [];
  if (engine.startsWith('aurora')) {
    extra.push(
      { key: 'aws.aurora', label: 'Aurora storage', type: 'select', options: opts(['standard', 'Standard (pay per I/O)'], ['io', 'I/O-Optimized (no I/O charge)']) },
      { key: 'readers', label: 'Reader instances', type: 'number', min: 0, step: 1, help: 'Replicas next to the writer. High availability needs at least one.' },
    );
    if (!ioOptimized(spec)) extra.push({ key: 'ios', label: 'I/O requests', type: 'number', unit: 'million / month', min: 0, step: 10 });
  }
  if (engine.startsWith('sqlserver') || engine.startsWith('oracle'))
    extra.push({ key: 'aws.deploy', label: 'Deployment', type: 'select', options: opts(['standard', 'RDS (managed)'], ['custom', 'RDS Custom (OS access)']) });
  return [...extra, {
    key: 'aws.class', label: 'DB instance class', type: 'select',
    options: [{ value: '', label: 'Pick the closest match for me' }, ...types.map((t) => {
      const r = rows.find((x) => x.a!.instanceType === t)!;
      return { value: t, label: `${t} · ${r.a!.vcpu} vCPU · ${r.a!.memory}` };
    })],
  }];
}

/** Aurora readers: the field when set, else one with high availability. */
function readers(spec: Spec): number {
  if (spec.readers !== undefined && spec.readers !== '') return Math.max(0, Math.round(num(spec, 'readers', 0)));
  return ha(spec) ? 1 : 0;
}

async function rdsPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const all = await aws.rows(ctx.region, 'rds');
  const engineKey = str(item.spec, 'engine', 'mysql');
  const [eng] = rdsEngine[engineKey];
  const aurora = eng.startsWith('Aurora');
  const rows = rdsInstances(all, item.spec);
  if (!rows.length) return unavailable(`${engines.find((e) => e.value === engineKey)?.label} is not sold in ${ctx.info?.name ?? ctx.region}.`);
  const chosen = str(item.spec, 'aws.class');
  const vcpu = num(item.spec, 'vcpu', 2), mem = num(item.spec, 'mem', 8);
  let row: AwsRow | undefined;
  if (chosen) row = rows.find((r) => r.a!.instanceType === chosen);
  else {
    const fits = rows.filter((r) => /^db\.(m|r)[5-8]/.test(r.a!.instanceType) && Number(r.a!.vcpu) >= vcpu && gib(r.a!.memory) >= mem);
    fits.sort((a, b) => awsRate(a) - awsRate(b));
    row = fits[0];
  }
  if (!row) return unavailable(chosen ? `${chosen} is not sold for this engine here.` : 'No DB instance class fits the vCPU and memory asked for.');

  const t = row.a!.instanceType;
  const rd = aurora ? readers(item.spec) : 0;
  const nodes = 1 + rd;
  const instItem = { ...item, qty: item.qty * nodes };
  const label = aurora
    ? `${t} ${eng}${ioOptimized(item.spec) ? ' I/O-Optimized' : ''}${rd ? ` (writer + ${rd} reader${rd > 1 ? 's' : ''})` : ''}`
    : `${t} ${eng}${custom(item.spec) ? ' Custom' : ''}${ha(item.spec) ? ' Multi-AZ' : ''}`;
  const c = awsCommitted(instItem, label, awsRate(row), Math.min(H, num(item.spec, 'hours', H)), row.ri, undefined);
  const lines: Line[] = [...c.lines];
  const notes: string[] = c.note ? [c.note] : [];

  const gb = num(item.spec, 'gb', 100) * item.qty;
  if (gb > 0) {
    if (aurora) {
      // Some regions list Aurora storage per engine, others under "Any".
      const key = ioOptimized(item.spec) ? 'Aurora:IO-OptimizedStorageUsage' : 'Aurora:StorageUsage';
      const s = all.find((x) => x.k === key && x.a?.databaseEngine === eng) ?? all.find((x) => x.k === key && x.a?.databaseEngine === 'Any');
      lines.push(line(`Aurora storage${ioOptimized(item.spec) ? ', I/O-Optimized' : ''}`, gb, 'GB-month', must(awsRate(s), 'Aurora storage')));
    } else {
      const multi = ha(item.spec);
      const keys = engineKey.startsWith('sqlserver') && multi
        ? ['RDS:Mirror-GP3-Storage', 'RDS:Multi-AZ-GP3-Storage']
        : [multi ? 'RDS:Multi-AZ-GP3-Storage' : 'RDS:GP3-Storage'];
      let s: AwsRow | undefined;
      for (const k of keys) s ??= all.find((r) => r.k === k && r.a?.databaseEngine === 'Any') ?? all.find((r) => r.k === k);
      lines.push(line(`gp3 storage${multi ? ', Multi-AZ' : ''}`, gb, 'GB-month', must(awsRate(s), 'RDS storage')));
    }
  }
  if (aurora && !ioOptimized(item.spec)) {
    const ios = num(item.spec, 'ios', 0) * 1e6 * item.qty;
    if (ios) {
      const io = all.find((x) => x.k === 'Aurora:StorageIOUsage' && x.a?.databaseEngine === eng) ?? all.find((x) => x.k === 'Aurora:StorageIOUsage');
      lines.push(line('Aurora I/O requests', ios, 'requests', must(awsRate(io), 'Aurora I/O')));
    }
  }
  if (custom(item.spec)) notes.push(eng === 'Oracle' ? 'RDS Custom for Oracle needs your own Oracle licence.' : 'RDS Custom gives access to the operating system; the SQL Server licence is included.');
  return priced(lines, { upfront: c.upfront, sku: `${t} · ${row.a!.vcpu} vCPU · ${row.a!.memory}`, notes });
}

// =====================================================================================
// Cloud SQL
// =====================================================================================

async function cloudSqlPrice(ctx: Ctx, item: Item): Promise<Priced> {
  const engine = str(item.spec, 'engine', 'mysql');
  const name = engine === 'postgres' ? 'PostgreSQL' : engine.startsWith('sqlserver') ? 'SQL Server' : engine === 'mysql' || engine === 'mariadb' ? 'MySQL' : '';
  if (!name) return unavailable('Cloud SQL runs MySQL, PostgreSQL and SQL Server.');
  const rows = await gcp.region(ctx.region);
  const multi = ha(item.spec);
  const zone = multi ? 'Regional' : 'Zonal';
  const cpu = gcpFind(rows, new RegExp(`^Cloud SQL for ${name}: ${zone} - vCPU in `), 'OnDemand', 'sql');
  const ram = gcpFind(rows, new RegExp(`^Cloud SQL for ${name}: ${zone} - RAM in `), 'OnDemand', 'sql');
  const disk = gcpFind(rows, new RegExp(`^Cloud SQL for ${name}: ${zone} - Standard storage in `), 'OnDemand', 'sql');
  const vcpu = num(item.spec, 'vcpu', 2), mem = num(item.spec, 'mem', 8);
  const q = item.qty;
  const hrs = Math.min(H, num(item.spec, 'hours', H));
  const p = item.pricing ?? { model: 'od' };
  // Cloud SQL committed use is a dollar-based commitment: each $0.01 an hour of on-demand
  // vCPU and memory costs the SKU price, so the price × 100 is the share left to pay
  // ($0.0075 → 75% for one year, $0.0048 → 48% for three).
  let cud = 1;
  if (p.model === 'cud') {
    const years = p.term === 3 ? '3 years' : '1 year';
    const sku = gcpFind(rows, new RegExp(`^Commitment - dollar based v1: Cloud SQL database .+ for ${years}$`), 'OnDemand', 'sql');
    cud = must(gcpRate(sku), 'Cloud SQL commitment') * 100;
  }
  const billHrs = p.model === 'cud' ? H : hrs;
  const tag = p.model === 'cud' ? `, ${p.term ?? 1}-year commitment` : '';
  const lines: Line[] = [
    line(`${name} vCPU${multi ? ' (HA)' : ''}${tag}`, vcpu * billHrs * q, 'vCPU-hours', must(gcpRate(cpu), 'Cloud SQL vCPU') * cud),
    line(`${name} memory${multi ? ' (HA)' : ''}${tag}`, mem * billHrs * q, 'GiB-hours', must(gcpRate(ram), 'Cloud SQL memory') * cud),
  ];
  const gb = num(item.spec, 'gb', 100) * q;
  if (gb > 0) lines.push(line(`SSD storage${multi ? ' (HA)' : ''}`, gb, 'GiB-month', must(gcpRate(disk), 'Cloud SQL storage')));
  const notes = p.model === 'cud' ? [`Committed use: ${Math.round((1 - cud) * 100)}% off vCPU and memory, from Google's commitment SKU.`] : [];
  if (engine === 'mariadb') notes.push('Cloud SQL has no MariaDB; priced as MySQL.');
  if (engine.startsWith('sqlserver')) {
    const ed = { 'sqlserver-std': 'Standard', 'sqlserver-ent': 'Enterprise', 'sqlserver-web': 'Web' }[engine]!;
    const g = await gcp.global();
    const small = vcpu <= 4;
    const lic = g.find((r) => r.u === 'OnDemand' && new RegExp(`^Licensing Fee for SQL Server 2022 ${ed} for Cloud SQL on VM with ${small ? 'up to 4' : 'more than 4'} VCPU$`).test(r.d));
    const rate = must(gcpRate(lic), `SQL Server ${ed} licence`);
    lines.push(small ? line(`SQL Server ${ed} licence (4-core minimum)`, hrs * q, 'instance-hours', rate) : line(`SQL Server ${ed} licence`, vcpu * hrs * q, 'vCPU-hours', rate));
  }
  return priced(lines, { sku: `Cloud SQL for ${name}, Enterprise edition · ${vcpu} vCPU · ${mem} GiB`, notes });
}

// =====================================================================================
// OCI: MySQL HeatWave and Database with PostgreSQL
// =====================================================================================

async function ociDbPrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const engine = str(item.spec, 'engine', 'mysql');
  const rows = await oci.all();
  const vcpu = num(item.spec, 'vcpu', 2);
  const q = item.qty;
  const hrs = Math.min(H, num(item.spec, 'hours', H));
  const gb = num(item.spec, 'gb', 100) * q;
  const multi = ha(item.spec);
  if (engine === 'mysql' || engine === 'mariadb') {
    // HeatWave MySQL bills per ECPU; a high-availability system runs three instances.
    const nodes = multi ? 3 : 1;
    const lines: Line[] = [
      line(`MySQL HeatWave, ${vcpu} ECPU${multi ? ' × 3 (HA)' : ''}`, vcpu * nodes * hrs * q, 'ECPU-hours', must(ociRate(ociPart(rows, 'B108030')), 'MySQL ECPU')),
    ];
    if (gb) lines.push(line(`Storage${multi ? ' × 3 (HA)' : ''}`, gb * nodes, 'GB-month', must(ociRate(ociPart(rows, 'B92426')), 'MySQL storage')));
    const notes = engine === 'mariadb' ? ['OCI has no managed MariaDB; priced as MySQL HeatWave.'] : [];
    notes.push('Memory comes with the ECPU shape.');
    return priced(lines, { sku: `MySQL HeatWave · ${vcpu} ECPU`, notes });
  }
  if (engine === 'postgres') {
    const ocpu = Math.max(1, Math.ceil(vcpu / 2));
    const nodes = multi ? 2 : 1;
    const lines: Line[] = [
      line(`PostgreSQL, ${ocpu} OCPU${multi ? ' × 2 (HA)' : ''}`, ocpu * nodes * hrs * q, 'OCPU-hours', must(ociRate(ociPart(rows, 'B99060')), 'PostgreSQL OCPU')),
    ];
    if (gb) lines.push(line('Database optimized storage', gb, 'GB-month', must(ociRate(ociPart(rows, 'B99062')), 'PostgreSQL storage')));
    return priced(lines, { sku: `OCI Database with PostgreSQL · ${ocpu} OCPU`, notes: ['Storage is shared by all nodes of a database system.'] });
  }
  if (engine.startsWith('oracle')) {
    // Base Database Service bills compute infrastructure and the database edition per
    // ECPU each, plus block storage. A standby for high availability doubles all three.
    const ed = str(item.spec, 'oci.oracle', 'se');
    const parts: Record<string, [string, string]> = {
      se: ['B112725', 'Standard Edition'], ee: ['B112726', 'Enterprise Edition'], hp: ['B112727', 'Enterprise Edition High Performance'], byol: ['B112728', 'bring your own licence'],
    };
    const [part, name] = parts[ed] ?? parts.se;
    const ecpu = Math.max(1, Math.ceil(vcpu));
    const nodes = multi ? 2 : 1;
    const lines: Line[] = [
      line(`Compute infrastructure, ${ecpu} ECPU${multi ? ' × 2 (Data Guard)' : ''}`, ecpu * nodes * hrs * q, 'ECPU-hours', must(ociRate(ociPart(rows, 'B112724')), 'Base Database infrastructure')),
      line(`Oracle Database, ${name}`, ecpu * nodes * hrs * q, 'ECPU-hours', must(ociRate(ociPart(rows, part)), 'Base Database edition')),
    ];
    if (gb) lines.push(line(`Database storage${multi ? ' × 2' : ''}`, gb * nodes, 'GB-month', must(ociRate(ociPart(rows, 'B111584')), 'Base Database storage')));
    return priced(lines, { sku: `Base Database Service · ${ecpu} ECPU · ${name}`, notes: multi ? ['High availability is priced as a Data Guard standby of the same size.'] : [] });
  }
  if (engine.startsWith('sqlserver')) {
    // OCI has no managed SQL Server: it runs on a VM from a marketplace image that carries
    // the SQL Server and Windows licences.
    const sw = { 'sqlserver-std': 'sql-std', 'sqlserver-ent': 'sql-ent' }[engine];
    if (!sw) return unavailable('OCI sells SQL Server Standard and Enterprise images; there is no Web edition.');
    const [licPart, ed] = ociSqlParts[sw];
    const shape = ociShapes['VM.Standard.E5.Flex'];
    const o = ocpus(shape, vcpu);
    const mem = num(item.spec, 'mem', 8);
    const nodes = multi ? 2 : 1;
    const oh = o * nodes * hrs * q;
    const lines: Line[] = [
      line(`${shape.name}, ${o} OCPU${multi ? ' × 2' : ''}`, oh, 'OCPU-hours', must(ociRate(ociPart(rows, shape.ocpu)), 'OCPU')),
      line(`${shape.name} memory, ${mem} GB`, mem * nodes * hrs * q, 'GB-hours', must(ociRate(ociPart(rows, shape.mem)), 'memory')),
      line('Windows Server licence', oh, 'OCPU-hours', must(ociRate(ociPart(rows, 'B88318')), 'Windows licence')),
      line(`SQL Server ${ed} licence`, oh, 'OCPU-hours', must(ociRate(ociPart(rows, licPart)), `SQL Server ${ed} licence`)),
    ];
    if (gb) lines.push(line(`Block Volume${multi ? ' × 2' : ''}`, gb * nodes, 'GB-month', must(ociRate(ociPart(rows, 'B91961')), 'block storage')));
    const notes = ['OCI has no managed SQL Server; this is a VM from a SQL Server marketplace image.'];
    if (multi) notes.push('High availability is priced as two VMs (Always On); the second needs its own licence.');
    return priced(lines, { sku: `SQL Server ${ed} on ${shape.name} · ${o} OCPU`, notes });
  }
  return unavailable('OCI has no managed database for this engine here.');
}

export const db: Service = {
  id: 'db',
  label: 'Managed database',
  group: 'Database',
  blurb: 'RDS / Aurora · Cloud SQL · MySQL HeatWave, PostgreSQL',
  defaults: { engine: 'mysql', vcpu: 2, mem: 8, ha: 'single', gb: 100, hours: H },
  fields: [
    { key: 'engine', label: 'Engine', type: 'select', options: engines },
    { key: 'vcpu', label: 'vCPU', type: 'number', min: 1, step: 1 },
    { key: 'mem', label: 'Memory', type: 'number', unit: 'GiB', min: 1, step: 1 },
    { key: 'ha', label: 'Availability', type: 'select', options: opts(['single', 'Single zone'], ['multi', 'High availability (multi-zone)']) },
    { key: 'gb', label: 'Storage', type: 'number', unit: 'GB', min: 0, step: 10 },
    { key: 'hours', label: 'Running hours', type: 'number', unit: 'h / month', min: 0, step: 1 },
  ],
  providers: {
    aws: {
      product: 'Amazon RDS',
      fields: rdsFields,
      models: [{ model: 'od', label: 'On-demand' }, { model: 'ri', label: 'Reserved Instance', terms: [1, 3], pays: ['no', 'partial', 'all'] }],
      price: rdsPrice,
      adopt: async (_c, item) => ({ ...item, spec: { ...item.spec, 'aws.class': '' }, pricing: { model: 'od' } }),
    },
    gcp: {
      product: 'Cloud SQL',
      models: [{ model: 'od', label: 'On-demand' }, { model: 'cud', label: 'Committed use', terms: [1, 3] }],
      price: cloudSqlPrice,
      adopt: async (_c, item) => ({ ...item, pricing: { model: 'od' }, check: item.spec.engine?.toString().startsWith('aurora') ? 'Aurora has no Google Cloud equivalent; pick an engine.' : undefined }),
    },
    oci: {
      product: 'OCI Database',
      fields: async (_c, spec) => (str(spec, 'engine').startsWith('oracle')
        ? [{ key: 'oci.oracle', label: 'Oracle edition', type: 'select', options: opts(['se', 'Standard Edition'], ['ee', 'Enterprise Edition'], ['hp', 'Enterprise Edition High Performance'], ['byol', 'Bring your own licence']) }]
        : []),
      models: [{ model: 'od', label: 'Pay as you go' }],
      price: ociDbPrice,
      adopt: async (_c, item) => ({ ...item, pricing: { model: 'od' } }),
    },
  },
};

// =====================================================================================
// Managed Redis
// =====================================================================================

async function elasticachePrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await aws.rows(ctx.region, 'elasticache');
  const engine = str(item.spec, 'engine', 'valkey') === 'redis' ? 'Redis' : 'Valkey';
  const nodesRows = rows.filter((r) => r.f === 'Cache Instance' && r.a?.cacheEngine === engine);
  const chosen = str(item.spec, 'aws.node');
  const gbWanted = num(item.spec, 'gb', 6);
  let row = chosen ? nodesRows.find((r) => r.a!.instanceType === chosen) : undefined;
  if (!row && !chosen) {
    const fits = nodesRows.filter((r) => /^cache\.(m|r)[5-8]/.test(r.a!.instanceType) && gib(r.a!.memory) >= gbWanted);
    fits.sort((a, b) => awsRate(a) - awsRate(b));
    row = fits[0];
  }
  if (!row) return unavailable('No cache node type fits the memory asked for.');
  const nodes = Math.max(1, num(item.spec, 'nodes', 2));
  const c = awsCommitted({ ...item, qty: item.qty * nodes }, `${row.a!.instanceType} ${engine} node`, awsRate(row), H, row.ri, undefined);
  return priced(c.lines, { upfront: c.upfront, sku: `${row.a!.instanceType} · ${row.a!.memory} · ${nodes} nodes`, notes: c.note ? [c.note] : [] });
}

async function memorystorePrice(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await gcp.region(ctx.region);
  const gb = Math.max(1, num(item.spec, 'gb', 6));
  const standard = num(item.spec, 'nodes', 2) > 1;
  const band = gb <= 4 ? 'M1' : gb <= 10 ? 'M2' : gb <= 35 ? 'M3' : gb <= 100 ? 'M4' : 'M5';
  const tier = standard ? 'Standard' : 'Basic';
  const r = gcpFind(rows, new RegExp(`^Redis Capacity ${tier} ${band} `), 'OnDemand', 'redis');
  return priced([line(`Memorystore for Redis ${tier}, ${band} capacity`, gb * H * item.qty, 'GiB-hours', must(gcpRate(r), 'Memorystore capacity'))], {
    sku: `Memorystore for Redis ${tier} · ${gb} GB`,
    notes: [standard ? 'Standard tier includes a replica for high availability.' : 'Basic tier has no replica.'],
  });
}

async function ociCachePrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await oci.all();
  const gb = Math.max(1, num(item.spec, 'gb', 6));
  const nodes = Math.max(1, num(item.spec, 'nodes', 2));
  const part = gb <= 10 ? 'B98217' : 'B99591';
  return priced([line(`OCI Cache, ${gb} GB per node × ${nodes}`, gb * nodes * H * item.qty, 'GB-hours', must(ociRate(ociPart(rows, part)), 'OCI Cache memory'))], {
    sku: `OCI Cache · ${gb} GB × ${nodes} nodes`,
  });
}

export const cache: Service = {
  id: 'cache',
  label: 'Managed Redis / Valkey',
  group: 'Database',
  blurb: 'ElastiCache · Memorystore · OCI Cache',
  defaults: { engine: 'valkey', gb: 6, nodes: 2 },
  fields: [
    { key: 'engine', label: 'Engine', type: 'select', options: opts(['valkey', 'Valkey'], ['redis', 'Redis OSS']) },
    { key: 'gb', label: 'Memory per node', type: 'number', unit: 'GB', min: 1, step: 1 },
    { key: 'nodes', label: 'Nodes (primary + replicas)', type: 'number', min: 1, step: 1 },
    zonesField,
  ],
  providers: {
    aws: {
      product: 'Amazon ElastiCache',
      fields: async (ctx, spec) => {
        const rows = (await aws.rows(ctx.region, 'elasticache')).filter((r) => r.f === 'Cache Instance' && r.a?.cacheEngine === (str(spec, 'engine', 'valkey') === 'redis' ? 'Redis' : 'Valkey'));
        const types = sortTypes(rows);
        return [{ key: 'aws.node', label: 'Node type', type: 'select', options: [{ value: '', label: 'Pick the closest match for me' }, ...types.map((t) => ({ value: t, label: `${t} · ${rows.find((r) => r.a!.instanceType === t)!.a!.memory}` }))] }];
      },
      models: [{ model: 'od', label: 'On-demand' }, { model: 'ri', label: 'Reserved node', terms: [1, 3], pays: ['no', 'partial', 'all'] }],
      price: elasticachePrice,
      adopt: async (_c, item) => ({ ...item, spec: { ...item.spec, 'aws.node': '' }, pricing: { model: 'od' } }),
    },
    gcp: { product: 'Memorystore for Redis', price: memorystorePrice, adopt: async (_c, item) => ({ ...item, pricing: { model: 'od' } }) },
    oci: { product: 'OCI Cache', price: ociCachePrice, adopt: async (_c, item) => ({ ...item, pricing: { model: 'od' } }) },
  },
};
