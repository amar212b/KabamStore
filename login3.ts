const { chromium } = require('playwright');
const fs = require('fs');

const MAIN_URL = 'https://store.playcontestofchampions.com/';

// ─────────────────────────────────────────
// Close modal — tries "Continue Shopping" first
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
            await page.waitForTimeout(500);
            return true;
        } catch (e) {}
    }
    return false;
}

// ─────────────────────────────────────────
// Check if a button is truly clickable
// ─────────────────────────────────────────
async function isButtonClickable(btn) {
    try {
        if (await btn.isDisabled()) return false;
        const ariaDisabled = await btn.getAttribute('aria-disabled');
        if (ariaDisabled === 'true') return false;
        const className = await btn.getAttribute('class') || '';
        if (/disabled|inactive|unavailable/i.test(className)) return false;
        const text = await btn.innerText();
        if (/owned/i.test(text)) return false;
        if (!await btn.isVisible()) return false;
        return true;
    } catch (e) {
        return false;
    }
}

// ─────────────────────────────────────────
// LOGIN — handles both old and new site
// ─────────────────────────────────────────
async function loginUser(page, user) {
    console.log(`\n--- Logging in: ${user.username} ---`);

    await page.goto(MAIN_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Accept cookies
    try {
        await page.locator('button.button-accept').click({ timeout: 3000 });
        await page.waitForTimeout(1000);
    } catch (e) {}

    // Detect which site version loaded
    const isNewSite = await page.evaluate(() => {
        return !!document.querySelector('span.primary-button.button-login');
    });
    console.log(`Site version: ${isNewSite ? 'NEW' : 'OLD'}`);

    if (isNewSite) {
        // ── NEW SITE: hidden span login ──
        console.log('Using new site login flow...');

        const loginURL = await page.evaluate(() => {
            const span = document.querySelector('span.primary-button.button-login');
            if (!span) return null;
            let el = span;
            while (el && el.tagName !== 'A') el = el.parentElement;
            return el ? el.href : null;
        });

        if (loginURL) {
            console.log(`Navigating directly to: ${loginURL}`);
            await page.goto(loginURL);
        } else {
            await Promise.all([
                page.waitForNavigation({ timeout: 15000 }),
                page.evaluate(() => {
                    const span = document.querySelector('span.primary-button.button-login');
                    if (span) span.click();
                }),
            ]);
        }

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);

        // Fill Kabam login form
        await page.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 10000 });
        await page.getByPlaceholder('Email').fill(user.username);
        await page.getByPlaceholder('Password').fill(user.password);
        await page.getByRole('button', { name: /^login$/i }).click({ timeout: 5000 });

        // Wait to be redirected back to store
        await page.waitForURL(/store\.playcontestofchampions\.com/i, { timeout: 30000 });

    } else {
        // ── OLD SITE: LOG IN button → LOGIN WITH KABAM modal → popup ──
        console.log('Using old site login flow...');

        // Click LOG IN button top right
        const loginTriggers = [
            () => page.locator('a', { hasText: /^log in$/i }).first().click({ timeout: 4000 }),
            () => page.getByRole('link', { name: /^log in$/i }).first().click({ timeout: 4000 }),
            () => page.locator('text=LOG IN').first().click({ timeout: 4000 }),
            () => page.locator('[class*="login"]').first().click({ timeout: 4000 }),
        ];
        for (const fn of loginTriggers) {
            try { await fn(); break; } catch (e) {}
        }
        await page.waitForTimeout(2000);

        // Click LOGIN WITH KABAM button in modal — opens popup
        const popupPromise = page.context().waitForEvent('page');

        const kabamTriggers = [
            () => page.locator('button', { hasText: /login with kabam/i }).click({ timeout: 5000 }),
            () => page.getByRole('button', { name: /login with kabam/i }).click({ timeout: 5000 }),
            () => page.locator('text=LOGIN WITH KABAM').click({ timeout: 5000 }),
            () => page.locator('[class*="kabam"]').first().click({ timeout: 5000 }),
        ];
        let kabamClicked = false;
        for (const fn of kabamTriggers) {
            try { await fn(); kabamClicked = true; break; } catch (e) {}
        }

        if (!kabamClicked) {
            await page.screenshot({ path: `debug_kabam_modal_${Date.now()}.png` });
            throw new Error('Could not click LOGIN WITH KABAM button');
        }

        // Handle Kabam popup
        let kabamPage;
        try {
            kabamPage = await Promise.race([
                popupPromise,
                // If no popup, maybe it navigated in same tab
                new Promise((_, reject) => setTimeout(() => reject(new Error('no popup')), 5000)),
            ]);
            console.log('Kabam popup opened');
            await kabamPage.waitForLoadState('domcontentloaded');
            await kabamPage.waitForTimeout(1500);

            await kabamPage.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 15000 });
            await kabamPage.getByPlaceholder('Email').fill(user.username);
            await kabamPage.locator('input[name="password"], input[placeholder="Password"]').fill(user.password);
            await kabamPage.getByRole('button', { name: /^login$/i }).click({ timeout: 5000 });
            await kabamPage.waitForEvent('close', { timeout: 20000 });

        } catch (e) {
            // No popup — may have navigated in same tab
            console.log('No popup detected, checking same tab navigation...');
            await page.waitForURL(/kabam|oauth|auth/i, { timeout: 10000 });
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1500);

            await page.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 10000 });
            await page.getByPlaceholder('Email').fill(user.username);
            await page.locator('input[name="password"], input[placeholder="Password"]').fill(user.password);
            await page.getByRole('button', { name: /^login$/i }).click({ timeout: 5000 });
        }

        // Wait to be redirected back to store
        await page.waitForURL(/store\.playcontestofchampions\.com/i, { timeout: 30000 });
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    console.log(`Logged in: ${user.username}`);
}

