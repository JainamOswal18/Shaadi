import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadEnv } from "./env";

const PRESIGN_EXPIRY_SECONDS = 900; // 15 minutes

export const s3Client = new S3Client({
  region: "auto",
  endpoint: loadEnv().R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: loadEnv().R2_ACCESS_KEY_ID,
    secretAccessKey: loadEnv().R2_SECRET_ACCESS_KEY,
  },
});

function originalsBucket(): string {
  return loadEnv().R2_BUCKET_ORIGINALS;
}

export async function presignPut(
  key: string,
  contentType: string,
  bucket: string = originalsBucket(),
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export interface PresignGetOptions {
  bucket?: string;
  expiresIn?: number;
  download?: boolean;
  filename?: string;
}

export async function presignGet(key: string, opts: PresignGetOptions = {}): Promise<string> {
  const bucket = opts.bucket ?? originalsBucket();
  const responseContentDisposition = opts.download
    ? opts.filename
      ? `attachment; filename="${opts.filename}"`
      : "attachment"
    : undefined;
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: responseContentDisposition,
  });
  return getSignedUrl(s3Client, command, {
    expiresIn: opts.expiresIn ?? PRESIGN_EXPIRY_SECONDS,
  });
}

export function previewUrl(key: string): string {
  return `${loadEnv().R2_PREVIEWS_PUBLIC_URL}/${key}`;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | Readable | string,
  contentType: string,
  bucket: string = originalsBucket(),
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObjectStream(
  key: string,
  bucket: string = originalsBucket(),
): Promise<Readable> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body as Readable;
}

export async function deleteObject(
  key: string,
  bucket: string = originalsBucket(),
): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
