# Cloud Service ProviderS Calculator (csps-calc)

A free cost calculator that prices one design on AWS, Google Cloud, Oracle Cloud and Microsoft Azure on the same board.

**Open it:** <https://csps-calc.vercel.app>

## What it is for

Solution architects quote one design on several clouds. Each provider's own calculator has its own layout, so comparing them means four tabs and a spreadsheet. This calculator keeps the design in one place and prices it with each provider's public list prices, refreshed every day.

## What it does

- Sites and region boxes sit on one board: a data centre on one cloud and a recovery site on another, with a running total per box and site.
- Cards nest like the architecture: disks inside a VM, VMs inside a cluster, the cluster inside a VPC. Counts multiply through them.
- A site moves to another cloud in one step. The calculator picks the nearest region and a matching size, and flags each card to check.
- Each card compares on-demand with Savings Plans, Reserved Instances and committed-use discounts.
- Cards, region boxes and sites copy as they are or scaled, for example a recovery site at 50%.
- Imports from the AWS Pricing Calculator: an estimate's CSV export and the EC2 and EBS bulk upload templates. It can also fill AWS's EC2 template from an estimate.
- A share link opens a read-only page with the saved numbers and today's price beside them. Excel and PDF exports come from the same figures.
- An AI review (beta) answers questions about the estimate and points out risks and savings. It gives advice only and can make mistakes.

## What the numbers are

- Estimates in USD at public list price, before tax. Negotiated discounts and credits are not in them.
- Free-tier allowances are not taken off the totals. The info icon on a card shows the allowance.
- If a cloud does not sell an option, the calculator says so instead of pricing something else.
- Check prices with the provider before you buy, sign or quote.

Prices come from the AWS Price List API, the Google Cloud Billing Catalog API, Oracle's public price list and the Azure Retail Prices API. Alibaba Cloud, Tencent Cloud and BytePlus are not included: their terms forbid collecting their prices this way.

## More

- What changed and when: [changelog](https://csps-calc.vercel.app/changelog)
- [Privacy](https://csps-calc.vercel.app/privacy) · [Terms](https://csps-calc.vercel.app/terms) · [Trademarks and credits](https://csps-calc.vercel.app/legal)
- Questions and bug reports: [GitHub Issues](https://github.com/Rayhanbintang/csps-calc-code/issues)

Not affiliated with or endorsed by Amazon Web Services, Google Cloud, Oracle, Microsoft or Red Hat.
