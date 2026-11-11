"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Crown,
  Gamepad2,
  ImagePlus,
  Layers,
  Loader,
  Lock,
  ShieldCheck,
  Sparkles,
  Trash,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-modal";

/**
 * AI Game Studio
 * UI for describing and configuring a game before generation:
 * - Prompt command box, title and hashtags
 * - Tier limits pulled live from the creator's profile
 * - Aspect ratio + ad placement (Option 1 / Option 2) selection
 * - Thumbnail uploader (local preview — Storage upload comes later)
 * - Safety compliance checkboxes that gate the Generate button
 *
 * The Generate button is intentionally a stub until an AI provider is wired up.
 */

type StudioProfile = {
  username: string;
  tier: string;
  game_count: number;
};

const TIER_ORDER = ["free", "tier100", "tier500", "tier1000"] as const;
type Tier = (typeof TIER_ORDER)[number];

const TIER_LIMITS: Record<Tier, number> = {
  free: 1,
  tier100: 100,
  tier500: 500,
  tier1000: 1000,
};

const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  tier100: "Tier 100",
  tier500: "Tier 500",
  tier1000: "Tier 1000",
};

const AD_OPTIONS = [
  {
    value: "normal" as const,
    title: "Option 1 · Normal ads",
    description:
      "Network ads are placed automatically around your game. Zero setup, best for passive earnings.",
  },
  {
    value: "custom" as const,
    title: "Option 2 · Custom ads",
    description:
      "You decide where ad breaks appear inside the game flow. More control, more setup.",
  },
];

const ASPECT_OPTIONS = [
  { value: "16:9" as const, title: "16:9 Long-form", hint: "Desktop & feed grid" },
  { value: "9:16" as const, title: "9:16 Shorts", hint: "Vertical shorts feed" },
];

const SAFETY_RULES = [
  {
    id: "rights",
    label: "I own or have permission to use every asset in this game.",
  },
  {
    id: "content",
    label:
      "The content follows ForgeVyn's community rules — no hate speech, explicit or harmful material.",
  },
  {
    id: "playable",
    label:
      "The game runs fully in the browser — no downloads, external servers or paid requirements.",
  },
] as const;

const INPUT_CLASS =
  "w-full rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30";

