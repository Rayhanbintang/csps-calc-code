// Block disks, object storage and file storage.
import type { Item, Line, Priced } from '../types';
import { aws, gcp, oci } from '../prices';
import {
  awsCost, awsFind, awsRate, gcpCost, gcpFind, gcpRate, line, must, num, ociCost, ociPart, ociRate, opts, priced, str,
  tierLine, unavailable,
} from './util';
import type { Ctx, Service } from './util';

// =====================================================================================
// Block disk
// =====================================================================================

const diskTypes = opts(
  ['ssd', 'SSD, general purpose'],
  ['ssd-fast', 'SSD, provisioned IOPS'],
  ['hdd', 'HDD, throughput'],
  ['hdd-cold', 'HDD, cold'],
);

async function awsDisk(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await aws.rows(ctx.region, 'ec2x');
  const gb = num(item.spec, 'gb', 100) * item.qty;
  const iops = num(item.spec, 'iops', 3000);
  const mbps = num(item.spec, 'mbps', 125);
  const kind = str(item.spec, 'aws.volume') || ({ ssd: 'gp3', 'ssd-fast': 'io2', hdd: 'st1', 'hdd-cold': 'sc1' } as Record<string, string>)[str(item.spec, 'type', 'ssd')];
  const usage: Record<string, string> = { gp3: 'EBS:VolumeUsage.gp3', gp2: 'EBS:VolumeUsage.gp2', io2: 'EBS:VolumeUsage.io2', io1: 'EBS:VolumeUsage.piops', st1: 'EBS:VolumeUsage.st1', sc1: 'EBS:VolumeUsage.sc1' };
  const lines: Line[] = [line(`EBS ${kind} storage`, gb, 'GB-month', must(awsRate(awsFind(rows, usage[kind])), `EBS ${kind}`))];
  const notes: string[] = [];
  if (kind === 'gp3') {
    const extraIops = Math.max(0, iops - 3000) * item.qty;
    const extraMbps = Math.max(0, mbps - 125) * item.qty;
    if (extraIops) lines.push(line('gp3 IOPS above 3,000', extraIops, 'IOPS-month', must(awsRate(awsFind(rows, 'EBS:VolumeP-IOPS.gp3')), 'gp3 IOPS')));
    // Throughput is listed per GiBps-month; the calculator takes MB/s.
    if (extraMbps) lines.push(line('gp3 throughput above 125 MB/s', extraMbps, 'MBps-month', must(awsRate(awsFind(rows, 'EBS:VolumeP-Throughput.gp3')), 'gp3 throughput') / 1024));
    notes.push('gp3 includes 3,000 IOPS and 125 MB/s at no extra charge.');
  }
  if (kind === 'io1') lines.push(line('io1 provisioned IOPS', iops * item.qty, 'IOPS-month', must(awsRate(awsFind(rows, 'EBS:VolumeP-IOPS.piops')), 'io1 IOPS')));
  if (kind === 'io2') {
    // io2 IOPS are tiered per volume: up to 32,000, 32,001 to 64,000, above 64,000.
    const t1 = Math.min(iops, 32000), t2 = Math.max(0, Math.min(iops, 64000) - 32000), t3 = Math.max(0, iops - 64000);
    lines.push(line('io2 IOPS up to 32,000', t1 * item.qty, 'IOPS-month', must(awsRate(awsFind(rows, 'EBS:VolumeP-IOPS.io2')), 'io2 IOPS')));
    if (t2) lines.push(line('io2 IOPS 32,001 to 64,000', t2 * item.qty, 'IOPS-month', must(awsRate(awsFind(rows, 'EBS:VolumeP-IOPS.io2.tier2')), 'io2 IOPS tier 2')));
    if (t3) lines.push(line('io2 IOPS above 64,000', t3 * item.qty, 'IOPS-month', must(awsRate(awsFind(rows, 'EBS:VolumeP-IOPS.io2.tier3')), 'io2 IOPS tier 3')));
  }
  return priced(lines, { sku: `EBS ${kind}`, notes });
}

// The three free-tier US regions (us-central1, us-east1, us-west1) and some others sell
// Persistent Disk under one shared SKU whose name drops the " in <city>" ending.
const anyRegion = '( in .+)?$';

