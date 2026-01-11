'use client'

/**
 * Bot Mode Selector
 *
 * Allows admins to configure the AI bot for a channel.
 * Four modes: off, watching, semi, full
 */

import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type BotMode = 'off' | 'watching' | 'semi' | 'full'

interface BotConfig {
  id: string
  channel_id: string
  bot_mode: BotMode
  bloe_api_url: string
  bloe_provider_id: string | null
  bloe_api_key_set: boolean
  auto_reply_start_minutes: number | null
  auto_reply_end_minutes: number | null
  auto_reply_timezone: string
  auto_pause_on_escalate: boolean
  reply_delay_ms: number
}

interface BotModeSelectorProps {
  channelId: string
  isAdmin?: boolean
}

const BOT_MODES: { value: BotMode; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    value: 'off',
    label: 'Off',
    desc: 'Bot disabled',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
  {
    value: 'watching',
    label: 'Watching',
    desc: 'Bot observes and learns',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
  {
    value: 'semi',
    label: 'Semi',
    desc: 'Bot drafts, you approve',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    value: 'full',
    label: 'Full',
    desc: 'Bot auto-replies',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
]

function formatMinutesToTime(minutes: number | null): string {
  if (minutes === null) return ''
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

function parseTimeToMinutes(time: string): number | null {
  if (!time) return null
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}

export function BotModeSelector({ channelId, isAdmin = false }: BotModeSelectorProps) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  // Local state for form
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('http://localhost:8000')
  const [providerId, setProviderId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [timezone, setTimezone] = useState('Europe/London')
  const [autoPauseOnEscalate, setAutoPauseOnEscalate] = useState(true)
  const [replyDelayMs, setReplyDelayMs] = useState(1500)

  // Fetch current config
  const { data: configData, isLoading } = useQuery({
    queryKey: ['bot-config', channelId],
    queryFn: async () => {
      const response = await fetch(`/api/channels/${channelId}/bot-config`)
      if (!response.ok) throw new Error('Failed to fetch bot config')
      return response.json()
    },
    enabled: isAdmin,
  })

  const config: BotConfig | null = configData?.config || null
  const currentMode: BotMode = config?.bot_mode || 'off'

  // Initialize form state from config
  useEffect(() => {
    if (config) {
      setApiUrl(config.bloe_api_url || 'http://localhost:8000')
      setProviderId(config.bloe_provider_id || '')
      setStartTime(formatMinutesToTime(config.auto_reply_start_minutes))
      setEndTime(formatMinutesToTime(config.auto_reply_end_minutes))
      setTimezone(config.auto_reply_timezone || 'Europe/London')
      setAutoPauseOnEscalate(config.auto_pause_on_escalate ?? true)
      setReplyDelayMs(config.reply_delay_ms || 1500)
    }
  }, [config])

  // Update config mutation
  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<{
      bot_mode: BotMode
      bloe_api_url: string
      bloe_api_key: string
      bloe_provider_id: string
      auto_reply_start_minutes: number | null
      auto_reply_end_minutes: number | null
      auto_reply_timezone: string
      auto_pause_on_escalate: boolean
      reply_delay_ms: number
    }>) => {
      const response = await fetch(`/api/channels/${channelId}/bot-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update config')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-config', channelId] })
      setApiKey('') // Clear API key input after save
      addToast('Bot configuration updated', 'success')
    },
    onError: (error: Error) => {
      addToast(error.message, 'error')
    },
  })

  const handleModeChange = (mode: BotMode) => {
    if (!isAdmin) return
    updateConfig.mutate({ bot_mode: mode })
  }

  const handleSaveSettings = () => {
    const updates: any = {
      bloe_api_url: apiUrl,
      bloe_provider_id: providerId || null,
      auto_reply_start_minutes: parseTimeToMinutes(startTime),
      auto_reply_end_minutes: parseTimeToMinutes(endTime),
      auto_reply_timezone: timezone,
      auto_pause_on_escalate: autoPauseOnEscalate,
      reply_delay_ms: replyDelayMs,
    }

    if (apiKey) {
      updates.bloe_api_key = apiKey
    }

    updateConfig.mutate(updates)
  }

  if (!isAdmin) {
    return null
  }

  if (isLoading) {
    return (
      <div className="animate-pulse p-4">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 w-20 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  const needsConfig = currentMode !== 'off' && (!config?.bloe_api_key_set || !providerId)

  return (
    <div className="mt-4 p-4 rounded-lg bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-purple-900 flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          AI Bot
        </h4>
        {currentMode !== 'off' && (
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1"
          >
            <svg className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {showAdvanced ? 'Hide' : 'Settings'}
          </button>
        )}
      </div>

      {/* Mode Selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {BOT_MODES.map((mode) => (
          <button
            key={mode.value}
            onClick={() => handleModeChange(mode.value)}
            disabled={updateConfig.isPending}
            className={cn(
              'flex flex-col items-center justify-center gap-1 p-2.5 rounded-lg transition-all min-w-[72px]',
              'border-2 text-xs font-medium',
              currentMode === mode.value
                ? mode.value === 'full'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : mode.value === 'semi'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : mode.value === 'watching'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-400 bg-gray-50 text-gray-600'
                : 'border-transparent bg-white/60 text-gray-500 hover:bg-white hover:border-gray-300'
            )}
          >
            {mode.icon}
            <span>{mode.label}</span>
          </button>
        ))}
      </div>

      {/* Mode description */}
      <p className="text-xs text-purple-700 mb-3">
        {BOT_MODES.find((m) => m.value === currentMode)?.desc}
        {currentMode === 'semi' && ' - Drafts appear in the message composer for you to review.'}
        {currentMode === 'full' && ' - Bot automatically sends replies to customers.'}
        {currentMode === 'watching' && ' - Bot learns from your conversations without taking action.'}
      </p>

      {/* Warning if config needed */}
      {needsConfig && (
        <div className="p-2 mb-3 rounded bg-amber-100 border border-amber-300 text-xs text-amber-800 flex items-center gap-2">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Configure API key and Provider ID below to enable bot</span>
        </div>
      )}

      {/* Advanced Settings */}
      {showAdvanced && currentMode !== 'off' && (
        <div className="space-y-3 pt-3 border-t border-purple-200">
          {/* API URL */}
          <div>
            <label className="block text-xs font-medium text-purple-800 mb-1">
              Bloe API URL
            </label>
            <Input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:8000"
              className="text-sm h-8"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-medium text-purple-800 mb-1">
              API Key {config?.bloe_api_key_set && <span className="text-green-600">(configured)</span>}
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.bloe_api_key_set ? "Leave blank to keep existing" : "Enter API key"}
              className="text-sm h-8"
            />
          </div>

          {/* Provider ID */}
          <div>
            <label className="block text-xs font-medium text-purple-800 mb-1">
              Provider ID
            </label>
            <Input
              type="text"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              placeholder="e.g., saloon_demo"
              className="text-sm h-8"
            />
          </div>

          {/* Auto-reply hours */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-purple-800 mb-1">
                Auto-reply Start
              </label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="text-sm h-8"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-purple-800 mb-1">
                Auto-reply End
              </label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="text-sm h-8"
              />
            </div>
          </div>
          <p className="text-xs text-purple-600">
            Leave both empty for 24/7 auto-reply. Times are in {timezone}.
          </p>

          {/* Reply delay */}
          <div>
            <label className="block text-xs font-medium text-purple-800 mb-1">
              Reply Delay (ms)
            </label>
            <Input
              type="number"
              value={replyDelayMs}
              onChange={(e) => setReplyDelayMs(parseInt(e.target.value) || 1500)}
              min={0}
              max={10000}
              step={100}
              className="text-sm h-8"
            />
            <p className="text-xs text-purple-600 mt-1">
              Delay before sending auto-replies (makes responses feel more natural)
            </p>
          </div>

          {/* Auto-pause on escalate */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoPauseOnEscalate}
              onChange={(e) => setAutoPauseOnEscalate(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs text-purple-800">
              Pause bot when it escalates to human
            </span>
          </label>

          {/* Save button */}
          <Button
            onClick={handleSaveSettings}
            disabled={updateConfig.isPending}
            size="sm"
            className="w-full"
          >
            {updateConfig.isPending ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      )}
    </div>
  )
}
