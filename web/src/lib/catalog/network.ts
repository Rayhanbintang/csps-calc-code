// VPC, load balancers, NAT, public IPs, private endpoints, data transfer, VPN, private
// interconnect, DNS.
import type { Item, Line, Priced } from '../types';
import { aws, gcp, oci } from '../prices';
import type { GcpRow, OciRow } from '../prices';
import {
  H, awsCost, awsFind, awsRate, continent, escapeRe, gcpCost, gcpFind, gcpRate, line, must, num, ociCost, ociPart, ociRate,
  opts, priced, str, tierLine, unavailable,
} from './util';
import type { Ctx, Field, Service } from './util';

const free = (product: string, sku: string, note: string): Priced => priced([line(sku, 1, 'each', 0)], { sku, notes: [note] });

// =====================================================================================
// VPC (network + internet gateway)
// =====================================================================================

export const vpc: Service = {
  id: 'vpc',
  label: 'VPC',
  group: 'Networking',
  blurb: 'VPC · VPC network · VCN, with NAT, endpoints and public IPs. Holds clusters, VMs, load balancers',
  defaults: { nat: 1, natGb: 500, natVms: 10, endpoints: 0, endpointZones: 2, endpointGb: 100, ips: 0, ipState: 'used' },
  fields: [
    { key: 'nat', label: 'NAT gateways', type: 'number', min: 0, step: 1, help: 'AWS bills one gateway per zone; use 2 or 3 for multi-zone.' },
    { key: 'natGb', label: 'Data through NAT, all gateways', type: 'number', unit: 'GB / month', min: 0, step: 100, show: (s) => Number(s.nat) > 0 },
    { key: 'natVms', label: 'VMs using Cloud NAT (Google)', type: 'number', min: 1, step: 1, show: (s) => Number(s.nat) > 0 },
    { key: 'endpoints', label: 'Interface endpoints (PrivateLink / PSC)', type: 'number', min: 0, step: 1 },
    { key: 'endpointZones', label: 'Zones per endpoint (AWS)', type: 'number', min: 1, step: 1, show: (s) => Number(s.endpoints) > 0 },
    { key: 'endpointGb', label: 'Data through endpoints, all of them', type: 'number', unit: 'GB / month', min: 0, step: 10, show: (s) => Number(s.endpoints) > 0 },
    { key: 'ips', label: 'Public IPv4 addresses', type: 'number', min: 0, step: 1 },
    { key: 'ipState', label: 'IP state', type: 'select', options: opts(['used', 'Attached to a running resource'], ['idle', 'Reserved, not attached']), show: (s) => Number(s.ips) > 0 },
  ],
  providers: {
    aws: { product: 'Amazon VPC', price: (ctx, item) => vpcPrice(ctx, item, 'The VPC, subnets, route tables and internet gateway have no charge.') },
    gcp: { product: 'VPC network', price: (ctx, item) => vpcPrice(ctx, item, 'The VPC network, subnets and routes have no charge.') },
    oci: { product: 'OCI VCN', price: (ctx, item) => vpcPrice(ctx, item, 'The VCN and its internet, NAT and service gateways have no charge on OCI.') },
  },
};

/** Prices the parts of a VPC that cost money by reusing the NAT, endpoint and IP pricers. */
export async function vpcPrice(ctx: Ctx, item: Item, freeNote: string): Promise<Priced> {
  const s = item.spec;
  // Data fields on the VPC card are totals for the VPC. The NAT and endpoint pricers bill
  // data per gateway / endpoint, so the total is split across them.
  const natN = num(s, 'nat', 0), epN = num(s, 'endpoints', 0);
  const parts: [Service, number, Record<string, string | number | boolean>][] = [
    [nat, natN, { gb: natN ? num(s, 'natGb', 0) / natN : 0, vms: num(s, 'natVms', 10) }],
    [endpoint, epN, { zones: num(s, 'endpointZones', 2), gb: epN ? num(s, 'endpointGb', 0) / epN : 0 }],
    [ip, num(s, 'ips', 0), { state: str(s, 'ipState', 'used') }],
  ];
  const lines: Line[] = [];
  const notes: string[] = [freeNote];
  for (const [svc, count, spec] of parts) {
    if (count <= 0) continue;
    const impl = svc.providers[ctx.provider];
    if (!impl) continue;
    const p = await impl.price(ctx, { ...item, svc: svc.id, qty: count * item.qty, spec, children: undefined, pricing: { model: 'od' } });
    if (p.unavailable) throw new Error(p.unavailable);
    for (const l of p.lines) if (l.monthly > 0 || l.rate > 0) lines.push({ ...l, label: `${svc.label}: ${l.label}` });
    for (const n of p.notes) if (!notes.includes(n)) notes.push(n);
  }
  if (!lines.length) lines.push(line('VPC', item.qty, 'VPCs', 0));
  return priced(lines, { sku: item.qty > 1 ? `${item.qty} VPCs` : 'VPC', notes });
}

