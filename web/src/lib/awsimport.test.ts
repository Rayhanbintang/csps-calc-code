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

    expect(db.spec).toMatchObject({ os: 'windows', sw: 'sql-std' });
    expect(db.pricing).toEqual({ model: 'ri', term: 1, pay: 'no', cls: 's' });
    expect(db.children?.[0].spec).toMatchObject({ type: 'ssd-fast', 'aws.volume': 'io2', gb: 500 });
    expect(db.check).toMatch(/Dedicated tenancy/);
    expect(db.check).toMatch(/snapshots \(daily, 50 GB each\)/);

    const batch = res.boxes[1].items[0];
    expect(batch.spec.hours).toBe(365); // 84 of 168 hours a week
    expect(batch.spec.os).toBe('rhel');
    expect(batch.pricing).toEqual({ model: 'od' });
    expect(batch.check).toMatch(/High Availability/);
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
