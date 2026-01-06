import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/inbox')

    // Should redirect to login page
    await expect(page).toHaveURL(/.*login.*/)
  })

  test('should show login form', async ({ page }) => {
    await page.goto('/login')

    // Check for email input
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()

    // Check for password input
    await expect(page.getByLabel(/password/i)).toBeVisible()

    // Check for submit button
    await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible()
  })

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login')

    // Fill in invalid credentials
    await page.getByRole('textbox', { name: /email/i }).fill('invalid@example.com')
    await page.getByLabel(/password/i).fill('wrongpassword')

    // Submit form
    await page.getByRole('button', { name: /sign in|log in/i }).click()

    // Should show error message
    await expect(page.getByText(/invalid|incorrect|error/i)).toBeVisible()
  })

  test('should navigate to signup page', async ({ page }) => {
    await page.goto('/login')

    // Click sign up link
    await page.getByRole('link', { name: /sign up|create account/i }).click()

    // Should be on signup page
    await expect(page).toHaveURL(/.*signup.*/)
  })
})