// =====================================================================================
// Load balancer
// =====================================================================================

const lbTypes = opts(['app', 'Application (HTTP/HTTPS, layer 7)'], ['net', 'Network (TCP/UDP, layer 4)'], ['gw', 'Gateway (inline appliances)'], ['classic', 'Classic (AWS legacy)']);

export const lb: Service = {
  id: 'lb',
  label: 'Load balancer',
  group: 'Networking',
  blurb: 'ELB (ALB, NLB, GWLB, CLB) · Cloud Load Balancing · OCI Load Balancer',
  defaults: { type: 'app', gb: 1000, lcu: 1, mbps: 10 },
  fields: [
    { key: 'type', label: 'Type', type: 'select', options: lbTypes },
    { key: 'gb', label: 'Data processed', type: 'number', unit: 'GB / month', min: 0, step: 100 },
    { key: 'lcu', label: 'Capacity units (AWS)', type: 'number', unit: 'LCU, average', min: 0, step: 0.5, help: 'One LCU covers about 25 new connections/s, 3,000 active connections or 1 GB/hour.' },
    { key: 'mbps', label: 'Bandwidth (OCI)', type: 'number', unit: 'Mbps', min: 10, step: 10 },
  ],
  providers: {
    aws: {
      product: 'Elastic Load Balancing',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'elb');
        const type = str(item.spec, 'type', 'app');
        const q = item.qty;
        if (type === 'classic') {
          return priced([
            line('Classic Load Balancer hours', H * q, 'hours', must(awsRate(awsFind(rows, 'LoadBalancerUsage', 'LoadBalancing')), 'CLB hours')),
            line('Data processed', num(item.spec, 'gb', 0) * q, 'GB', must(awsRate(awsFind(rows, 'DataProcessing-Bytes', 'LoadBalancing')), 'CLB data')),
          ], { sku: 'Classic Load Balancer' });
        }
        const op = { app: 'LoadBalancing:Application', net: 'LoadBalancing:Network', gw: 'LoadBalancing:Gateway' }[type]!;
        const name = { app: 'Application Load Balancer', net: 'Network Load Balancer', gw: 'Gateway Load Balancer' }[type]!;
        return priced([
          line(`${name} hours`, H * q, 'hours', must(awsRate(awsFind(rows, 'LoadBalancerUsage', op)), `${name} hours`)),
          line('Capacity units', num(item.spec, 'lcu', 1) * H * q, 'LCU-hours', must(awsRate(awsFind(rows, 'LCUUsage', op)), `${name} LCU`)),
        ], { sku: name });
      },
    },
    gcp: {
      product: 'Cloud Load Balancing',
      price: async (ctx, item) => {
        const type = str(item.spec, 'type', 'app');
        if (type === 'gw') return unavailable('Google Cloud has no gateway load balancer; use Network Security Integration or a network load balancer.');
        const rows = await gcp.region(ctx.region);
        const q = item.qty;
        const kind = type === 'net' ? 'Regional External Passthrough Network Load Balancer' : 'Regional External Application Load Balancer';
        const rule = type === 'net'
          ? gcpFind(rows, /^Cloud Load Balancer Forwarding Rule Minimum for /, 'OnDemand', 'networking')
          : gcpFind(rows, new RegExp(`^${kind} Forwarding Rule Minimum for `), 'OnDemand', 'networking');
        const inb = gcpFind(rows, new RegExp(`^${kind} Inbound Data Processing for `), 'OnDemand', 'networking');
        const gb = num(item.spec, 'gb', 0) * q;
        const lines: Line[] = [line('Forwarding rules (first 5)', H * q, 'hours', must(gcpRate(rule), 'forwarding rule'))];
        if (gb) lines.push(line('Data processed', gb, 'GiB', must(gcpRate(inb), 'data processing')));
        const notes = type === 'classic' ? ['Priced as a regional external Application Load Balancer.'] : [];
        return priced(lines, { sku: kind, notes });
      },
    },
    oci: {
      product: 'OCI Load Balancer',
      price: async (_ctx, item) => {
        const type = str(item.spec, 'type', 'app');
        if (type === 'net') return free('OCI Network Load Balancer', 'Network Load Balancer', 'OCI does not charge for the Network Load Balancer.');
        if (type === 'gw') return unavailable('OCI has no gateway load balancer.');
        const rows = await oci.all();
        const q = item.qty;
        const mbps = Math.max(10, num(item.spec, 'mbps', 10));
        const hours = H * q;
        return priced([
          tierLine('Flexible Load Balancer base', hours, 'hours', must(ociCost(ociPart(rows, 'B93030'), hours), 'LB base')),
          tierLine(`Bandwidth, ${mbps} Mbps`, mbps * hours, 'Mbps-hours', must(ociCost(ociPart(rows, 'B93031'), mbps * hours), 'LB bandwidth')),
        ], { sku: `Flexible Load Balancer · ${mbps} Mbps` });
      },
    },
  },
};

