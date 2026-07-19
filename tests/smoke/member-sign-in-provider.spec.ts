import { expect, test, type Route } from '@playwright/test';
import { gotoAppFresh } from './_helpers';

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 0, data }),
  });
}

test.describe('member sign-in provider', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppFresh(page);
  });

  test('maps config, summary and sign-in records', async ({ page }) => {
    const baseUrl = `${await page.evaluate(() => window.location.origin)}/__sign-in/app`;
    const requests: Array<{ method: string; url: string; auth?: string }> = [];

    await page.route('**/__sign-in/app/member/sign-in/**', async (route) => {
      const request = route.request();
      requests.push({
        method: request.method(),
        url: request.url(),
        auth: request.headers().authorization,
      });
      if (request.url().includes('/config/list')) {
        await fulfill(route, [
          { id: 7, day: 1, point: 10, experience: 2, cashAmount: 88, status: 1 },
        ]);
      } else if (request.url().includes('/get-summary')) {
        await fulfill(route, { totalDay: 5, continuousDay: 3, todaySigned: false });
      } else {
        await fulfill(route, {
          id: 9,
          userId: 1001,
          day: 4,
          point: 20,
          experience: 3,
          cashAmount: 188,
          createdAt: '2026-07-19T09:00:00Z',
        });
      }
    });

    const result = await page.evaluate(async ({ url }) => {
      const { PlatformMemberSignInProvider } = await import(
        '/src/lib/member-sign-in-provider.ts'
      );
      const provider = new PlatformMemberSignInProvider(url, () => 'member-token');
      return {
        configs: await provider.listConfigs(),
        summary: await provider.getSummary('1001'),
        record: await provider.signIn('1001'),
      };
    }, { url: baseUrl });

    expect(result).toEqual({
      configs: [
        { id: '7', day: 1, point: 10, experience: 2, cashAmount: 88, status: 1 },
      ],
      summary: { totalDay: 5, continuousDay: 3, todaySigned: false },
      record: {
        id: '9',
        userId: '1001',
        day: 4,
        point: 20,
        experience: 3,
        cashAmount: 188,
        createdAt: '2026-07-19T09:00:00Z',
      },
    });
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET', 'POST']);
    expect(requests.every((request) => request.auth === 'Bearer member-token')).toBe(true);
    expect(requests[1]?.url).toContain('userId=1001');
    expect(requests[2]?.url).toContain('userId=1001');
  });

  test('rejects calls without an active token', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { PlatformMemberSignInProvider } = await import(
        '/src/lib/member-sign-in-provider.ts'
      );
      const provider = new PlatformMemberSignInProvider('/__sign-in/app', () => null);
      try {
        await provider.getSummary('1001');
        return null;
      } catch (error) {
        return error instanceof Error ? error.name : String(error);
      }
    });
    expect(result).toBe('PlatformConfigError');
  });
});
