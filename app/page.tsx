"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Bookmark,
  Gamepad2,
  Heart,
  Info,
  MonitorPlay,
  Play,
  RotateCcw,
  Search,
  Smartphone,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

/**
 * Discovery Feed
 * - Live games straight from Supabase (published only, enforced by RLS).
 * - Toggle between a 16:9 grid and a 9:16 vertical shorts feed.
 * - Search supports plain words (title match) and #hashtags (tag match).
 * - Cards open an in-page iframe player built from each game's `game_code`
 *   (a URL opens directly, raw HTML is rendered with srcDoc).
 */

type FeedGame = {
  id: string;
  title: string;
  description: string;
  hashtags: string[];
  thumbnail_url: string | null;
  game_code: string;
  aspect_ratio: string;
  ad_mode: string;
  likes_count: number;
  saves_count: number;
  created_at: string;
  creator: { username: string } | null;
};

type ViewMode = "grid" | "shorts";

// PostgREST embeds can come back as an object or a one-element array depending
// on the query, so normalise before putting rows into state.
type RawGameRow = Omit<FeedGame, "creator"> & {
  creator: { username: string } | { username: string }[] | null;
};

function toFeedGame(row: RawGameRow): FeedGame {
  const { creator, ...rest } = row;
  return {
    ...rest,
    creator: Array.isArray(creator) ? (creator[0] ?? null) : creator,
  };
}

const RATIOS: Record<string, [number, number]> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
};

const GAMES_SELECT =
  "id, title, description, hashtags, thumbnail_url, game_code, aspect_ratio, ad_mode, likes_count, saves_count, created_at, creator:profiles(username)";

