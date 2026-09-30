"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { ProposalDialog } from "./ProposalDialog";
import { HistoryDialog } from "./HistoryDialog";
import { AuthDialog, type SessionUser } from "./AuthDialog";
import { Button, Segmented } from "./ui";
import { LOCALES, LOCALE_SHORT, useLocale, useT } from "@/lib/i18n";

export function Topbar({
  user,
  onUserChange,
  autoOpenLogin = false,
  onLoginHandled,
}: {
  user: SessionUser | null;
  onUserChange: (user: SessionUser | null) => void;
  autoOpenLogin?: boolean;
  onLoginHandled?: () => void;
}) {
  const { config, view, past, future, setView, undo, redo, update, setScreen } =
    useConfigStore();
  const locale = useLocale();
  const setLocale = useConfigStore((s) => s.setLocale);
  const t = useT();
  const [authOpen, setAuthOpen] = useState(false);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const log = useConfigStore((s) => s.log);

  useEffect(() => {
    if (autoOpenLogin && !user) setAuthOpen(true);
  }, [autoOpenLogin, user]);

  return (
    <header className="no-print flex h-[56px] flex-none items-center gap-4 border-b border-steel bg-steel px-3 text-paper">
      <button onClick={() => setScreen("onboarding")} className="flex flex-none items-center">
        <Image
          src="/inkab-logo.png"
          alt="INKAB"
          width={459}
          height={96}
          priority
          className="h-5 w-auto"
        />
      </button>

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="kicker text-paper/50">{t("top.project")}</span>
        <input
          value={config.projectName}
          onChange={(e) => update((d) => void (d.projectName = e.target.value))}
          aria-label={t("top.projectName")}
          className="min-w-0 max-w-[280px] border-b border-transparent bg-transparent text-sm text-paper outline-none hover:border-paper/30 focus:border-accent"
        />
      </div>

      <a
        href="tel:+46705701760"
        className="ml-auto hidden items-baseline gap-2 whitespace-nowrap px-2 text-paper/80 hover:text-paper lg:flex"
      >
        <span className="kicker text-paper/50">{t("top.questions")}</span>
        <span className="num text-sm">+46 70-570 17 60</span>
      </a>

      <div className="flex items-center gap-2 lg:ml-0">
        <button
          onClick={undo}
          disabled={past.length === 0}
          title={t("top.undo")}
          className="px-2 py-1 text-sm text-paper/70 hover:text-paper disabled:opacity-30"
        >
          ↶
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          title={t("top.redo")}
          className="px-2 py-1 text-sm text-paper/70 hover:text-paper disabled:opacity-30"
        >
          ↷
        </button>

        {/*
          * Språkväljaren står först bland reglagen: den som inte förstår
          * sidhuvudet ska hitta den utan att läsa något annat.
          */}
        <Segmented
          ariaLabel={t("top.language")}
          value={locale}
          options={LOCALES.map((code) => ({ value: code, label: LOCALE_SHORT[code] }))}
          onChange={setLocale}
        />
        <Segmented
          ariaLabel={t("top.view")}
          value={view}
          options={[
            { value: "2d", label: "2D" },
            { value: "model", label: t("top.view.model") },
          ]}
          onChange={setView}
        />

        <button
          onClick={() => setHistoryOpen(true)}
          title={t("top.historyTitle")}
          className="border border-paper/30 px-3 py-1.5 text-sm text-paper hover:border-accent hover:bg-accent hover:text-white"
        >
          {t("top.history")}{log.length > 0 ? ` (${log.length})` : ""}
        </button>

        {user?.role === "admin" ? (
          <a
            href="/admin"
            className="inline-flex items-center border border-paper/30 px-3 py-1.5 text-sm text-paper hover:border-accent hover:bg-accent hover:text-white"
          >
            Admin
          </a>
        ) : null}

        {user ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProposalsOpen(true)}
              className="border border-paper/30 px-3 py-1.5 text-sm text-paper hover:border-accent hover:bg-accent hover:text-white"
            >
              {t("top.myProposals")}
            </button>
            <span className="hidden text-right leading-tight sm:block">
              <span className="block text-xs text-paper">{user.name || user.email}</span>
              <span className="kicker text-paper/50">{t(`role.${user.role}`)}</span>
            </span>
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                onUserChange(null);
              }}
              className="border border-paper/30 px-3 py-1.5 text-sm text-paper hover:border-accent hover:bg-accent hover:text-white"
            >
              {t("top.logOut")}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAuthOpen(true)}
            className="border border-paper/30 px-3 py-1.5 text-sm text-paper hover:border-accent hover:bg-accent hover:text-white"
          >
            {t("top.logIn")}
          </button>
        )}
      </div>

      {historyOpen ? <HistoryDialog onClose={() => setHistoryOpen(false)} /> : null}

      {proposalsOpen ? (
        <ProposalDialog
          onClose={() => setProposalsOpen(false)}
          canAdmin={user?.role === "admin"}
        />
      ) : null}

      {authOpen ? (
        <AuthDialog
          onClose={() => {
            setAuthOpen(false);
            onLoginHandled?.();
          }}
          onSuccess={(nextUser) => {
            setAuthOpen(false);
            onLoginHandled?.();
            onUserChange(nextUser);
            if (nextUser.role === "admin" && autoOpenLogin) window.location.href = "/admin";
          }}
        />
      ) : null}
    </header>
  );
}
