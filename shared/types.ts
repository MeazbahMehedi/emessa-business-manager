import { calendarWindow, isoCalendarDay } from './dates';

export interface Product {
  id: string; sku: string; name: string; category: string;
  openingStock: number | null; stock: number | null;
  price: number | null; cost: number | null;
}
export interface Invoice {
  id: string; number: string; date: string; customer: string; phone: string;
  total: number | null; paymentStatus: string; deliveryStatus: string;
  tracking: string; expectedCredit: number | null; actualCredit: number | null;
}
export interface WorkspaceData {
  mode: 'sample' | 'google'; asOf: string; timezone: string;
  products: Product[]; invoices: Invoice[];
  warnings: string[]; limits: { products: number; invoices: number };
}
export interface ConnectionCheck { label: string; status: 'passed' | 'needs_setup' | 'not_run' | 'failed'; detail: string }
export interface ConnectionData {
  state: 'sample' | 'connected' | 'setup_required' | 'attention';
  checkedAt: string; readOnly: true; checks: ConnectionCheck[];
}
export interface SessionView {
  name: string; email: string; mode: 'sample' | 'google'; csrfToken: string; expiresAt: string;
}
export interface Bootstrap { googleLoginAvailable: boolean; localPreviewAvailable: boolean }
export interface ApiEnvelope<T> { ok: true; data: T; requestId: string }
export interface ApiFailure { ok: false; error: { code: string; message: string }; requestId: string }

export const statusClass = (status: string) => {
  const s = status.toLowerCase();
  if (['delivered', 'received', 'paid', 'in stock', 'passed'].includes(s)) return 'positive';
  if (['returned', 'cancelled', 'voided', 'failed', 'oversold', 'out of stock'].includes(s)) return 'negative';
  if (['pending', 'partial', 'low stock', 'processing', 'needs_setup'].includes(s)) return 'attention';
  return 'neutral';
};

export function overview(data: WorkspaceData, days: number) {
  const { start, end } = calendarWindow(data.asOf, data.timezone, days);
  const relevant = data.invoices.filter(i => {
    const day = isoCalendarDay(i.date);
    return day !== null && day >= start && day <= end && !['returned', 'cancelled', 'voided'].includes(i.deliveryStatus.toLowerCase());
  });
  const pending = data.invoices.filter(i => !['returned', 'cancelled', 'voided'].includes(i.deliveryStatus.toLowerCase()));
  const daily = new Map<string, number>();
  relevant.forEach(i => daily.set(i.date, (daily.get(i.date) || 0) + (i.total || 0)));
  return {
    stock: data.products.reduce((a, p) => a + (p.stock || 0), 0),
    value: relevant.reduce((a, i) => a + (i.total || 0), 0),
    receivable: pending.reduce((a, i) => a + (i.expectedCredit === null ? 0 : Math.max(0, i.expectedCredit - (i.actualCredit || 0))), 0),
    low: data.products.filter(p => p.stock !== null && p.stock <= 10).length,
    invoices: relevant.length,
    series: [...daily].sort((a,b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value })),
  };
}
