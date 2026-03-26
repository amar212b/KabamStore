const { chromium } = require('playwright');
const fs = require('fs');

const MAIN_URL = 'https://store.playcontestofchampions.com/';

// ─────────────────────────────────────────
// Close modal
// ─────────────────────────────────────────
async function closeModal(page: any) {
    const strategies = [
        () => page.locator('button.button-continue').click({ timeout: 3000 }),
        () => page.getByRole('button', { name: /continue shopping/i }).click({ timeout: 3000 }),
        () => page.getByRole('button', { name: /back to store/i }).click({ timeout: 3000 }),
        () => page.locator('[data-testid="close-icon"]').click({ timeout: 3000 }),
        () => page.keyboard.press('Escape'),
    ];
    for (const strategy of strategies) {
        try {
            await strategy();
            await page.waitForTimeout(600);
            return true;
        } catch (e) {}
    }
    return false;
}

// ─────────────────────────────────────────
// LOGIN - Fixed for old version in GitHub Actions
// ─────────────────────────────────────────
async function loginUser(page: any, user: any) {
    console.log(`\n--- Logging in: ${user.username} ---`);

    await page.goto(MAIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Accept cookies
    console.log('Accepting cookie banner...');
    try {
        await page.getByRole('button', { name: /ACCEPT ALL/i }).click({ timeout: 5000, force: true });
        console.log('✅ Cookie banner accepted');
    } catch (e) {
        try {
            await page.locator('button.button-accept').click({ timeout: 3000 });
        } catch (e2) {}
    }
    await page.waitForTimeout(1500);

    await page.screenshot({ path: `debug_after_cookies_${Date.now()}.png` });

    // Click green LOG IN button
    console.log('Clicking green LOG IN button...');
    await page.getByRole('button', { name: /LOG IN/i }).first().click({ timeout: 10000, force: true });
    await page.waitForTimeout(2500);

    await page.screenshot({ path: `debug_after_green_login_${Date.now()}.png` });

    // Click "LOGIN WITH KABAM" - This is the main fix for old version
    console.log('Clicking LOGIN WITH KABAM button...');
    const kabamButton = page.getByRole('button', { name: /LOGIN WITH KABAM/i }).first();

    if (await kabamButton.count() > 0) {
        console.log('✅ Found and clicking LOGIN WITH KABAM');
        await kabamButton.click({ timeout: 10000, force: true });
        await page.waitForTimeout(3000);
    } else {
        console.log('No LOGIN WITH KABAM button found (possibly new flow)');
    }

    await page.screenshot({ path: `debug_after_kabam_${Date.now()}.png` });

    // Fill credentials
    console.log('Waiting for Email field...');
    await page.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 30000 });

    await page.getByPlaceholder('Email').fill(user.username);
    await page.getByPlaceholder('Password').fill(user.password);

    await page.getByRole('button', { name: /^login$/i }).click({ timeout: 10000 });

    // Wait for redirect back to store
    await page.waitForURL(/store\.playcontestofchampions\.com/i, { timeout: 40000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log(`✅ Successfully logged in: ${user.username}`);
}

// ─────────────────────────────────────────
// CLAIM FREE ITEMS
// ─────────────────────────────────────────
async function claimFreeItems(page: any) {
    console.log('Checking for free items...');
    await page.waitForTimeout(1500);

    let attempts = 0;
    const maxAttempts = 25;

    while (attempts < maxAttempts) {
        const buttons = await page.locator('div.item-action-free span.primary-button').all();
        if (buttons.length === 0) {
            console.log('No more free items found.');
            break;
        }

        const btn = buttons[0];
        const ctaText = await btn.locator('span.CTA').innerText().catch(() => '');

        if (/owned/i.test(ctaText)) {
            console.log(`Skipping — already owned`);
            break;
        }

        console.log(`Claiming: "${ctaText.trim()}"`);
        await btn.scrollIntoViewIfNeeded();
        await page.evaluate((el: any) => el.click(), await btn.elementHandle());
        await page.waitForTimeout(1500);

        await closeModal(page);
        await page.waitForTimeout(1000);
        attempts++;
    }
    console.log(`Free items done — processed ${attempts} item(s).`);
}

// ─────────────────────────────────────────
// APPLY PROMO CODES
// ─────────────────────────────────────────
async function applyPromoCodes(page: any, codes: string[]) {
    if (codes.length === 0) return;

    console.log(`Applying ${codes.length} promo code(s)...`);

    for (const code of codes) {
        try {
            console.log(`Applying: ${code}`);
            const codeInput = page.locator('input[placeholder="Enter your code"]');
            await codeInput.waitFor({ state: 'visible', timeout: 8000 });
            await codeInput.fill(code);
            await page.getByText('Apply code').click();
            await page.waitForTimeout(1800);
            await closeModal(page);
            console.log(`✅ Applied: ${code}`);
        } catch (error) {
            console.log(`Error with code ${code}: ${error.message}`);
        }
    }
}

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────
async function logoutUser(page: any, username: string) {
    console.log(`Logging out: ${username}`);
    try {
        await page.evaluate(() => {
            const btn = document.querySelector('span.primary-button.button-profile');
            if (btn) btn.click();
        });
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: /sign out/i }).click({ timeout: 4000 }).catch(() => {});
    } catch (e) {
        console.log(`Logout issue: ${e.message}`);
    }
}

// ─────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────
async function main() {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf-8'));
    const codes = config.code
        ? config.code.split(',').map((c: string) => c.trim()).filter(Boolean)
        : [];

    const browser = await chromium.launch({
        headless: true,
        slowMo: 80,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const user of credentials) {
        const context = await browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();

        try {
            await loginUser(page, user);
            await claimFreeItems(page);
            await applyPromoCodes(page, codes);
            await logoutUser(page, user.username);
        } catch (error) {
            console.error(`Failed for ${user.username}: ${error.message}`);
            await page.screenshot({ 
                path: `debug_error_${user.username.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png` 
            }).catch(() => {});
        } finally {
            await context.close();
            console.log(`Context closed for ${user.username}\n`);
        }

        await new Promise((r) => setTimeout(r, 2500));
    }

    await browser.close();
    console.log('All users processed.');
}

main().catch(console.error);