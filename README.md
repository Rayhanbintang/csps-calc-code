# csps-calc

A cost calculator for AWS, Google Cloud and Oracle Cloud on one page.

- Put sites side by side: a data centre on AWS Jakarta and a recovery site on Google Cloud Jakarta in one estimate.
- Drag a workload to another region or another cloud and see the new price. A VM moved between clouds keeps its vCPU and memory and gets the nearest machine type, flagged for a check.
- Compare on-demand, Savings Plans, Reserved Instances and committed use in one matrix next to the spec.
- Share the estimate by link, or export it to Excel (full detail, a sheet per region) and PDF (one-page summary).
- Plain reminders catch common gaps: replication traffic between sites, VMs without disks, sites with no VPN or interconnect.

Live at <https://csps-calc.vercel.app>.

Prices are estimates in USD at public list price. Taxes are not included.

## How prices get here

A GitHub Action runs every day. It downloads the public price lists (AWS Price List API, Google Cloud Billing Catalog API, Oracle's price list), keeps the rows the calculator uses, and deploys them with the site as gzipped JSON. The browser loads only the files for the regions on the canvas. Alibaba Cloud is not included: its terms forbid compiling its prices.

| Folder | What it holds |
|---|---|
| `etl/` | Go price fetcher (`go run ./cmd/fetch`) |
| `web/` | Svelte app: canvas, pricing logic per service (`src/lib/catalog`), tests |
| `api/`, `apilib/` | Go functions on Vercel: share links (Supabase) and Excel/PDF export |
| `supabase/` | Database migration for saved estimates |

## Run it locally

```bash
cd etl && GCP_BILLING_API_KEY=... go run ./cmd/fetch -out ../web/public/prices -regions ap-southeast-3
cd web && npm ci && npm run dev
```

`npm test` in `web/` prices real items against the fetched files and checks the dollar values.
