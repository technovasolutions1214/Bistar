"use client";
import React, { useCallback, useEffect, useState } from "react";
import { MarketingShell } from "@/components/marketing-shell";
import { useAuth } from "@/lib/auth-context";
import { Button, Input, Loader, useToast } from "@bistar/ui";

interface MktUser {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
}

export default function MarketingTeamPage() {
  const { firebaseUser, isAdmin, loading: authLoading } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<MktUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const authedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const token = await firebaseUser!.getIdToken();
      return fetch(input, {
        ...init,
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
      });
    },
    [firebaseUser]
  );

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const res = await authedFetch("/api/marketing/users");
      const body = await res.json();
      if (res.ok) setUsers(body.users || []);
      else toast.error(body.error || "Failed to load");
    } catch {
      toast.error("Failed to load marketing users");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, authedFetch, toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!email || password.length < 8) {
      toast.error("Email and an 8+ character password are required");
      return;
    }
    setCreating(true);
    try {
      const res = await authedFetch("/api/marketing/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Marketing account created");
        setEmail("");
        setPassword("");
        setDisplayName("");
        load();
      } else {
        toast.error(body.error || "Failed to create account");
      }
    } catch {
      toast.error("Failed to create account");
    } finally {
      setCreating(false);
    }
  }

  async function handleResetPassword(uid: string) {
    const pw = window.prompt("New password (8+ characters):");
    if (pw === null) return;
    if (pw.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    const res = await authedFetch("/api/marketing/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, password: pw }),
    });
    if (res.ok) toast.success("Password updated");
    else toast.error("Failed to update password");
  }

  async function handleToggleDisabled(u: MktUser) {
    const res = await authedFetch("/api/marketing/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: u.uid, disabled: !u.disabled }),
    });
    if (res.ok) {
      toast.success(u.disabled ? "Account enabled" : "Account disabled");
      load();
    } else {
      toast.error("Failed to update account");
    }
  }

  async function handleDelete(uid: string) {
    if (!window.confirm("Remove this marketing account permanently?")) return;
    const res = await authedFetch(`/api/marketing/users?uid=${encodeURIComponent(uid)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Account removed");
      load();
    } else {
      toast.error("Failed to remove account");
    }
  }

  if (!authLoading && !isAdmin) {
    return (
      <MarketingShell>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--muted)]">
          Only admins can manage marketing accounts.
        </div>
      </MarketingShell>
    );
  }

  return (
    <MarketingShell>
      <div className="max-w-2xl space-y-8">
        {/* Create */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="text-lg font-semibold mb-1">Add marketing user</h2>
          <p className="text-sm text-[var(--muted)] mb-4">
            They can sign in to the dashboard with this email + password, and see only the Marketing area.
          </p>
          <form onSubmit={handleCreate} className="space-y-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} className="w-full" />
            <Input type="text" placeholder="Display name (optional)" value={displayName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDisplayName(e.target.value)} className="w-full" />
            <Input type="text" placeholder="Temporary password (8+ chars)" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} className="w-full" />
            <Button type="submit" loading={creating}>Create account</Button>
          </form>
        </section>

        {/* List */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Marketing users</h2>
          {loading ? (
            <div className="py-10 flex justify-center"><Loader /></div>
          ) : users.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No marketing accounts yet.</p>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.uid} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.displayName || u.email}</p>
                    <p className="text-xs text-[var(--muted)] truncate">
                      {u.email}{u.disabled && <span className="ml-2 text-[var(--danger)]">· disabled</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => handleResetPassword(u.uid)}>Reset password</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleToggleDisabled(u)}>{u.disabled ? "Enable" : "Disable"}</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(u.uid)}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </MarketingShell>
  );
}
