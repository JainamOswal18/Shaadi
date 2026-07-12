// @vitest-environment node
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Loaded fresh in beforeAll, after env vars are confirmed present (they come
// from vitest.config.ts's .env injection — see tests/unit/env.test.ts).
let previewUrl: typeof import("@/lib/r2").previewUrl;
let presignPut: typeof import("@/lib/r2").presignPut;
let presignGet: typeof import("@/lib/r2").presignGet;
let putObject: typeof import("@/lib/r2").putObject;
let getObjectStream: typeof import("@/lib/r2").getObjectStream;
let deleteObject: typeof import("@/lib/r2").deleteObject;
let s3: S3Client;

const mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

beforeAll(async () => {
  const mod = await import("@/lib/r2");
  previewUrl = mod.previewUrl;
  presignPut = mod.presignPut;
  presignGet = mod.presignGet;
  putObject = mod.putObject;
  getObjectStream = mod.getObjectStream;
  deleteObject = mod.deleteObject;
  s3 = mod.s3Client;
});

afterEach(() => {
  mock.reset();
});

afterAll(() => {
  s3.destroy();
});

describe("r2 (mocked)", () => {
  it("previewUrl builds the public preview base + key", () => {
    expect(previewUrl("thumb/x.webp")).toBe(
      `${process.env.R2_PREVIEWS_PUBLIC_URL}/thumb/x.webp`,
    );
  });

  it("presignPut returns a URL containing the key and defaults to the originals bucket", async () => {
    const url = await presignPut("uploads/foo.jpg", "image/jpeg");
    expect(url).toContain("uploads/foo.jpg");
    expect(url).toContain(process.env.R2_BUCKET_ORIGINALS as string);
  });

  it("presignPut honors an explicit bucket override", async () => {
    const url = await presignPut("thumb/foo.webp", "image/webp", "shaadi-previews");
    expect(url).toContain("thumb/foo.webp");
    expect(url).toContain("shaadi-previews");
  });

  it("presignGet returns a URL containing the key and defaults to the originals bucket", async () => {
    const url = await presignGet("uploads/foo.jpg");
    expect(url).toContain("uploads/foo.jpg");
    expect(url).toContain(process.env.R2_BUCKET_ORIGINALS as string);
  });

  it("presignGet sets a Content-Disposition query param when download is requested", async () => {
    const url = await presignGet("uploads/foo.jpg", { download: true, filename: "photo.jpg" });
    expect(url).toContain("response-content-disposition=attachment");
    expect(url).toContain("photo.jpg");
  });

  it("putObject sends a PutObjectCommand with the given key/body/content-type", async () => {
    mock.on(PutObjectCommand).resolves({});
    await putObject("uploads/bar.jpg", Buffer.from("hi"), "image/jpeg");
    const calls = mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: process.env.R2_BUCKET_ORIGINALS,
      Key: "uploads/bar.jpg",
      ContentType: "image/jpeg",
    });
  });

  it("putObject honors an explicit bucket override", async () => {
    mock.on(PutObjectCommand).resolves({});
    await putObject("thumb/bar.webp", Buffer.from("hi"), "image/webp", "shaadi-previews");
    const calls = mock.commandCalls(PutObjectCommand);
    expect(calls[0].args[0].input.Bucket).toBe("shaadi-previews");
  });

  it("getObjectStream returns a Node Readable from the response body", async () => {
    const body = Readable.from([Buffer.from("hello")]);
    mock.on(GetObjectCommand).resolves({ Body: body as never });
    const stream = await getObjectStream("uploads/bar.jpg");
    expect(stream).toBeInstanceOf(Readable);
  });

  it("deleteObject sends a DeleteObjectCommand for the given key/bucket", async () => {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    mock.on(DeleteObjectCommand).resolves({});
    await deleteObject("uploads/bar.jpg");
    const calls = mock.commandCalls(DeleteObjectCommand);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: process.env.R2_BUCKET_ORIGINALS,
      Key: "uploads/bar.jpg",
    });
  });
});

describe("r2 live smoke (RUN_LIVE=1)", () => {
  const run = process.env.RUN_LIVE === "1" ? it : it.skip;

  run(
    "puts, fetches, and deletes a tiny object in the previews bucket",
    async () => {
      // Bypass the mock for this suite: real S3Client, real R2 bucket.
      mock.restore();
      const key = `smoke-test/${Date.now()}.txt`;
      const bucket = process.env.R2_BUCKET_PREVIEWS as string;
      await putObject(key, Buffer.from("r2 smoke test"), "text/plain", bucket);
      try {
        const res = await fetch(previewUrl(key));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("r2 smoke test");
      } finally {
        await deleteObject(key, bucket);
      }
    },
    30_000,
  );
});
