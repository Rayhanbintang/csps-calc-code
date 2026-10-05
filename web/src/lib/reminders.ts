// Plain rules that look for things an estimate often misses. No AI: each rule reads the
// estimate and says what it found.
import type { Estimate, Item, Priced, Provider, Spec } from './types';
import { providerNames } from './engine';
import { walk } from './tree';

export interface Reminder {
  id: string;
  text: string;
  /** Optional one-click fix: add this service to this box, or inside this item. */
  add?: { boxId: string; parentId?: string; svc: string; spec?: Spec; label: string };
}

const label = (i: Item, fallback: string) => i.name || fallback;

export function reminders(est: Estimate, prices: Map<string, Priced>): Reminder[] {
  const out: Reminder[] = [];
  const boxes = est.accounts.flatMap((a) => a.regions.map((r) => ({ acc: a, box: r })));
  const cloudBoxes = boxes.filter((b) => b.acc.provider !== 'onprem');
  const providers = new Set<Provider>(cloudBoxes.map((b) => b.acc.provider));
  const all = boxes.flatMap((b) => [...walk(b.box.items)].map((n) => ({ ...n, ...b })));
  const has = (svc: string) => all.some((n) => n.item.svc === svc);

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
    const where = `${acc.label || providerNames[acc.provider]} · ${box.label || box.region}`;
    const nodes = [...walk(box.items)];
    // 2. Each VM needs a disk inside it: every cloud bills boot and data volumes.
    const bare = nodes.filter((n) => n.item.svc === 'vm' && !(n.item.children ?? []).some((c) => c.svc === 'disk'));
    for (const n of bare.slice(0, 3)) {
      out.push({
        id: `disk-${n.item.id}`,
        text: `${where}: ${label(n.item, 'a VM')} has no disk inside it. Every provider bills boot and data volumes.`,
        add: { boxId: box.id, parentId: n.item.id, svc: 'disk', label: 'Add a disk inside it' },
      });
    }
    // 3. VMs outside any VPC, or a VPC without a way out to the internet.
    const vms = nodes.filter((n) => n.item.svc === 'vm');
    const vpcs = nodes.filter((n) => n.item.svc === 'vpc');
    if (vms.length && !vpcs.length) {
      out.push({
        id: `vpc-${box.id}`,
        text: `${where}: the VMs sit outside a VPC. Add a VPC card and drag them in; it carries NAT gateways, endpoints and public IPs.`,
        add: { boxId: box.id, svc: 'vpc', label: 'Add a VPC' },
      });
    }
    for (const v of vpcs) {
      const inside = [...walk(v.item.children ?? [])].some((n) => n.item.svc === 'vm' || n.item.svc === 'k8s');
      if (inside && Number(v.item.spec.nat ?? 0) === 0 && Number(v.item.spec.ips ?? 0) === 0) {
        out.push({ id: `nat-${v.item.id}`, text: `${where}: ${label(v.item, 'the VPC')} has no NAT gateway or public IP. Set one on the VPC card if the machines need the internet.` });
      }
    }
    // 4. A cluster without nodes.
    for (const k of nodes.filter((n) => n.item.svc === 'k8s')) {
      if (!(k.item.children ?? []).some((c) => c.svc === 'vm' || c.svc === 'containers')) {
        out.push({
          id: `nodes-${k.item.id}`,
          text: `${where}: ${label(k.item, 'the Kubernetes cluster')} has no worker nodes. Add VMs inside it for the node groups.`,
          add: { boxId: box.id, parentId: k.item.id, svc: 'vm', label: 'Add a node group' },
        });
      }
    }
  }

  // 5. Shield Advanced is one subscription per AWS Organization.
  const shields = boxes.filter((b) => b.acc.provider === 'aws' && [...walk(b.box.items)].some((n) => n.item.svc === 'ddos')).length;
  if (shields > 1) out.push({ id: 'shield', text: `Shield Advanced appears in ${shields} AWS boxes. The subscription covers the whole AWS Organization, so it is usually paid once.` });

  // 6. Items that moved between clouds or could not be priced.
  const moved = all.filter((n) => n.item.check).length;
  if (moved) out.push({ id: 'moved', text: `${moved} item${moved > 1 ? 's' : ''} moved to another cloud and ${moved > 1 ? 'were' : 'was'} matched by size. Check the marked items.` });
  const broken = all.filter((n) => prices.get(n.item.id)?.unavailable).length;
  if (broken) out.push({ id: 'broken', text: `${broken} item${broken > 1 ? 's' : ''} could not be priced and ${broken > 1 ? 'count' : 'counts'} as $0. See the items marked in red.` });

  return out;
}