// =====================================================================================
// NAT gateway
// =====================================================================================

export const nat: Service = {
  id: 'nat',
  label: 'NAT gateway',
  hidden: true,
  group: 'Networking',
  blurb: 'NAT Gateway · Cloud NAT · NAT Gateway',
  defaults: { gb: 500, vms: 10 },
  fields: [
    { key: 'gb', label: 'Data processed', type: 'number', unit: 'GB / month', min: 0, step: 100 },
    { key: 'vms', label: 'VMs behind it (Google)', type: 'number', min: 1, step: 1 },
  ],
  providers: {
    aws: {
      product: 'NAT Gateway',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'ec2x');
        return priced([
          line('NAT gateway hours', H * item.qty, 'hours', must(awsRate(awsFind(rows, 'NatGateway-Hours')), 'NAT hours')),
          line('Data processed', num(item.spec, 'gb', 0) * item.qty, 'GB', must(awsRate(awsFind(rows, 'NatGateway-Bytes')), 'NAT data')),
        ], { sku: 'NAT Gateway, one zone' });
      },
    },
    gcp: {
      product: 'Cloud NAT',
      price: async (ctx, item) => {
        const rows = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const vms = Math.min(32, Math.max(1, num(item.spec, 'vms', 10)));
        return priced([
          line(`Gateway uptime, ${vms} VMs`, vms * H * item.qty, 'VM-hours', must(gcpRate(gcpFind(rows, /^Networking Cloud Nat Gateway Uptime$/, 'OnDemand', 'networking')), 'Cloud NAT uptime')),
          line('NAT IP address', H * item.qty, 'hours', must(gcpRate(gcpFind(rows, /^Networking Cloud NAT IP Usage$/, 'OnDemand', 'networking')), 'NAT IP')),
          line('Data processed', num(item.spec, 'gb', 0) * item.qty, 'GiB', must(gcpRate(gcpFind(rows, /^Networking Cloud Nat Data Processing$/, 'OnDemand', 'networking')), 'NAT data')),
        ], { sku: 'Cloud NAT', notes: ['Cloud NAT charges per VM using the gateway, capped at 32 VMs.'] });
      },
    },
    oci: { product: 'OCI NAT Gateway', price: async () => free('OCI NAT Gateway', 'NAT gateway', 'OCI does not charge for the NAT gateway; outbound data is priced under data transfer.') },
  },
};

// =====================================================================================
// Public IP address
// =====================================================================================

