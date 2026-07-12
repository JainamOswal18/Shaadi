import postgres from "postgres";
import { loadEnv } from "./env";

const schema = process.env.DB_SCHEMA?.trim();
// Pin search_path per connection so every pooled connection targets the same
// schema deterministically. Neon's pooled endpoint ignores postgres.js's
// `connection: { search_path }` startup param, so we pass it via the libpq
// `options` startup parameter on the URL, which the pooler honors.
function withSearchPath(url: string, schemaName: string): string {
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schemaName},public`);
  return u.toString();
}
export const sql = schema
  ? postgres(withSearchPath(loadEnv().DATABASE_URL, schema))
  : postgres(loadEnv().DATABASE_URL);

export interface MatchResult {
  photoId: string;
  similarity: number;
  thumbKey: string;
  previewKey: string;
}

export interface InsertPhotoInput {
  source: "ingest" | "guest_upload";
  contentHash: string;
  originalKey: string;
  previewKey: string;
  thumbKey: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  takenAt?: Date | string | null;
  uploadedBy?: string | null;
  uploadSession?: string | null;
}

export async function insertPhoto(p: InsertPhotoInput): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into photos (
      source, content_hash, original_key, preview_key, thumb_key,
      width, height, bytes, taken_at, uploaded_by, upload_session
    ) values (
      ${p.source}, ${p.contentHash}, ${p.originalKey}, ${p.previewKey}, ${p.thumbKey},
      ${p.width ?? null}, ${p.height ?? null}, ${p.bytes ?? null},
      ${p.takenAt ?? null}, ${p.uploadedBy ?? null}, ${p.uploadSession ?? null}
    )
    returning id`;
  return rows[0];
}

export type Bbox = Record<string, number> | number[];

export interface FaceInput {
  embedding: number[];
  bbox?: Bbox | null;
  detScore?: number | null;
}

export async function insertFaces(photoId: string, faces: FaceInput[]): Promise<void> {
  for (const f of faces) {
    const vec = `[${f.embedding.join(",")}]`;
    await sql`
      insert into faces (photo_id, embedding, bbox, det_score)
      values (
        ${photoId}, ${vec}::vector,
        ${f.bbox != null ? sql.json(f.bbox) : null}, ${f.detScore ?? null}
      )`;
  }
}

/**
 * Insert a photo row and all of its faces in a single transaction so a faces
 * failure can never leave an orphaned photo row (which would be indexed but
 * unsearchable). Returns the new photo id.
 */
export async function insertPhotoWithFaces(
  p: InsertPhotoInput,
  faces: FaceInput[],
): Promise<{ id: string }> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into photos (
        source, content_hash, original_key, preview_key, thumb_key,
        width, height, bytes, taken_at, uploaded_by, upload_session
      ) values (
        ${p.source}, ${p.contentHash}, ${p.originalKey}, ${p.previewKey}, ${p.thumbKey},
        ${p.width ?? null}, ${p.height ?? null}, ${p.bytes ?? null},
        ${p.takenAt ?? null}, ${p.uploadedBy ?? null}, ${p.uploadSession ?? null}
      )
      returning id`;
    const photoId = rows[0].id;
    for (const f of faces) {
      const vec = `[${f.embedding.join(",")}]`;
      await tx`
        insert into faces (photo_id, embedding, bbox, det_score)
        values (
          ${photoId}, ${vec}::vector,
          ${f.bbox != null ? tx.json(f.bbox) : null}, ${f.detScore ?? null}
        )`;
    }
    return { id: photoId };
  }) as Promise<{ id: string }>;
}

export async function searchByEmbedding(
  embedding: number[],
  threshold: number,
  limit: number,
): Promise<MatchResult[]> {
  const vec = `[${embedding.join(",")}]`;
  // Exact scan over all faces: COMPLETE (no HNSW candidate cap) and
  // deterministic. At this gallery's scale (~17k faces) a warm scan is ~120ms,
  // so subjects who appear in many photos (e.g. the couple) are never truncated
  // the way a top-K/ef_search-capped index query would truncate them.
  return await sql<MatchResult[]>`
    select p.id as "photoId", p.thumb_key as "thumbKey", p.preview_key as "previewKey",
           max(1 - (f.embedding <=> ${vec}::vector)) as similarity
    from faces f
    join photos p on p.id = f.photo_id and p.status = 'active'
    group by p.id, p.thumb_key, p.preview_key
    having max(1 - (f.embedding <=> ${vec}::vector)) >= ${threshold}
    order by similarity desc
    limit ${limit}`;
}

export interface InsertMediaInput {
  source: string;
  contentHash: string;
  originalKey: string;
  posterKey?: string | null;
  duration?: number | null;
  bytes?: number | null;
  uploadedBy?: string | null;
  uploadSession?: string | null;
}

export async function insertMedia(m: InsertMediaInput): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into media (
      source, content_hash, original_key, poster_key,
      duration, bytes, uploaded_by, upload_session
    ) values (
      ${m.source}, ${m.contentHash}, ${m.originalKey}, ${m.posterKey ?? null},
      ${m.duration ?? null}, ${m.bytes ?? null}, ${m.uploadedBy ?? null}, ${m.uploadSession ?? null}
    )
    returning id`;
  return rows[0];
}

