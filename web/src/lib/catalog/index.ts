import { vm } from './vm';
import { k8s, functions, containers } from './compute';
import { disk, object, file } from './storage';
import { db, cache } from './db';
import { vpc, lb, nat, ip, endpoint, egress, vpn, interconnect, dns } from './network';
import { waf, ddos, apigw, queue, notify, monitoring, custom } from './more';
import type { Service } from './util';
import { azureImpls } from './azure';

/** Every service, in palette order. */
export const services: Service[] = [
  vm, k8s, containers, functions,
  disk, object, file,
  db, cache,
  vpc, lb, nat, ip, endpoint, egress, vpn, interconnect, dns,
  waf, ddos,
  apigw, queue, notify,
  monitoring,
  custom,
];

const byId = new Map(services.map((s) => [s.id, s]));

// Azure pricers live in one file; each joins its service here.
for (const [id, impl] of Object.entries(azureImpls)) {
  const s = byId.get(id);
  if (s) s.providers.azure = impl;
}

export function service(id: string): Service | undefined {
  return byId.get(id);
}

export type { Service, Field, ModelOption, Ctx, Option } from './util';
