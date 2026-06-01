'use strict';
const { test, expect } = require('@playwright/test');

test.describe('Autenticação', () => {
  test('login com credenciais válidas entra na aplicação', async ({ page }) => {
    await page.goto('/');
    await page.fill('#login-email', 'admin@test.pt');
    await page.fill('#login-password', 'test123');
    await page.click('#login-btn');

    // Deve aparecer o dashboard (nav-items visíveis)
    await expect(page.locator('#app')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#user-info')).toContainText('Admin Teste');
  });

  test('login com password errada mostra erro', async ({ page }) => {
    await page.goto('/');
    await page.fill('#login-email', 'admin@test.pt');
    await page.fill('#login-password', 'errada');
    await page.click('#login-btn');

    await expect(page.locator('#login-error')).toBeVisible({ timeout: 3000 });
  });

  test('logout volta ao ecrã de login', async ({ page }) => {
    await page.goto('/');
    await page.fill('#login-email', 'admin@test.pt');
    await page.fill('#login-password', 'test123');
    await page.click('#login-btn');
    await page.locator('#app').waitFor({ state: 'visible' });

    await page.click('#logout-btn');
    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 3000 });
  });

  test('reload mantém sessão (sessionStorage)', async ({ page }) => {
    await page.goto('/');
    await page.fill('#login-email', 'admin@test.pt');
    await page.fill('#login-password', 'test123');
    await page.click('#login-btn');
    await page.locator('#app').waitFor({ state: 'visible' });

    await page.reload();
    // Deve manter-se logado após reload
    await expect(page.locator('#app')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#login-screen')).toBeHidden();
  });

  test('perfil visualizador — botões de criar não visíveis', async ({ page }) => {
    await page.goto('/');
    await page.fill('#login-email', 'viz@test.pt');
    await page.fill('#login-password', 'test123');
    await page.click('#login-btn');
    await page.locator('#app').waitFor({ state: 'visible' });

    // Botão "Nova Ocorrência" não deve estar visível para visualizador
    await expect(page.locator('.btn-new-occ')).toBeHidden();
  });
});
