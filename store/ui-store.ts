'use client'

/**
 * UI State Store (Zustand)
 *
 * Manages client-side UI state including:
 * - Selected chat and channel
 * - Draft messages per chat
 * - Pane configuration (for split view)
 * - UI preferences
 *
 * Persisted to localStorage for session recovery.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// ============================================================================
// Types
// ============================================================================

export interface Pane {
  id: string
  channelId: string | null // null = Unified Inbox
  chatId: string | null
  scrollPosition: number
}

export interface Draft {
  text: string
  attachments: string[] // Storage paths for pending attachments
  updatedAt: string
}

export interface UIState {
  // Current selections
  selectedChatId: string | null
  selectedChannelId: string | null // null = Unified Inbox

  // Draft messages per chat
  drafts: Record<string, Draft>

  // Panes for split view
  panes: Pane[]
  activePaneId: string | null
  maxPanes: number

  // UI preferences
  sidebarCollapsed: boolean
  detailsPanelOpen: boolean
  soundEnabled: boolean
  notificationsEnabled: boolean

  // Connection status
  isOnline: boolean
  isReconnecting: boolean
}

export interface UIActions {
  // Selection actions
  selectChat: (chatId: string | null, channelId?: string) => void
  selectChannel: (channelId: string | null) => void

  // Draft actions
  setDraft: (chatId: string, text: string) => void
  clearDraft: (chatId: string) => void
  getDraft: (chatId: string) => Draft | null

  // Pane actions
  addPane: () => void
  removePane: (paneId: string) => void
  setActivePane: (paneId: string) => void
  updatePane: (paneId: string, updates: Partial<Pane>) => void
  setMaxPanes: (max: number) => void

  // UI preference actions
  toggleSidebar: () => void
  toggleDetailsPanel: () => void
  setSound: (enabled: boolean) => void
  setNotifications: (enabled: boolean) => void

  // Connection actions
  setOnline: (online: boolean) => void
  setReconnecting: (reconnecting: boolean) => void

  // Reset
  reset: () => void
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: UIState = {
  selectedChatId: null,
  selectedChannelId: null,
  drafts: {},
  panes: [
    {
      id: 'pane-1',
      channelId: null, // Unified inbox by default
      chatId: null,
      scrollPosition: 0,
    },
  ],
  activePaneId: 'pane-1',
  maxPanes: 4,
  sidebarCollapsed: false,
  detailsPanelOpen: false,
  soundEnabled: true,
  notificationsEnabled: true,
  isOnline: true,
  isReconnecting: false,
}

// ============================================================================
// Store
// ============================================================================

export const useUIStore = create<UIState & UIActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Selection actions
      selectChat: (chatId, channelId) => {
        set((state) => ({
          selectedChatId: chatId,
          selectedChannelId: channelId ?? state.selectedChannelId,
          // Also update active pane if in split view mode
          panes: state.panes.map((pane) =>
            pane.id === state.activePaneId
              ? { ...pane, chatId, channelId: channelId ?? pane.channelId }
              : pane
          ),
        }))
      },

      selectChannel: (channelId) => {
        set((state) => ({
          selectedChannelId: channelId,
          // Clear chat selection when switching channels
          selectedChatId: null,
          panes: state.panes.map((pane) =>
            pane.id === state.activePaneId
              ? { ...pane, channelId, chatId: null }
              : pane
          ),
        }))
      },

      // Draft actions
      setDraft: (chatId, text) => {
        set((state) => ({
          drafts: {
            ...state.drafts,
            [chatId]: {
              text,
              attachments: state.drafts[chatId]?.attachments || [],
              updatedAt: new Date().toISOString(),
            },
          },
        }))
      },

      clearDraft: (chatId) => {
        set((state) => {
          const { [chatId]: _, ...rest } = state.drafts
          return { drafts: rest }
        })
      },

      getDraft: (chatId) => {
        return get().drafts[chatId] || null
      },

      // Pane actions
      addPane: () => {
        const state = get()
        if (state.panes.length >= state.maxPanes) return

        const newPaneId = `pane-${Date.now()}`
        set((state) => ({
          panes: [
            ...state.panes,
            {
              id: newPaneId,
              channelId: null,
              chatId: null,
              scrollPosition: 0,
            },
          ],
          activePaneId: newPaneId,
        }))
      },

      removePane: (paneId) => {
        const state = get()
        if (state.panes.length <= 1) return // Always keep at least one pane

        const paneIndex = state.panes.findIndex((p) => p.id === paneId)
        const newPanes = state.panes.filter((p) => p.id !== paneId)

        // If we're removing the active pane, select an adjacent one
        let newActiveId = state.activePaneId
        if (state.activePaneId === paneId) {
          const newIndex = Math.min(paneIndex, newPanes.length - 1)
          newActiveId = newPanes[newIndex].id
        }

        set({
          panes: newPanes,
          activePaneId: newActiveId,
        })
      },

      setActivePane: (paneId) => {
        const pane = get().panes.find((p) => p.id === paneId)
        if (!pane) return

        set({
          activePaneId: paneId,
          selectedChatId: pane.chatId,
          selectedChannelId: pane.channelId,
        })
      },

      updatePane: (paneId, updates) => {
        set((state) => ({
          panes: state.panes.map((pane) =>
            pane.id === paneId ? { ...pane, ...updates } : pane
          ),
        }))
      },

      setMaxPanes: (max) => {
        set((state) => {
          // Trim panes if we're reducing max
          const trimmedPanes = state.panes.slice(0, max)
          const newActiveId =
            state.activePaneId &&
            trimmedPanes.some((p) => p.id === state.activePaneId)
              ? state.activePaneId
              : trimmedPanes[0]?.id

          return {
            maxPanes: max,
            panes: trimmedPanes,
            activePaneId: newActiveId,
          }
        })
      },

      // UI preference actions
      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
      },

      toggleDetailsPanel: () => {
        set((state) => ({ detailsPanelOpen: !state.detailsPanelOpen }))
      },

      setSound: (enabled) => {
        set({ soundEnabled: enabled })
      },

      setNotifications: (enabled) => {
        set({ notificationsEnabled: enabled })
      },

      // Connection actions
      setOnline: (online) => {
        set({ isOnline: online })
      },

      setReconnecting: (reconnecting) => {
        set({ isReconnecting: reconnecting })
      },

      // Reset
      reset: () => {
        set(initialState)
      },
    }),
    {
      name: 'whatsapp-web-ui-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist these fields
        selectedChannelId: state.selectedChannelId,
        drafts: state.drafts,
        panes: state.panes,
        activePaneId: state.activePaneId,
        sidebarCollapsed: state.sidebarCollapsed,
        detailsPanelOpen: state.detailsPanelOpen,
        soundEnabled: state.soundEnabled,
        notificationsEnabled: state.notificationsEnabled,
      }),
    }
  )
)

// ============================================================================
// Selectors
// ============================================================================

export const selectActivePane = (state: UIState) =>
  state.panes.find((p) => p.id === state.activePaneId) || state.panes[0]

export const selectPaneCount = (state: UIState) => state.panes.length

export const selectCanAddPane = (state: UIState) =>
  state.panes.length < state.maxPanes

export const selectDraftForChat = (chatId: string) => (state: UIState) =>
  state.drafts[chatId]
