export type EmbedFace = { embedding: number[]; bbox: [number,number,number,number]; det_score: number };
export type EmbedResponse = { faces: EmbedFace[] };
export type MatchResult = { photoId: string; similarity: number; thumbKey: string; previewKey: string };
export type SearchResponse = { sessionId: string; matches: (MatchResult & { thumbUrl: string; previewUrl: string })[] };
/** GET /api/session — rebuilds a past search's results from the DB (no re-embed). */
export type SessionResponse = { sessionId: string; guestName: string | null; matches: SearchResponse["matches"] };
export type UploadUrlRequest = { sessionId: string; guestName: string; files: { name: string; type: string; size: number; kind: "photo"|"video" }[] };
export type UploadUrlResponse = { grants: { name: string; key: string; putUrl: string }[]; remaining: { photos: number; videos: number } };
export type AdminSettings = { match_threshold: number; passcode_enabled: boolean; kill_switch: boolean };
/** Public, unauthenticated client bootstrap — GET /api/config. */
export type ConfigResponse = { passcodeRequired: boolean };

export type ReelJobStatus = "queued" | "rendering" | "done" | "error";
/** POST /api/reel — create + dispatch a reel render. */
export type CreateReelResponse = { jobId: string };
/** GET /api/reel?jobId= — poll a reel job's status. */
export type ReelStatusResponse = { status: ReelJobStatus; url?: string; error?: string };
