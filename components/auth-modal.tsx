"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Gamepad2, Loader, Lock, LogOut, Mail, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

/**
 * Authentication toolkit:
 * - <AuthProvider>  — wraps the app in app/layout.tsx; tracks the signed-in
 *                     user (via Supabase auth cookies) and renders the modal.
 * - useAuth()       — { user, loading, openAuthModal, signOut } from anywhere.
 * - <AuthForm>      — the shared sign-in / sign-up form (login page + modal).
 * - <HeaderAuth>    — the small header widget (sign-in button / @username).
 *
 * Opening the modal: `const { openAuthModal } = useAuth();` then
 * `openAuthModal("Sign in to like games")` — e.g. from a like/save button.
 */

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  openAuthModal: (reason?: string) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside <AuthProvider> (wired up in app/layout.tsx).",
    );
  }

  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const router = useRouter();

  // Fires INITIAL_SESSION immediately, then on every sign-in/out/refresh.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);

        // Signed in — no reason to keep the modal around.
        if (session?.user) setModalOpen(false);
      },
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  function openAuthModal(nextReason?: string) {
    setReason(nextReason ?? null);
    setModalOpen(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.refresh();
  }

  const value: AuthContextValue = { user, loading, openAuthModal, signOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {modalOpen && (
        <AuthModalPanel reason={reason} onClose={() => setModalOpen(false)} />
      )}
    </AuthContext.Provider>
  );
}

function AuthModalPanel({
  reason,
  onClose,
}: {
  reason: string | null;
  onClose: () => void;
}) {
  // Lock page scroll and close on Escape while the modal is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in or create an account"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1220] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Gamepad2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Welcome to ForgeVyn</p>
            {reason && <p className="mt-0.5 text-xs text-slate-400">{reason}</p>}
          </div>
        </div>

        <AuthForm onSuccess={onClose} />
      </div>
    </div>
  );
}

type AuthMode = "signin" | "signup";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;

const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-white/[0.08] bg-black/30 px-4 text-sm text-white placeholder:text-slate-600 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/30";

/**
 * The shared auth form. `redirectTo` navigates after success (the login page
 * sends you to /studio); inside the modal it just closes and you stay put.
 */
export function AuthForm({
  redirectTo,
  onSuccess,
}: {
  redirectTo?: string;
  onSuccess?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();

    if (mode === "signup") {
      if (!USERNAME_PATTERN.test(username.trim())) {
        setError("Username must be 3-30 characters — letters, numbers or underscores.");
        return;
      }

      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
    }

    setBusy(true);

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setBusy(false);
        return;
      }

      setBusy(false);
      onSuccess?.();

      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      }

      return;
    }

    // `options.data.username` is picked up by the on_auth_user_created
    // database trigger, which creates the profiles row automatically.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: { username: username.trim() } },
    });

    if (signUpError) {
      setError(signUpError.message);
      setBusy(false);
      return;
    }

    // No session means this Supabase project requires email confirmation.
    if (!data.session) {
      setAwaitingConfirmation(true);
      setBusy(false);
      return;
    }

    setBusy(false);
    onSuccess?.();

    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Check your inbox — we sent a confirmation link to{" "}
            <span className="font-medium">{email.trim()}</span>. Click it, then
            sign in here to unlock everything.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAwaitingConfirmation(false);
            setMode("signin");
          }}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div
        role="group"
        aria-label="Authentication mode"
        className="flex rounded-xl border border-white/[0.08] bg-white/[0.04] p-1"
      >
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setError(null);
          }}
          aria-pressed={mode === "signin"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            mode === "signin"
              ? "bg-accent/15 text-accent"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setError(null);
          }}
          aria-pressed={mode === "signup"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            mode === "signup"
              ? "bg-accent/15 text-accent"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Create Account
        </button>
      </div>

      {mode === "signup" && (
        <label className="block">
          <span className="text-xs text-slate-400">Username</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="neon_builder"
            autoComplete="username"
            maxLength={30}
            className={`mt-1.5 ${INPUT_CLASS}`}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Your public @handle — 3-30 letters, numbers or underscores.
          </span>
        </label>
      )}

      <label className="block">
        <span className="text-xs text-slate-400">Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          className={`mt-1.5 ${INPUT_CLASS}`}
        />
      </label>

      <label className="block">
        <span className="text-xs text-slate-400">Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={6}
          className={`mt-1.5 ${INPUT_CLASS}`}
        />
      </label>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-[#04120a] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
      >
        {busy && <Loader className="h-4 w-4 animate-spin" />}
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

/** Small header widget: sign-in button or the signed-in @username + sign-out. */
export function HeaderAuth() {
  const { user, loading, openAuthModal, signOut } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <div className="h-9 w-24 animate-pulse rounded-xl bg-white/5" aria-hidden="true" />
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() =>
          openAuthModal(
            "Sign in to like games, save favourites and build in the Studio.",
          )
        }
        className="flex h-9 shrink-0 items-center rounded-xl bg-accent px-3 text-xs font-semibold text-[#04120a] transition hover:brightness-110 sm:px-4 sm:text-sm"
      >
        Sign in
      </button>
    );
  }

  const metadataUsername = user.user_metadata?.username;
  const username =
    typeof metadataUsername === "string" && metadataUsername.length > 0
      ? metadataUsername
      : "player";

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="hidden max-w-[140px] truncate rounded-xl border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent sm:block">
        @{username}
      </span>
      <button
        type="button"
        onClick={async () => {
          await signOut();
          router.push("/");
        }}
        aria-label="Sign out"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-slate-300 transition-colors hover:border-white/20 hover:text-white"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
