"use client";

import { useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { Button, Segmented } from "./ui";

export function Topbar({
  role,
  onRoleChange,
}: {
  role: "guest" | "sales";
  onRoleChange: (role: "guest" | "sales") => void;
}) {
  const { config, view, unit, past, future, setView, setUnit, undo, redo, update, setScreen } =
    useConfigStore();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <header className="flex h-[52px] flex-none items-center gap-4 border-b border-divider bg-white px-3">
      <button onClick={() => setScreen("onboarding")} className="flex items-center gap-2">
        <span className="h-4 w-4 bg-accent" />
        <span className="text-[15px] font-medium tracking-tight">INKAB</span>
      </button>

      <div className="flex min-w-0 items-baseline gap-2">
        <span className="kicker">Projekt</span>
        <input
          value={config.projectName}
          onChange={(e) => update((d) => void (d.projectName = e.target.value))}
          className="min-w-0 max-w-[280px] border-b border-transparent bg-transparent text-sm outline-none hover:border-divider focus:border-accent"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={undo} disabled={past.length === 0} title="Ångra (Ctrl+Z)">
          ↶
        </Button>
        <Button size="sm" variant="ghost" onClick={redo} disabled={future.length === 0} title="Gör om (Ctrl+Y)">
          ↷
        </Button>
        <Segmented
          ariaLabel="Vy"
          value={view}
          options={[
            { value: "2d", label: "2D" },
            { value: "3d", label: "3D" },
          ]}
          onChange={setView}
        />
        <Segmented
          ariaLabel="Enhet"
          value={unit}
          options={[
            { value: "m", label: "m" },
            { value: "mm", label: "mm" },
          ]}
          onChange={setUnit}
        />
        {role === "sales" ? (
          <Button
            active
            onClick={async () => {
              await fetch("/api/session", { method: "POST", body: "{}" , headers: { "Content-Type": "application/json" }});
              onRoleChange("guest");
            }}
          >
            Säljläge · logga ut
          </Button>
        ) : (
          <Button onClick={() => setLoginOpen(true)}>Logga in</Button>
        )}
      </div>

      {loginOpen ? (
        <LoginDialog
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            onRoleChange("sales");
          }}
        />
      ) : null}
    </header>
  );
}

function LoginDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (response.ok) onSuccess();
    else setError("Fel lösenord.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="blueprint w-[380px] bg-white p-4"
      >
        <h2 className="kicker mb-1">Säljläge</h2>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Visar listpriser, marginal och radpriser. Prototypen använder ett delat lösenord — i skarpt
          läge ersätts det av Auth.js med magisk länk för kund och Entra ID internt.
        </p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Lösenord"
          className="mb-2 w-full border border-divider px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {error ? <p className="mb-2 text-xs text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy ? "Loggar in…" : "Logga in"}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
        </div>
      </form>
    </div>
  );
}
