import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vowvy-lang', 'en'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vowvy', exact: true })).toBeVisible();
});

test('landing page exposes account creation and sign-in', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Create your free account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In', exact: true }).first()).toBeVisible();
});

test('registration protects submission and exposes all policy documents', async ({ page }) => {
  await page.getByRole('button', { name: 'Create your free account' }).click();

  const submit = page.getByRole('button', { name: 'Create Account' });
  await expect(submit).toBeDisabled();
  await page.getByPlaceholder('Email').fill('regression@example.com');
  await page.getByPlaceholder('Password').fill('test-password');
  await expect(submit).toBeDisabled();

  await expect(page.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
  await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  await expect(page.getByRole('link', { name: 'Acceptable Use Policy' })).toHaveAttribute('href', '/acceptable-use');

  await page.getByRole('checkbox').check();
  await expect(submit).toBeEnabled();
});

test('sign-in supports password visibility and safe password-reset messaging', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign In', exact: true }).first().click();
  const password = page.getByPlaceholder('Password');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');

  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByText('Enter your email above first.')).toBeVisible();
});

test('language preference switches the rendered interface to Spanish', async ({ page }) => {
  await page.getByLabel('Language').selectOption('es');
  await expect(page.getByRole('button', { name: 'Crea tu cuenta gratis' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vowvy-lang'))).toBe('es');
});

test('language preference switches the rendered interface to Portuguese', async ({ page }) => {
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('button', { name: 'Crie sua conta grátis' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vowvy-lang'))).toBe('pt-BR');
});
