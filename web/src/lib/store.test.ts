import { describe, expect, it } from 'vitest';
import { app, addAccount, addItem, copyBox, newTab, openTab } from './store.svelte';

describe('copy a region box', () => {
  it('into another tab: a new site on the same cloud, then that site again', () => {
    const src = app.est.accounts[0];
    addItem(src.regions[0].id, 'vm');
    const from = app.tab;
    const boxId = src.regions[0].id;
    newTab();
    const to = app.tab;
    openTab(from);
    const before = app.tabs.find((t) => t.id === to)!.est.accounts.length;

    copyBox(boxId, 1, to, '');
    const est = app.tabs.find((t) => t.id === to)!.est;
    expect(est.accounts.length).toBe(before + 1);
    const site = est.accounts[est.accounts.length - 1];
    expect(site.provider).toBe(src.provider);
    expect(site.regions[0].items[0].svc).toBe('vm');
    expect(site.regions[0].items[0].id).not.toBe(src.regions[0].items[0].id);

    copyBox(boxId, 1, to, site.id);
    expect(est.accounts.length).toBe(before + 1);
    expect(est.accounts[est.accounts.length - 1].regions.length).toBe(2);
  });

  it('refuses a site on another cloud and makes a new one instead', () => {
    addAccount('gcp');
    const gcp = app.est.accounts[app.est.accounts.length - 1];
    const aws = app.est.accounts[0];
    const n = app.est.accounts.length;
    copyBox(aws.regions[0].id, 1, app.tab, gcp.id);
    expect(app.est.accounts.length).toBe(n + 1);
    expect(app.est.accounts[n].provider).toBe('aws');
  });
});
