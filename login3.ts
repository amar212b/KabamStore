const { chromium } = require('playwright');
const fs = require('fs');

const MAIN_URL = 'https://store.playcontestofchampions.com/';

// ─────────────────────────────────────────
// Close modal with multiple strategies
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
// LOGIN - Most reliable version
// ─────────────────────────────────────────
async function loginUser(page, user) {
    console.log(`\n--- Logging in: ${user.username} ---`);

    await page.goto(MAIN_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Accept cookies if present
    try {
        await page.locator('button.button-accept').click({ timeout: 4000 });
        await page.waitForTimeout(800);
    } catch (e) {}

    // Debug information (very useful when it breaks)
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    const spanInfo = await page.evaluate(() => {
        const span = document.querySelector('span.primary-button.button-login');
        return {
            exists: !!span,
            visible: span ? (span.offsetParent !== null) : false,
            parentTag: span ? span.parentElement?.tagName : null,
            parentHref: span ? span.closest('a')?.href : null,
        };
    });
    console.log('Login span info:', JSON.stringify(spanInfo));

    // Take screenshot before attempting login
    await page.screenshot({ path: `debug_before_login_${Date.now()}.png` });

    // Try to get direct Kabam login URL from the anchor wrapping the span
    let loginURL = await page.evaluate(() => {
        const span = document.querySelector('span.primary-button.button-login');
        if (!span) return null;
        let el = span;
        while (el && el.tagName !== 'A') el = el.parentElement;
        return el && el.href ? el.href : null;
    });

    if (loginURL) {
        console.log(`Navigating directly to login URL: ${loginURL}`);
        await page.goto(loginURL, { waitUntil: 'domcontentloaded' });
    } else {
        console.log('No direct login URL found. Falling back to JS click + navigation...');
        await Promise.all([
            page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
            page.evaluate(() => {
                const span = document.querySelector('span.primary-button.button-login');
                if (span) span.click();
            })
        ]);
    }

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    console.log('Kabam login page URL:', page.url());
    await page.screenshot({ path: `debug_kabam_login_${Date.now()}.png` });

    // Fill credentials on Kabam page
    await page.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByPlaceholder('Email').fill(user.username);
    await page.getByPlaceholder('Password').fill(user.password);

    await page.getByRole('button', { name: /^login$/i }).click({ timeout: 8000 });

    // Wait for redirect back to the store
    await page.waitForURL(/store\.playcontestofchampions\.com/i, { timeout: 30000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log(`✅ Successfully logged in as ${user.username}`);
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

        console.log(`Claiming item: "${ctaText.trim()}" [${attempts + 1}]`);

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

    console.log(`Free items processing completed — claimed ${attempts} item(s).`);
}

// ─────────────────────────────────────────
// APPLY PROMO CODES
// ─────────────────────────────────────────
async function applyPromoCodes(page, codes) {
    if (codes.length === 0) return;

    console.log(`Applying ${codes.length} promo code(s)...`);

    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        console.log(`→ Applying code: ${code}`);

        try {
            const codeInput = page.locator('input[placeholder="Enter your code"]');
            await codeInput.waitFor({ state: 'visible', timeout: 8000 });
            await codeInput.fill(code);

            await page.getByText('Apply code').click();
            await page.waitForTimeout(1800);

            // Check for error message
            const errorMessage = await page
                .locator('span.promocodes-input__error.xds-text-minor[data-source="server"]')
                .textContent({ timeout: 2500 })
                .catch(() => null);

            if (errorMessage) {
                console.log(`Code ${code} rejected: ${errorMessage.trim()}`);
                await codeInput.fill('');
                continue;
            }

            const closed = await closeModal(page);
            if (!closed) {
                console.log(`Failed to close modal after ${code} — reloading page`);
                await page.reload({ waitUntil: 'networkidle' });
                await page.waitForTimeout(2000);
                if (i < codes.length - 1) i--; // retry same code after reload
                continue;
            }

            console.log(`✅ Code applied successfully: ${code}`);
            await page.waitForTimeout(800);

        } catch (error) {
            console.log(`Error applying code ${code}: ${error.message}`);
        }
    }
    console.log('Promo codes processing finished.');
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
            () => page.evaluate(() => document.querySelector('button.button-sign-out')?.click()),
            () => page.getByRole('button', { name: /sign out/i }).click({ timeout: 4000 }),
            () => page.locator('button').filter({ hasText: /sign out/i }).click({ timeout: 4000 }),
        ];

        for (const strategy of signOutStrategies) {
            try {
                await strategy();
                console.log('Sign out clicked successfully');
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

    // const browser = await chromium.launch({
    //     headless: true,
    //     slowMo: 50,
    //     executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    //                     '/usr/bin/google-chrome-stable' ||
    //                     '/usr/bin/chromium-browser',
    // });
    const browser = await chromium.launch({ headless: true, slowMo: 100 });

    for (const user of credentials) {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            // Optional: make it look more human
            // userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...'
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

        // Small delay between accounts
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
    }

    await browser.close();
    console.log('🎉 All users processed successfully.');
}

main().catch(console.error);