export interface LogSearchInput {
  /** Explicit session id so callers can correlate the row before insert. */
  id?: string | null;
  guestName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  selfieKey?: string | null;
  matchCount?: number | null;
  /** Photo ids that matched this search, persisted for later ZIP download. */
  matchedIds?: string[] | null;
}

export async function logSearch(x: LogSearchInput): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into search_sessions (id, guest_name, ip, user_agent, selfie_key, match_count, matched_ids)
    values (
      coalesce(${x.id ?? null}::uuid, gen_random_uuid()),
      ${x.guestName ?? null}, ${x.ip ?? null}, ${x.userAgent ?? null},
      ${x.selfieKey ?? null}, ${x.matchCount ?? null}, ${x.matchedIds ?? null}::uuid[]
    )
    returning id`;
  return rows[0];
}

export interface SearchSessionRow {
  id: string;
  guest_name: string | null;
  matched_ids: string[] | null;
}

/** Fetch a search session by id, including the photo ids it matched. */
export async function getSearchSession(id: string): Promise<SearchSessionRow | null> {
  const rows = await sql<SearchSessionRow[]>`
    select id, guest_name, matched_ids
    from search_sessions
    where id = ${id}`;
  return rows[0] ?? null;
}

export interface DownloadPhotoRow {
  id: string;
  original_key: string;
  bytes: number | null;
}

/** Active photos (by id) with the original key + size needed to build a ZIP. */
export async function getPhotosForDownload(ids: string[]): Promise<DownloadPhotoRow[]> {
  if (ids.length === 0) return [];
  return sql<DownloadPhotoRow[]>`
    select id, original_key, bytes::float8 as bytes
    from photos
    where id = any(${ids}::uuid[]) and status = 'active'`;
}

export interface PreviewPhotoRow {
  id: string;
  thumb_key: string;
  preview_key: string;
}

/**
 * Active photos (by id) with their public thumb + preview keys — used to rebuild
 * a search session's result set for `GET /api/session` without re-running face
 * matching. Does NOT return `original_key` (that stays behind signed downloads).
 * Order is not guaranteed; the caller re-orders by the session's `matched_ids`.
 */
export async function getPhotosByIds(ids: string[]): Promise<PreviewPhotoRow[]> {
  if (ids.length === 0) return [];
  return sql<PreviewPhotoRow[]>`
    select id, thumb_key, preview_key
    from photos
    where id = any(${ids}::uuid[]) and status = 'active'`;
}

/** The original object key + size for a single active photo, or null. */
export async function getPhotoOriginal(
  photoId: string,
): Promise<{ original_key: string; bytes: number | null } | null> {
  const rows = await sql<{ original_key: string; bytes: number | null }[]>`
    select original_key, bytes::float8 as bytes
    from photos
    where id = ${photoId} and status = 'active'`;
  return rows[0] ?? null;
}

export async function getSessionQuota(
  sessionId: string,
): Promise<{ photos: number; videos: number }> {
  const rows = await sql<{ photos: string | number; videos: string | number }[]>`
    select coalesce(sum(photo_count), 0) as photos, coalesce(sum(video_count), 0) as videos
    from upload_events
    where upload_session = ${sessionId}`;
  const r = rows[0];
  return { photos: Number(r?.photos ?? 0), videos: Number(r?.videos ?? 0) };
}

/**
 * Rolling total of photos/videos ever uploaded from a client IP, summed across
 * all of that IP's upload sessions. `sessionId` is client-chosen and rotatable,
 * so the per-IP total is the real abuse guard: quota can't be reset by minting a
 * fresh sessionId. A null/empty IP returns zero (unattributable — the caller
 * falls back to the per-session guard).
 */
export async function getIpQuota(
  ip: string | null,
): Promise<{ photos: number; videos: number }> {
  if (!ip) return { photos: 0, videos: 0 };
  const rows = await sql<{ photos: string | number; videos: string | number }[]>`
    select coalesce(sum(photo_count), 0) as photos, coalesce(sum(video_count), 0) as videos
    from upload_events
    where ip = ${ip}`;
  const r = rows[0];
  return { photos: Number(r?.photos ?? 0), videos: Number(r?.videos ?? 0) };
}

export interface AdminSettings {
  matchThreshold: number;
  passcodeEnabled: boolean;
  passcodeHash: string | null;
  killSwitch: boolean;
}

export async function getSettings(): Promise<AdminSettings> {
  const rows = await sql<
    {
      match_threshold: number;
      passcode_enabled: boolean;
      passcode_hash: string | null;
      kill_switch: boolean;
    }[]
  >`
    select match_threshold, passcode_enabled, passcode_hash, kill_switch
    from admin_settings where id = 1`;
  const r = rows[0];
  return {
    matchThreshold: r.match_threshold,
    passcodeEnabled: r.passcode_enabled,
    passcodeHash: r.passcode_hash,
    killSwitch: r.kill_switch,
  };
}

export async function updateSettings(patch: Partial<AdminSettings>): Promise<void> {
  await sql`
    update admin_settings set
      match_threshold = coalesce(${patch.matchThreshold ?? null}, match_threshold),
      passcode_enabled = coalesce(${patch.passcodeEnabled ?? null}, passcode_enabled),
      passcode_hash = coalesce(${patch.passcodeHash ?? null}, passcode_hash),
      kill_switch = coalesce(${patch.killSwitch ?? null}, kill_switch)
    where id = 1`;
}

export interface LogDownloadInput {
  sessionId?: string | null;
  guestName?: string | null;
  ip?: string | null;
  kind: "single" | "zip";
  photoId?: string | null;
  count?: number | null;
}

export async function logDownload(x: LogDownloadInput): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into download_events (session_id, guest_name, ip, kind, photo_id, count)
    values (${x.sessionId ?? null}, ${x.guestName ?? null}, ${x.ip ?? null}, ${x.kind}, ${x.photoId ?? null}, ${x.count ?? null})
    returning id`;
  return rows[0];
}

