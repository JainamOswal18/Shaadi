import { getSettings } from "@/lib/db";

// Node runtime: reads the postgres driver, which does not run on the edge.
export const runtime = "nodejs";

// Never cache: the passcode requirement can be toggled by an admin at any time
// and the guest client must see the current value on load.
export const dynamic = "force-dynamic";

/**
 * GET /api/config — public, unauthenticated client bootstrap.
 *
 * Exposes only the small set of settings the guest UI legitimately needs before
 * a search: whether a shared passcode is required. Nothing sensitive (no hash,
 * no threshold, no kill-switch internals beyond what other routes already
 * surface) is included.
 */
export async function GET(): Promise<Response> {
  const settings = await getSettings();
  return Response.json({ passcodeRequired: settings.passcodeEnabled }, { status: 200 });
}
