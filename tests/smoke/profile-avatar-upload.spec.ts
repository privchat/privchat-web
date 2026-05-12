// R8.4d-2 — Avatar upload provider smokes.
//
// Tests `PlatformProfileProvider.uploadAvatar` + `updateAvatar` end-to-end
// through the test harness. Same page.route mocking pattern as other
// R8.4 smokes. UI integration (dialog → pick → preview → save chain) is
// best verified in a real browser against real application — that's
// the R8.4d combined real-e2e checklist at the end of R8.4d-3.

import { expect, test, type Page, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

function fakeBaseUrl(originUrl: string): string {
  return `${originUrl}/__fake-platform/app`;
}

async function originOf(page: Page): Promise<string> {
  return page.evaluate(() => window.location.origin);
}

interface MockEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function fulfillJson<T>(
  route: Route,
  status: number,
  envelope: MockEnvelope<T>,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(envelope),
  });
}

test.describe('PlatformProfileProvider avatar (R8.4d-2)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  // ─────────────────────── uploadAvatar happy path ───────────────────────

  test('uploadAvatar: multipart hits /infra/file/upload (single /app); ' +
    'allows jpeg', async ({ page }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let receivedContentType: string | null = null;
    let receivedHadBusinessType = false;
    let receivedHadFile = false;
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        const req = route.request();
        receivedContentType = req.headers()['content-type'] ?? null;
        // Playwright doesn't expose parsed multipart parts directly,
        // so we sniff the raw body for the form field names.
        const raw = req.postData() ?? '';
        receivedHadBusinessType =
          raw.includes('name="businessType"') && raw.includes('member_avatar');
        receivedHadFile = raw.includes('name="file"');
        await fulfillJson(route, 200, {
          code: 0,
          data: {
            fileId: 'file_abc123',
            url: 'https://cdn.example/member_avatar/ab/cd/abcdef.jpg',
            businessType: 'member_avatar',
            mimeType: 'image/jpeg',
            size: 12_345,
          },
        });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      mime: 'image/jpeg',
      byteSize: 512, // tiny
      filename: 'pic.jpg',
    });

    expect(out).toMatchObject({
      ok: true,
      data: {
        fileId: 'file_abc123',
        url: 'https://cdn.example/member_avatar/ab/cd/abcdef.jpg',
        businessType: 'member_avatar',
        mimeType: 'image/jpeg',
        size: 12_345,
      },
    });
    // Multipart Content-Type with boundary; browser sets this — provider
    // must NOT override.
    expect(receivedContentType).toMatch(/^multipart\/form-data;\s*boundary=/);
    expect(receivedHadBusinessType).toBe(true);
    expect(receivedHadFile).toBe(true);
  });

  test('uploadAvatar: png allowed', async ({ page }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 0,
          data: {
            fileId: 'file_png',
            url: 'https://cdn.example/x.png',
            businessType: 'member_avatar',
            mimeType: 'image/png',
            size: 1024,
          },
        });
      },
    );
    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', mime: 'image/png', byteSize: 1024 });
    expect(out).toMatchObject({ ok: true });
  });

  test('uploadAvatar: webp allowed', async ({ page }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 0,
          data: {
            fileId: 'file_webp',
            url: 'https://cdn.example/x.webp',
            businessType: 'member_avatar',
            mimeType: 'image/webp',
            size: 2048,
          },
        });
      },
    );
    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', mime: 'image/webp', byteSize: 2048 });
    expect(out).toMatchObject({ ok: true });
  });

  // ─────────────────────── client-side guards ───────────────────────

  test('uploadAvatar: non-image mime rejected → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      mime: 'application/pdf',
      byteSize: 1024,
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  test('uploadAvatar: >5MB rejected → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    {
      baseUrl,
      accessToken: 'access-jwt-test',
      mime: 'image/jpeg',
      // 5 MB + 1 byte
      byteSize: 5 * 1024 * 1024 + 1,
    });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  // ─────────────────────── server error mapping ───────────────────────

  test('uploadAvatar: server code !== 0 → PlatformApiError', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 4003,
          message: 'AVATAR_FILE_TOO_LARGE',
        });
      },
    );
    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', mime: 'image/jpeg', byteSize: 1024 });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformApiError',
      errorCode: 4003,
      errorMessage: 'AVATAR_FILE_TOO_LARGE',
    });
  });

  // ─────────────────────── updateAvatar ───────────────────────

  test('updateAvatar: PUT /app/app/member/user/update-avatar with body {fileId}', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let body: unknown = null;
    let method = '';
    await page.route(
      '**/__fake-platform/app/app/member/user/update-avatar',
      async (route: Route) => {
        method = route.request().method();
        body = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', fileId: '  file_abc123  ' });

    expect(out).toEqual({ ok: true, data: null });
    expect(method).toBe('PUT');
    // Provider trims fileId to keep server-side validation simple.
    expect(body).toEqual({ fileId: 'file_abc123' });
  });

  test('updateAvatar: empty fileId rejected → PlatformConfigError, NO HTTP', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    let hits = 0;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-avatar',
      async (route: Route) => {
        hits += 1;
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    const out = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', fileId: '   ' });

    expect(out).toMatchObject({
      ok: false,
      errorName: 'PlatformConfigError',
    });
    expect(hits).toBe(0);
  });

  // ─────────────── uploadAvatar return shape usable by UI ───────────────

  test('uploadAvatar: returned fileId can be passed straight to updateAvatar', async ({
    page,
  }) => {
    const baseUrl = fakeBaseUrl(await originOf(page));
    await page.route(
      '**/__fake-platform/app/infra/file/upload',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          code: 0,
          data: {
            fileId: 'file_chained',
            url: 'https://cdn.example/c.jpg',
            businessType: 'member_avatar',
            mimeType: 'image/jpeg',
            size: 1024,
          },
        });
      },
    );
    let updateBody: unknown = null;
    await page.route(
      '**/__fake-platform/app/app/member/user/update-avatar',
      async (route: Route) => {
        updateBody = JSON.parse(route.request().postData() ?? 'null');
        await fulfillJson(route, 200, { code: 0, data: null });
      },
    );

    // Step 1: upload
    const uploadResult = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUploadAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUploadAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', mime: 'image/jpeg', byteSize: 1024 });
    const uploadOk = uploadResult as { ok: true; data: { fileId: string } };
    expect(uploadOk.ok).toBe(true);

    // Step 2: updateAvatar with returned fileId
    const updateResult = await page.evaluate(async (args) =>
      (
        window as unknown as {
          __privchatTest: {
            platformUpdateAvatar(args: unknown): Promise<unknown>;
          };
        }
      ).__privchatTest.platformUpdateAvatar(args),
    { baseUrl, accessToken: 'access-jwt-test', fileId: uploadOk.data.fileId });
    expect(updateResult).toEqual({ ok: true, data: null });
    expect(updateBody).toEqual({ fileId: 'file_chained' });
  });
});
