// Support plans per provider, priced at the account level from the account's own spend.
// Rules come from each provider's support pricing page (read 2026-10-07); change the
// table here when a page changes. Tiers are marginal, like tax brackets: 10% of the first
// $10K, 7% of the next $70K, and so on. The plan costs the greater of that and its minimum.
import type { Provider } from './types';

export interface Plan {
  id: string;
  label: string;
  /** Monthly minimum (or the flat fee when there are no tiers). */
  min: number;
  /** [up to this much monthly spend, rate]; the last entry runs to Infinity. */
  tiers?: [number, number][];
}

export interface ProviderSupport {
  /** Where the rule comes from. */
  src: string;
  plans: Plan[];
  /** Shown instead of a plan choice when the provider has nothing to buy. */
  included?: string;
}

export const SUPPORT: Partial<Record<Provider, ProviderSupport>> = {
  aws: {
    src: 'https://aws.amazon.com/premiumsupport/pricing/',
    plans: [
      { id: 'basic', label: 'Basic (no charge)', min: 0 },
      { id: 'business-plus', label: 'Business Support+', min: 29, tiers: [[10_000, 0.09], [80_000, 0.07], [250_000, 0.05], [Infinity, 0.03]] },
      { id: 'enterprise', label: 'Enterprise', min: 5_000, tiers: [[150_000, 0.1], [500_000, 0.07], [1_000_000, 0.05], [Infinity, 0.03]] },
      { id: 'unified-ops', label: 'Unified Operations', min: 50_000, tiers: [[1_000_000, 0.1], [5_000_000, 0.06], [Infinity, 0.05]] },
    ],
  },
  gcp: {
    src: 'https://cloud.google.com/support/pricing',
    plans: [
      { id: 'basic', label: 'Basic (no charge)', min: 0 },
      { id: 'standard', label: 'Standard', min: 29, tiers: [[Infinity, 0.03]] },
      { id: 'enhanced', label: 'Enhanced', min: 100, tiers: [[10_000, 0.1], [80_000, 0.07], [250_000, 0.05], [Infinity, 0.03]] },
      { id: 'premium', label: 'Premium', min: 15_000, tiers: [[150_000, 0.1], [500_000, 0.07], [1_000_000, 0.05], [Infinity, 0.03]] },
    ],
  },
  azure: {
    src: 'https://azure.microsoft.com/en-us/support/plans/',
    plans: [
      { id: 'basic', label: 'Basic (no charge)', min: 0 },
      { id: 'developer', label: 'Developer', min: 29 },
      { id: 'standard', label: 'Standard', min: 100 },
      { id: 'prodirect', label: 'Professional Direct', min: 1_000 },
    ],
  },
  oci: {
    src: 'https://www.oracle.com/cloud/pricing/',
    plans: [],
    included: 'OCI includes support in its prices.',
  },
};

/** Monthly spend through marginal tiers. */
export function tieredFee(spend: number, tiers: [number, number][]): number {
  let fee = 0, from = 0;
  for (const [to, rate] of tiers) {
    if (spend <= from) break;
    fee += (Math.min(spend, to) - from) * rate;
    from = to;
  }
  return fee;
}

export interface SupportFee {
  plan: string;
  monthly: number;
  /** How the fee was worked out, for the card and the exports. */
  basis: string;
}

/** The monthly support fee of a plan, given the account's monthly spend and its upfront
 *  payments. Upfront payments count as one twelfth a month, so a reservation paid up
 *  front still adds to the base. Undefined when nothing is charged. */
export function supportFee(provider: Provider, planId: string | undefined, monthly: number, upfront: number): SupportFee | undefined {
  const plan = SUPPORT[provider]?.plans.find((p) => p.id === planId);
  if (!plan || (!plan.min && !plan.tiers)) return undefined;
  const base = monthly + upfront / 12;
  const pct = plan.tiers ? tieredFee(base, plan.tiers) : 0;
  const fee = Math.max(plan.min, pct);
  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const basis = !plan.tiers
    ? `${money(plan.min)} a month, flat`
    : fee === plan.min
      ? `minimum ${money(plan.min)} a month (the share of ${money(base)} spend is ${money(pct)})`
      : `share of ${money(base)} monthly spend${upfront ? ', upfront spread over 12 months' : ''}`;
  return { plan: plan.label, monthly: Math.round(fee * 100) / 100, basis };
}
