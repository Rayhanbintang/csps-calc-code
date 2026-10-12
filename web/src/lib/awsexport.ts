// Builds rows for AWS's "EC2 Instances" bulk upload template from the AWS virtual machines
// of an estimate. The server (api/export.go, format=awsec2) writes them into the
// visitor's own copy of AWS's file. Values use AWS's dropdown wording, read from the
// template's hidden "VH Calc Input" sheet on 2026-10-12.
import type { Estimate, Item, Priced } from './types';
import { HOURS_PER_MONTH } from './types';
import { walk } from './tree';

export interface AwsRow {
  group: string;
  description: string;
  region: string;
  os: string;
  type: string;
  tenancy: string;
  count: number;
  usage: number;
  usageType: string;
  purchase: string;
  storage: string;
  gb: number;
  iops: number;
  mbps: number;
  snapFreq: string;
  snapGb: number;
}

export interface AwsExport {
  rows: AwsRow[];
  /** Cards left out, with the reason. */
  skipped: string[];
  /** Cards exported with a change, with what changed. */
  changed: string[];
}

const SQL: Record<string, string> = { 'sql-web': 'SQL Server Web', 'sql-std': 'SQL Server Standard', 'sql-ent': 'SQL Server Enterprise' };

/** The template's operating system for our OS and database licence, or why there is none. */
export function templateOS(os: string, sw: string): string | { no: string } {
  const sql = SQL[sw];
  switch (os) {
    case 'linux':
      return sql ? `Linux with ${sql}` : 'Linux';
    case 'windows':
      return sql ? `Windows Server with ${sql}` : 'Windows Server';
    case 'rhel':
      return sql ? `Red Hat Enterprise Linux with ${sql}` : 'Red Hat Enterprise Linux';
    case 'rhel-ha':
      if (sw === 'sql-web') return { no: "AWS's template has no RHEL with HA and SQL Server Web" };
      return sql ? `Red Hat Enterprise Linux with HA and ${sql}` : 'Red Hat Enterprise Linux with HA';
    case 'suse':
      return sql ? { no: "AWS's template has no SUSE with SQL Server" } : 'SUSE Linux Enterprise Server';
    case 'ubuntu-pro':
      return { no: "AWS's template has no Ubuntu Pro" };
  }
  return { no: `operating system "${os}" is not in AWS's template` };
}

const PAY: Record<string, string> = { all: 'All', partial: 'Partial', no: 'No' };

export function templatePurchase(p: Item['pricing']): string {
  if (!p || p.model === 'od') return 'On-Demand';
  const head = `${p.term ?? 1} Yr ${PAY[p.pay ?? 'no']} Upfront`;
  if (p.model === 'sp') return `${head} ${p.kind === 'e' ? 'EC2 Instance' : 'Compute'} Savings Plan`;
  if (p.model === 'ri') return `${head} ${p.cls === 'c' ? 'Convertible' : 'Standard'} Reserved Instances Plan`;
  return 'On-Demand';
}

const VOLUME: Record<string, string> = {
  gp3: 'General Purpose SSD (gp3)', gp2: 'General Purpose SSD (gp2)', io2: 'Provisioned IOPS SSD (io2)',
  io1: 'Provisioned IOPS SSD (io1)', st1: 'Throughput Optimized HDD (st 1)', sc1: 'Cold HDD (sc1)',
};
const BY_TYPE: Record<string, string> = { ssd: 'gp3', 'ssd-fast': 'io2', hdd: 'st1', 'hdd-cold': 'sc1' };

function volumeOf(disk: Item): string {
  return String(disk.spec['aws.volume'] || BY_TYPE[String(disk.spec.type)] || 'gp3');
}

/** Rows for every AWS VM in the estimate, in board order. */
export function ec2Rows(est: Estimate, prices: Map<string, Priced>): AwsExport {
  const out: AwsExport = { rows: [], skipped: [], changed: [] };
  for (const acc of est.accounts) {
    if (acc.provider !== 'aws') continue;
    for (const box of acc.regions) {
      for (const n of walk(box.items)) {
        const vm = n.item;
        if (vm.svc !== 'vm') continue;
        const name = vm.name || 'Virtual machine';
        const p = prices.get(vm.id);
        const type = String(vm.spec['aws.type'] || p?.sku?.split(' · ')[0] || '');
        if (!type || p?.unavailable) {
          out.skipped.push(`${name}: no AWS instance type priced${p?.unavailable ? ` (${p.unavailable})` : ''}.`);
          continue;
        }
        const os = templateOS(String(vm.spec.os ?? 'linux'), String(vm.spec.sw ?? 'none'));
        if (typeof os !== 'string') {
          out.skipped.push(`${name}: ${os.no}.`);
          continue;
        }
        if (vm.spec.licence === 'byol') out.changed.push(`${name}: AWS's template has no bring-your-own licence; the row has the licence included.`);

        const hours = Math.min(HOURS_PER_MONTH, Number(vm.spec.hours ?? HOURS_PER_MONTH));
        const always = hours >= HOURS_PER_MONTH;
        const row: AwsRow = {
          group: box.label ?? '',
          description: name,
          region: box.region,
          os,
          type,
          tenancy: vm.spec.tenancy === 'dedicated' ? 'Dedicated Instances' : 'Shared Instances',
          count: vm.qty * n.mult,
          usage: always ? 0 : Math.round((hours * 168) / HOURS_PER_MONTH),
          usageType: always ? 'Always On' : 'Hours/Week',
          purchase: templatePurchase(vm.pricing),
          storage: '', gb: 0, iops: 0, mbps: 0,
          snapFreq: 'No snapshot storage', snapGb: 0,
        };

        // The template takes one volume type per instance: the first disk's, with the
        // sizes of every disk of that type added up.
        const disks = (vm.children ?? []).filter((c) => c.svc === 'disk');
        if (disks.length) {
          const vol = volumeOf(disks[0]);
          const same = disks.filter((d) => volumeOf(d) === vol);
          row.storage = VOLUME[vol] ?? VOLUME.gp3;
          row.gb = same.reduce((s, d) => s + d.qty * Number(d.spec.gb ?? 0), 0);
          if (vol === 'gp3' || vol === 'io1' || vol === 'io2') row.iops = same.reduce((s, d) => s + d.qty * Number(d.spec.iops ?? 0), 0);
          if (vol === 'gp3') row.mbps = same.reduce((s, d) => s + d.qty * Number(d.spec.mbps ?? 0), 0);
          if (same.length < disks.length) out.changed.push(`${name}: AWS's template takes one volume type per instance; only the ${vol} disks are in the row.`);
        }
        if ((vm.children ?? []).some((c) => c.svc === 'backup')) {
          out.changed.push(`${name}: snapshots are left out; AWS's template asks for a snapshot frequency, which the estimate does not keep.`);
        }
        out.rows.push(row);
      }
    }
  }
  return out;
}