export interface LogUploadInput {
  uploadSession?: string | null;
  guestName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  photoCount?: number | null;
  videoCount?: number | null;
}

export async function logUpload(x: LogUploadInput): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into upload_events (upload_session, guest_name, ip, user_agent, photo_count, video_count)
    values (${x.uploadSession ?? null}, ${x.guestName ?? null}, ${x.ip ?? null}, ${x.userAgent ?? null}, ${x.photoCount ?? 0}, ${x.videoCount ?? 0})
    returning id`;
  return rows[0];
}

export async function softDeletePhoto(id: string): Promise<void> {
  await sql`update photos set status = 'deleted' where id = ${id}`;
}

export interface PhotoKeys {
  original_key: string;
  preview_key: string;
  thumb_key: string;
}

/**
 * The stored R2 object keys for a photo (any status), or null if unknown. Used
 * by the admin delete route to purge the original + derived preview objects
 * before soft-deleting the row. Not filtered by status so a delete is
 * idempotent even after the row has already been marked 'deleted'.
 */
export async function getPhotoKeys(id: string): Promise<PhotoKeys | null> {
  const rows = await sql<PhotoKeys[]>`
    select original_key, preview_key, thumb_key
    from photos
    where id = ${id}`;
  return rows[0] ?? null;
}

export interface MediaKeys {
  original_key: string;
  poster_key: string | null;
}

/**
 * The stored R2 object keys for a media (video) row, or null if unknown. Used
 * by the admin delete route when a media-gallery id doesn't match a photo (the
 * gallery mixes photos + videos behind one id space). Not filtered by status
 * so a delete is idempotent even after the row has already been marked
 * 'deleted'.
 */
export async function getMediaKeys(id: string): Promise<MediaKeys | null> {
  const rows = await sql<MediaKeys[]>`
    select original_key, poster_key
    from media
    where id = ${id}`;
  return rows[0] ?? null;
}

export async function softDeleteMedia(id: string): Promise<void> {
  await sql`update media set status = 'deleted' where id = ${id}`;
}

export interface LogEntry {
  id: string;
  type: "search" | "upload" | "download";
  guest: string | null;
  detail: string;
  at: Date;
}

export interface ListLogsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Paginated activity feed for the admin console: a UNION of the three audit
 * tables (search_sessions, upload_events, download_events), newest first.
 * Each row is normalized to `{ id, type, guest, detail, at }` so the caller
 * doesn't need to know the source table's schema.
 */
export async function listLogs(
  opts: ListLogsOptions = {},
): Promise<{ rows: LogEntry[]; total: number }> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const [rows, totalRows] = await Promise.all([
    sql<LogEntry[]>`
      select id, type, guest, detail, at from (
        select id, 'search'::text as type, guest_name as guest,
          (coalesce(match_count, 0)::text || ' matches') as detail,
          created_at as at
        from search_sessions
        union all
        select id, 'upload'::text as type, guest_name as guest,
          ((coalesce(photo_count, 0) + coalesce(video_count, 0))::text || ' files') as detail,
          created_at as at
        from upload_events
        union all
        select id, 'download'::text as type, guest_name as guest,
          case
            when kind = 'zip' then (coalesce(count, 0)::text || ' files (zip)')
            else ('photo ' || coalesce(photo_id::text, ''))
          end as detail,
          created_at as at
        from download_events
      ) combined
      order by at desc
      limit ${limit} offset ${offset}`,
    sql<{ total: string }[]>`
      select (
        (select count(*) from search_sessions) +
        (select count(*) from upload_events) +
        (select count(*) from download_events)
      )::text as total`,
  ]);

  return { rows, total: Number(totalRows[0]?.total ?? 0) };
}

export interface MediaRow {
  id: string;
  kind: "photo" | "video";
  guest: string | null;
  thumbKey: string | null;
  uploadedAt: Date;
}

export interface ListMediaOptions {
  limit?: number;
  offset?: number;
}

/**
 * Paginated gallery feed for the admin console: active photos + active videos
 * (media), newest first. `thumbKey` is the photo's thumb_key or the video's
 * poster_key (null if a poster failed to generate) — the caller resolves it to
 * a public URL via `previewUrl`.
 */
export interface SearchLogRow {
  id: string;
  guest_name: string | null;
  selfie_key: string | null;
  match_count: number | null;
  created_at: Date;
}

export interface ListSearchesOptions {
  limit?: number;
  offset?: number;
}

/**
 * Paginated "who searched" feed for the admin console: recent search sessions
 * (including their private selfie key, when one was stored), newest first.
 * The caller resolves `selfie_key` to a short-lived signed URL via
 * `presignGet` — this table never exposes a public URL for a selfie.
 */
export async function listSearches(opts: ListSearchesOptions = {}): Promise<SearchLogRow[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  return sql<SearchLogRow[]>`
    select id, guest_name, selfie_key, match_count, created_at
    from search_sessions
    order by created_at desc
    limit ${limit} offset ${offset}`;
}

export type ReelJobStatus = "queued" | "rendering" | "done" | "error";

export interface InsertReelJobInput {
  spec: unknown; // the validated ReelSpec, stored as jsonb
  sessionId?: string | null;
  guestName?: string | null;
  ip?: string | null;
}

export async function insertReelJob(x: InsertReelJobInput): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into reel_jobs (spec, session_id, guest_name, ip)
    values (${sql.json(x.spec as unknown as Parameters<typeof sql.json>[0])}, ${x.sessionId ?? null}, ${x.guestName ?? null}, ${x.ip ?? null})
    returning id`;
  return rows[0];
}