async function gcpDisk(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await gcp.region(ctx.region);
  const gb = num(item.spec, 'gb', 100) * item.qty;
  const kind = str(item.spec, 'gcp.disk') || ({ ssd: 'pd-balanced', 'ssd-fast': 'pd-ssd', hdd: 'pd-standard', 'hdd-cold': 'pd-standard' } as Record<string, string>)[str(item.spec, 'type', 'ssd')];
  const desc: Record<string, RegExp> = {
    'pd-balanced': new RegExp(`^Balanced PD Capacity${anyRegion}`),
    'pd-ssd': new RegExp(`^SSD backed PD Capacity${anyRegion}`),
    'pd-standard': new RegExp(`^Storage PD Capacity${anyRegion}`),
    'hyperdisk-balanced': /^Hyperdisk Balanced Capacity in /,
    'hyperdisk-extreme': /^Hyperdisk Extreme Capacity in /,
    'hyperdisk-throughput': /^Hyperdisk Throughput Capacity in /,
    'hyperdisk-ml': /^Hyperdisk ML Capacity in /,
  };
  if (!desc[kind]) return unavailable(`Unknown disk type ${kind}.`);
  const lines: Line[] = [line(`${kind} capacity`, gb, 'GiB-month', must(gcpRate(gcpFind(rows, desc[kind])), kind))];
  const notes: string[] = [];
  const iops = num(item.spec, 'iops', 3000) * item.qty;
  const mbps = num(item.spec, 'mbps', 140) * item.qty;
  if (kind === 'hyperdisk-balanced') {
    const xi = Math.max(0, num(item.spec, 'iops', 3000) - 3000) * item.qty;
    const xm = Math.max(0, num(item.spec, 'mbps', 140) - 140) * item.qty;
    if (xi) lines.push(line('IOPS above 3,000', xi, 'IOPS-month', must(gcpRate(gcpFind(rows, /^Hyperdisk Balanced IOPS in /)), 'Hyperdisk IOPS')));
    if (xm) lines.push(line('Throughput above 140 MB/s', xm, 'MBps-month', must(gcpRate(gcpFind(rows, /^Hyperdisk Balanced Throughput in /)), 'Hyperdisk throughput')));
    notes.push('Hyperdisk Balanced includes 3,000 IOPS and 140 MB/s.');
  }
  // Extreme bills every provisioned IOPS; Throughput and ML bill every provisioned MB/s.
  if (kind === 'hyperdisk-extreme' && iops) lines.push(line('Provisioned IOPS', iops, 'IOPS-month', must(gcpRate(gcpFind(rows, /^Hyperdisk Extreme IOPS in /)), 'Hyperdisk Extreme IOPS')));
  if (kind === 'hyperdisk-throughput' && mbps) lines.push(line('Provisioned throughput', mbps, 'MBps-month', must(gcpRate(gcpFind(rows, /^Hyperdisk Throughput Throughput in /)), 'Hyperdisk Throughput throughput')));
  if (kind === 'hyperdisk-ml' && mbps) lines.push(line('Provisioned throughput', mbps, 'MBps-month', must(gcpRate(gcpFind(rows, /^Hyperdisk ML Throughput in /)), 'Hyperdisk ML throughput')));
  return priced(lines, { sku: kind, notes });
}

async function ociDisk(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await oci.all();
  const gb = num(item.spec, 'gb', 100) * item.qty;
  const vpu = Number(str(item.spec, 'oci.vpu') || ({ ssd: '10', 'ssd-fast': '20', hdd: '0', 'hdd-cold': '0' } as Record<string, string>)[str(item.spec, 'type', 'ssd')]);
  const lines: Line[] = [line('Block Volume storage', gb, 'GB-month', must(ociRate(ociPart(rows, 'B91961')), 'block storage'))];
  if (vpu > 0) lines.push(line(`Performance, ${vpu} VPU per GB`, gb * vpu, 'VPU-GB-month', must(ociRate(ociPart(rows, 'B91962')), 'block performance units')));
  const level = vpu === 0 ? 'Lower cost' : vpu === 10 ? 'Balanced' : vpu === 20 ? 'Higher performance' : 'Ultra high performance';
  return priced(lines, { sku: `Block Volume, ${level} (${vpu} VPU)`, notes: ['OCI sets disk performance in volume performance units (VPU) per GB.'] });
}

