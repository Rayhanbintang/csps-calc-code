// The estimate model. The canvas edits it, the share link stores it, and later the AWS
// importer and the chat input only have to produce it.

export type Provider = 'aws' | 'gcp' | 'oci' | 'onprem';

export const HOURS_PER_MONTH = 730;

/** One estimate: provider accounts, each holding region boxes, each holding items. */
export interface Estimate {
  v: 1;
  name: string;
  accounts: Account[];
}

export interface Account {
  id: string;
  provider: Provider;
  label: string; // e.g. "DC" or "Production account"
  /** Account ID, project ID, compartment or data-centre name. Optional, shown in exports. */
  ref?: string;
  regions: RegionBox[];
  /** Folded on the canvas: only the header shows. */
  folded?: boolean;
}

export interface RegionBox {
  id: string;
  region: string; // provider region code; "onprem" for the on-prem box
  label?: string;
  items: Item[];
  folded?: boolean;
  /** Set by a cloud switch: the region the box started in and the one the switch picked.
   *  The next switch measures from `from`, so AWS Jakarta → OCI Batam → Google Cloud lands
   *  in Jakarta, not in Singapore (closest to Batam). A region picked by hand resets it. */
  swap?: { from: string; picked: string };
}

export type Spec = Record<string, string | number | boolean>;

/** A priced item. `svc` is a provider-neutral service, so an item can move between clouds. */
export interface Item {
  id: string;
  svc: string;
  name?: string;
  qty: number;
  spec: Spec;
  pricing?: Pricing;
  /** Set when the item changed provider and the SA should confirm the equivalent. */
  check?: string;
  /** Items inside this one (VPC → cluster → VM → disk). Counts multiply down the tree. */
  children?: Item[];
  /** Folded on the canvas. */
  folded?: boolean;
}

export interface Pricing {
  model: 'od' | 'ri' | 'sp' | 'cud';
  term?: 1 | 3;
  pay?: 'no' | 'partial' | 'all';
  cls?: 's' | 'c'; // RI: standard or convertible
  kind?: 'c' | 'e'; // SP: compute or EC2 instance
}

/** One priced line of an item, e.g. "Instance hours" or "Storage (GB-month)". */
export interface Line {
  label: string;
  qty: number;
  unit: string;
  rate: number; // USD per unit
  monthly: number; // USD per month
}

export interface Priced {
  lines: Line[];
  monthly: number;
  upfront: number;
  /** SKU or shape actually priced, e.g. "m5.large" or "n2-standard-2". */
  sku?: string;
  notes: string[];
  /** Set when the item cannot be priced here; monthly is 0. */
  unavailable?: string;
}