export const ip: Service = {
  id: 'ip',
  label: 'Public IPv4 address',
  hidden: true,
  group: 'Networking',
  blurb: 'Elastic IP · External IP · Reserved public IP',
  defaults: { state: 'used' },
  fields: [{ key: 'state', label: 'State', type: 'select', options: opts(['used', 'Attached to a running resource'], ['idle', 'Reserved, not attached']) }],
  providers: {
    aws: {
      product: 'Public IPv4',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'vpc');
        const k = str(item.spec, 'state') === 'idle' ? 'PublicIPv4:IdleAddress' : 'PublicIPv4:InUseAddress';
        return priced([line('Public IPv4 address', H * item.qty, 'hours', must(awsRate(awsFind(rows, k)), 'public IPv4'))], { sku: 'Public IPv4 address' });
      },
    },
    gcp: {
      product: 'External IP address',
      price: async (ctx, item) => {
        const rows = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const idle = str(item.spec, 'state') === 'idle';
        const r = idle ? gcpFind(rows, /^Static Ip Charge in /, 'OnDemand', 'compute') ?? gcpFind(rows, /^Static Ip Charge$/, 'OnDemand', 'compute') : gcpFind(rows, /^External IP Charge on a Standard VM$/, 'OnDemand', 'compute');
        return priced([line(idle ? 'Static IP, not attached' : 'External IP on a VM', H * item.qty, 'hours', must(gcpRate(r), 'external IP'))], { sku: 'External IPv4 address' });
      },
    },
    oci: { product: 'OCI Public IP', price: async () => free('OCI Public IP', 'Public IP address', 'OCI does not charge for public IPv4 addresses.') },
  },
};

// =====================================================================================
// Private endpoint (PrivateLink / Private Service Connect)
// =====================================================================================

export const endpoint: Service = {
  id: 'endpoint',
  label: 'Private endpoint',
  hidden: true,
  group: 'Networking',
  blurb: 'VPC interface endpoint · Private Service Connect · Private Endpoint',
  defaults: { zones: 2, gb: 100 },
  fields: [
    { key: 'zones', label: 'Zones per endpoint (AWS)', type: 'number', min: 1, step: 1 },
    { key: 'gb', label: 'Data processed', type: 'number', unit: 'GB / month', min: 0, step: 10 },
  ],
  providers: {
    aws: {
      product: 'AWS PrivateLink',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'vpc');
        const gb = num(item.spec, 'gb', 0) * item.qty;
        return priced([
          line('Interface endpoint, per zone', num(item.spec, 'zones', 2) * H * item.qty, 'hours', must(awsRate(awsFind(rows, 'VpcEndpoint-Hours')), 'endpoint hours')),
          tierLine('Data processed', gb, 'GB', must(awsCost(awsFind(rows, 'VpcEndpoint-Bytes'), gb), 'endpoint data')),
        ], { sku: 'VPC interface endpoint', notes: ['Gateway endpoints for S3 and DynamoDB have no charge.'] });
      },
    },
    gcp: {
      product: 'Private Service Connect',
      price: async (ctx, item) => {
        const rows = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const gb = num(item.spec, 'gb', 0) * item.qty;
        return priced([
          line('Consumer endpoint', H * item.qty, 'hours', must(gcpRate(gcpFind(rows, /^Networking Private Service Connect Consumer End Point$/, 'OnDemand', 'networking')), 'PSC endpoint')),
          tierLine('Data processed', gb, 'GiB', must(gcpCost(gcpFind(rows, /^Networking Private Service Connect Consumer Data Processing$/, 'OnDemand', 'networking'), gb), 'PSC data')),
        ], { sku: 'Private Service Connect endpoint' });
      },
    },
    oci: { product: 'OCI Private Endpoint', price: async () => free('OCI Private Endpoint', 'Private endpoint / service gateway', 'OCI does not charge for private endpoints or the service gateway.') },
  },
};

// =====================================================================================
// Data transfer out
// =====================================================================================

export function destField(ctx: Ctx): Field[] {
  return [{
    key: 'to', label: 'Destination', type: 'select',
    options: [{ value: 'internet', label: 'Internet' }, ...ctx.regions.filter((r) => r.code !== ctx.region).map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))],
  }];
}

