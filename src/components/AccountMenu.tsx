"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, Search, UserRound, Users } from "lucide-react";
import type { RememberedGuest } from "@/lib/guest-store";
import { cn } from "@/lib/utils";

/**
 * Compact account popover for a remembered guest: shows who's active and lets
 * them switch to another recently-viewed person, look up someone new, or log
 * out. Self-contained (plain state + outside-click/Escape close) so it doesn't
 * depend on a menu primitive.
 */
export function AccountMenu({
  activeName,
  others,
  onSwitch,
  onSomeoneElse,
  onLogout,
}: {
  activeName: string;
  /** Recently-viewed people other than the active one, for quick-switch. */
  others: RememberedGuest[];
  onSwitch: (sessionId: string) => void;
  onSomeoneElse: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const firstName = activeName.split(" ")[0] || activeName;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="account-menu-trigger"
        className="inline-flex h-11 max-w-[8rem] items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-marigold-deep">
          <UserRound className="size-4" />
        </span>
        <span className="truncate">{firstName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card p-1 text-card-foreground shadow-[var(--shadow-float)]"
        >
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{activeName}</span>
          </p>

          {others.length > 0 && (
            <div className="border-t border-border py-1">
              <p className="px-3 pb-1 pt-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                Switch person
              </p>
              {others.map((g) => (
                <button
                  key={g.sessionId}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSwitch(g.sessionId);
                  }}
                  className={menuItemClass}
                >
                  <Users className="size-4 text-muted-foreground" />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-border py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSomeoneElse();
              }}
              className={menuItemClass}
            >
              <Search className="size-4 text-muted-foreground" />
              Find someone else&rsquo;s photos
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="account-logout"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className={cn(menuItemClass, "text-maroon")}
            >
              <LogOut className="size-4" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const menuItemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";
