const { chromium } = require('playwright');
const fs = require('fs');

async function main() {
    let browser;
    try {
        browser = await chromium.launch({ headless: false, slowMo: 500 });
        const context = await browser.newContext();
        const page = await context.newPage();
        const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
        const url = config.url;
        const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf-8'));

        for (const user of credentials) {
            console.log(`Logging in as ${user.username}`);
            await page.goto(url);
            await page.getByPlaceholder('Email').click();
            await page.getByPlaceholder('Email').fill(user.username);
            await page.locator('input[name="password"]').click();
            await page.locator('input[name="password"]').fill(user.password);
            await page.getByRole('button', { name: 'Login' }).click();

            try {
                await page.getByRole('button', { name: 'Accept All' }).click();
            } catch (e) {
                console.log("No 'Accept All' button found.");
            }

            const freeButtons = await page.$$('button >> text=Get free');
            if (freeButtons.length === 0) {
                console.log("No button available");
            } else {
                console.log(`Found ${freeButtons.length} 'Get free' buttons.`);
                for (const button of freeButtons) {
                    try {
                        await button.click({ timeout: 5000 });
                         // const closeApplyButton = await page.getByText('Back to store');
                         await page.getByTestId('free-item-modal').click(); 
                        // await page.getByText('Back to store').click();
                        // await page.getByRole('button').filter({ hasText: /Back to store/ }).click();
                        
                        // await page.locator('button.ui-site-modal-window__close.promo-item-modal__close[data-testid="close-icon"]').click();
                        await page.waitForTimeout(1000);
                    } catch (error) {
                        console.log("Error while clicking button:", error);
                    }
                }
            }

            if (config.code) {
                const codes = config.code.split(',').map(code => code.trim());
                for (let codeIndex = 0; codeIndex < codes.length; codeIndex++) {
                    const code = codes[codeIndex];
                    try {
                        const codeInput = await page.locator('input[placeholder="Enter your code"]');
                        await codeInput.click();
                        await codeInput.fill(code);
                        const applyButton = await page.getByText('Apply code');
                        await applyButton.click();

                        // Handle error message gracefully
                        let errorMessage = null;
                        try {
                            errorMessage = await page.locator('span.promocodes-input__error.xds-text-minor[data-source="server"]').textContent({ timeout: 2000 }); // Short timeout
                        } catch (e) {
                            // console.log(`Error element not found for promo code ${code}:`, e.message); // Log the error message
                            // If you want to log the entire error object, use: console.log(`Error element not found for promo code ${code}:`, e);
                            // Error message not found, continue
                        }

                        if (errorMessage) {
                            console.log(`Error applying promo code ${code}: ${errorMessage}`);
                            await codeInput.fill('');
                            continue;
                        }

                        let closeModalClicked = false;
                        try {
                            const closeApplyButton = await page.locator('button#coupon-modal-button[data-testid="coupon-modal-button"]');
                            await closeApplyButton.waitFor({ state: 'visible', timeout: 5000 });
                            await closeApplyButton.click();
                            closeModalClicked = true;
                        } catch (error) {
                            // console.log("Error clicking 'Back to store' button:", error);
                        }

                        if (!closeModalClicked) {
                            try {
                                await page.locator('button.ui-site-modal-window__close.promo-item-modal__close[data-testid="close-icon"]').click();
                            } catch (error) {
                                // console.log("Error clicking close icon:", error);
                            }
                        }

                        if (!closeModalClicked) {
                            try {
                                await page.locator('button#coupon-modal-button[data-testid="coupon-modal-button"]').dispatchEvent('click');
                                closeModalClicked = true;
                            } catch (forceClickError) {
                                // console.log("Force click failed:", forceClickError);
                            }
                        }

                        if (!closeModalClicked) {
                            console.log("Refresh page to prevent error");
                            await page.reload();

                            if (codeIndex === codes.length - 1) {
                                console.log("Last code failed, moving to next user.");
                                break;
                            }

                            codeIndex--;
                            continue;
                        }

                        await page.waitForTimeout(1000);
                    } catch (error) {
                        console.log(`Error applying promo code ${code}:`, error);
                    }
                }
            }

            try {
                await page.getByRole('button', { name: user.username }).click();
                await page.getByRole('button', { name: 'Log out' }).click();
                await page.waitForSelector('text=Log In', { timeout: 10000 });
            } catch (e) {
                console.log("No logout button found");
            }

            await page.waitForTimeout(2000);
        }
    } catch (error) {
        console.error("Main Error:", error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main();