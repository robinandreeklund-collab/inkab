"use client";

import { useState } from "react";
import { Button } from "./ui";
import type { Role } from "@/lib/server/pricing";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  role: Role;
};

type Mode = "login" | "register";

export function AuthDialog({
  initialMode = "login",
  onClose,
  onSuccess,
}: {
  initialMode?: Mode;
  onClose: () => void;
  onSuccess: (user: SessionUser) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = mode === "login" ? { email, password } : { email, password, name, company };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Något gick fel.");
        return;
      }
      onSuccess(data.user as SessionUser);
    } catch {
      setError("Kunde inte nå servern.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full border border-divider bg-white px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="blueprint w-[420px] max-w-full bg-white p-5"
      >
        <div className="mb-4 flex border border-divider">
          {(
            [
              ["login", "Logga in"],
              ["register", "Skapa konto"],
            ] as const
          ).map(([value, label], index) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={`flex-1 px-3 py-2 text-sm transition-colors ${index > 0 ? "border-l border-divider" : ""} ${
                mode === value ? "bg-accent text-white" : "hover:bg-paper"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {mode === "register" ? (
            <>
              <label className="block">
                <span className="kicker mb-1 block">Namn</span>
                <input
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="kicker mb-1 block">Företag</span>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          ) : null}

          <label className="block">
            <span className="kicker mb-1 block">E-post</span>
            <input
              required
              type="email"
              autoComplete="email"
              autoFocus={mode === "login"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="kicker mb-1 block">Lösenord</span>
            <input
              required
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            {mode === "register" ? (
              <span className="mt-1 block text-[11px] text-muted">Minst 8 tecken.</span>
            ) : null}
          </label>
        </div>

        {error ? (
          <p className="mt-3 border border-danger px-3 py-2 text-xs text-danger">{error}</p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Arbetar…" : mode === "login" ? "Logga in" : "Skapa konto"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
        </div>

        <p className="mt-4 border-t border-divider pt-3 text-[11px] leading-relaxed text-muted">
          Konton behövs för att spara projekt, se priser och ladda ner underlag. Prototypen
          hanterar lösenorden själv (scrypt-hashade); i skarpt läge ersätts det av magisk länk för
          kund och Entra ID internt.
        </p>
      </form>
    </div>
  );
}
