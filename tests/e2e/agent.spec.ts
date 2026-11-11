// The opt-in in-page agent end to end (docs/web-build.md, sections 2 and 12), against out/
// with a fake OpenAI-compatible model server on loopback (tests/e2e/fakeProvider.mjs) as the
// "Model server on this computer". No real provider and no key are involved. Every other test in
// this suite fails on any off-origin request, which proves nothing leaves before opt-in; here
// the only off-origin requests allowed are the fake server's, they must start only after the
// clinician confirms, and they come from the sandboxed agent frame (origin "null"), never from
// the viewer's page, whose connect-src is 'self'.
import { expect, test, type Page } from '@playwright/test';
import { startFakeProvider } from './fakeProvider.mjs';
import { waitForVolume } from './helpers';

interface Fake {
  origin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requests: { method: string; path: string; origin: string | undefined; body: any }[];
  release: () => void;
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
  fake.release();
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
const toggle = (page: Page) => page.locator('header').getByTestId('agent-status');

/** open the docked panel from the header's Agent button */
async function openPanel(page: Page) {
  await expect(toggle(page)).toHaveText('Agent: off');
  await expect(panel(page)).toBeHidden();
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
}
const optIn = (page: Page) => page.getByRole('dialog', { name: 'Switch on the navigation agent' });

/** open the setup and point the local endpoint at the fake server */
async function setUpLocal(page: Page) {
  await openPanel(page);
  await expect(panel(page).getByText('Agent: off')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Set up the navigation agent' }).click();
  await panel(page).getByLabel('Provider').selectOption({ label: 'Model server on this computer' });
  await panel(page).getByLabel('Endpoint').fill(fake.origin);
  await panel(page).getByLabel('Model id').fill('fake-model');
  await panel(page).getByRole('button', { name: 'Switch on…' }).click();
  await expect(optIn(page)).toBeVisible();
}

async function switchOn(page: Page) {
  await setUpLocal(page);
  await optIn(page).getByRole('button', { name: 'Switch on', exact: true }).click();
  await expect(toggle(page)).toHaveText(`Agent: on, Model server on this computer (${fake.origin})`);
}

async function ask(page: Page, text: string) {
  await panel(page).getByLabel('Request to the agent').fill(text);
  await panel(page).getByRole('button', { name: 'Send', exact: true }).click();
}

test('the agent is off and its panel closed on load, and nothing is sent', async ({ page }) => {
  await expect(toggle(page)).toHaveText('Agent: off');
  await expect(panel(page)).toBeHidden();
  await page.waitForTimeout(1000);
  expect(fake.requests).toEqual([]);
  expect(offOrigin).toEqual([]);
});

test('the setup starts with no provider and no model, and Switch on asks for a provider first', async ({ page }) => {
  await openPanel(page);
  await panel(page).getByRole('button', { name: 'Set up the navigation agent' }).click();
  const provider = panel(page).getByLabel('Provider');
  await expect(provider.locator('option:checked')).toHaveText('Choose a provider');
  // the model server on this computer is listed first, before any cloud provider
  const labels = await provider.locator('option').allTextContents();
  expect(labels).toEqual(['Choose a provider', 'Model server on this computer', 'Anthropic', 'OpenAI', 'Google Gemini']);
  await expect(panel(page).getByLabel('Model id')).toHaveValue('');
  // Switch on stays at full contrast and answers with a plain message, never a dialogue
  const switchOnButton = panel(page).getByRole('button', { name: 'Switch on…' });
  await expect(switchOnButton).toBeEnabled();
  await switchOnButton.click();
  await expect(panel(page).getByRole('alert')).toHaveText('Choose a provider first: a model server on this computer, or a cloud provider.');
  await expect(optIn(page)).toHaveCount(0);
  // a choice fills the model field
  await provider.selectOption({ label: 'Anthropic' });
  await expect(panel(page).getByLabel('Model id')).not.toHaveValue('');
  await expect(provider.locator('option')).toHaveCount(4);
  expect(fake.requests).toEqual([]);
});

test('the opt-in dialogue says what the agent is, and Cancel sends nothing', async ({ page }) => {
  await setUpLocal(page);
  const d = optIn(page);
  await expect(d).toContainText('The agent runs on your own model account with Model server on this computer');
  await expect(d).toContainText("Your key stays in this tab's memory and is forgotten when the tab closes.");
  await expect(d).toContainText('Every snapshot the agent asks for is sent to Model server on this computer');
  await expect(d).toContainText('and nowhere else.');
  await expect(d).toContainText('The agent only moves the camera. It is not asked for findings, and nothing it says is a finding.');
  await expect(d).toContainText('The local server must accept requests from the agent frame (CORS); llama-server does by default.');
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
  // the model's words appear only in the labelled block, apart from the steps
  const block = panel(page).getByTestId('agent-model-text');
  await expect(block.getByText('TMJ mode is on screen at the current window.')).toBeVisible({ timeout: 30_000 });
  await expect(block).toContainText('Model text. Not a reading, not a finding.');
  await expect(panel(page).getByTestId('agent-log')).not.toContainText('TMJ mode is on screen');

  // every provider request came from the sandboxed frame: an opaque origin, never the viewer's
  expect(fake.requests.every((r) => r.origin === 'null')).toBe(true);
  const sandbox = await page.locator('iframe[data-testid="agent-frame"]').getAttribute('sandbox');
  expect(sandbox).toBe('allow-scripts');

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
  await ask(page, 'hold: show the TMJ');
  // the fake server holds the second request (after the set_view_mode step) until released:
  // the turn is provably in flight when Switch off is clicked
  await expect.poll(() => fake.requests.length, { timeout: 30_000 }).toBe(2);
  // the header's Switch off, beside the status, works with the panel open or closed
  await toggle(page).click();
  await expect(panel(page)).toBeHidden();
  await page.locator('header').getByRole('button', { name: 'Switch off' }).click();
  await expect(toggle(page)).toHaveText('Agent: off');
  await expect(page.locator('iframe[data-testid="agent-frame"]')).toHaveCount(0); // the key went with it
  // the held answer would ask for a snapshot and a third request; it never arrives
  fake.release();
  await page.waitForTimeout(2000);
  expect(fake.requests.length).toBe(2);
  await expect(page.locator('header').getByRole('button', { name: 'Switch off' })).toHaveCount(0);
});

test('closing the panel mid-turn keeps Stop in the header, and it works', async ({ page }) => {
  await switchOn(page);
  await ask(page, 'hold: show the TMJ');
  await expect.poll(() => fake.requests.length, { timeout: 30_000 }).toBe(2);
  await panel(page).getByRole('button', { name: 'Close panel' }).click();
  await expect(panel(page)).toHaveCount(0); // closed means unmounted, never hidden
  const stop = page.locator('header').getByTestId('agent-header-stop');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  fake.release();
  await page.waitForTimeout(2000);
  expect(fake.requests.length).toBe(2);
  // the agent stays on; the panel says the request stopped
  await expect(toggle(page)).toHaveText(`Agent: on, Model server on this computer (${fake.origin})`);
  await toggle(page).click();
  await expect(panel(page).getByTestId('agent-log')).toContainText('Stopped.');
});

test('model text with report vocabulary is replaced by the guard sentence', async ({ page }) => {
  await switchOn(page);
  await ask(page, 'interpret this scan');
  const block = panel(page).getByTestId('agent-model-text');
  await expect(block).toContainText(
    'The model offered an interpretation. CBCTScope does not display readings; ask for a view, not an opinion.',
    { timeout: 30_000 },
  );
  await expect(page.locator('body')).not.toContainText('radiolucency');
});

test('the open panel docks under the viewer and covers no control', async ({ page }) => {
  const viewer = page.locator('main');
  const before = await viewer.boundingBox();
  await openPanel(page);
  const strip = await panel(page).boundingBox();
  const after = await viewer.boundingBox();
  expect(before && strip && after).toBeTruthy();
  // the viewer moved up to make room: it ends where the strip begins
  expect(after!.height).toBeLessThan(before!.height - 150);
  expect(after!.y + after!.height).toBeLessThanOrEqual(strip!.y + 1);
  const overlaps = (a: { x: number; y: number; width: number; height: number }) =>
    a.x < strip!.x + strip!.width && strip!.x < a.x + a.width && a.y < strip!.y + strip!.height && strip!.y < a.y + a.height;
  // two right-rail controls, a window preset and a 3D style: visible, uncovered and clickable
  const rail = page.locator('aside');
  for (const name of ['Bone', 'Shiny']) {
    const b = rail.getByRole('button', { name, exact: true });
    await b.scrollIntoViewIfNeeded();
    await expect(b).toBeVisible();
    expect(overlaps((await b.boundingBox())!), `${name} is under the agent panel`).toBe(false);
    await b.click(); // fails if anything covers it
  }
  // the header's mode buttons stay clickable too
  await page.locator('header').getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(panel(page)).toBeVisible();
});