export interface ReelJobRow {
  id: string;
  status: ReelJobStatus;
  output_key: string | null;
  error: string | null;
}

export async function getReelJob(id: string): Promise<ReelJobRow | null> {
  const rows = await sql<ReelJobRow[]>`
    select id, status, output_key, error from reel_jobs where id = ${id}`;
  return rows[0] ?? null;
}

export async function setReelJobStatus(
  id: string,
  patch: { status: ReelJobStatus; outputKey?: string | null; error?: string | null },
): Promise<void> {
  await sql`
    update reel_jobs set
      status = ${patch.status},
      output_key = coalesce(${patch.outputKey ?? null}, output_key),
      error = coalesce(${patch.error ?? null}, error),
      updated_at = now()
    where id = ${id}`;
}

export interface ReelListRow {
  id: string;
  guest_name: string | null;
  output_key: string | null;
  created_at: Date;
}

export async function listReels(opts: { limit?: number; offset?: number } = {}): Promise<ReelListRow[]> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  return sql<ReelListRow[]>`
    select id, guest_name, output_key, created_at
    from reel_jobs
    where status = 'done'
    order by created_at desc
    limit ${limit} offset ${offset}`;
}

export async function listMedia(opts: ListMediaOptions = {}): Promise<MediaRow[]> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  return sql<MediaRow[]>`
    select id, kind, guest, "thumbKey", "uploadedAt" from (
      select id, 'photo'::text as kind, uploaded_by as guest,
        thumb_key as "thumbKey", created_at as "uploadedAt"
      from photos
      where status = 'active'
      union all
      select id, 'video'::text as kind, uploaded_by as guest,
        poster_key as "thumbKey", created_at as "uploadedAt"
      from media
      where status = 'active'
    ) combined
    order by "uploadedAt" desc
    limit ${limit} offset ${offset}`;
}