export default function StudioPage() {
  const { user, loading: authLoading, openAuthModal } = useAuth();

  const [profile, setProfile] = useState<StudioProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [aspect, setAspect] = useState<"16:9" | "9:16">("16:9");
  const [adMode, setAdMode] = useState<"normal" | "custom">("normal");
  const [thumbnailName, setThumbnailName] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({
    rights: false,
    content: false,
    playable: false,
  });
  const [showNotice, setShowNotice] = useState(false);

  // Loads (and reloads) the creator profile whenever auth state changes,
  // so signing in through the auth modal unlocks the Studio instantly.
  useEffect(() => {
    if (!user) return;

    const userId = user.id;
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, tier, game_count")
        .eq("id", userId)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setProfileError(error?.message ?? "Creator profile not found.");
        return;
      }

      setProfile(data as StudioProfile);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Free the local thumbnail preview when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    };
  }, [thumbnailUrl]);

  const parsedHashtags = useMemo(
    () =>
      hashtags
        .split(/[\s,]+/)
        .map((tag) => tag.replace(/^#+/, "").toLowerCase())
        .filter(Boolean),
    [hashtags],
  );

  // While auth state is still unknown, show a spinner.
  if (authLoading || (!user && !profile)) {
    return (
      <PageShell>
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader className="h-6 w-6 animate-spin text-accent" />
        </div>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell>
        <SignedOutCard
          onSignIn={() =>
            openAuthModal("Sign in to build and publish games in the AI Studio.")
          }
        />
      </PageShell>
    );
  }

  if (profileError) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-center text-sm text-rose-300">
          {profileError}
        </div>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell>
        <div className="flex flex-1 items-center justify-center py-24">
          <Loader className="h-6 w-6 animate-spin text-accent" />
        </div>
      </PageShell>
    );
  }

  const tier: Tier = TIER_ORDER.includes(profile.tier as Tier)
    ? (profile.tier as Tier)
    : "free";
  const limit = TIER_LIMITS[tier];
  const used = profile.game_count;
  const remaining = Math.max(limit - used, 0);
  const usagePercent = Math.min(100, Math.round((used / limit) * 100));
  const atLimit = remaining === 0;

  const nextTier = TIER_ORDER.slice(TIER_ORDER.indexOf(tier) + 1).find(
    (candidate) => TIER_LIMITS[candidate] > limit,
  );

  const allChecked = SAFETY_RULES.every((rule) => checks[rule.id]);
  const canGenerate = title.trim().length > 0 && prompt.trim().length > 0 && allChecked;

  function handleThumbnail(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    setThumbnailUrl(URL.createObjectURL(file));
    setThumbnailName(file.name);
  }

  function clearThumbnail() {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    setThumbnailUrl(null);
    setThumbnailName(null);
  }

  function handleGenerate() {
    if (!canGenerate) return;
    // TODO: connect your AI provider here. Everything collected in this form
    // (prompt, title, hashtags, aspect, ad_mode) is ready to send.
    setShowNotice(true);
  }

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              AI Game Studio
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Describe your game, pick your ad setup, prove it&apos;s safe — then generate.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="truncate rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-slate-300">
              @{profile.username}
            </span>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 font-medium text-accent">
              {TIER_LABELS[tier]} tier
            </span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="prompt"
                  className="flex items-center gap-2 text-sm font-medium text-white"
                >
                  <Sparkles className="h-4 w-4 text-accent" />
                  Prompt command
                </label>
                <span className="text-xs text-slate-500">{prompt.trim().length} chars</span>
              </div>
              <textarea
                id="prompt"
                rows={7}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe your game: genre, mechanics, art style and controls. e.g. 'Neon 2D endless runner — robot cat, one-button jump, battery pickups, speed ramps every 30 seconds.'"
                className={`mt-3 resize-none font-mono ${INPUT_CLASS}`}
              />
            </section>

            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Gamepad2 className="h-4 w-4 text-accent" />
                Game details
              </div>

              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="text-xs text-slate-400">Title</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Battery Cat Run"
                    maxLength={120}
                    className={`mt-1.5 ${INPUT_CLASS}`}
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-slate-400">Hashtags</span>
                  <input
                    type="text"
                    value={hashtags}
                    onChange={(event) => setHashtags(event.target.value)}
                    placeholder="arcade, endless, neon"
                    className={`mt-1.5 ${INPUT_CLASS}`}
                  />
                </label>

                {parsedHashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {parsedHashtags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Layers className="h-4 w-4 text-accent" />
                Format &amp; ad placement
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {ASPECT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAspect(option.value)}
                    aria-pressed={aspect === option.value}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      aspect === option.value
                        ? "border-accent/60 bg-accent/10"
                        : "border-white/[0.08] bg-white/[0.03] hover:border-white/20"
                    }`}
                  >
                    <span className="block text-sm font-medium text-white">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">{option.hint}</span>
                  </button>
                ))}
              </div>

              <fieldset className="mt-5">
                <legend className="text-xs text-slate-400">Ad placement</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {AD_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${
                        adMode === option.value
                          ? "border-accent/60 bg-accent/10"
                          : "border-white/[0.08] bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="ad_placement"
                        value={option.value}
                        checked={adMode === option.value}
                        onChange={() => setAdMode(option.value)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[#22c55e]"
                      />
                      <span>
                        <span className="block text-sm font-medium text-white">
                          {option.title}
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          </div>

          <aside className="space-y-6 self-start lg:sticky lg:top-24">
            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-white">
                  <Crown className="h-4 w-4 text-accent" />
                  {TIER_LABELS[tier]} tier
                </span>
                <span className="text-xs text-slate-400">
                  {used} / {limit} games
                </span>
              </div>

              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={used}
                aria-valuemin={0}
                aria-valuemax={limit}
                aria-label="Games used on your tier"
              >
                <div
                  className={`h-full rounded-full transition-all ${atLimit ? "bg-rose-400" : "bg-accent"}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <p className="mt-2 text-xs text-slate-400">
                {atLimit
                  ? "You've hit your tier limit — upgrade to publish more games."
                  : `${remaining} generation${remaining === 1 ? "" : "s"} left on this tier.`}
              </p>

              {nextTier && (
                <p className="mt-3 rounded-lg bg-accent/10 p-2.5 text-xs text-accent">
                  Upgrade to {TIER_LABELS[nextTier]} for {TIER_LIMITS[nextTier]} games.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ImagePlus className="h-4 w-4 text-accent" />
                Thumbnail
              </div>

              {thumbnailUrl ? (
                <div className="mt-4 space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnailUrl}
                    alt="Thumbnail preview"
                    className="aspect-video w-full rounded-xl border border-white/[0.08] object-cover"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-400">{thumbnailName}</span>
                    <button
                      type="button"
                      onClick={clearThumbnail}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-rose-400/40 hover:text-rose-300"
                    >
                      <Trash className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center transition-colors hover:border-accent/40 hover:bg-accent/5">
                  <ImagePlus className="h-8 w-8 text-slate-500" />
                  <span className="text-sm text-slate-300">Upload thumbnail</span>
                  <span className="text-xs text-slate-500">
                    PNG or JPG · 1280×720 recommended
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleThumbnail}
                    className="sr-only"
                  />
                </label>
              )}

              <p className="mt-3 text-xs text-slate-500">
                The preview stays on your device for now — Supabase Storage upload gets wired
                up in a later step.
              </p>
            </section>

            <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <ShieldCheck className="h-4 w-4 text-accent" />
                Safety compliance
              </div>

              <div className="mt-4 space-y-2.5">
                {SAFETY_RULES.map((rule) => (
                  <label
                    key={rule.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-sm text-slate-300 transition-colors hover:border-white/20"
                  >
                    <input
                      type="checkbox"
                      checked={checks[rule.id]}
                      onChange={(event) =>
                        setChecks((current) => ({
                          ...current,
                          [rule.id]: event.target.checked,
                        }))
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#22c55e]"
                    />
                    {rule.label}
                  </label>
                ))}
              </div>
            </section>

            {showNotice && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
                <Zap className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  AI generation isn&apos;t wired up yet. Your prompt, ad placement and safety
                  sign-off are saved in this form — connect an AI provider next and this
                  button will build the game.
                </p>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-[#04120a] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
              >
                <Sparkles className="h-4 w-4" />
                Generate game
              </button>
              {!allChecked && (
                <p className="mt-2 text-center text-xs text-slate-500">
                  Tick every safety box to unlock generation.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}

function SignedOutCard({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 pb-16">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
          <Lock className="h-6 w-6" />
        </span>
        <h2 className="text-xl font-semibold text-white">Sign in to use the Studio</h2>
        <p className="mt-2 text-sm text-slate-400">
          Your tier, game allowance and ad settings live on your ForgeVyn
          profile, so the Studio unlocks as soon as you&apos;re signed in.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-6 flex h-11 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-[#04120a] transition hover:brightness-110"
        >
          Sign in or create account
        </button>
      </div>
    </div>
  );
}
