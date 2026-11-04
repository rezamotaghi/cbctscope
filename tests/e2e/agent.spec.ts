// The opt-in in-page agent end to end (docs/web-build.md, section 10, item 3), against out/
// with a fake OpenAI-compatible model server on loopback (tests/e2e/fakeProvider.mjs) as the
// "Local or custom endpoint". No real provider and no key are involved. Every other test in
// this suite fails on any off-origin request, which proves nothing leaves before opt-in; here
// the only off-origin requests allowed are the fake server's, and they must start only after
// the clinician confirms.
import { expect, test, type Page } from '@playwright/test';
import { startFakeProvider } from './fakeProvider.mjs';
import { waitForVolume } from './helpers';

interface Fake {
  origin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requests: { method: string; path: string; origin: string | undefined; body: any }[];
  close: () => Promise<void>;
}

let fake: Fake;
let offOrigin: string[] = [];
let problems: string[] = [];

test.beforeAll(async () => {
  fake = (await startFakeProvider()) as Fake;
});

test.afterAll(async () => {
  await fake?.close();
});

test.beforeEach(async ({ page, baseURL }) => {
  fake.requests.length = 0;
  offOrigin = [];
  problems = [];
  const origin = new URL(baseURL as string).origin;
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (new URL(url).origin !== origin) offOrigin.push(url);
  });
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(`CSP: ${msg.text()}`);
  });
  await page.goto('/');
  await waitForVolume(page);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
  // the fake server's origin and nothing else, ever
  expect(offOrigin.filter((u) => new URL(u).origin !== fake.origin)).toEqual([]);
});

const panel = (page: Page) => page.getByTestId('agent-panel');
const optIn = (page: Page) => page.getByRole('dialog', { name: 'Switch on the navigation agent' });

/** open the setup and point the local endpoint at the fake server */
async function setUpLocal(page: Page) {
  await expect(panel(page).getByText('Agent: off')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Set up the navigation agent' }).click();
  await panel(page).getByLabel('Provider').selectOption({ label: 'Local or custom endpoint' });
  await panel(page).getByLabel('Endpoint').fill(fake.origin);
  await panel(page).getByLabel('Model id').fill('fake-model');
  await panel(page).getByRole('button', { name: 'Switch on…' }).click();
  await expect(optIn(page)).toBeVisible();
}

async function switchOn(page: Page) {
  await setUpLocal(page);
  await optIn(page).getByRole('button', { name: 'Switch on', exact: true }).click();
  await expect(page.getByTestId('agent-status')).toHaveText(`Agent: on, Local or custom endpoint (${fake.origin})`);
}

async function ask(page: Page, text: string) {
  await panel(page).getByLabel('Request to the agent').fill(text);
  await panel(page).getByRole('button', { name: 'Send', exact: true }).click();
}

test('the agent is off on load and nothing is sent', async ({ page }) => {
  await expect(panel(page).getByText('Agent: off')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(fake.requests).toEqual([]);
  expect(offOrigin).toEqual([]);
});

test('the opt-in dialogue says what the agent is, and Cancel sends nothing', async ({ page }) => {
  await setUpLocal(page);
  const d = optIn(page);
  await expect(d).toContainText('The agent runs on your own model account with Local or custom endpoint');
  await expect(d).toContainText("Your key stays in this tab's memory and is forgotten when the tab closes.");
  await expect(d).toContainText('Every snapshot the agent asks for is sent to Local or custom endpoint');
  await expect(d).toContainText('and nowhere else.');
  await expect(d).toContainText('The agent only moves the camera. It is not asked for findings, and nothing it says is a finding.');
  await expect(d).toContainText('Your browser decides whether a page may reach a local server; the desktop app always can.');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toHaveCount(0);
  await expect(panel(page).getByText('Agent: off')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(fake.requests).toEqual([]);
  expect(offOrigin).toEqual([]);
});

test('a request moves the viewer and the snapshot reaches the provider as an image part', async ({ page }) => {
  await switchOn(page);
  expect(fake.requests).toEqual([]); // switching on sends nothing by itself
  await ask(page, 'show the TMJ');
  await expect(panel(page).getByText('TMJ mode is on screen at the current window.')).toBeVisible({ timeout: 30_000 });

  // three requests: the request, the set_view_mode result, the snapshot result
  expect(fake.requests.map((r) => r.path)).toEqual(['/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions']);
  const first = fake.requests[0].body;
  expect(first.model).toBe('fake-model');
  expect(first.tools.map((t: { function: { name: string } }) => t.function.name)).toHaveLength(15);
  expect(first.messages[0].role).toBe('system');
  expect(first.messages[0].content).toMatch(/never interpret/i);

  // the view mode changed: the viewer's own state, read back after the verb, says tmj ...
  const second = fake.requests[1].body;
  const toolMsg = second.messages.find((m: { role: string }) => m.role === 'tool');
  expect(toolMsg.content).toMatch(/mode tmj/);
  // ... and the header's TMJ button is the active one
  const tmj = page.locator('header').getByRole('button', { name: 'TMJ', exact: true });
  const mpr = page.locator('header').getByRole('button', { name: 'MPR', exact: true });
  const bg = (b: typeof tmj) => b.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(tmj)).not.toBe(await bg(mpr));

  // the snapshot went to the provider as an image part (a PNG data URL) and nowhere else
  const third = fake.requests[2].body;
  const imageParts = third.messages
    .filter((m: { role: string; content: unknown }) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m: { content: { type: string; image_url?: { url: string } }[] }) => m.content)
    .filter((p: { type: string }) => p.type === 'image_url');
  expect(imageParts).toHaveLength(1);
  expect(imageParts[0].image_url.url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]{1000,}/);

  // every off-origin request went to the fake server's origin
  expect(offOrigin.length).toBeGreaterThanOrEqual(3);
  expect(offOrigin.every((u) => new URL(u).origin === fake.origin)).toBe(true);
});

test('Switch off stops the request in flight and anything after it', async ({ page }) => {
  await switchOn(page);
  await ask(page, 'slow: show the TMJ');
  await expect.poll(() => fake.requests.length, { timeout: 10_000 }).toBe(1);
  await panel(page).getByRole('button', { name: 'Switch off' }).click();
  await expect(panel(page).getByText('Agent: off')).toBeVisible();
  // the slow answer would have asked for set_view_mode and a second request; neither happens
  await page.waitForTimeout(4000);
  expect(fake.requests.length).toBe(1);
  await expect(page.getByTestId('agent-status')).toHaveCount(0);
});
