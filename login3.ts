const { chromium } = require('playwright');
const fs = require('fs');

const MAIN_URL = 'https://store.playcontestofchampions.com/';

// ─────────────────────────────────────────
// Close modal
// ─────────────────────────────────────────
async function closeModal(page) {
    const strategies = [
        () => page.locator('button.button-continue').click({ timeout: 3000 }),
        () => page.getByRole('button', { name: /continue shopping/i }).click({ timeout: 3000 }),
        () => page.getByRole('button', { name: /back to store/i }).click({ timeout: 3000 }),
        () => page.locator('button#coupon-modal-button[data-testid="coupon-modal-button"]').click({ timeout: 3000 }),
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
// LOGIN - Fixed for GitHub Actions (March 2026 design)
// ─────────────────────────────────────────
async function loginUser(page, user) {
    console.log(`\n--- Logging in: ${user.username} ---`);

    await page.goto(MAIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // === Strong Cookie Banner Handling ===
    console.log('Trying to accept cookie banner...');
    const cookieStrategies = [
        () => page.getByRole('button', { name: /ACCEPT ALL/i }).click({ timeout: 6000, force: true }),
        () => page.locator('button').filter({ hasText: /ACCEPT ALL/i }).first().click({ timeout: 6000, force: true }),
        () => page.getByRole('button', { name: /accept|ok|agree/i }).first().click({ timeout: 5000, force: true }),
        () => page.locator('button.button-accept').click({ timeout: 4000, force: true }),
    ];

    let cookieAccepted = false;
    for (const strategy of cookieStrategies) {
        try {
            await strategy();
            console.log('✅ Cookie banner accepted');
            cookieAccepted = true;
            await page.waitForTimeout(1500);
            break;
        } catch (e) {}
    }

    if (!cookieAccepted) {
        console.log('⚠️ Could not click ACCEPT ALL, continuing anyway...');
    }

    // Debug after cookies
    await page.screenshot({ path: `debug_after_cookies_${Date.now()}.png` });

    // === Click green LOG IN button ===
    console.log('Looking for LOG IN button...');
    const logInButton = page.getByRole('button', { name: /LOG IN/i }).first();

    if (await logInButton.count() === 0) {
        console.log('❌ LOG IN button not found!');
        await page.screenshot({ path: `debug_no_login_button_${Date.now()}.png` });
        throw new Error('LOG IN button not found - possibly blocked by cookie banner');
    }

    console.log('✅ Found LOG IN button, clicking...');
    await logInButton.click({ timeout: 10000, force: true });

    await page.waitForTimeout(3000);

    // Wait for Kabam auth page
    await page.waitForURL(/kabam|oauth|auth|login|signin/i, { timeout: 25000 }).catch(() => {
        console.log('Warning: Auth URL pattern not detected');
    });

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `debug_auth_page_${Date.now()}.png` });
    console.log('Auth page URL:', page.url());

    // === Fill Kabam login form ===
    console.log('Filling credentials...');

    await page.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByPlaceholder('Email').fill(user.username);
    await page.getByPlaceholder('Password').fill(user.password);

    await page.getByRole('button', { name: /^login$|^sign in$/i }).click({ timeout: 10000 });

    // Wait for redirect back to store
    console.log('Waiting for redirect back to store...');
    await page.waitForURL(/store\.playcontestofchampions\.com/i, { timeout: 40000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log(`✅ Successfully logged in: ${user.username}`);
}

// ─────────────────────────────────────────
// CLAIM FREE ITEMS
// ─────────────────────────────────────────
async function claimFreeItems(page) {
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
            console.log(`Skipping — already owned ("${ctaText.trim()}")`);
            break;
        }

        console.log(`Claiming: "${ctaText.trim()}" [${attempts + 1}]`);

        await btn.scrollIntoViewIfNeeded();
        await page.evaluate(el => el.click(), await btn.elementHandle());
        await page.waitForTimeout(1500);

        try {
            await page.locator('div.purchase-handler-modal').waitFor({ state: 'visible', timeout: 6000 });
        } catch (e) {}

        await closeModal(page);

        try {
            await page.locator('div.purchase-handler-modal').waitFor({ state: 'hidden', timeout: 5000 });
        } catch (e) {}

        await page.waitForTimeout(1000);
        attempts++;
    }

    console.log(`Free items done — processed ${attempts} item(s).`);
}

// ─────────────────────────────────────────
// APPLY PROMO CODES
// ─────────────────────────────────────────
async function applyPromoCodes(page, codes) {
    if (codes.length === 0) return;

    console.log(`Applying ${codes.length} promo code(s)...`);

    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        console.log(`Applying: ${code}`);

        try {
            const codeInput = page.locator('input[placeholder="Enter your code"]');
            await codeInput.waitFor({ state: 'visible', timeout: 8000 });
            await codeInput.fill(code);

            await page.getByText('Apply code').click();
            await page.waitForTimeout(1800);

            const errorMessage = await page
                .locator('span.promocodes-input__error.xds-text-minor[data-source="server"]')
                .textContent({ timeout: 3000 })
                .catch(() => null);

            if (errorMessage) {
                console.log(`Code ${code} rejected: ${errorMessage.trim()}`);
                await codeInput.fill('');
                continue;
            }

            await closeModal(page);
            console.log(`✅ Code applied: ${code}`);
            await page.waitForTimeout(800);

        } catch (error) {
            console.log(`Error with code ${code}: ${error.message}`);
        }
    }
}

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────
async function logoutUser(page, username) {
    console.log(`Logging out: ${username}`);
    try {
        await page.evaluate(() => {
            const btn = document.querySelector('span.primary-button.button-profile');
            if (btn) btn.click();
        });
        await page.waitForTimeout(1000);

        const signOutStrategies = [
            () => page.locator('button.button-sign-out').click({ timeout: 4000 }),
            () => page.getByRole('button', { name: /sign out/i }).click({ timeout: 4000 }),
        ];

        for (const strategy of signOutStrategies) {
            try {
                await strategy();
                console.log('Sign out clicked');
                break;
            } catch (e) {}
        }
        await page.waitForTimeout(1500);
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
        ? config.code.split(',').map(c => c.trim()).filter(Boolean)
        : [];

    const browser = await chromium.launch({
        headless: true,
        slowMo: 100,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
        ]
    });

    for (const user of credentials) {
        const context = await browser.newContext({
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        const page = await context.newPage();

        try {
            await loginUser(page, user);
            await claimFreeItems(page);
            if (codes.length > 0) await applyPromoCodes(page, codes);
            await logoutUser(page, user.username);
        } catch (error) {
            console.error(`❌ Failed for ${user.username}: ${error.message}`);
            await page.screenshot({ 
                path: `debug_error_${user.username.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png` 
            }).catch(() => {});
        } finally {
            await context.close();
            console.log(`Context closed for ${user.username}\n`);
        }

        await new Promise(r => setTimeout(r, 2500));
    }

    await browser.close();
    console.log('🎉 All users processed.');
}

main().catch(console.error);