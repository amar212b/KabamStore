async function loginUser(page, user) {
    console.log(`\n--- Logging in: ${user.username} ---`);

    await page.goto(MAIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Accept cookies (old + new banner)
    console.log('Accepting cookies...');
    await page.getByRole('button', { name: /ACCEPT ALL/i }).click({ timeout: 5000, force: true }).catch(() => {});
    await page.locator('button.button-accept').click({ timeout: 3000 }).catch(() => {});

    await page.screenshot({ path: `debug_after_cookies_${Date.now()}.png` });

    // Step 1: Click green LOG IN button
    console.log('Clicking green LOG IN button...');
    await page.getByRole('button', { name: /LOG IN/i }).first().click({ timeout: 10000, force: true });
    await page.waitForTimeout(2500);

    await page.screenshot({ path: `debug_after_green_login_${Date.now()}.png` });

    // Step 2: Click orange "LOGIN WITH KABAM" button (this is what old version needs)
    console.log('Clicking "LOGIN WITH KABAM" button...');
    const kabamButton = page.getByRole('button', { name: /LOGIN WITH KABAM/i }).first();

    if (await kabamButton.count() > 0) {
        await kabamButton.click({ timeout: 10000, force: true });
        console.log('✅ Clicked LOGIN WITH KABAM');
        await page.waitForTimeout(3000);
    } else {
        console.log('No "LOGIN WITH KABAM" button found — assuming new direct flow');
    }

    await page.screenshot({ path: `debug_after_kabam_button_${Date.now()}.png` });

    // Step 3: Fill email and password (common for both versions)
    console.log('Waiting for Email field on Kabam page...');
    await page.getByPlaceholder('Email').waitFor({ state: 'visible', timeout: 30000 });

    await page.getByPlaceholder('Email').fill(user.username);
    await page.getByPlaceholder('Password').fill(user.password);

    await page.getByRole('button', { name: /^login$/i }).click({ timeout: 10000 });

    // Wait for successful return to store
    await page.waitForURL(/store\.playcontestofchampions\.com/i, { timeout: 40000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log(`✅ Logged in successfully: ${user.username}`);
}