export const disk: Service = {
  id: 'disk',
  label: 'Block disk',
  group: 'Storage',
  blurb: 'EBS · Persistent Disk · Block Volume',
  defaults: { gb: 100, type: 'ssd', iops: 3000, mbps: 125 },
  fields: [
    { key: 'gb', label: 'Size', type: 'number', unit: 'GB', min: 1, step: 10 },
    { key: 'type', label: 'Disk class', type: 'select', options: diskTypes },
    { key: 'iops', label: 'IOPS', type: 'number', min: 0, step: 100 },
    { key: 'mbps', label: 'Throughput', type: 'number', unit: 'MB/s', min: 0, step: 10 },
  ],
  providers: {
    aws: {
      product: 'Amazon EBS',
      fields: async () => [{ key: 'aws.volume', label: 'Volume type', type: 'select', options: opts(['', 'Match the disk class'], ['gp3', 'gp3'], ['gp2', 'gp2'], ['io2', 'io2'], ['io1', 'io1'], ['st1', 'st1'], ['sc1', 'sc1']) }],
      price: awsDisk,
    },
    gcp: {
      product: 'Persistent Disk',
      fields: async () => [{ key: 'gcp.disk', label: 'Disk type', type: 'select', options: opts(['', 'Match the disk class'], ['pd-balanced', 'pd-balanced'], ['pd-ssd', 'pd-ssd'], ['pd-standard', 'pd-standard'], ['hyperdisk-balanced', 'Hyperdisk Balanced'], ['hyperdisk-extreme', 'Hyperdisk Extreme'], ['hyperdisk-throughput', 'Hyperdisk Throughput'], ['hyperdisk-ml', 'Hyperdisk ML']) }],
      price: gcpDisk,
    },
    oci: {
      product: 'OCI Block Volume',
      fields: async () => [{ key: 'oci.vpu', label: 'Performance', type: 'select', options: opts(['', 'Match the disk class'], ['0', 'Lower cost (0 VPU)'], ['10', 'Balanced (10 VPU)'], ['20', 'Higher performance (20 VPU)'], ['30', 'Ultra high (30 VPU)']) }],
      price: ociDisk,
    },
  },
};

// =====================================================================================
// Object storage
// =====================================================================================

const objClasses = opts(['hot', 'Frequent access'], ['cool', 'Infrequent access'], ['cold', 'Archive, instant'], ['archive', 'Archive, hours to restore']);

async function awsObject(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await aws.rows(ctx.region, 's3');
  const gb = num(item.spec, 'gb', 1000) * item.qty;
  const cls = str(item.spec, 'class', 'hot');
  const storage: Record<string, [string, string, string]> = {
    hot: ['TimedStorage-ByteHrs', 'S3 Standard', ''],
    cool: ['TimedStorage-SIA-ByteHrs', 'S3 Standard-IA', 'SIA-'],
    cold: ['TimedStorage-GIR-ByteHrs', 'S3 Glacier Instant Retrieval', 'GIR-'],
    archive: ['TimedStorage-GDA-ByteHrs', 'S3 Glacier Deep Archive', 'GDA-'],
  };
  let [key, name, req] = storage[cls];
  let row = awsFind(rows, key);
  const notes: string[] = [];
  if (!row && cls === 'archive') {
    // Not every region sells Deep Archive; Glacier Flexible Retrieval is the next tier up.
    [key, name, req] = ['TimedStorage-GlacierByteHrs', 'S3 Glacier Flexible Retrieval', 'GLACIER-'];
    row = awsFind(rows, key);
    notes.push('Glacier Deep Archive is not sold in this region; priced as Glacier Flexible Retrieval.');
  }
  const lines: Line[] = [tierLine(`${name} storage`, gb, 'GB-month', must(awsCost(row, gb), name))];
  const puts = num(item.spec, 'puts', 0) * item.qty;
  const gets = num(item.spec, 'gets', 0) * item.qty;
  const putRow = (req === 'GLACIER-' ? awsFind(rows, 'Requests-GLACIER-Tier1', 'PutObject') : awsFind(rows, `Requests-${req}Tier1`)) ?? awsFind(rows, 'Requests-Tier1');
  const getRow = awsFind(rows, `Requests-${req}Tier2`) ?? awsFind(rows, 'Requests-Tier2');
  if (puts) lines.push(tierLine('PUT, COPY, POST, LIST requests', puts, 'requests', must(awsCost(putRow, puts), 'PUT requests')));
  if (gets) lines.push(tierLine('GET and other requests', gets, 'requests', must(awsCost(getRow, gets), 'GET requests')));
  return priced(lines, { sku: name, notes });
}

