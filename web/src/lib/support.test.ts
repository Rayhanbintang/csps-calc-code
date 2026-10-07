import { describe, expect, it } from 'vitest';
import { supportFee, tieredFee } from './support';

describe('support plans', () => {
  it('tiers are marginal, like tax brackets', () => {
    // AWS Business Support+: 9% of $10K + 7% of $10K = $900 + $700
    expect(tieredFee(20_000, [[10_000, 0.09], [80_000, 0.07], [250_000, 0.05], [Infinity, 0.03]])).toBeCloseTo(1600, 6);
  });
  it('the minimum applies when the share is smaller', () => {
    expect(supportFee('aws', 'business-plus', 200, 0)!.monthly).toBe(29);
    expect(supportFee('aws', 'enterprise', 20_000, 0)!.monthly).toBe(5_000);
  });
  it('AWS Enterprise above its minimum: 10% of the first $150K, 7% of the rest', () => {
    expect(supportFee('aws', 'enterprise', 200_000, 0)!.monthly).toBeCloseTo(15_000 + 3_500, 2);
  });
  it('upfront payments count one twelfth a month', () => {
    expect(supportFee('aws', 'business-plus', 0, 12_000)!.monthly).toBeCloseTo(90, 2);
  });
  it('Google Standard is 3% with a $29 minimum; Enhanced starts at $100', () => {
    expect(supportFee('gcp', 'standard', 5_000, 0)!.monthly).toBe(150);
    expect(supportFee('gcp', 'enhanced', 500, 0)!.monthly).toBe(100);
  });
  it('Azure plans are flat', () => {
    expect(supportFee('azure', 'prodirect', 123_456, 0)!.monthly).toBe(1_000);
  });
  it('Basic and OCI charge nothing', () => {
    expect(supportFee('aws', 'basic', 50_000, 0)).toBeUndefined();
    expect(supportFee('oci', 'anything', 50_000, 0)).toBeUndefined();
    expect(supportFee('aws', undefined, 50_000, 0)).toBeUndefined();
  });
});
