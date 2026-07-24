import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const projectId = 'vowvy-1ba5f';
const authBase = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`;
const firestoreBase =
  `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

interface TestAccount {
  email: string;
  password: string;
  uid: string;
  idToken: string;
}

async function createAccount(email: string): Promise<TestAccount> {
  const password = 'Collaborator-test-2026!';
  const response = await fetch(`${authBase}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  expect(response.ok).toBeTruthy();
  const body = await response.json() as { localId: string; idToken: string };
  return { email, password, uid: body.localId, idToken: body.idToken };
}

async function writeDocument(
  path: string,
  fields: Record<string, unknown>,
  idToken: string,
) {
  const response = await fetch(`${firestoreBase}/${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields }),
  });
  expect(response.ok).toBeTruthy();
}

const stringValue = (value: string) => ({ stringValue: value });
const boolValue = (value: boolean) => ({ booleanValue: value });
const timestampValue = (value: Date) => ({ timestampValue: value.toISOString() });

async function signIn(page: Page, account: TestAccount) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign In', exact: true }).first().click();
  await page.getByPlaceholder('Email').fill(account.email);
  await page.getByPlaceholder('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).last().click();
  await expect(
    page.getByRole('button', { name: 'Sign In', exact: true }),
  ).toHaveCount(0);
}

async function newEnglishContext(
  browser: { newContext(): Promise<BrowserContext> },
) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('vowvy-lang', 'en'));
  return context;
}

test('owner invitation, collaborator acceptance, shared context, and revocation', async ({ browser }, testInfo) => {
  const suffix = Date.now();
  const owner = await createAccount(`owner-${suffix}@example.test`);
  const collaborator = await createAccount(`collaborator-${suffix}@example.test`);
  const accepted = {
    acceptedTermsVersion: stringValue('2026-06-13'),
    acceptedPrivacyVersion: stringValue('2026-06-13'),
    acceptedAupVersion: stringValue('2026-06-13'),
    onboardingSkipped: boolValue(true),
  };
  await writeDocument(`users/${owner.uid}`, accepted, owner.idToken);
  await writeDocument(`users/${collaborator.uid}`, accepted, collaborator.idToken);
  await writeDocument(`users/${owner.uid}/locations/shared-location`, {
    id: stringValue('shared-location'),
    name: stringValue('Shared Test Room'),
    effectiveIsPrivate: boolValue(false),
    visibility: stringValue('shared'),
    deletedAt: { nullValue: null },
    isDeleted: boolValue(false),
    createdAt: timestampValue(new Date()),
  }, owner.idToken);

  const ownerContext = await newEnglishContext(browser);
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner);
  await ownerPage.goto('/collaborators');
  const inviteInput = ownerPage.locator('input[readonly]');
  await expect(inviteInput).toHaveValue(/\/invite\//);
  const inviteLink = await inviteInput.inputValue();

  const collaboratorContext = await newEnglishContext(browser);
  const collaboratorPage = await collaboratorContext.newPage();
  await signIn(collaboratorPage, collaborator);
  await collaboratorPage.goto(new URL(inviteLink).pathname);
  await collaboratorPage.getByRole('button', { name: /accept/i }).click();
  await expect(collaboratorPage.getByRole('heading', { name: /you.re in/i })).toBeVisible();
  await collaboratorPage.getByRole('button', { name: /go to.*inventory/i }).click();
  await expect(collaboratorPage.getByText(/authorized shared inventory/i)).toBeVisible();
  await expect(collaboratorPage.getByText('Shared Test Room')).toBeVisible();
  await collaboratorPage.screenshot({
    path: testInfo.outputPath('shared-inventory-access.png'),
    fullPage: true,
  });

  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: /revoke/i }).click();
  await collaboratorPage.reload();
  await expect(collaboratorPage.getByText(/authorized shared inventory/i)).toHaveCount(0);
  await expect(collaboratorPage.getByText('Shared Test Room')).toHaveCount(0);
  await collaboratorPage.screenshot({
    path: testInfo.outputPath('revoked-access-removed.png'),
    fullPage: true,
  });

  await ownerContext.close();
  await collaboratorContext.close();
});
