# csps-calc

A cost calculator for AWS, Google Cloud, Oracle Cloud and Microsoft Azure on one page.

- Lay sites out on a board, side by side or stacked: a data centre on AWS Jakarta and a recovery site on Azure Indonesia Central in one estimate. Pan and zoom like a diagram tool.
- Copy a card, a region or a whole site at the same size or at any percentage, for example a recovery site at 50%.
- Build the estimate like the architecture: a VPC holds a Kubernetes cluster, the cluster holds node groups, each node group holds its disks. Counts multiply down the tree, so 3 nodes with 2 disks each price 6 disks.
- Drag a workload, or a whole VPC with everything inside, to another region or another cloud and see the new price. Items moved between clouds keep their size and get the nearest type, flagged for a check.
- Compare on-demand, Savings Plans, Reserved Instances and committed use in one matrix next to the spec.
- Attach add-ons to what they serve: a WAF with 3 rules on one load balancer and 1 rule on another, DDoS protection on a CDN, backups on a database.
- Add each cloud's support plan to a site; the fee follows the provider's published rule.
- Place cards freely inside a region, with guides, a minimap and arrow-key moves.
- Share the estimate by link, or export it to Excel (full detail, a sheet per region) and PDF (one-page summary).
- Each card shows whether the service runs in one zone or several, and the cloud's free tier for it.
- A shared link also shows what the same design costs at today's prices.
- Works with mouse, touch and pen.
- Plain reminders catch common gaps: replication traffic between sites, VMs without disks, sites with no VPN or interconnect.

Live at <https://csps-calc.vercel.app>.

Prices are estimates in USD at public list price. Taxes are not included.

## How prices get here

A GitHub Action runs every day. It downloads the public price lists (AWS Price List API, Google Cloud Billing Catalog API, Oracle's price list, Azure Retail Prices API), keeps the rows the calculator uses, and deploys them with the site as gzipped JSON. The browser loads only the files for the regions on the canvas. Alibaba Cloud is not included: its terms forbid compiling its prices. Tencent Cloud and BytePlus are not included for the same reason.

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