/** City name as Google's catalog spells it for a region, e.g. "Jakarta" or "Americas". */
async function gcpCity(region: string): Promise<string | undefined> {
  const rows = await gcp.region(region);
  const m = rows.map((r) => /^E2 Instance Core running in (.+)$/.exec(r.d)).find(Boolean);
  return m?.[1];
}

function gcpInternetRow(rows: GcpRow[], city: string, dest: string): GcpRow | undefined {
  const all = rows.filter((r) => r.u === 'OnDemand' && r.d.startsWith(`Network Internet Data Transfer Out from ${city} to `));
  const want: Record<string, RegExp> = { apac: /Apac|Asia/i, na: /Americas|North America/i, eu: /Europe|EMEA/i, other: /Middle East|Africa|South America/i };
  return all.find((r) => want[dest]?.test(r.d.split(' to ').pop() ?? '')) ?? all.sort((a, b) => gcpRate(b) - gcpRate(a))[0];
}

function ociEgressPart(region: string): string {
  const c = continent('oci', region);
  return c === 'na' || c === 'eu' ? 'B88327' : c === 'me' || c === 'af' ? 'B93456' : 'B93455';
}

export const egress: Service = {
  id: 'egress',
  label: 'Data transfer out',
  group: 'Networking',
  blurb: 'To the internet, another region or another cloud',
  defaults: { gb: 1000, to: 'internet', dest: 'apac' },
  fields: [
    { key: 'gb', label: 'Data out', type: 'number', unit: 'GB / month', min: 0, step: 100 },
    { key: 'dest', label: 'Users mostly in (Google)', type: 'select', options: opts(['apac', 'Asia Pacific'], ['na', 'Americas'], ['eu', 'Europe'], ['other', 'Middle East, Africa, Latin America']), show: (s) => (s.to ?? 'internet') === 'internet' },
  ],
  providers: {
    aws: {
      product: 'AWS data transfer',
      fields: async (ctx) => destField(ctx),
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'transfer');
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const to = str(item.spec, 'to', 'internet');
        if (to === 'internet') {
          return priced([tierLine('Data transfer out to the internet', gb, 'GB', must(awsCost(awsFind(rows, 'DataTransfer-Out-Bytes'), gb), 'internet data transfer'))], {
            sku: 'Data transfer out',
          });
        }
        const dest = ctx.regions.find((r) => r.code === to);
        const row = dest?.prefix ? awsFind(rows, `${dest.prefix}-AWS-Out-Bytes`) : undefined;
        return priced([line(`Inter-region to ${dest?.name ?? to}`, gb, 'GB', must(awsRate(row), 'inter-region transfer'))], { sku: 'Inter-region data transfer' });
      },
      adopt: async (_c, item) => ({ ...item, spec: { ...item.spec, to: 'internet' } }),
    },
    gcp: {
      product: 'Google Cloud network',
      fields: async (ctx) => destField(ctx),
      price: async (ctx, item) => {
        const rows = await gcp.region(ctx.region);
        const city = await gcpCity(ctx.region);
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const to = str(item.spec, 'to', 'internet');
        if (!city) return unavailable('Region not found in the Google price feed.');
        if (to === 'internet') {
          const row = gcpInternetRow(rows, city, str(item.spec, 'dest', 'apac'));
          return priced([tierLine(`Internet egress, ${row?.d.split(' to ').pop() ?? ''}`, gb, 'GiB', must(gcpCost(row, gb), 'internet egress'))], { sku: 'Premium Tier internet egress' });
        }
        const destCity = await gcpCity(to);
        const row = gcpFind(rows, new RegExp(`^Network Inter Region Data Transfer Out from ${escapeRe(city)} to ${escapeRe(destCity ?? '')}$`));
        const name = ctx.regions.find((r) => r.code === to)?.name ?? to;
        return priced([tierLine(`Inter-region to ${name}`, gb, 'GiB', must(gcpCost(row, gb), 'inter-region egress'))], { sku: 'Inter-region data transfer' });
      },
      adopt: async (_c, item) => ({ ...item, spec: { ...item.spec, to: 'internet' } }),
    },
    oci: {
      product: 'OCI data transfer',
      fields: async (ctx) => destField(ctx),
      price: async (ctx, item) => {
        const rows: OciRow[] = await oci.all();
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const part = ociEgressPart(ctx.region);
        const to = str(item.spec, 'to', 'internet');
        return priced([tierLine(to === 'internet' ? 'Outbound data transfer' : `Outbound to ${to}`, gb, 'GB', must(ociCost(ociPart(rows, part), gb), 'outbound transfer'))], {
          sku: 'Outbound data transfer', notes: ['OCI includes the first 10 TB a month at no charge (per tenancy); inter-region transfer uses the same rates.'],
        });
      },
      adopt: async (_c, item) => ({ ...item, spec: { ...item.spec, to: 'internet' } }),
    },
  },
};

