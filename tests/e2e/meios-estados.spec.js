'use strict';
const { test, expect } = require('@playwright/test');

// Helper: faz login como gestor
async function loginGestor(page) {
  await page.goto('/');
  await page.fill('#login-email', 'gestor@test.pt');
  await page.fill('#login-password', 'test123');
  await page.click('#login-btn');
  await page.locator('#app').waitFor({ state: 'visible' });
}

// Helper: cria uma ocorrência e abre o detalhe
async function criarEAbrirOcorrencia(page) {
  await page.click('.btn-new-occ');
  await page.fill('#occ-local', 'Local E2E Teste');
  await page.fill('#occ-codigo', 'E2E-001');
  await page.click('#save-occ-btn');
  await page.locator('.occ-item').first().click();
  await page.locator('#detail-panel').waitFor({ state: 'visible' });
}

test.describe('Transições de estado de meios', () => {
  test.beforeEach(async ({ page }) => {
    await loginGestor(page);
    await criarEAbrirOcorrencia(page);
  });

  test('adicionar meio previsto → aparece na secção Previstos', async ({ page }) => {
    await page.click('#add-team-btn');
    await page.fill('#team-eq', 'VFCI-E2E-001');
    await page.selectOption('#team-estado', 'previsto');
    await page.fill('#team-previsto-data', '2026-06-02');
    await page.fill('#team-previsto-hora', '08:00');
    await page.click('#save-team-btn');

    await expect(page.locator('.previsto-section')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.previsto-section')).toContainText('VFCI-E2E-001');
  });

  test('Activar Trânsito → toast aparece + meio sai da secção Previstos', async ({ page }) => {
    // Adicionar meio previsto
    await page.click('#add-team-btn');
    await page.fill('#team-eq', 'VFCI-E2E-002');
    await page.selectOption('#team-estado', 'previsto');
    await page.fill('#team-previsto-data', '2026-06-02');
    await page.fill('#team-previsto-hora', '09:00');
    await page.click('#save-team-btn');

    // Clicar no botão Activar Trânsito
    await page.locator('.team-card.estado-previsto').first().locator('[onclick*="quickAction(\'transit\'"]').click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });

    // Confirmar
    await page.click('button:has-text("Confirmar Trânsito")');

    // Toast deve aparecer
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('Em Trânsito');

    // Modal deve fechar
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });

    // Meio não deve estar na secção previstos
    const prevSection = page.locator('.previsto-section');
    if (await prevSection.isVisible()) {
      await expect(prevSection).not.toContainText('VFCI-E2E-002');
    }
  });

  test('Activar Operação → toast com limite', async ({ page }) => {
    // Adicionar meio em trânsito
    await page.click('#add-team-btn');
    await page.fill('#team-eq', 'VFCI-E2E-003');
    await page.selectOption('#team-estado', 'transito');
    await page.click('#save-team-btn');

    await page.locator('.team-card').first().locator('[onclick*="quickAction(\'op\'"]').click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });

    const today = new Date().toISOString().split('T')[0];
    await page.fill('[id="qa-date"]', today);
    await page.fill('[id="qa-time"]', '10:00');
    await page.fill('[id="qa-hmax"]', '12');
    await page.click('button:has-text("Confirmar Activação")');

    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('Em Operação');
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });
  });

  test('modal fecha após confirmar qualquer acção', async ({ page }) => {
    await page.click('#add-team-btn');
    await page.fill('#team-eq', 'VFCI-E2E-004');
    await page.selectOption('#team-estado', 'transito');
    await page.click('#save-team-btn');

    // Descanso
    await page.locator('.team-card').first().locator('[onclick*="quickAction(\'rest\'"]').click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });
    await page.click('button:has-text("Confirmar Descanso")');
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });
  });

  test('Desmobilizar → toast "Desmobilizado"', async ({ page }) => {
    await page.click('#add-team-btn');
    await page.fill('#team-eq', 'VFCI-E2E-005');
    await page.selectOption('#team-estado', 'transito');
    await page.click('#save-team-btn');

    await page.locator('.team-card').first().locator('[onclick*="quickAction(\'demob\'"]').click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });

    const today = new Date().toISOString().split('T')[0];
    await page.fill('[id="qa-demob-date"]', today);
    await page.fill('[id="qa-demob-time"]', '18:00');
    await page.click('button:has-text("Confirmar Desmob")');

    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('Desmobilizado');
  });
});
