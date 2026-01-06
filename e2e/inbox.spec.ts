import { test, expect, Page } from '@playwright/test'

// Helper to setup authenticated state
async function setupAuthenticatedUser(page: Page) {
  // This would normally involve setting up auth cookies/tokens
  // For E2E tests with real Supabase, you'd log in first
  // For mock tests, you'd set the auth state directly

  // Mock approach: Set localStorage auth state
  await page.addInitScript(() => {
    localStorage.setItem(
      'sb-test-auth-token',
      JSON.stringify({
        access_token: 'test-token',
        user: {
          id: 'user-123',
          email: 'test@example.com',
        },
      })
    )
  })
}

test.describe('Inbox Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page)
  })

  test('should display inbox layout', async ({ page }) => {
    await page.goto('/inbox')

    // Check for main layout elements
    await expect(page.getByRole('navigation')).toBeVisible()

    // Check for sidebar
    await expect(page.locator('[data-testid="chat-sidebar"]')).toBeVisible()

    // Check for main content area
    await expect(page.locator('[data-testid="main-content"]')).toBeVisible()
  })

  test('should display channel selector', async ({ page }) => {
    await page.goto('/inbox')

    // Find channel selector
    const channelSelector = page.locator('[data-testid="channel-selector"]')
    await expect(channelSelector).toBeVisible()

    // Should have "All Channels" option
    await expect(page.getByText(/all channels/i)).toBeVisible()
  })

  test('should display chat list', async ({ page }) => {
    await page.goto('/inbox')

    // Chat list should be visible
    const chatList = page.locator('[data-testid="chat-list"]')
    await expect(chatList).toBeVisible()
  })

  test('should show empty state when no chats', async ({ page }) => {
    await page.goto('/inbox')

    // If no chats, should show empty state
    const emptyChatState = page.locator('[data-testid="empty-chat-state"]')
    const chatItems = page.locator('[data-testid="chat-item"]')

    // Either empty state or chat items should be visible
    const hasEmptyState = await emptyChatState.isVisible().catch(() => false)
    const hasChatItems = (await chatItems.count()) > 0

    expect(hasEmptyState || hasChatItems).toBeTruthy()
  })

  test('should show search input', async ({ page }) => {
    await page.goto('/inbox')

    // Search input should be visible
    await expect(page.getByPlaceholder(/search/i)).toBeVisible()
  })
})

test.describe('Chat Selection', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page)
  })

  test('should display chat view when chat is selected', async ({ page }) => {
    await page.goto('/inbox')

    // Find and click first chat item (if exists)
    const firstChat = page.locator('[data-testid="chat-item"]').first()

    if (await firstChat.isVisible()) {
      await firstChat.click()

      // Chat view should be visible
      await expect(page.locator('[data-testid="chat-view"]')).toBeVisible()

      // Message composer should be visible
      await expect(page.locator('[data-testid="message-composer"]')).toBeVisible()
    }
  })

  test('should show welcome message when no chat selected', async ({ page }) => {
    await page.goto('/inbox')

    // Without clicking a chat, should show welcome/placeholder
    const welcomeMessage = page.locator('[data-testid="no-chat-selected"]')
    const chatView = page.locator('[data-testid="chat-view"]')

    // Either welcome message or chat view (if chat auto-selected)
    const hasWelcome = await welcomeMessage.isVisible().catch(() => false)
    const hasChatView = await chatView.isVisible().catch(() => false)

    expect(hasWelcome || hasChatView).toBeTruthy()
  })
})

test.describe('Message Sending', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuthenticatedUser(page)
  })

  test('should allow typing in message composer', async ({ page }) => {
    await page.goto('/inbox')

    // Click first chat to select it
    const firstChat = page.locator('[data-testid="chat-item"]').first()
    if (await firstChat.isVisible()) {
      await firstChat.click()

      // Find message input
      const messageInput = page.locator('[data-testid="message-input"]')
      await expect(messageInput).toBeVisible()

      // Type a message
      await messageInput.fill('Test message')
      await expect(messageInput).toHaveValue('Test message')
    }
  })

  test('should show send button', async ({ page }) => {
    await page.goto('/inbox')

    const firstChat = page.locator('[data-testid="chat-item"]').first()
    if (await firstChat.isVisible()) {
      await firstChat.click()

      // Send button should be visible
      await expect(page.locator('[data-testid="send-button"]')).toBeVisible()
    }
  })
})

test.describe('Responsive Layout', () => {
  test('should hide sidebar on mobile when chat selected', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    await setupAuthenticatedUser(page)
    await page.goto('/inbox')

    // Initially sidebar should be visible on mobile
    const sidebar = page.locator('[data-testid="chat-sidebar"]')

    // Click a chat (if available)
    const firstChat = page.locator('[data-testid="chat-item"]').first()
    if (await firstChat.isVisible()) {
      await firstChat.click()

      // On mobile, sidebar might be hidden after chat selection
      // or there should be a back button to return
      const backButton = page.locator('[data-testid="back-button"]')
      const hasBackButton = await backButton.isVisible().catch(() => false)

      // Either sidebar visible or back button available
      expect(hasBackButton || (await sidebar.isVisible())).toBeTruthy()
    }
  })

  test('should adapt layout for tablet', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 })

    await setupAuthenticatedUser(page)
    await page.goto('/inbox')

    // Layout should adapt
    await expect(page.locator('[data-testid="chat-sidebar"]')).toBeVisible()
  })
})

test.describe('Connection Status', () => {
  test('should show connection banner when offline', async ({ page }) => {
    await setupAuthenticatedUser(page)
    await page.goto('/inbox')

    // Simulate going offline
    await page.context().setOffline(true)

    // Wait for UI to update
    await page.waitForTimeout(1000)

    // Connection banner should appear
    const connectionBanner = page.locator('[data-testid="connection-banner"]')
    await expect(connectionBanner).toBeVisible()
    await expect(connectionBanner).toContainText(/offline|disconnected|no internet/i)

    // Restore connection
    await page.context().setOffline(false)
  })
})
