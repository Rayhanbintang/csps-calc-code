import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readSheet } from './xlsxread';
import { SHEET, parseTemplate, purchase } from './awsimport';

const REGIONS = ['ap-southeast-1', 'ap-southeast-3', 'us-east-1', 'us-east-2'];
const fixture = () => readFileSync(new URL('./fixtures/ec2-bulk.xlsx', import.meta.url));

describe('AWS EC2 bulk upload template', () => {
  it('reads the Inputs sheet of a workbook', async () => {
    const rows = await readSheet(fixture(), SHEET);
    expect(rows[1][5]).toBe('Instance Type');
    expect(rows[2][2]).toBe('App & web');
  });

  it('turns rows into VM cards with disks inside, per region and group', async () => {
    const res = parseTemplate(await readSheet(fixture(), SHEET), REGIONS);
    expect(res.rows).toBe(3);
    expect(res.instances).toBe(6);
    expect(res.boxes.map((b) => `${b.region}/${b.group}`)).toEqual(['ap-southeast-3/Production', 'ap-southeast-1/Beta']);

    const [web, db] = res.boxes[0].items;
    expect(web.qty).toBe(3);
    expect(web.spec['aws.type']).toBe('m6i.large');
    expect(web.pricing).toEqual({ model: 'sp', term: 3, pay: 'all', kind: 'c' });
    expect(web.children?.[0].spec).toMatchObject({ gb: 100, type: 'ssd', 'aws.volume': 'gp3', iops: 5000, mbps: 250 });
    expect(web.check).toBeUndefined();

    expect(db.spec).toMatchObject({ os: 'windows', sw: 'sql-std', tenancy: 'dedicated' });
    // Dedicated Instances are priced on demand only; the 1-year RI in the template is flagged.
    expect(db.pricing).toEqual({ model: 'od' });
    expect(db.check).toMatch(/on demand only/);
    expect(res.boxes[0].dedicated).toBe(true);
    expect(db.children?.[0].spec).toMatchObject({ type: 'ssd-fast', 'aws.volume': 'io2', gb: 500 });
    // Daily snapshots of 50 GB kept a month: a 500 GB first copy plus 29 × 50 GB = 1,950 GB.
    const snaps = db.children?.[1];
    expect(snaps?.svc).toBe('backup');
    expect(snaps?.spec).toMatchObject({ on: 'vm', what: 'vm', gb: 1950 });

    const batch = res.boxes[1].items[0];
    expect(batch.spec.hours).toBe(365); // 84 of 168 hours a week
    expect(batch.spec.os).toBe('rhel-ha');
    expect(batch.pricing).toEqual({ model: 'od' });
    expect(batch.check).not.toMatch(/High Availability/);
    expect(batch.check).toMatch(/Spot/);
    expect(batch.children).toBeUndefined();
  });

  it('names each skipped row and why', async () => {
    const res = parseTemplate(await readSheet(fixture(), SHEET), REGIONS);
    expect(res.skipped).toEqual([
      'Row 6: ap-southeast-1-bkk-1 is not in the AWS price list (Local Zones and Wavelength zones are not covered).',
      'Row 7: purchasing option "5 Yr Magic Plan" is not recognised.',
    ]);
  });

  it('knows every purchasing option of the template', () => {
    for (const y of [1, 3]) for (const p of ['All', 'Partial', 'No'])
      for (const k of ['Compute Savings Plan', 'EC2 Instance Savings Plan', 'Standard Reserved Instances Plan', 'Convertible Reserved Instances Plan'])
        expect(purchase(`${y} Yr ${p} Upfront ${k}`), `${y} ${p} ${k}`).toBeDefined();
  });

  // AWS's own file, when it is on this machine (it is not committed).
  const real = 'C:/Users/Raybin/Downloads/Amazon_EC2_Instances_BulkUpload_Template_Commercial.xlsx'.replace(/^C:/, existsSync('/mnt/c') ? '/mnt/c' : 'C:');
  it.skipIf(!existsSync(real))('reads the template AWS publishes', async () => {
    const res = parseTemplate(await readSheet(readFileSync(real), SHEET), REGIONS);
    expect(res.rows).toBe(2);
    expect(res.boxes[0].items[0].spec['aws.type']).toBe('t4g.nano');
    expect(res.boxes[1].items[0].spec.hours).toBe(Math.round((167 * 730) / 168));
  });
});

describe('our sample file (public/templates/csps-ec2-sample.xlsx)', () => {
  it('imports every row with nothing skipped or flagged', async () => {
    const file = readFileSync(new URL('../../public/templates/csps-ec2-sample.xlsx', import.meta.url));
    const res = parseTemplate(await readSheet(file, SHEET), REGIONS);
    expect(res.skipped).toEqual([]);
    expect(res.rows).toBe(3);
    expect(res.instances).toBe(7);
    const all = res.boxes.flatMap((b) => b.items);
    expect(all.filter((i) => i.check)).toEqual([]);
    // Daily 5 GB snapshots of a 100 GB disk, one month kept: 100 + 29 × 5 = 245 GB.
    expect(all[0].children?.[1].spec.gb).toBe(245);
  });
});
