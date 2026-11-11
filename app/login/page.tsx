"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Gamepad2 } from "lucide-react";
import { AuthForm, useAuth } from "@/components/auth-modal";

/**
 * Sign-in / sign-up page.
 * Already signed in? You get bounced straight to the Studio.
 */
export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/studio");
    }
  }, [loading, user, router]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-[0_0_40px_-8px_rgba(34,197,94,0.7)]">
            <Gamepad2 className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Forge<span className="text-accent">Vyn</span>
            </h1>
            <p className="mt-1 text-sm text-slate-400">Play. Build. Earn.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 sm:p-8">
          <AuthForm redirectTo="/studio" />
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          By continuing you agree to keep your uploads legal, safe and yours to
          share.
        </p>
      </div>
    </div>
  );
}