// =====================================================================================
// Site-to-site VPN
// =====================================================================================

export const vpn: Service = {
  id: 'vpn',
  label: 'Site-to-site VPN',
  group: 'Networking',
  blurb: 'Site-to-Site VPN · Cloud VPN · IPSec VPN',
  defaults: { tunnels: 2 },
  fields: [{ key: 'tunnels', label: 'Tunnels', type: 'number', min: 1, step: 1, help: 'AWS: one connection carries two tunnels. Google HA VPN: two tunnels per gateway.' }],
  providers: {
    aws: {
      product: 'AWS Site-to-Site VPN',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'vpc');
        const conns = Math.ceil(num(item.spec, 'tunnels', 2) / 2) * item.qty;
        return priced([line('VPN connection (2 tunnels each)', conns * H, 'connection-hours', must(awsRate(awsFind(rows, 'VPN-Usage-Hours:ipsec.1')), 'VPN connection'))], {
          sku: 'Site-to-Site VPN', notes: ['Data out over the VPN is billed as data transfer out.'],
        });
      },
    },
    gcp: {
      product: 'Cloud VPN',
      price: async (ctx, item) => {
        const rows = await gcp.region(ctx.region);
        const t = num(item.spec, 'tunnels', 2) * item.qty;
        return priced([line('HA VPN tunnel', t * H, 'tunnel-hours', must(gcpRate(gcpFind(rows, /^Networking Cloud VPN Tunnel /, 'OnDemand', 'networking')), 'VPN tunnel'))], { sku: 'Cloud HA VPN' });
      },
    },
    oci: { product: 'OCI Site-to-Site VPN', price: async () => free('OCI VPN', 'IPSec VPN', 'OCI does not charge for Site-to-Site VPN; data out is priced under data transfer.') },
  },
};

// =====================================================================================
// Private interconnect
// =====================================================================================

const capacities = opts(['50M', '50 Mbps'], ['100M', '100 Mbps'], ['200M', '200 Mbps'], ['500M', '500 Mbps'], ['1G', '1 Gbps'], ['2G', '2 Gbps'], ['5G', '5 Gbps'], ['10G', '10 Gbps'], ['100G', '100 Gbps']);

function gcpIcGroup(region: string): string {
  if (region === 'asia-southeast2') return 'Indonesia';
  if (region.startsWith('asia-south')) return 'India';
  if (region.startsWith('australia')) return 'Australia';
  if (region.startsWith('asia')) return 'Asia';
  if (region.startsWith('europe')) return 'Europe';
  if (region.startsWith('northamerica-northeast')) return 'Canada';
  if (region.startsWith('northamerica-south')) return 'Mexico';
  if (region.startsWith('us-')) return 'UnitedStates';
  if (region.startsWith('southamerica')) return 'SouthAmerica';
  if (region.startsWith('me-')) return 'MiddleEast';
  return 'Africa';
}

