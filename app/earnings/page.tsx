"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgePercent,
  CircleCheck,
  CircleDollarSign,
  Eye,
  Globe,
  Loader,
  Lock,
  Receipt,
  Wallet,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-modal";

/**
 * Creator Earnings Dashboard
 * - Balance & impression summary cards, live from Supabase (RLS-protected).
 * - Monetag regional CPM breakdown (Tier 1 vs Tier 3) from ad_impressions.
 * - Creator share calculator (defaults to 60% — the platform's cut model).
 * - "Request payout" calls the request_payout() database function, which
 *   needs supabase/payout-request.sql to be run once in the SQL Editor.
 */

type ImpressionRow = {
  region_tier: string;
  cpm_rate: number | string | null;
  creator_share: number | string | null;
};

type PayoutRow = {
  id: string;
  amount: number | string | null;
  status: string;
  created_at: string;
};

type RegionStats = {
  impressions: number;
  avgCpm: number;
  gross: number;
  earned: number;
};

type Feedback = { type: "success" | "error"; message: string };

const REGIONS = ["Tier 1", "Tier 3"] as const;
const MIN_PAYOUT = 10;

type DashboardResults = {
  profileResult: {
    data: { balance: number | string } | null;
    error: { message: string } | null;
  };
  impressionsResult: { data: ImpressionRow[] | null };
  payoutsResult: { data: PayoutRow[] | null };
};

