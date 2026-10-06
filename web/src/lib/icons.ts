// Provider service icons in public/icons/<provider>/<service>.svg. AWS Architecture Icons,
// Google Cloud icons and Oracle's OCI diagram toolkit are offered for architecture diagrams.
// Oracle ships draw.io stencils; they were converted to SVG once. Azure and on-premises
// cards keep their text tag.
import type { Provider } from './types';

const HAVE: Partial<Record<Provider, Set<string>>> = {
  aws: new Set(["apigw", "cache", "containers", "db", "ddos", "disk", "dns", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
  gcp: new Set(["apigw", "cache", "containers", "db", "ddos", "disk", "dns", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
  oci: new Set(["apigw", "containers", "db", "ddos", "disk", "dns", "egress", "endpoint", "file", "functions", "interconnect", "ip", "k8s", "lb", "monitoring", "nat", "notify", "object", "queue", "vm", "vpc", "vpn", "waf"]),
};

/** URL of the provider's icon for a service, or undefined when there is none. */
export function iconUrl(provider: Provider, svc: string): string | undefined {
  return HAVE[provider]?.has(svc) ? `/icons/${provider}/${svc}.svg` : undefined;
}