export const interconnect: Service = {
  id: 'interconnect',
  label: 'Private interconnect',
  group: 'Networking',
  blurb: 'Direct Connect · Cloud Interconnect · FastConnect',
  defaults: { kind: 'dedicated', cap: '1G', ports: 1, gb: 1000 },
  fields: [
    { key: 'kind', label: 'Connection', type: 'select', options: opts(['dedicated', 'Dedicated port'], ['hosted', 'Through a partner (hosted)']) },
    { key: 'cap', label: 'Capacity', type: 'select', options: capacities },
    { key: 'ports', label: 'Ports / attachments', type: 'number', min: 1, step: 1 },
    { key: 'gb', label: 'Data out', type: 'number', unit: 'GB / month', min: 0, step: 100 },
  ],
  providers: {
    aws: {
      product: 'AWS Direct Connect',
      // Data out over Direct Connect is priced per location the circuit lands at.
      fields: async (ctx) => {
        const outs = (await aws.rows(ctx.region, 'dx')).filter((r) => r.k.endsWith('-DataXfer-Out') && r.f === 'Data Transfer' && r.a?.toLocation);
        outs.sort((a, b) => a.a!.toLocation.localeCompare(b.a!.toLocation));
        return [{
          key: 'aws.dx', label: 'Direct Connect location', type: 'select',
          options: [{ value: '', label: 'Lowest data-out rate' }, ...outs.map((r) => ({ value: r.a!.toLocation, label: `${r.a!.toLocation} · $${awsRate(r)}/GB` }))],
        }];
      },
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'dx');
        const hosted = str(item.spec, 'kind') === 'hosted';
        const cap = str(item.spec, 'cap', '1G');
        const port = rows.find((r) => r.a?.capacity === cap && r.a?.connectionType === (hosted ? 'Hosted' : 'Dedicated'));
        if (!port) return unavailable(`No ${hosted ? 'hosted' : 'dedicated'} ${cap} port price at Direct Connect locations for this region.`);
        const outs = rows.filter((r) => r.k.endsWith('-DataXfer-Out') && r.f === 'Data Transfer' && Number.isFinite(awsRate(r)));
        const at = str(item.spec, 'aws.dx');
        const out = at ? outs.find((r) => r.a?.toLocation === at) : [...outs].sort((a, b) => awsRate(a) - awsRate(b))[0];
        if (at && !out) return unavailable(`${at} has no data-out rate from this region.`);
        const ports = num(item.spec, 'ports', 1) * item.qty;
        const lines: Line[] = [line(`${hosted ? 'Hosted' : 'Dedicated'} ${cap} port`, ports * H, 'port-hours', awsRate(port))];
        const gb = num(item.spec, 'gb', 0) * item.qty;
        if (gb && out) lines.push(line(`Data out over Direct Connect, ${out.a?.toLocation ?? 'location'}`, gb, 'GB', awsRate(out)));
        const notes = ['Partner and cross-connect fees are not included.'];
        if (!at) notes.unshift('Data out uses the lowest rate among Direct Connect locations; pick the location for its own rate.');
        return priced(lines, { sku: `Direct Connect ${cap}`, notes });
      },
    },
    gcp: {
      product: 'Cloud Interconnect',
      price: async (ctx, item) => {
        const rows = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const hosted = str(item.spec, 'kind') === 'hosted';
        const cap = str(item.spec, 'cap', '1G');
        const ports = num(item.spec, 'ports', 1) * item.qty;
        const capTxt = cap.replace('M', 'Mbps').replace('G', 'Gbps');
        const lines: Line[] = [];
        const notes: string[] = [];
        if (hosted) {
          const r = gcpFind(rows, new RegExp(`^Cloud Interconnect - ${capTxt} VLAN attachment via Google partner$`));
          if (!r) return unavailable(`Partner Interconnect has no ${capTxt} attachment.`);
          lines.push(line(`Partner VLAN attachment ${capTxt}`, ports * H, 'attachment-hours', gcpRate(r)));
        } else {
          // Dedicated Interconnect sells 10 Gbps and 100 Gbps circuits only; smaller asks get one 10 Gbps circuit.
          const dcap = cap === '100G' ? '100Gbps' : '10Gbps';
          if (cap !== '10G' && cap !== '100G') notes.push(`Dedicated Interconnect starts at 10 Gbps, so this card prices ${capTxt} as one 10 Gbps circuit. Partner Interconnect sells smaller attachments.`);
          const c = gcpFind(rows, new RegExp(`^Cloud Interconnect - ${dcap} Dedicated circuit$`));
          const a = gcpFind(rows, new RegExp(`^Cloud Interconnect - ${dcap} VLAN attachment via Dedicated Interconnect$`));
          lines.push(line(`Dedicated circuit ${dcap}`, ports * H, 'circuit-hours', must(gcpRate(c), 'Interconnect circuit')));
          if (a) lines.push(line(`VLAN attachment ${dcap}`, ports * H, 'attachment-hours', gcpRate(a)));
        }
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const egressRow = gcpFind(rows, new RegExp(`^Cloud Interconnect - Local Data Transfer in ${gcpIcGroup(ctx.region)}$`));
        if (gb) lines.push(line('Data out over Interconnect', gb, 'GiB', must(gcpRate(egressRow), 'Interconnect egress')));
        return priced(lines, { sku: `${hosted ? 'Partner' : 'Dedicated'} Interconnect ${hosted ? capTxt : cap === '100G' ? '100Gbps' : '10Gbps'}`, notes });
      },
    },
    oci: {
      product: 'OCI FastConnect',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const cap = str(item.spec, 'cap', '1G');
        const part = { '1G': 'B88325', '10G': 'B88326', '100G': 'B93126' }[cap];
        const hosted = str(item.spec, 'kind') === 'hosted';
        if (!part) return unavailable('FastConnect ports come in 1, 10, 100 and 400 Gbps.');
        const ports = num(item.spec, 'ports', 1) * item.qty;
        return priced([line(`FastConnect ${cap} port`, ports * H, 'port-hours', must(ociRate(ociPart(rows, part)), 'FastConnect port'))], {
          sku: `FastConnect ${cap}`, notes: ['OCI does not charge for data out over FastConnect.', ...(hosted ? ['Partner fees are billed by the partner; not included.'] : [])],
        });
      },
    },
  },
};