// Pure data fetch (no state) so it can be reused by the load effect and retry.
function queryGames() {
  return supabase
    .from("games")
    .select(GAMES_SELECT)
    .eq("is_published", true)
    .order("created_at", { ascending: false });
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function thumbnailStyle(game: FeedGame): CSSProperties {
  if (game.thumbnail_url) {
    return {
      backgroundImage: `url("${game.thumbnail_url}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }

  return { background: "linear-gradient(135deg, #0e1a2e 0%, #10281c 100%)" };
}

export default function FeedPage() {
  const [games, setGames] = useState<FeedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [activeGame, setActiveGame] = useState<FeedGame | null>(null);

  // Initial load happens inside the effect so state updates stay in one place.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error: fetchError } = await queryGames();

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setGames(((data ?? []) as RawGameRow[]).map(toFeedGame));
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Used by the retry buttons (event handlers may set state directly).
  async function retryFetch() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await queryGames();

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setGames(((data ?? []) as RawGameRow[]).map(toFeedGame));
    }

    setLoading(false);
  }

  // Lock page scroll while the player modal is open.
  useEffect(() => {
    if (!activeGame) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [activeGame]);

  // Close the player with Escape.
  useEffect(() => {
    if (!activeGame) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveGame(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeGame]);

  // "#" tokens filter by hashtag, everything else matches the title.
  const { filtered, hasFilters } = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hashTerms = terms
      .filter((term) => term.startsWith("#"))
      .map((term) => term.slice(1))
      .filter(Boolean);
    const textTerms = terms.filter((term) => !term.startsWith("#"));

    const matches = games.filter((game) => {
      const tags = game.hashtags.map((tag) => tag.replace(/^#/, "").toLowerCase());
      const title = game.title.toLowerCase();

      const textOk = textTerms.every(
        (term) => title.includes(term) || tags.some((tag) => tag.includes(term)),
      );
      const hashOk = hashTerms.every((term) => tags.includes(term));

      return textOk && hashOk;
    });

    return { filtered: matches, hasFilters: terms.length > 0 };
  }, [games, query]);

  // Most used hashtags across the feed, shown as one-click filters.
  const suggestedTags = useMemo(() => {
    const counts = new Map<string, number>();

    for (const game of games) {
      for (const rawTag of game.hashtags) {
        const tag = rawTag.replace(/^#/, "").toLowerCase();
        if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [games]);

  const toggleTag = (tag: string) => {
    const needle = `#${tag.toLowerCase()}`;
    setQuery((current) =>
      current.toLowerCase().includes(needle)
        ? current
        : `${current} ${needle}`.trim(),
    );
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Discover games
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Community-made browser games. Filter by hashtag to find your next obsession.
        </p>

        <div className="sticky top-16 z-40 -mx-4 mt-6 space-y-3 bg-background/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search games or filter by tag — try #arcade"
                aria-label="Search games"
                className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] pl-10 pr-10 text-sm text-white placeholder:text-slate-500 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div
              role="group"
              aria-label="Feed layout"
              className="flex shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.04] p-1"
            >
              <ViewToggleButton
                active={view === "grid"}
                onClick={() => setView("grid")}
                icon={<MonitorPlay className="h-4 w-4" />}
                label="16:9 Grid"
              />
              <ViewToggleButton
                active={view === "shorts"}
                onClick={() => setView("shorts")}
                icon={<Smartphone className="h-4 w-4" />}
                label="9:16 Shorts"
              />
            </div>
          </div>

          {suggestedTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">
                <Info className="mr-1 inline h-3.5 w-3.5" />
                Trending tags:
              </span>
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === "grid" ? (
        <section className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-2 sm:px-6 lg:px-8">
          {loading ? (
            <GridSkeleton />
          ) : error ? (
            <FeedError message={error} onRetry={retryFetch} />
          ) : filtered.length === 0 ? (
            <EmptyState hasFilters={hasFilters} onClear={() => setQuery("")} />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  onPlay={() => setActiveGame(game)}
                  onTag={toggleTag}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="flex-1 pb-10">
          {loading ? (
            <ShortsSkeleton />
          ) : error ? (
            <FeedError message={error} onRetry={retryFetch} />
          ) : filtered.length === 0 ? (
            <EmptyState hasFilters={hasFilters} onClear={() => setQuery("")} />
          ) : (
            <div className="mx-auto h-[calc(100dvh-14rem)] min-h-[420px] max-w-3xl snap-y snap-mandatory overflow-y-auto rounded-3xl">
              {filtered.map((game) => (
                <div
                  key={game.id}
                  className="flex h-full w-full snap-start items-center justify-center px-3"
                >
                  <ShortsCard game={game} onPlay={() => setActiveGame(game)} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeGame && (
        <GamePlayer game={activeGame} onClose={() => setActiveGame(null)} />
      )}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-sm ${
        active ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function GameCard({
  game,
  onPlay,
  onTag,
}: {
  game: FeedGame;
  onPlay: () => void;
  onTag: (tag: string) => void;
}) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] transition-colors hover:border-accent/30">
      <div
        className="relative aspect-video"
        style={thumbnailStyle(game)}
        role="img"
        aria-label={game.thumbnail_url ? game.title : undefined}
      >
        {!game.thumbnail_url && (
          <span className="absolute inset-0 flex items-center justify-center text-slate-600">
            <Gamepad2 className="h-9 w-9" />
          </span>
        )}

        <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-medium text-slate-300 backdrop-blur">
          {game.aspect_ratio}
        </span>

        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${game.title}`}
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-[#04120a] shadow-lg transition-transform hover:scale-105"
        >
          <Play className="h-4 w-4 fill-current" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="truncate font-semibold text-white">{game.title}</h3>
          <p className="mt-0.5 text-xs text-accent">
            @{game.creator?.username ?? "unknown"}
          </p>
        </div>

        {game.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {game.hashtags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTag(tag)}
                className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 transition-colors hover:bg-accent/15 hover:text-accent"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-4 border-t border-white/[0.06] pt-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5 text-rose-400" />
            {formatCount(game.likes_count)}
          </span>
          <span className="flex items-center gap-1.5">
            <Bookmark className="h-3.5 w-3.5 text-accent" />
            {formatCount(game.saves_count)}
          </span>
        </div>
      </div>
    </article>
  );
}

function ShortsCard({ game, onPlay }: { game: FeedGame; onPlay: () => void }) {
  return (
    <article
      className="relative aspect-[9/16] overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0b1424] shadow-2xl"
      style={{ width: "min(94vw, calc((100dvh - 14rem) * 9 / 16))" }}
    >
      <div
        className="absolute inset-0"
        style={thumbnailStyle(game)}
        role="img"
        aria-label={game.thumbnail_url ? game.title : undefined}
      >
        {!game.thumbnail_url && (
          <span className="absolute inset-0 flex items-center justify-center text-slate-600">
            <Gamepad2 className="h-12 w-12" />
          </span>
        )}
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

      <span className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-medium text-slate-300 backdrop-blur">
        {game.aspect_ratio}
      </span>

      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${game.title}`}
        className="absolute left-1/2 top-[38%] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent/90 text-[#04120a] shadow-[0_0_40px_-5px_rgba(34,197,94,0.8)] transition-transform hover:scale-105"
      >
        <Play className="h-6 w-6 fill-current" />
      </button>

      <div className="absolute inset-x-0 bottom-0 space-y-2.5 p-5">
        <h3 className="text-lg font-semibold text-white">{game.title}</h3>
        <p className="text-xs text-accent">@{game.creator?.username ?? "unknown"}</p>

        {game.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {game.hashtags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-200"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 pt-1 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5 text-rose-400" />
            {formatCount(game.likes_count)}
          </span>
          <span className="flex items-center gap-1.5">
            <Bookmark className="h-3.5 w-3.5 text-accent" />
            {formatCount(game.saves_count)}
          </span>
        </div>
      </div>
    </article>
  );
}

function GamePlayer({ game, onClose }: { game: FeedGame; onClose: () => void }) {
  const [ratioWidth, ratioHeight] = RATIOS[game.aspect_ratio] ?? [16, 9];
  const code = game.game_code.trim();
  const isUrl = /^(https?:)?\/\//i.test(code);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${game.title}`}
    >
      <div
        className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{game.title}</h2>
          <p className="text-xs text-slate-400">@{game.creator?.username ?? "unknown"}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs text-slate-300">
          <span className="hidden items-center gap-1.5 sm:flex">
            <Heart className="h-3.5 w-3.5 text-rose-400" />
            {formatCount(game.likes_count)}
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <Bookmark className="h-3.5 w-3.5 text-accent" />
            {formatCount(game.saves_count)}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <div
          className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl"
          style={{
            width: `min(94vw, calc(80dvh * ${ratioWidth} / ${ratioHeight}))`,
            aspectRatio: `${ratioWidth} / ${ratioHeight}`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {code ? (
            <iframe
              key={game.id}
              src={isUrl ? code : undefined}
              srcDoc={isUrl ? undefined : code}
              title={game.title}
              className="h-full w-full border-0 bg-black"
              allow="autoplay; fullscreen"
              sandbox="allow-scripts allow-pointer-lock allow-popups allow-forms allow-modals"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-slate-400">
              <Gamepad2 className="h-10 w-10" />
              <p className="text-sm">This game has no playable build yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="h-64 animate-pulse rounded-2xl border border-white/[0.04] bg-white/[0.04]"
        />
      ))}
    </div>
  );
}

function ShortsSkeleton() {
  return (
    <div className="mx-auto h-[calc(100dvh-14rem)] min-h-[420px] max-w-3xl px-3">
      <div className="mx-auto aspect-[9/16] h-full animate-pulse rounded-3xl border border-white/[0.04] bg-white/[0.04]" />
    </div>
  );
}

function FeedError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 py-16 text-center">
      <p className="text-sm text-rose-300">Couldn&apos;t load the feed: {message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
      >
        <RotateCcw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}

function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 py-20 text-center">
      <Gamepad2 className="h-10 w-10 text-slate-500" />
      <h3 className="font-semibold text-white">No games found</h3>
      <p className="max-w-sm text-sm text-slate-400">
        {hasFilters
          ? "Nothing matches that search. Try a different title or hashtag."
          : "No published games yet — be the first to build one in the AI Studio."}
      </p>
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
