import { z } from "zod";
import { verifyAdmin } from "@/lib/auth";
import { type AdminSettings as DbAdminSettings, getSettings, updateSettings } from "@/lib/db";
import { hashPasscode } from "@/lib/passcode";
import type { AdminSettings } from "@/lib/types";

// Node runtime: reads/writes the postgres driver and verifies the JWT via jose.
export const runtime = "nodejs";

// Body fields use the DB's snake_case names. Every field is optional — a PATCH
// updates only what it sends; omitted fields are left untouched by updateSettings.
//
// `passcode` is the plaintext shared guest passcode: it is hashed server-side
// (never stored raw, never accepted pre-hashed from the client). A non-empty
// value updates the stored hash.
const BodySchema = z
  .object({
    match_threshold: z.number().min(0).max(1),
    passcode_enabled: z.boolean(),
    passcode: z.string(),
    kill_switch: z.boolean(),
  })
  .partial();

// The frontend's frozen `AdminSettings` type (src/lib/types.ts) is a public
// subset of the DB's row: snake_case, no `passcode_hash` (never sent to the
// client). Both GET and PATCH respond with this shape.
function toClientSettings(s: DbAdminSettings): AdminSettings {
  return {
    match_threshold: s.matchThreshold,
    passcode_enabled: s.passcodeEnabled,
    kill_switch: s.killSwitch,
  };
}

/**
 * GET /api/admin/settings — current settings. Requires a valid admin cookie
 * (401 otherwise).
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  return Response.json(toClientSettings(settings), { status: 200 });
}

/**
 * PATCH /api/admin/settings — update any of match_threshold / passcode_enabled /
 * passcode (plaintext, hashed here) / kill_switch. Requires a valid admin cookie
 * (401 otherwise).
 * Returns the full public settings after the update.
 */
export async function PATCH(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const patch: Partial<DbAdminSettings> = {};
  if (body.match_threshold !== undefined) patch.matchThreshold = body.match_threshold;
  if (body.passcode_enabled !== undefined) patch.passcodeEnabled = body.passcode_enabled;
  if (body.kill_switch !== undefined) patch.killSwitch = body.kill_switch;
  // Hash a supplied plaintext passcode into passcode_hash. An empty string is
  // ignored (no accidental wipe); use passcode_enabled=false to disable the gate.
  if (body.passcode !== undefined && body.passcode.length > 0) {
    patch.passcodeHash = await hashPasscode(body.passcode);
  }

  await updateSettings(patch);
  const settings = await getSettings();
  return Response.json(toClientSettings(settings), { status: 200 });
}
