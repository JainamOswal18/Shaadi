import { verifyAdmin } from "@/lib/auth";
import { listReels } from "@/lib/db";
import { presignGet } from "@/lib/r2";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await listReels({ limit: 200 });
  const reels = await Promise.all(
    rows
      .filter((r) => r.output_key)
      .map(async (r) => ({
        id: r.id,
        guest: r.guest_name,
        url: await presignGet(r.output_key as string, { expiresIn: 3600 }),
        createdAt: r.created_at.toISOString(),
      })),
  );

  return Response.json({ reels }, { status: 200 });
}
