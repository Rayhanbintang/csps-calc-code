import { vm } from './vm';
import { k8s, functions, containers } from './compute';
import { disk, object, file } from './storage';
import { db, cache } from './db';
import { vpc, lb, nat, ip, endpoint, egress, vpn, interconnect, dns } from './network';
import { waf, ddos, apigw, queue, notify, monitoring, custom } from './more';
import type { Service } from './util';

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

export function service(id: string): Service | undefined {
  return byId.get(id);
}

export type { Service, Field, ModelOption, Ctx, Option } from './util';
