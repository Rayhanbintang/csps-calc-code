// Where a service runs: one zone, several zones, or the whole region by design. Shown as a
// badge on each card. For VMs and caches the SA states the spread in a "Zones" field; it
// records placement and does not change the price.
import type { Item, Provider } from './types';
import { num, str } from './catalog/util';

export interface Zones {
  kind: 'single' | 'multi' | 'regional' | 'global';
  label: string;
  title: string;
}

/** What each cloud calls a zone. */
const TERM: Record<Provider, string> = {
  aws: 'Availability Zone',
  gcp: 'zone',
  oci: 'availability domain (fault domain in one-domain regions)',
  azure: 'availability zone',
  onprem: 'zone',
};

const REGIONAL = new Set(['lb', 'object', 'functions', 'containers', 'k8s', 'queue', 'notify', 'apigw', 'waf', 'monitoring']);

function count(n: number, provider: Provider): Zones {
  if (n > 1) return { kind: 'multi', label: `${n} zones`, title: `Spread across ${n} zones (${TERM[provider]}).` };
  return { kind: 'single', label: '1 zone', title: `Runs in one zone (${TERM[provider]}). A zone outage stops it.` };
}

export function zonesOf(item: Item, provider: Provider): Zones | undefined {
  if (provider === 'onprem') return undefined;
  const s = item.spec;
  switch (item.svc) {
    case 'vm':
    case 'cache':
      return count(Math.max(1, Math.round(num(s, 'zones', 1))), provider);
    case 'db':
      return str(s, 'ha', 'single') === 'multi'
        ? { kind: 'multi', label: 'Multi-zone', title: `A standby in a second zone takes over if the first fails (${TERM[provider]}).` }
        : count(1, provider);
    case 'disk':
      return { kind: 'single', label: '1 zone', title: `A disk lives in the zone of its VM (${TERM[provider]}).` };
    case 'file':
      if (provider === 'aws' || (provider === 'gcp' && str(s, 'gcp.filestore') === 'regional'))
        return { kind: 'regional', label: 'Regional', title: 'Stores data across zones in the region.' };
      return count(1, provider);
    case 'dns':
      return { kind: 'global', label: 'Global', title: 'Served from the provider’s global network.' };
  }
  if (REGIONAL.has(item.svc)) return { kind: 'regional', label: 'Regional', title: 'Runs across the zones of the region by design.' };
  return undefined;
}

/** The field VMs and caches show to record their spread. */
export const zonesField = {
  key: 'zones',
  label: 'Zones',
  type: 'number' as const,
  min: 1,
  step: 1,
  help: 'How many zones the instances spread across. Placement only; the price does not change.',
};
