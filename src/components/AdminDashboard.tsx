'use client';

import { useEffect, useState } from 'react';
import { formatPaise } from '@/lib/format';

type Revenue = {
  serviceRevenueNetPaise: number;
  affiliateFeeRevenueNetPaise: number;
  totalRevenueNetPaise: number;
  capturedOrderPaymentCount: number;
  commissionPaidOutPaise: number;
  commissionAvailablePaise: number;
} | null;

type AffiliateRow = { affiliateId: string; referralCode: string; email: string; netCommissionPaise: number; conversionCount: number };

export function AdminDashboard() {
  const [revenue, setRevenue] = useState<Revenue>(null);
  const [affiliatePerformance, setAffiliatePerformance] = useState<AffiliateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/revenue');
        if (res.status === 403) {
          setError("You don't have permission to view revenue or affiliate reports.");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
        setRevenue(body.revenue);
        setAffiliatePerformance(body.affiliatePerformance);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, []);

  if (!loaded) return <p className="text-gray-500">Loading…</p>;
  if (error && !revenue && !affiliatePerformance) return <p className="text-red-700">{error}</p>;

  return (
    <div className="space-y-8">
      {revenue && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Revenue (live, not cached)</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Total net revenue" value={formatPaise(revenue.totalRevenueNetPaise)} />
            <Stat label="Service revenue" value={formatPaise(revenue.serviceRevenueNetPaise)} />
            <Stat label="Affiliate fee revenue" value={formatPaise(revenue.affiliateFeeRevenueNetPaise)} />
            <Stat label="Captured orders" value={String(revenue.capturedOrderPaymentCount)} />
            <Stat label="Commission paid out" value={formatPaise(revenue.commissionPaidOutPaise)} />
            <Stat label="Commission available" value={formatPaise(revenue.commissionAvailablePaise)} />
          </div>
        </div>
      )}

      {affiliatePerformance && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Top affiliates</h2>
          {affiliatePerformance.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No conversions yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-1 pr-4">Affiliate</th>
                  <th className="py-1 pr-4">Referral code</th>
                  <th className="py-1 pr-4">Conversions</th>
                  <th className="py-1">Net commission</th>
                </tr>
              </thead>
              <tbody>
                {affiliatePerformance.map((row) => (
                  <tr key={row.affiliateId} className="border-b border-gray-100">
                    <td className="py-1 pr-4">{row.email}</td>
                    <td className="py-1 pr-4 font-mono">{row.referralCode}</td>
                    <td className="py-1 pr-4">{row.conversionCount}</td>
                    <td className="py-1">{formatPaise(row.netCommissionPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!revenue && !affiliatePerformance && <p className="text-red-700">{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}
