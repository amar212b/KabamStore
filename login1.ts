const { chromium } = require('playwright');
const fs = require('fs');

const MAIN_URL = 'https://store.playcontestofchampions.com/';

// ─────────────────────────────────────────
// Close modal — tries "Back to store" first
// then falls back to other strategies
// ─────────────────────────────────────────
async function closeModal(page) {
    const strategies = [
        // "Back to store" button — shown after claiming free item
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
// LOGIN
// ─────────────────────────────────────────
async function loginUser(page, user) {
    console.log(`\n--- Logging in: ${user.username} ---`);

    await page.goto(MAIN_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    try {
        await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 });
        await page.waitForTimeout(300);
    } catch (e) {}

    // Click main Log In
    try {
        await page.getByRole('button', { name: /^log in$/i }).first().click({ timeout: 5000 });
    } catch (e) {
        await page.getByText(/^log in$/i).first().click({ timeout: 5000 });
    }
    await page.waitForTimeout(2000);

    // Find Xsolla iframe
    let iframeSelector = 'iframe';
    const candidateSelectors = [
        'iframe[src*="xsolla"]',
        'iframe[src*="login.xsolla"]',
        'iframe[src*="kabam"]',
        'iframe[src*="pubsdk"]',
        'iframe[src*="auth"]',
        'iframe[src*="oauth"]',
    ];
    for (const sel of candidateSelectors) {
        try {
            await page.locator(sel).first().waitFor({ state: 'attached', timeout: 2000 });
            iframeSelector = sel;
            break;
        } catch (e) {}
    }

    const xsollaFrame = page.frameLocator(iframeSelector).first();
    const popupPromise = page.context().waitForEvent('page');

    // Click LOGIN WITH KABAM
    let clicked = false;
    const btnSelectors = [
        '[data-testid="login-form__primary-social--kabam"]',
        'button.primary-social__kabam',
        'button[class*="primary-social__kabam"]',
        'button[class*="primary-social_"]',
    ];
    for (const sel of btnSelectors) {
        try {
            const btn = xsollaFrame.locator(sel);
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            await btn.click();
            clicked = true;
            break;
        } catch (e) {}
    }
    if (!clicked) {
        for (const f of page.frames()) {
            if (!f.url() || f.url() === 'about:blank') continue;
            try {
                await f.locator('[data-testid="login-form__primary-social--kabam"]').click({ timeout: 2000 });
                clicked = true;
                break;
            } catch (e) {}
        }
    }
    if (!clicked) throw new Error('Could not click LOGIN WITH KABAM');

    // Handle OAuth popup
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1500);

    try {
        await popup.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 15000 });
        await popup.getByPlaceholder('Email').fill(user.username);
        await popup.locator('input[name="password"]').fill(user.password);
        await popup.getByRole('button', { name: /^log in$|^login$|^sign in$/i }).click({ timeout: 5000 });
        await popup.waitForEvent('close', { timeout: 20000 });
    } catch (e) {
        if (!popup.isClosed()) {
            await popup.screenshot({ path: `error_${user.username.replace(/[^a-z0-9]/gi, '_')}.png` });
            await popup.close();
        }
        throw e;
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    console.log(`Logged in: ${user.username}`);
}

// ─────────────────────────────────────────
// CLAIM FREE ITEMS
// Only clicks buttons that are NOT "Owned"
// Clicks "Back to store" to close modal after each claim
// ─────────────────────────────────────────
async function claimFreeItems(page) {
    console.log('Checking for free items...');
    await page.waitForTimeout(1500);

    const freeButtons = await page.locator('[data-testid="free-button"]').all();

    if (freeButtons.length === 0) {
        console.log('No free items found.');
        return;
    }

    console.log(`Found ${freeButtons.length} free button(s), checking which are claimable...`);

    for (let i = 0; i < freeButtons.length; i++) {
        try {
            // Re-query on each iteration since DOM can shift after claims
            const buttons = await page.locator('[data-testid="free-button"]').all();
            if (i >= buttons.length) break;

            const btn = buttons[i];

            // Check if button text contains "Owned" — skip if so
            const btnText = await btn.innerText();
            if (/owned/i.test(btnText)) {
                console.log(`Item ${i + 1}: already Owned, skipping.`);
                continue;
            }

            // Also check the span inside for "Owned"
            const spanText = await btn.locator('span').innerText().catch(() => '');
            if (/owned/i.test(spanText)) {
                console.log(`Item ${i + 1}: span says Owned, skipping.`);
                continue;
            }

            console.log(`Item ${i + 1}: claiming ("${btnText.trim()}")...`);
            await btn.scrollIntoViewIfNeeded();
            await btn.click({ timeout: 5000 });
            await page.waitForTimeout(1000);

            // Click "Back to store" to close the modal
            try {
                await page.getByRole('button', { name: /back to store/i }).waitFor({ state: 'visible', timeout: 5000 });
                await page.getByRole('button', { name: /back to store/i }).click();
                console.log(`Item ${i + 1}: claimed, clicked Back to store.`);
            } catch (e) {
                // "Back to store" not found — try other close strategies
                console.log(`Item ${i + 1}: Back to store not found, trying other close methods...`);
                await closeModal(page);
            }

            await page.waitForTimeout(800);

        } catch (error) {
            console.log(`Error on free item ${i + 1}: ${error.message}`);
        }
    }

    console.log('Done with free items.');
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

            // Check for server error
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

            // Close success modal
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
        await page.getByRole('button', { name: new RegExp(username, 'i') }).click({ timeout: 5000 });
        await page.waitForTimeout(300);
        await page.getByRole('button', { name: /log out|logout|sign out/i }).click({ timeout: 5000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
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

    const browser = await chromium.launch({ headless: false, slowMo: 100 }); // reduced slowMo from 300 to 100

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