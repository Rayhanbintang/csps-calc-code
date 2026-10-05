// Plain rules that look for things an estimate often misses. No AI: each rule reads the
// estimate and says what it found.
import type { Estimate, Priced, Provider, Spec } from './types';
import { providerNames } from './engine';

export interface Reminder {
  id: string;
  text: string;
  /** Optional one-click fix: add this service to this box. */
  add?: { boxId: string; svc: string; spec?: Spec; label: string };
}

export function reminders(est: Estimate, prices: Map<string, Priced>): Reminder[] {
  const out: Reminder[] = [];
  const boxes = est.accounts.flatMap((a) => a.regions.map((r) => ({ acc: a, box: r })));
  const cloudBoxes = boxes.filter((b) => b.acc.provider !== 'onprem');
  const providers = new Set<Provider>(cloudBoxes.map((b) => b.acc.provider));
  const has = (svc: string, boxId?: string) =>
    boxes.some((b) => (boxId === undefined || b.box.id === boxId) && b.box.items.some((i) => i.svc === svc));

  // 1. Several sites: data usually flows between them.
  if (boxes.length > 1) {
    const first = cloudBoxes[0];
    if (first && !has('egress')) {
      const across = providers.size > 1 ? `${[...providers].map((p) => providerNames[p]).join(' and ')}` : 'several regions';
      out.push({
        id: 'replication',
        text: `This estimate spans ${across}. If data is copied between sites (for example DC to DRC replication), add the data transfer out of the sending site.`,
        add: { boxId: first.box.id, svc: 'egress', label: 'Add data transfer to the first site' },
      });
    }
    if (!has('vpn') && !has('interconnect')) {
      out.push({
        id: 'connect',
        text: 'The sites have no VPN or private interconnect. Add one if they talk to each other or to an office or data centre.',
        add: first ? { boxId: first.box.id, svc: 'vpn', label: 'Add a VPN to the first site' } : undefined,
      });
    }
  }

  for (const { acc, box } of cloudBoxes) {
    const vms = box.items.filter((i) => i.svc === 'vm');
    const where = `${acc.label || providerNames[acc.provider]} · ${box.label || box.region}`;
    // 2. VMs need disks: every cloud bills the boot volume.
    if (vms.length && !box.items.some((i) => i.svc === 'disk')) {
      out.push({
        id: `disk-${box.id}`,
        text: `${where}: the VMs have no disks. Every provider bills boot and data volumes separately.`,
        add: { boxId: box.id, svc: 'disk', label: 'Add block storage' },
      });
    }
    // 3. Outbound internet for private VMs.
    if (vms.length && !box.items.some((i) => i.svc === 'nat' || i.svc === 'ip')) {
      out.push({
        id: `nat-${box.id}`,
        text: `${where}: if the VMs need to reach the internet (updates, APIs), add a NAT gateway or public IPs.`,
        add: { boxId: box.id, svc: 'nat', label: 'Add a NAT gateway' },
      });
    }
    // 4. A cluster without nodes.
    if (box.items.some((i) => i.svc === 'k8s') && !vms.length && !box.items.some((i) => i.svc === 'containers')) {
      out.push({
        id: `nodes-${box.id}`,
        text: `${where}: the Kubernetes cluster has no worker nodes. Add VMs for the node pool.`,
        add: { boxId: box.id, svc: 'vm', label: 'Add worker VMs' },
      });
    }
  }

  // 5. Shield Advanced is one subscription per AWS Organization.
  const shields = boxes.filter((b) => b.acc.provider === 'aws' && b.box.items.some((i) => i.svc === 'ddos')).length;
  if (shields > 1) out.push({ id: 'shield', text: `Shield Advanced appears in ${shields} AWS boxes. The subscription covers the whole AWS Organization, so it is usually paid once.` });

  // 6. Items that moved between clouds or could not be priced.
  const items = boxes.flatMap((b) => b.box.items);
  const moved = items.filter((i) => i.check).length;
  if (moved) out.push({ id: 'moved', text: `${moved} item${moved > 1 ? 's' : ''} moved to another cloud and ${moved > 1 ? 'were' : 'was'} matched by size. Check the marked items.` });
  const broken = items.filter((i) => prices.get(i.id)?.unavailable).length;
  if (broken) out.push({ id: 'broken', text: `${broken} item${broken > 1 ? 's' : ''} could not be priced and ${broken > 1 ? 'count' : 'counts'} as $0. See the items marked in red.` });

  return out;
}
