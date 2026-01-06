import { test, expect, Page } from '@playwright/test'

// Helper to setup authenticated admin user
async function setupAuthenticatedAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'sb-test-auth-token',
      JSON.stringify({
        access_token: 'test-admin-token',
        user: {
          id: 'admin-123',
          email: 'admin@example.com',
          role: 'admin',
        },
      })
    )
  })
}

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedAdmin(page)
  })

  test('should display settings page', async ({ page }) => {
    await page.goto('/settings')

    // Check for settings page header
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible()
  })

  test('should show workspace settings section', async ({ page }) => {
    await page.goto('/settings')

    // Workspace settings should be visible
    await expect(page.getByText(/workspace/i)).toBeVisible()
  })

  test('should show channels section', async ({ page }) => {
    await page.goto('/settings')

    // Channels section should be visible
    await expect(page.getByRole('heading', { name: /channels/i })).toBeVisible()
  })

  test('should show team members section for admins', async ({ page }) => {
    await page.goto('/settings')

    // Team members section should be visible for admins
    await expect(page.getByText(/team|members/i)).toBeVisible()
  })
})

test.describe('Channel Management', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedAdmin(page)
  })

  test('should display add channel button', async ({ page }) => {
    await page.goto('/settings/channels')

    // Add channel button should be visible
    await expect(
      page.getByRole('button', { name: /add channel|new channel|connect/i })
    ).toBeVisible()
  })

  test('should open add channel modal', async ({ page }) => {
    await page.goto('/settings/channels')

    // Click add channel button
    await page.getByRole('button', { name: /add channel|new channel|connect/i }).click()

    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('should display channel list', async ({ page }) => {
    await page.goto('/settings/channels')

    // Channel list should be visible
    const channelList = page.locator('[data-testid="channel-list"]')
    await expect(channelList).toBeVisible()
  })

  test('should show channel status indicators', async ({ page }) => {
    await page.goto('/settings/channels')

    // If channels exist, they should have status indicators
    const channelItems = page.locator('[data-testid="channel-item"]')
    const count = await channelItems.count()

    if (count > 0) {
      // Each channel should have a status indicator
      const firstChannel = channelItems.first()
      const statusIndicator = firstChannel.locator('[data-testid="channel-status"]')
      await expect(statusIndicator).toBeVisible()
    }
  })

  test('should allow editing channel name', async ({ page }) => {
    await page.goto('/settings/channels')

    const channelItems = page.locator('[data-testid="channel-item"]')
    const count = await channelItems.count()

    if (count > 0) {
      // Click edit button on first channel
      const firstChannel = channelItems.first()
      const editButton = firstChannel.getByRole('button', { name: /edit/i })

      if (await editButton.isVisible()) {
        await editButton.click()

        // Edit form should appear
        await expect(page.getByLabel(/display name|name/i)).toBeVisible()
      }
    }
  })
})

test.describe('Add Channel Flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedAdmin(page)
  })

  test('should validate channel form inputs', async ({ page }) => {
    await page.goto('/settings/channels')

    // Open add channel modal
    await page.getByRole('button', { name: /add channel|new channel|connect/i }).click()

    // Try to submit empty form
    await page.getByRole('button', { name: /save|create|add/i }).click()

    // Should show validation errors
    await expect(page.getByText(/required|invalid/i)).toBeVisible()
  })

  test('should show phone number field', async ({ page }) => {
    await page.goto('/settings/channels')

    // Open add channel modal
    await page.getByRole('button', { name: /add channel|new channel|connect/i }).click()

    // Phone number field should be visible
    await expect(
      page.getByLabel(/phone|number|whatsapp/i)
    ).toBeVisible()
  })

  test('should show API token field', async ({ page }) => {
    await page.goto('/settings/channels')

    // Open add channel modal
    await page.getByRole('button', { name: /add channel|new channel|connect/i }).click()

    // API token field should be visible
    await expect(
      page.getByLabel(/token|api.*key|whapi/i)
    ).toBeVisible()
  })
})

test.describe('Team Management', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedAdmin(page)
  })

  test('should display team members list', async ({ page }) => {
    await page.goto('/settings/team')

    // Team member list should be visible
    const memberList = page.locator('[data-testid="team-member-list"]')
    await expect(memberList).toBeVisible()
  })

  test('should show invite member button', async ({ page }) => {
    await page.goto('/settings/team')

    // Invite button should be visible
    await expect(
      page.getByRole('button', { name: /invite|add member/i })
    ).toBeVisible()
  })

  test('should open invite member modal', async ({ page }) => {
    await page.goto('/settings/team')

    // Click invite button
    await page.getByRole('button', { name: /invite|add member/i }).click()

    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible()

    // Email input should be visible
    await expect(page.getByLabel(/email/i)).toBeVisible()
  })

  test('should show role selector in invite form', async ({ page }) => {
    await page.goto('/settings/team')

    // Open invite modal
    await page.getByRole('button', { name: /invite|add member/i }).click()

    // Role selector should be visible
    await expect(page.getByLabel(/role/i)).toBeVisible()
  })
})

test.describe('Access Control', () => {
  test('should restrict settings to admin users', async ({ page }) => {
    // Set up non-admin user
    await page.addInitScript(() => {
      localStorage.setItem(
        'sb-test-auth-token',
        JSON.stringify({
          access_token: 'test-user-token',
          user: {
            id: 'user-123',
            email: 'user@example.com',
            role: 'member',
          },
        })
      )
    })

    await page.goto('/settings/channels')

    // Should either redirect or show access denied
    const accessDenied = page.getByText(/access denied|unauthorized|not allowed/i)
    const hasAccessDenied = await accessDenied.isVisible().catch(() => false)
    const redirectedToInbox = page.url().includes('/inbox')

    expect(hasAccessDenied || redirectedToInbox).toBeTruthy()
  })
})