async function gcpObject(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await gcp.region(ctx.region);
  const g = await gcp.global();
  const gb = num(item.spec, 'gb', 1000) * item.qty;
  const cls = str(item.spec, 'class', 'hot');
  const name = { hot: 'Standard', cool: 'Nearline', cold: 'Coldline', archive: 'Archive' }[cls]!;
  const row = gcpFind(rows, new RegExp(`^${name} Storage [^(]*$`), 'OnDemand', 'storage');
  const lines: Line[] = [tierLine(`${name} storage`, gb, 'GiB-month', must(gcpCost(row, gb), `${name} storage`))];
  const puts = num(item.spec, 'puts', 0) * item.qty;
  const gets = num(item.spec, 'gets', 0) * item.qty;
  const all = [...rows, ...g];
  const opRow = (c: 'A' | 'B') =>
    gcpFind(all, new RegExp(`^Regional ${name} Class ${c} Operations$`), 'OnDemand', 'storage') ??
    gcpFind(all, new RegExp(`^${name} Storage Class ${c} Operations$`), 'OnDemand', 'storage') ??
    gcpFind(all, new RegExp(`^${name} Class ${c} Operations$`), 'OnDemand', 'storage');
  if (puts) lines.push(tierLine('Class A operations (writes, lists)', puts, 'operations', must(gcpCost(opRow('A'), puts), 'Class A operations')));
  if (gets) lines.push(tierLine('Class B operations (reads)', gets, 'operations', must(gcpCost(opRow('B'), gets), 'Class B operations')));
  return priced(lines, { sku: `Cloud Storage ${name}, regional` });
}

async function ociObject(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await oci.all();
  const gb = num(item.spec, 'gb', 1000) * item.qty;
  const cls = str(item.spec, 'class', 'hot');
  const [part, name] = ({ hot: ['B91628', 'Standard'], cool: ['B93000', 'Infrequent Access'], cold: ['B93000', 'Infrequent Access'], archive: ['B91633', 'Archive'] } as Record<string, [string, string]>)[cls];
  const lines: Line[] = [tierLine(`Object Storage ${name}`, gb, 'GB-month', must(ociCost(ociPart(rows, part), gb), name))];
  const reqs = (num(item.spec, 'puts', 0) + num(item.spec, 'gets', 0)) * item.qty;
  if (reqs) lines.push(tierLine('Requests', reqs, 'requests', must(ociCost(ociPart(rows, 'B91627'), reqs / 10000), 'requests')));
  const notes = cls === 'cold' ? ['OCI has no instant-retrieval archive tier; priced as Infrequent Access.'] : [];
  return priced(lines, { sku: `Object Storage ${name}`, notes });
}

export const object: Service = {
  id: 'object',
  label: 'Object storage',
  group: 'Storage',
  blurb: 'S3 · Cloud Storage · Object Storage',
  defaults: { gb: 1000, class: 'hot', puts: 1000000, gets: 10000000 },
  fields: [
    { key: 'gb', label: 'Stored data', type: 'number', unit: 'GB', min: 0, step: 100 },
    { key: 'class', label: 'Storage class', type: 'select', options: objClasses },
    { key: 'puts', label: 'Write requests', type: 'number', unit: '/ month', min: 0, step: 100000 },
    { key: 'gets', label: 'Read requests', type: 'number', unit: '/ month', min: 0, step: 100000 },
  ],
  providers: {
    aws: { product: 'Amazon S3', price: awsObject },
    gcp: { product: 'Cloud Storage', price: gcpObject },
    oci: { product: 'OCI Object Storage', price: ociObject },
  },
};

// =====================================================================================
// File storage
// =====================================================================================

async function awsFile(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await aws.rows(ctx.region, 'efs');
  const gb = num(item.spec, 'gb', 500) * item.qty;
  const ia = str(item.spec, 'tier', 'standard') === 'infrequent';
  const key = ia ? 'IATimedStorage-ByteHrs' : 'TimedStorage-ByteHrs';
  return priced([line(`EFS ${ia ? 'Infrequent Access' : 'Standard'} storage`, gb, 'GB-month', must(awsRate(awsFind(rows, key)), 'EFS storage'))], {
    sku: 'Amazon EFS, Regional', notes: ['Elastic throughput reads and writes are billed per GB moved; not included.'],
  });
}

