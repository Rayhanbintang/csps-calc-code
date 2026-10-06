// Provider service icons in public/icons/<provider>/<service>.svg. AWS Architecture Icons,
// Google Cloud icons, Oracle's OCI diagram toolkit and Microsoft's Azure architecture icons
// are offered for architecture diagrams. Oracle ships draw.io stencils; they were converted
// to SVG once. On-premises cards keep their text tag.
import type { Provider } from './types';

const HAVE: Partial<Record<Provider, Set<string>>> = {
  aws: new Set(["apigw", "cache", "containers", "db", "ddos", "disk", "dns", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
  gcp: new Set(["apigw", "cache", "containers", "db", "ddos", "disk", "dns", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
  oci: new Set(["apigw", "containers", "db", "ddos", "disk", "dns", "egress", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
  azure: new Set(["apigw", "cache", "containers", "db", "ddos", "disk", "dns", "egress", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
};

/** URL of the provider's icon for a service, or undefined when there is none. */
export function iconUrl(provider: Provider, svc: string): string | undefined {
  return HAVE[provider]?.has(svc) ? `/icons/${provider}/${svc}.svg` : undefined;
}