// Pure data fetch (no state) shared by the load effect and the refresh after a payout.
async function fetchDashboardData(userId: string): Promise<DashboardResults> {
  const [profileResult, impressionsResult, payoutsResult] = await Promise.all([
    supabase.from("profiles").select("balance").eq("id", userId).single(),
    supabase
      .from("ad_impressions")
      .select("region_tier, cpm_rate, creator_share")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("payouts")
      .select("id, amount, status, created_at")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    profileResult: {
      data: (profileResult.data ?? null) as { balance: number | string } | null,
      error: profileResult.error,
    },
    impressionsResult: { data: (impressionsResult.data ?? null) as ImpressionRow[] | null },
    payoutsResult: { data: (payoutsResult.data ?? null) as PayoutRow[] | null },
  };
}

type DashboardOutcome =
  | { ok: false; error: string }
  | { ok: true; balance: number; impressions: ImpressionRow[]; payouts: PayoutRow[] };

function extractDashboard(results: DashboardResults): DashboardOutcome {
  if (results.profileResult.error || !results.profileResult.data) {
    return {
      ok: false,
      error: results.profileResult.error?.message ?? "Creator profile not found.",
    };
  }

  return {
    ok: true,
    balance: num(results.profileResult.data.balance),
    impressions: results.impressionsResult.data ?? [],
    payouts: results.payoutsResult.data ?? [],
  };
}

function num(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export default function EarningsPage() {
  const { user, loading: authLoading, openAuthModal } = useAuth();

  const [balance, setBalance] = useState(0);
  const [impressions, setImpressions] = useState<ImpressionRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [requesting, setRequesting] = useState(false);
  // User tweaks to the calculator; undefined fields fall back to live data.
  const [calcEdits, setCalcEdits] = useState<
    Partial<{ impressions: number; cpm: number; share: number }>
  >({});

  // Loads (and reloads) the dashboard whenever auth state changes, so signing
  // in through the auth modal fills in balance, impressions and payouts.
  useEffect(() => {
    if (!user) return;

    const userId = user.id;
    let cancelled = false;

    async function load() {
      const outcome = extractDashboard(await fetchDashboardData(userId));

      if (cancelled) return;

      if (!outcome.ok) {
        setDashboardError(outcome.error);
        setDashboardLoading(false);
        return;
      }

      setBalance(outcome.balance);
      setImpressions(outcome.impressions);
      setPayouts(outcome.payouts);
      setDashboardLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Re-reads the dashboard after a successful payout request.
  async function refreshDashboard() {
    if (!user) return;

    const outcome = extractDashboard(await fetchDashboardData(user.id));
    if (!outcome.ok) {
      setDashboardError(outcome.error);
      return;
    }

    setBalance(outcome.balance);
    setImpressions(outcome.impressions);
    setPayouts(outcome.payouts);
  }

  // Aggregate impressions by region for the CPM table.
  const { regionStats, totals } = useMemo(() => {
    const stats: Record<string, RegionStats> = {};
    for (const region of REGIONS) {
      stats[region] = { impressions: 0, avgCpm: 0, gross: 0, earned: 0 };
    }

    for (const row of impressions) {
      const bucket = stats[row.region_tier];
      if (!bucket) continue;

      const cpm = num(row.cpm_rate);
      const share = num(row.creator_share);

      bucket.impressions += 1;
      bucket.avgCpm += cpm;
      bucket.gross += cpm / 1000;
      bucket.earned += share;
    }

    let totalCount = 0;
    let totalGross = 0;
    let totalEarned = 0;

    for (const region of REGIONS) {
      const bucket = stats[region];
      if (bucket.impressions > 0) {
        bucket.avgCpm = bucket.avgCpm / bucket.impressions;
      }
      totalCount += bucket.impressions;
      totalGross += bucket.gross;
      totalEarned += bucket.earned;
    }

    return { regionStats: stats, totals: { count: totalCount, gross: totalGross, earned: totalEarned } };
  }, [impressions]);

  // Calculator values: user edits win, otherwise they fall back to live data.
  const blendedCpm = totals.count
    ? Number(((totals.gross / totals.count) * 1000).toFixed(2))
    : 1.5;
  const calc = {
    impressions: calcEdits.impressions ?? totals.count,
    cpm: calcEdits.cpm ?? blendedCpm,
    share: calcEdits.share ?? 60,
  };

  const pendingPayout = payouts.find((payout) => payout.status === "pending");
  const pendingTotal = payouts
    .filter((payout) => payout.status === "pending")
    .reduce((sum, payout) => sum + num(payout.amount), 0);

  const calcGross = (calc.impressions / 1000) * calc.cpm;
  const calcEarnings = calcGross * (calc.share / 100);

  async function handleRequestPayout() {
    setRequesting(true);
    setFeedback(null);

    const { data, error } = await supabase.rpc("request_payout");

    if (error) {
      if (/request_payout|Could not find the function|schema cache/i.test(error.message)) {
        setFeedback({
          type: "error",
          message:
            "Payouts aren't set up in the database yet. Run supabase/payout-request.sql in the Supabase SQL Editor, then try again.",
        });
      } else {
        setFeedback({ type: "error", message: error.message });
      }
    } else {
      setFeedback({
        type: "success",
        message: `${formatMoney(num(data))} payout requested — it's now pending admin approval.`,
      });
      await refreshDashboard();
    }

    setRequesting(false);
  }

  if (authLoading || (dashboardLoading && !dashboardError)) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Lock className="h-6 w-6" />
          </span>
          <h2 className="text-xl font-semibold text-white">Sign in to see your earnings</h2>
          <p className="mt-2 text-sm text-slate-400">
            Balances and ad impressions are private to each creator, so this dashboard needs
            you signed in.
          </p>
          <button
            type="button"
            onClick={() =>
              openAuthModal("Sign in to view your balance and request payouts.")
            }
            className="mt-6 flex h-11 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-[#04120a] transition hover:brightness-110"
          >
            Sign in or create account
          </button>
        </div>
      </div>
    );
  }

  if (dashboardError) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-center text-sm text-rose-300">
          {dashboardError}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Creator earnings
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Your balance, ad performance and payouts — all in one place.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Wallet className="h-4 w-4 text-accent" />}
          label="Available balance"
          value={formatMoney(balance)}
          hint="Ready to withdraw"
        />
        <StatCard
          icon={<Eye className="h-4 w-4 text-accent" />}
          label="Lifetime impressions"
          value={formatCount(totals.count)}
          hint="Across all your games"
        />
        <StatCard
          icon={<CircleDollarSign className="h-4 w-4 text-accent" />}
          label="Creator earnings"
          value={formatMoney(totals.earned)}
          hint="Your 60% share, all time"
        />
        <StatCard
          icon={<Receipt className="h-4 w-4 text-accent" />}
          label="Pending payouts"
          value={formatMoney(pendingTotal)}
          hint={pendingPayout ? "Awaiting approval" : "No requests yet"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03]">
            <div className="flex items-center gap-2 border-b border-white/[0.06] p-5">
              <Globe className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-medium text-white">Monetag regional CPM breakdown</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Region</th>
                    <th className="px-5 py-3 font-medium">Impressions</th>
                    <th className="px-5 py-3 font-medium">Avg CPM</th>
                    <th className="px-5 py-3 font-medium">Gross revenue</th>
                    <th className="px-5 py-3 font-medium">Your share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {REGIONS.map((region) => {
                    const stats = regionStats[region];
                    const hasData = stats.impressions > 0;

                    return (
                      <tr key={region}>
                        <td className="px-5 py-3.5">
                          <span className="flex items-center gap-2 font-medium text-white">
                            <span
                              className={`h-2 w-2 rounded-full ${region === "Tier 1" ? "bg-accent" : "bg-slate-500"}`}
                            />
                            {region}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-300">
                          {formatCount(stats.impressions)}
                        </td>
                        <td className="px-5 py-3.5 text-slate-300">
                          {hasData ? formatMoney(stats.avgCpm) : "—"}
                        </td>
                        <td className="px-5 py-3.5 text-slate-300">
                          {hasData ? formatMoney(stats.gross) : "—"}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-accent">
                          {hasData ? formatMoney(stats.earned) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="border-t border-white/[0.06] px-5 py-4 text-xs text-slate-500">
              Gross revenue = impressions ÷ 1,000 × avg CPM. Your 60% cut is logged per
              impression in creator_share when the ad is served. Tier 1 traffic (US, UK, EU…)
              pays far more than Tier 3.
            </p>
          </section>

          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Receipt className="h-4 w-4 text-accent" />
              Payout history
            </div>

            {payouts.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No payouts requested yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {payouts.slice(0, 5).map((payout) => (
                  <li
                    key={payout.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm"
                  >
                    <span className="text-white">{formatMoney(num(payout.amount))}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        payout.status === "paid"
                          ? "bg-accent/15 text-accent"
                          : payout.status === "approved"
                            ? "bg-sky-400/15 text-sky-300"
                            : "bg-amber-400/15 text-amber-300"
                      }`}
                    >
                      {payout.status}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(payout.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <BadgePercent className="h-4 w-4 text-accent" />
              Creator share calculator
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Forecast earnings for future traffic — it starts from your live numbers.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-slate-400">Impressions</span>
                <input
                  type="number"
                  min={0}
                  value={calc.impressions}
                  onChange={(event) =>
                    setCalcEdits((current) => ({
                      ...current,
                      impressions: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 text-sm text-white focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-400">Avg CPM (USD)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={calc.cpm}
                  onChange={(event) =>
                    setCalcEdits((current) => ({
                      ...current,
                      cpm: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                  className="mt-1.5 h-10 w-full rounded-lg border border-white/[0.08] bg-black/30 px-3 text-sm text-white focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </label>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Your share</span>
                <span className="font-medium text-accent">{calc.share}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={calc.share}
                onChange={(event) =>
                  setCalcEdits((current) => ({
                    ...current,
                    share: Number(event.target.value) || 0,
                  }))
                }
                aria-label="Creator share percentage"
                className="mt-2 w-full accent-[#22c55e]"
              />
            </div>

            <div className="mt-5 grid gap-3 rounded-xl bg-black/30 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-500">Gross ad revenue</p>
                <p className="mt-1 text-xl font-semibold text-white">
                  {formatMoney(calcGross)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Your {calc.share}% cut</p>
                <p className="mt-1 text-xl font-semibold text-accent">
                  {formatMoney(calcEarnings)}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Zap className="h-4 w-4 text-accent" />
              Request payout
            </div>

            {pendingPayout ? (
              <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                A payout of {formatMoney(num(pendingPayout.amount))} is already pending
                approval. You can request again once it&apos;s processed.
              </p>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                Requests your full balance of{" "}
                <span className="font-medium text-white">{formatMoney(balance)}</span> as a
                pending payout. Minimum is {formatMoney(MIN_PAYOUT)}.
              </p>
            )}

            <button
              type="button"
              onClick={handleRequestPayout}
              disabled={requesting || balance < MIN_PAYOUT || Boolean(pendingPayout)}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-[#04120a] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
            >
              {requesting ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Requesting…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Request payout
                </>
              )}
            </button>

            {feedback && (
              <p
                className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs ${
                  feedback.type === "success"
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                }`}
              >
                {feedback.type === "success" && <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />}
                {feedback.message}
              </p>
            )}

            {balance < MIN_PAYOUT && !pendingPayout && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Earn {formatMoney(MIN_PAYOUT - balance)} more to unlock withdrawals.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
      <span className="flex items-center gap-2 text-xs text-slate-400">
        {icon}
        {label}
      </span>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