// ─────────────────────────────────────────
// CLAIM FREE ITEMS
// Always takes index 0 — DOM shrinks after each claim
// ─────────────────────────────────────────
async function claimFreeItems(page) {
    console.log('Checking for free items...');
    await page.waitForTimeout(1500);

    let attempts = 0;
    const maxAttempts = 20;

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

        console.log(`Claiming ("${ctaText.trim()}")... [${attempts + 1}]`);

        await btn.scrollIntoViewIfNeeded();
        await page.evaluate(el => el.click(), await btn.elementHandle());
        await page.waitForTimeout(1500);

        try {
            await page.locator('div.purchase-handler-modal').waitFor({ state: 'visible', timeout: 5000 });
        } catch (e) {}

        await closeModal(page);

        try {
            await page.locator('div.purchase-handler-modal').waitFor({ state: 'hidden', timeout: 5000 });
        } catch (e) {}

        await page.waitForTimeout(800);
        attempts++;
    }

    console.log(`Free items done — processed ${attempts} item(s).`);
}

// ─────────────────────────────────────────
// APPLY PROMO CODES
// ─────────────────────────────────────────
async function applyPromoCodes(page, codes) {
    console.log(`Applying ${codes.length} promo code(s)...`);

    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        console.log(`Applying: ${code}`);
        try {
            const codeInput = page.locator('input[placeholder="Enter your code"]');
            await codeInput.waitFor({ state: 'visible', timeout: 5000 });
            await codeInput.fill(code);
            await page.getByText('Apply code').click();
            await page.waitForTimeout(1500);

            let errorMessage = null;
            try {
                errorMessage = await page
                    .locator('span.promocodes-input__error.xds-text-minor[data-source="server"]')
                    .textContent({ timeout: 2000 });
            } catch (e) {}

            if (errorMessage) {
                console.log(`Code ${code} rejected: ${errorMessage}`);
                await codeInput.fill('');
                continue;
            }

            const closed = await closeModal(page);
            if (!closed) {
                console.log(`Could not close modal for ${code}, reloading...`);
                await page.reload();
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(1500);
                if (i === codes.length - 1) break;
                i--;
                continue;
            }

            console.log(`Code applied: ${code}`);
            await page.waitForTimeout(500);

        } catch (error) {
            console.log(`Error with code ${code}: ${error.message}`);
        }
    }
    console.log('Done with promo codes.');
}

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────
async function logoutUser(page, username) {
    console.log(`Logging out: ${username}`);
    try {
        // Open profile dropdown via JS
        await page.evaluate(() => {
            const btn = document.querySelector('span.primary-button.button-profile');
            if (btn) btn.click();
        });
        await page.waitForTimeout(800);

        // Try clicking sign out button multiple ways
        const signOutStrategies = [
            () => page.locator('button.button-sign-out').click({ timeout: 3000 }),
            () => page.evaluate(() => {
                const btn = document.querySelector('button.button-sign-out');
                if (btn) btn.click();
            }),
            () => page.getByRole('button', { name: /sign out/i }).click({ timeout: 3000 }),
            () => page.locator('button').filter({ hasText: /sign out/i }).click({ timeout: 3000 }),
        ];

        for (const strategy of signOutStrategies) {
            try {
                await strategy();
                console.log('Sign out clicked');
                break;
            } catch (e) {}
        }

        await page.waitForTimeout(1500);
        console.log(`Logged out: ${username}`);
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
        slowMo: 50,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            || '/usr/bin/google-chrome-stable'
            || '/usr/bin/chromium-browser',
    });

    for (const user of credentials) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        try {
            await loginUser(page, user);
            await claimFreeItems(page);
            if (codes.length > 0) await applyPromoCodes(page, codes);
            await logoutUser(page, user.username);
        } catch (error) {
            console.error(`Failed for ${user.username}: ${error.message}`);
            await page.screenshot({ path: `debug_error_${user.username.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png` });
        } finally {
            await context.close();
            console.log(`Context closed for ${user.username}\n`);
        }

        await new Promise(r => setTimeout(r, 1500));
    }

    await browser.close();
    console.log('All users processed.');
}

main().catch(console.error);