import { describe, expect, it } from 'vitest';
import { overview, type Invoice, type WorkspaceData } from '../shared/types';

function invoice(date: string, amount = 100, deliveryStatus = 'Processing'): Invoice {
  return { id: date, number: date, date, total: amount, deliveryStatus,
    customer: 'Synthetic customer', phone: '', paymentStatus: 'Pending', tracking: '',
    expectedCredit: amount, actualCredit: 0 };
}
function report(asOf: string, timezone: string, invoices: Invoice[], days = 7) {
  const data: WorkspaceData = { mode: 'google', asOf, timezone, invoices,
    products: [], warnings: [], limits: { products: 200, invoices: 1000 } };
  return overview(data, days);
}

describe('Business calendar reporting boundaries', () => {
  it('includes today in Dhaka before noon UTC, including when UTC is still yesterday', () => {
    // Dhaka is already 6 November. A date-only invoice must not wait until noon UTC.
    const r = report('2026-11-05T18:05:00Z', 'Asia/Dhaka', [invoice('2026-11-06', 250)]);
    expect(r.value).toBe(250);
    expect(r.series).toEqual([{ date: '2026-11-06', value: 250 }]);
  });
  it('counts exactly seven calendar dates, includes the first day and excludes tomorrow', () => {
    const r = report('2026-11-05T18:05:00Z', 'Asia/Dhaka', [
      invoice('2026-10-30', 900), invoice('2026-10-31', 10),
      invoice('2026-11-06', 20), invoice('2026-11-07', 800),
    ]);
    expect(r.value).toBe(30);
    expect(r.invoices).toBe(2);
  });
  it('uses the configured local day when UTC is already on the following date', () => {
    const r = report('2026-11-06T07:30:00Z', 'America/Los_Angeles', [
      invoice('2026-11-05', 40), invoice('2026-11-06', 600),
    ]);
    expect(r.value).toBe(40);
  });
  it('keeps calendar-day counts across a daylight-saving change', () => {
    const r = report('2026-11-02T07:30:00Z', 'America/Los_Angeles', [
      invoice('2026-10-25', 700), invoice('2026-10-26', 10),
      invoice('2026-11-01', 20), invoice('2026-11-02', 600),
    ]);
    expect(r.value).toBe(30);
    expect(r.invoices).toBe(2);
  });
  it('includes leap day in a 30-day calendar window without including the preceding date', () => {
    const r = report('2028-03-01T00:00:00Z', 'Asia/Dhaka', [
      invoice('2028-01-31', 700), invoice('2028-02-01', 10),
      invoice('2028-02-29', 20), invoice('2028-03-01', 30), invoice('2028-03-02', 600),
    ], 30);
    expect(r.value).toBe(60);
    expect(r.invoices).toBe(3);
  });
  it('excludes invalid calendar dates and reversed sales while preserving valid date-only records', () => {
    const r = report('2026-03-02T00:00:00Z', 'Asia/Dhaka', [
      invoice('2026-02-30', 700), invoice('2026-03-01T09:00:00Z', 600),
      invoice('2026-03-01', 500, 'Returned'), invoice('2026-03-02', 25),
    ]);
    expect(r.value).toBe(25);
    expect(r.invoices).toBe(1);
  });
});
