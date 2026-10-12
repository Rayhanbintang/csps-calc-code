// What shipped, by date. A version is the day it went live. Newest first. Visitor-facing
// text: plain, short, passes stop-slop.

export interface Release {
  date: string; // YYYY-MM-DD, the version
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    date: '2026-10-12',
    items: [
      'A landing page, plus privacy, terms, trademarks and this changelog. The calculator moved to /app; old share links still open.',
      'AI review (beta): a chat panel on the right of the board. Start with "Review my design" or ask anything about the estimate. It never changes your cards.',
      "A share link checks its saved numbers against today's prices and, when they changed, offers a new link with today's prices.",
      'Totals no longer subtract free tiers. The info icon on a card shows the allowance.',
      'If a cloud does not sell something, the option is greyed out with the reason instead of priced as something else: MariaDB off AWS, Arm on Cloud Run and Azure Functions, the Classic load balancer off AWS, and more.',
      'Red Hat OpenShift on the Kubernetes card: ROSA on AWS and ARO on Azure.',
      'Dedicated Instances and RHEL with HA on AWS.',
      'AWS files: import the EC2 and EBS bulk upload templates and a calculator.aws CSV export, download a sample, or fill AWS\'s EC2 template from your estimate.',
      'A card dropped on empty box space lands where you let go. Region boxes copy into another tab.',
      'Azure database backups use each database\'s own backup price. OCI prices Arm containers on Ampere A1.',
      'New icons for CDN, backup and Google Cloud egress.',
      'S3 Glacier Deep Archive is priced from its own AWS price list; it was priced as Glacier Flexible Retrieval before.',
      'A card the cloud does not sell shows a dash, not $0.00. Fields saved before they existed show their default instead of a blank.',
      'After a cloud switch, Azure VMs carry the same "matched by size" note as the other clouds.',
    ],
  },
  {
    date: '2026-10-07',
    items: [
      'Add-ons inside resources: a WAF inside a load balancer, backup inside a VM, and more. New CDN and backup cards.',
      'Support plans per site, priced by each provider\'s own rule.',
      'Cards inside a region box can be placed freely, with alignment guides, arrow keys and a minimap.',
      'Copy a whole site into another tab. Delete buttons on cards and a review table per site.',
    ],
  },
  {
    date: '2026-10-06',
    items: [
      'Microsoft Azure as a fourth cloud.',
      'A board you can pan and zoom, with sites and region boxes placed anywhere. Drag and drop works with mouse, touch and pen.',
      'Copy cards, region boxes and sites as they are or scaled to a percentage.',
      'Zone badges, free-tier information, provider icons, more database engines, and Savings Plans for Fargate and Lambda.',
    ],
  },
  {
    date: '2026-10-05',
    items: [
      'First release: AWS, Google Cloud and Oracle Cloud priced from their public price lists, refreshed every day.',
      'Cards nest (VPC, cluster, VM, disk) and counts multiply through them.',
      'Tabs for options, a one-click cloud switch per site, share links, and Excel and PDF exports.',
      'Import of the AWS EC2 bulk upload template.',
    ],
  },
];
