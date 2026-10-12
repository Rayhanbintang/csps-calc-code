import { describe, expect, it } from 'vitest';
import { zonesOf } from './zones';
import { freeTier, freeTierText } from './freetier';
import type { Item } from './types';

const it_ = (svc: string, spec: Item['spec'] = {}): Item => ({ id: 'x', svc, qty: 1, spec });

describe('zone badge', () => {
  it('reads the Zones field of VMs and caches; 1 when missing', () => {
    expect(zonesOf(it_('vm'), 'aws')?.label).toBe('1 zone');
    expect(zonesOf(it_('vm', { zones: 3 }), 'aws')).toMatchObject({ kind: 'multi', label: '3 zones' });
    expect(zonesOf(it_('cache', { zones: 2 }), 'gcp')?.kind).toBe('multi');
  });
  it('reads high availability of databases', () => {
    expect(zonesOf(it_('db', { ha: 'multi' }), 'aws')?.label).toBe('Multi-zone');
    expect(zonesOf(it_('db', { ha: 'single' }), 'oci')?.kind).toBe('single');
  });
  it('marks regional and global services, and none for on-premises', () => {
    expect(zonesOf(it_('object'), 'gcp')?.kind).toBe('regional');
    expect(zonesOf(it_('dns'), 'aws')?.kind).toBe('global');
    expect(zonesOf(it_('file', { 'gcp.filestore': 'zonal' }), 'gcp')?.kind).toBe('single');
    expect(zonesOf(it_('vm'), 'onprem')).toBeUndefined();
  });
});

describe('free tiers', () => {
  it('are listed per service and cloud, and the text says totals charge them', () => {
    expect(freeTier('egress', 'oci')?.text).toMatch(/10 TB/);
    expect(freeTierText('notify', 'aws')).toMatch(/charges this in full/);
    expect(freeTier('vpc', 'aws')).toBeUndefined();
  });
});
