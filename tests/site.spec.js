import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { siteServer } from '../scripts/site-server.mjs';

const test = base.extend({
  browserHealth: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    page.on('request', request => {
      if (!request.url().startsWith('http://127.0.0.1:')) errors.push(`External request: ${request.url()}`);
    });
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`));
    });
    await use();
    if (!page.isClosed()) errors.push(...await page.evaluate(() => window.__cspViolations ?? []));
    expect(errors, 'No console, page, CSP, failed-resource or external-resource errors').toEqual([]);
  }, { auto: true }],
});

const widths = [320, 390, 768, 1440];
const themes = ['light', 'dark'];
const copyTargets = ['setup-command', 'token-command', 'event-command', 'docker-command', 'native-command'];
const scenes = {
  notification: 'Notification badge',
  success: 'All clear — sample pixel art',
  heartbeat: 'Heartbeat — sample pixel art',
};
const copied = 'Copied to clipboard. Review the commands before running them.';
const denied = 'Clipboard access is unavailable. The command is selected; copy it with Ctrl+C or your browser’s copy action.';

async function open(page, width = 1440, theme = 'light') {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Give your events\s*a little light\./);
  await expect(page.locator('[data-matrix] > span')).toHaveCount(64);
}

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, 'No document-level horizontal overflow').toBe(dimensions.width);
  expect(dimensions.width).toBeLessThanOrEqual(page.viewportSize().width);
}

async function expandDisclosures(page) {
  for (const summary of await page.locator('details > summary').all()) {
    await summary.click();
    await expect(summary.locator('..')).toHaveAttribute('open', '');
  }
}

async function capture(page, testInfo, mode, width, theme) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Manrope')), 'Self-hosted font decoded').toBe(true);
  const directory = path.resolve('artifacts/site/screenshots');
  await mkdir(directory, { recursive: true });
  const name = `${mode}-${width}-${theme}`;
  const filename = path.join(directory, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true, animations: 'disabled' });
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify({ name, file: `screenshots/${name}.png`, mode, width, theme, url: page.url(), browser: page.context().browser().version() }, null, 2) + '\n');
  await testInfo.attach(name, { path: filename, contentType: 'image/png' });
}

for (const width of widths) {
  for (const theme of themes) {
    test(`enhanced ${width}px ${theme}: layout, controls, expanded disclosures, axe and screenshot`, async ({ page }, testInfo) => {
      await open(page, width, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('button[data-theme-toggle]')).toHaveAccessibleName(`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      const group = page.getByRole('group', { name: 'Preview an animation' });
      await expect(group).toBeVisible();
      for (const [scene, label] of Object.entries(scenes)) {
        const before = await page.locator('[data-matrix] > span').evaluateAll(nodes => nodes.map(node => node.dataset.tone));
        await group.locator(`button[data-scene="${scene}"]`).click();
        await expect(page.locator('#scene-caption')).toHaveText(label);
        await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
        await expect(group.locator(`button[data-scene="${scene}"]`)).toHaveAttribute('aria-pressed', 'true');
        const after = await page.locator('[data-matrix] > span').evaluateAll(nodes => nodes.map(node => node.dataset.tone));
        expect(after.every(tone => ['off', 'cyan', 'amber', 'white'].includes(tone))).toBe(true);
        if (scene !== 'notification') expect(after).not.toEqual(before);
      }
      await group.locator('button[data-scene="notification"]').click();
      await expandDisclosures(page);
      for (const id of ['features', 'how-it-works', 'install', 'faq']) await expect(page.locator(`#${id}`)).toBeVisible();
      for (const target of copyTargets) await expect(page.locator(`button[data-copy="${target}"]`)).toBeVisible();
      await noOverflow(page);
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await capture(page, testInfo, 'enhanced', width, theme);
    });
  }
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const width of widths) {
    for (const theme of themes) {
      test(`nojs ${width}px ${theme}: native links, disclosures and screenshot`, async ({ page }, testInfo) => {
        await open(page, width, theme);
        await expect(page.locator('html')).not.toHaveAttribute('data-theme');
        expect(await page.locator('html').evaluate(node => getComputedStyle(node).colorScheme)).toBe(theme);
        await expect(page.locator('button[data-theme-toggle]')).toBeHidden();
        await expect(page.locator('.scene-controls')).toBeHidden();
        for (const copy of await page.locator('button[data-copy]').all()) await expect(copy).toBeHidden();
        const nav = page.getByRole('navigation', { name: 'Main navigation' });
        await nav.getByRole('link', { name: 'Features', exact: true }).click();
        await expect(page).toHaveURL(/\/echo\/#features$/);
        await nav.getByRole('link', { name: 'Install on Linux', exact: true }).click();
        await expect(page).toHaveURL(/\/echo\/#install$/);
        await expandDisclosures(page);
        await expect(page.locator('#native-command')).toBeVisible();
        await noOverflow(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        // Axe is intentionally not run in script-disabled contexts.
        await capture(page, testInfo, 'nojs', width, theme);
      });
    }
  }
});

test('theme persistence, saved preference, and system preference changes', async ({ page }) => {
  await open(page);
  await page.locator('button[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('echo-theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.removeItem('echo-theme'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('blocked storage retains usable theme and scene controls', async ({ page }) => {
  await page.addInitScript(() => {
    const blocked = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    Object.defineProperty(Storage.prototype, 'getItem', { value: blocked });
    Object.defineProperty(Storage.prototype, 'setItem', { value: blocked });
  });
  await open(page, 390);
  await page.locator('button[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('button[data-scene="success"]').click();
  await expect(page.locator('#scene-caption')).toHaveText(scenes.success);
});

test('clipboard grants copy exact source commands', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.getByText('Build a native Linux binary', { exact: true }).click();
  for (const target of copyTargets) {
    const expected = (await page.locator(`#${target}`).textContent()).trim();
    await page.locator(`button[data-copy="${target}"]`).click();
    await expect(page.locator('[data-copy-status]')).toHaveText(copied);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    await expect(page.locator(`button[data-copy="${target}"]`)).toBeEnabled();
  }
});

test('clipboard permission denial selects exact commands without errors', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'denied', origin: 'http://127.0.0.1:4173' });
  await open(page);
  await page.getByText('Build a native Linux binary', { exact: true }).click();
  for (const target of copyTargets) {
    await page.locator(`button[data-copy="${target}"]`).click();
    await expect(page.locator('[data-copy-status]')).toHaveText(denied);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe(await page.locator(`#${target}`).textContent());
    await expect(page.locator(`button[data-copy="${target}"]`)).toBeEnabled();
  }
});

test('unavailable clipboard API uses the same manual-copy fallback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await open(page);
  await page.locator('button[data-copy="event-command"]').click();
  await expect(page.locator('[data-copy-status]')).toHaveText(denied);
});

test('keyboard skip link, scene buttons, theme and disclosures', async ({ page }) => {
  await open(page, 390);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  const theme = page.locator('button[data-theme-toggle]');
  await theme.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const notification = page.locator('button[data-scene="notification"]');
  await notification.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('button[data-scene="success"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scene-caption')).toHaveText(scenes.success);
  const summary = page.locator('.native-install > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.native-install')).toHaveAttribute('open', '');
  expect(await summary.evaluate(node => ({ style: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }))).toEqual({ style: 'solid', width: '3px' });
});

test('reduced motion disables transitions and demo stays static between user events', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 768);
  expect(await page.locator('html').evaluate(node => getComputedStyle(node).scrollBehavior)).toBe('auto');
  await page.locator('button[data-scene="heartbeat"]').click();
  expect(await page.locator('[data-matrix] > span').first().evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
  const before = await page.locator('[data-matrix]').innerHTML();
  await page.waitForTimeout(600); // Demonstrate no autonomous scene updates.
  expect(await page.locator('[data-matrix]').innerHTML()).toBe(before);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
});

test('built site also serves correctly from a root deployment', async ({ page }) => {
  const server = siteServer({ base: '/' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Give your events\s*a little light\./);
    await expect(page.locator('button[data-theme-toggle]')).toBeVisible();
    await expect(page.locator('[data-matrix] > span')).toHaveCount(64);
    await page.locator('button[data-scene="heartbeat"]').click();
    await expect(page.locator('#scene-caption')).toHaveText(scenes.heartbeat);
    expect(await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('16px Manrope')))).toBe(true);
    await noOverflow(page);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
