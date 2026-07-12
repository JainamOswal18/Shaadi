"use client";

import { useEffect, useState } from "react";

const MOCKING_ENABLED =
  process.env.NEXT_PUBLIC_API_MOCKING !== "disabled" &&
  process.env.NODE_ENV !== "production";

/**
 * Boots the MSW browser worker before rendering children so no request escapes
 * to the (parallel, not-yet-built) backend. In production it is a passthrough.
 */
export function MswProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!MOCKING_ENABLED);

  useEffect(() => {
    if (!MOCKING_ENABLED) return;
    let active = true;
    import("@/mocks/browser").then(async ({ worker }) => {
      await worker.start({
        onUnhandledRequest: "bypass",
        quiet: true,
        serviceWorker: { url: "/mockServiceWorker.js" },
      });
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
