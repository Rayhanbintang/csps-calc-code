import { describe, expect, it } from 'vitest';
import type { Account, Item } from './types';
import { blockerMessage, nearestRegion, swapBlockers } from './swap';

const item = (id: string, svc: string, children?: Item[]): Item => ({ id, svc, qty: 1, spec: {}, children });
const site = (items: Item[]): Account => ({ id: 'a', provider: 'aws', label: 'DC', regions: [{ id: 'r', region: 'ap-southeast-3', items }] });

describe('switching a site to another cloud', () => {
  it('picks the nearest region of the new cloud', () => {
    expect(nearestRegion('ap-southeast-3', ['asia-southeast1', 'asia-southeast2', 'us-central1'])).toBe('asia-southeast2');
    // Oracle has no Jakarta region: Batam is the closest.
    expect(nearestRegion('ap-southeast-3', ['ap-singapore-1', 'ap-batam-1', 'ap-tokyo-1'])).toBe('ap-batam-1');
    expect(nearestRegion('us-east-1', ['us-ashburn-1', 'us-phoenix-1'])).toBe('us-ashburn-1');
  });

  it('falls back to the new cloud default region when a location is unknown', () => {
    // A region missing from the coordinates table: the default, not the first listed.
    expect(nearestRegion('xx-new-1', ['af-south-1', 'us-east-1', 'eu-west-1'], 'us-east-1')).toBe('us-east-1');
    // Known start, but none of the candidates has a location.
    expect(nearestRegion('ap-southeast-3', ['zz-a-1', 'zz-b-1', 'zz-c-1'], 'zz-b-1')).toBe('zz-b-1');
    // A default the cloud does not list: the first listed region.
    expect(nearestRegion('xx-new-1', ['af-south-1', 'eu-west-1'], 'us-east-1')).toBe('af-south-1');
  });

  it('a site of common services can switch', () => {
    const acc = site([item('v', 'vpc', [item('k', 'k8s', [item('n', 'vm', [item('d', 'disk')])])]), item('db', 'db')]);
    expect(swapBlockers(acc, 'gcp')).toEqual([]);
    expect(swapBlockers(acc, 'oci')).toEqual([]);
  });

  it('the message names what is missing', () => {
    expect(blockerMessage('oci', ['DDoS protection (advanced)'])).toBe('Oracle Cloud has no DDoS protection (advanced), so this site cannot switch to Oracle Cloud.');
    expect(blockerMessage('gcp', ['A', 'B', 'C'])).toMatch(/^Google Cloud has no A, B and C,/);
  });
});

describe('switching back and forth', () => {
  it('measures from the region the box started in', async () => {
    const { swapAccount } = await import('./swap');
    const regions = (p: string, codes: string[]) => ({ [p]: { regions: codes.map((code) => ({ code, name: code, fetched: '' })) } });
    const manifest = { generated: '', providers: { ...regions('aws', ['ap-southeast-1', 'ap-southeast-3']), ...regions('gcp', ['asia-southeast1', 'asia-southeast2']), ...regions('oci', ['ap-singapore-1', 'ap-batam-1']) } };
    let acc = site([]);
    acc = (await swapAccount(acc, 'oci', manifest, new Set())).acc;
    expect(acc.regions[0].region).toBe('ap-batam-1');
    acc = (await swapAccount(acc, 'gcp', manifest, new Set())).acc;
    expect(acc.regions[0].region).toBe('asia-southeast2');
    acc = (await swapAccount(acc, 'aws', manifest, new Set())).acc;
    expect(acc.regions[0].region).toBe('ap-southeast-3');
    // A region picked by hand becomes the new starting point.
    acc.regions[0].region = 'ap-southeast-1';
    acc = (await swapAccount(acc, 'oci', manifest, new Set())).acc;
    expect(acc.regions[0].region).toBe('ap-singapore-1');
  });
});
