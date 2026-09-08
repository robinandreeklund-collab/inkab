"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Tag } from "../ui";
import { Panel } from "./fields";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  role: "customer" | "sales" | "admin";
  createdAt: string;
  lockedAdmin: boolean;
};

const ROLE_LABEL = { customer: "Kund", sales: "Säljare", admin: "Admin" } as const;

export function UserAdmin({ currentUserId }: { currentUserId: string | null }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/users");
    if (response.ok) {
      const data = await response.json();
      setUsers(data.users);
      setError(null);
    } else {
      setError("Kunde inte läsa användarlistan.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setRole = async (id: string, role: AdminUser["role"]) => {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Kunde inte ändra rollen.");
      return;
    }
    setError(null);
    load();
  };

  const remove = async (user: AdminUser) => {
    if (!window.confirm(`Ta bort kontot ${user.email}?`)) return;
    const response = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Kunde inte ta bort kontot.");
      return;
    }
    setError(null);
    load();
  };

  return (
    <div>
      <h2 className="mb-4 text-xl">Användare</h2>

      {error ? (
        <p className="mb-3 border border-danger px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      <Panel
        title={`Konton (${users.length})`}
        description="Kund ser prisintervall. Säljare och admin ser listpriser och marginal. Admin kan dessutom redigera maskinbiblioteket."
        action={
          <Button size="sm" onClick={load}>
            Uppdatera
          </Button>
        }
      >
        {loading ? (
          <p className="text-xs text-muted">Laddar…</p>
        ) : users.length === 0 ? (
          <p className="border border-dashed border-divider px-3 py-4 text-xs text-muted">
            Inga konton ännu.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink text-left">
                <th className="kicker py-1.5">Namn</th>
                <th className="kicker py-1.5">E-post</th>
                <th className="kicker py-1.5">Företag</th>
                <th className="kicker py-1.5">Roll</th>
                <th className="kicker py-1.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-divider">
                  <td className="py-1.5">
                    {user.name || "—"}
                    {user.id === currentUserId ? (
                      <span className="ml-2">
                        <Tag tone="accent">Du</Tag>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-muted">{user.email}</td>
                  <td className="py-1.5 text-muted">{user.company || "—"}</td>
                  <td className="py-1.5">
                    {user.lockedAdmin ? (
                      <span title="Adressen står i ADMIN_EMAILS och är alltid admin.">
                        <Tag tone="accent">Admin (låst)</Tag>
                      </span>
                    ) : (
                      <select
                        value={user.role}
                        disabled={user.id === currentUserId}
                        onChange={(e) => setRole(user.id, e.target.value as AdminUser["role"])}
                        className="border border-divider bg-white px-2 py-1 text-xs outline-none focus:border-accent disabled:bg-paper disabled:text-muted"
                      >
                        {Object.entries(ROLE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {user.id === currentUserId ? null : (
                      <Button size="sm" variant="ghost" onClick={() => remove(user)}>
                        Ta bort
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