// =====================================================================================
// DNS
// =====================================================================================

export const dns: Service = {
  id: 'dns',
  label: 'DNS',
  group: 'Networking',
  blurb: 'Route 53 · Cloud DNS · OCI DNS',
  defaults: { zones: 2, queries: 10_000_000 },
  fields: [
    { key: 'zones', label: 'Hosted zones', type: 'number', min: 0, step: 1 },
    { key: 'queries', label: 'Queries', type: 'number', unit: '/ month', min: 0, step: 1000000 },
  ],
  providers: {
    aws: {
      product: 'Amazon Route 53',
      price: async (_ctx, item) => {
        const rows = await aws.global('route53');
        const zones = num(item.spec, 'zones', 0) * item.qty, qs = num(item.spec, 'queries', 0) * item.qty;
        return priced([
          tierLine('Hosted zones', zones, 'zones', must(awsCost(awsFind(rows, 'HostedZone'), zones), 'hosted zones')),
          tierLine('Standard queries', qs, 'queries', must(awsCost(awsFind(rows, 'DNS-Queries'), qs), 'DNS queries')),
        ], { sku: 'Route 53 public hosted zone' });
      },
    },
    gcp: {
      product: 'Cloud DNS',
      price: async (_ctx, item) => {
        const g = await gcp.global();
        const zones = num(item.spec, 'zones', 0) * item.qty, qs = num(item.spec, 'queries', 0) * item.qty;
        return priced([
          tierLine('Managed zones', zones, 'zones', must(gcpCost(gcpFind(g, /^ManagedZone$/, 'OnDemand', 'dns'), zones), 'managed zones')),
          tierLine('Queries', qs, 'queries', must(gcpCost(gcpFind(g, /^DNS Query \(port 53\)$/, 'OnDemand', 'dns'), qs), 'DNS queries')),
        ], { sku: 'Cloud DNS public zone' });
      },
    },
    oci: {
      product: 'OCI DNS',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const qs = num(item.spec, 'queries', 0) * item.qty;
        return priced([line('Queries', qs, 'queries', must(ociRate(ociPart(rows, 'B88525')), 'DNS queries') / 1e6)], {
          sku: 'OCI DNS', notes: ['OCI does not charge for zones.'],
        });
      },
    },
  },
};