async function gcpFile(ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await gcp.region(ctx.region);
  const gb = Math.max(num(item.spec, 'gb', 1024), 0) * item.qty;
  const tier = str(item.spec, 'gcp.filestore') || (str(item.spec, 'tier', 'standard') === 'performance' ? 'basic-ssd' : 'basic-hdd');
  const notes = ['Filestore bills the capacity provisioned, not the data stored.'];
  if (tier === 'basic-hdd' || tier === 'basic-ssd') {
    const ssd = tier === 'basic-ssd';
    const re = ssd ? /^Filestore Capacity Basic SSD \(Premium\) / : /^Filestore Capacity Basic HDD \(Standard\) /;
    notes.push('Filestore Basic has a 1 TiB minimum per instance (2.5 TiB for SSD).');
    return priced([line(`Filestore ${ssd ? 'Basic SSD' : 'Basic HDD'} capacity`, gb, 'GiB-month', must(gcpRate(gcpFind(rows, re)), 'Filestore capacity'))], { sku: `Filestore ${ssd ? 'Basic SSD' : 'Basic HDD'}`, notes });
  }
  if (tier !== 'zonal' && tier !== 'regional') return unavailable(`Unknown Filestore tier ${tier}.`);
  const Z = tier === 'zonal' ? 'Zonal' : 'Regional';
  const iops = num(item.spec, 'gcp.iops', 0);
  notes.push(`Filestore ${Z} has a 1 TiB minimum per instance.`);
  if (!iops) {
    // Without custom performance the GiB price includes the default IOPS.
    const re = tier === 'zonal' ? /^Filestore Capacity Zonal and High Scale / : /^Filestore Capacity Regional and Enterprise /;
    return priced([line(`Filestore ${Z} capacity`, gb, 'GiB-month', must(gcpRate(gcpFind(rows, re)), `Filestore ${Z} capacity`))], { sku: `Filestore ${Z}`, notes });
  }
  // Custom performance: an instance fee, a lower GiB price and each provisioned IOPS.
  return priced([
    line(`Filestore ${Z} instance`, item.qty, 'instance-months', must(gcpRate(gcpFind(rows, new RegExp(`^Filestore Instance Count ${Z} `))), `Filestore ${Z} instance`)),
    line(`Filestore ${Z} capacity`, gb, 'GiB-month', must(gcpRate(gcpFind(rows, new RegExp(`^Filestore Instance Capacity ${Z} `))), `Filestore ${Z} capacity`)),
    line('Provisioned IOPS', iops * item.qty, 'IOPS-month', must(gcpRate(gcpFind(rows, new RegExp(`^Filestore Instance IOPS ${Z} `))), `Filestore ${Z} IOPS`)),
  ], { sku: `Filestore ${Z}, custom performance`, notes });
}

async function ociFile(_ctx: Ctx, item: Item): Promise<Priced> {
  const rows = await oci.all();
  const gb = num(item.spec, 'gb', 500) * item.qty;
  return priced([line('File Storage', gb, 'GB-month', must(ociRate(ociPart(rows, 'B89057')), 'File Storage'))], { sku: 'OCI File Storage' });
}

export const file: Service = {
  id: 'file',
  label: 'File storage (NFS)',
  group: 'Storage',
  blurb: 'EFS · Filestore · File Storage',
  defaults: { gb: 500, tier: 'standard' },
  fields: [
    { key: 'gb', label: 'Stored data', type: 'number', unit: 'GB', min: 0, step: 100 },
    { key: 'tier', label: 'Tier', type: 'select', options: opts(['standard', 'Standard'], ['performance', 'High performance (SSD)'], ['infrequent', 'Infrequent access']) },
  ],
  providers: {
    aws: { product: 'Amazon EFS', price: awsFile },
    gcp: {
      product: 'Filestore',
      fields: async (_ctx, spec) => [
        { key: 'gcp.filestore', label: 'Filestore tier', type: 'select', options: opts(['', 'Match the tier'], ['basic-hdd', 'Basic HDD'], ['basic-ssd', 'Basic SSD'], ['zonal', 'Zonal'], ['regional', 'Regional']) },
        ...(['zonal', 'regional'].includes(String(spec['gcp.filestore'] ?? ''))
          ? [{ key: 'gcp.iops', label: 'Custom performance IOPS', type: 'number' as const, min: 0, step: 1000, help: '0 = default performance, priced per GiB.' }]
          : []),
      ],
      price: gcpFile,
    },
    oci: { product: 'OCI File Storage', price: ociFile },
  },
};

export { unavailable };
