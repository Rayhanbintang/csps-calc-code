// Reading Azure retail meters (etl/internal/azure). A meter's price is per "unit of
// measure", which can be "1 Hour", "10K", "1M", "100 Hours" or "1 GB/Month"; tiered
// meters repeat with a higher starting count `f`.
import type { AzRow } from '../prices';

/** How many base units one price covers: "10K" → 10,000, "1M" → 1,000,000, "100 Hours" → 100. */
export function azPer(unit: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([KM])?/i.exec(unit);
  if (!m) return 1;
  const n = Number(m[1]);
  const mult = m[2]?.toUpperCase() === 'K' ? 1e3 : m[2]?.toUpperCase() === 'M' ? 1e6 : 1;
  return n * mult || 1;
}

/** Pay-as-you-go rows of one meter, cheapest tier first by start. */
export function azMeter(rows: AzRow[], test: (r: AzRow) => boolean): AzRow[] {
  return rows.filter((r) => r.t === 'c' && test(r)).sort((a, b) => (a.f ?? 0) - (b.f ?? 0));
}

/** Price per base unit of the first (or only) tier. */
export function azRate(tiers: AzRow[]): number {
  const r = tiers[0];
  return r ? r.r / azPer(r.u) : NaN;
}

/** Cost of `qty` base units through the meter's tiers. Tier starts are in the meter's
 *  own unit ("10K" tiers start in tens of thousands). */
export function azCost(tiers: AzRow[], qty: number): number {
  if (!tiers.length) return NaN;
  const per = azPer(tiers[0].u);
  const units = qty / per;
  let total = 0;
  for (let i = 0; i < tiers.length; i++) {
    const from = tiers[i].f ?? 0;
    const to = i + 1 < tiers.length ? tiers[i + 1].f ?? Infinity : Infinity;
    if (units <= from) break;
    total += (Math.min(units, to) - from) * tiers[i].r;
  }
  return total;
}

/** Reservation hourly rate: Azure lists the whole term's price. */
export function azReservedHourly(row: AzRow | undefined): number {
  if (!row || !row.y) return NaN;
  return row.r / (8760 * row.y);
}
