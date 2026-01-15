import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

export const dynamic = 'force-dynamic'

// Conditional logging
const DEBUG = process.env.WEBHOOK_DEBUG === 'true'
const log = DEBUG ? (...args: any[]) => console.log('[Media Cron]', ...args) : () => {}

/**
 * GET /api/cron/process-media
 *
 * Cron job to process the media fetch queue.
 * Runs every minute via Vercel Cron.
 *
 * Features:
 * - Processes up to 10 media items per run
 * - Uses FOR UPDATE SKIP LOCKED for concurrent safety
 * - Exponential backoff for retries
 * - Downloads media from Whapi and stores in Supabase Storage
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Verify cron secret
    const authHeader = request.headers.get('Authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceRoleClient()

    // Claim pending media fetch jobs using the database function
    const { data: jobs, error: claimError } = await supabase.rpc(
      'claim_media_fetch_jobs',
      { p_limit: 10 }
    )

    if (claimError) {
      log('Error claiming jobs:', claimError.message)
      // Fall back to regular query if RPC doesn't exist
      const { data: fallbackJobs, error: fallbackError } = await supabase
        .from('media_fetch_queue')
        .select('*')
        .eq('status', 'pending')
        .lte('next_attempt_at', new Date().toISOString())
        .lt('attempts', 3)
        .order('created_at', { ascending: true })
        .limit(10)

      if (fallbackError) {
        return NextResponse.json(
          { error: 'Failed to fetch jobs', details: fallbackError.message },
          { status: 500 }
        )
      }

      // Mark as processing
      if (fallbackJobs && fallbackJobs.length > 0) {
        await supabase
          .from('media_fetch_queue')
          .update({
            status: 'processing',
            attempts: supabase.sql`attempts + 1`,
          })
          .in('id', fallbackJobs.map((j: any) => j.id))
      }

      return await processJobs(supabase, fallbackJobs || [], startTime)
    }

    return await processJobs(supabase, jobs || [], startTime)
  } catch (error) {
    console.error('[Media Cron] Processing error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Process a batch of media fetch jobs
 */
async function processJobs(
  supabase: any,
  jobs: any[],
  startTime: number
) {
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      message: 'No pending media jobs',
      processing_time_ms: Date.now() - startTime,
    })
  }

  log(`Processing ${jobs.length} media jobs`)

  // Process each job
  const results = await Promise.all(
    jobs.map((job: any) => processMediaJob(supabase, job))
  )

  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount

  return NextResponse.json({
    success: true,
    processed: results.length,
    succeeded: successCount,
    failed: failCount,
    results,
    processing_time_ms: Date.now() - startTime,
  })
}

/**
 * Process a single media fetch job
 */
async function processMediaJob(
  supabase: any,
  job: any
): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    log(`Processing job ${job.id} for message ${job.message_id}`)

    // Get channel token
    const { data: tokenData, error: tokenError } = await supabase
      .from('channel_tokens')
      .select('encrypted_token')
      .eq('channel_id', job.channel_id)
      .eq('token_type', 'whapi')
      .single()

    if (tokenError || !tokenData?.encrypted_token) {
      await failJob(supabase, job.id, 'Channel token not found')
      return { id: job.id, success: false, error: 'Channel token not found' }
    }

    const whapiToken = decrypt(tokenData.encrypted_token)

    // Try to fetch media
    let mediaResult = null

    // Strategy 1: Try /media/{mediaId} endpoint if we have media ID
    if (job.media_id) {
      log(`Trying /media/${job.media_id}`)
      mediaResult = await tryFetchMedia(whapiToken, job.media_id)
    }

    // Strategy 2: Try /messages/{messageId} endpoint
    if (!mediaResult && job.wa_message_id) {
      log(`Trying /messages/${job.wa_message_id}`)
      mediaResult = await tryFetchMessage(whapiToken, job.wa_message_id, job.media_type)
    }

    // Strategy 3: Download and store in Supabase Storage
    if (!mediaResult && job.media_id) {
      log(`Trying direct download for ${job.media_id}`)
      mediaResult = await downloadAndStore(
        supabase,
        whapiToken,
        job.workspace_id,
        job.media_id,
        job.media_type
      )
    }

    if (mediaResult) {
      // Success - update message and complete job
      await completeJob(supabase, job.id, mediaResult)
      log(`Job ${job.id} completed successfully`)
      return { id: job.id, success: true }
    } else {
      // Failed to get media
      await failJob(supabase, job.id, 'Failed to fetch media from all strategies')
      return { id: job.id, success: false, error: 'Media fetch failed' }
    }
  } catch (error: any) {
    console.error(`[Media Cron] Job ${job.id} error:`, error)
    await failJob(supabase, job.id, error.message || 'Unknown error')
    return { id: job.id, success: false, error: error.message || 'Unknown error' }
  }
}

/**
 * Try to fetch media info from /media/{mediaId} endpoint
 */
async function tryFetchMedia(
  whapiToken: string,
  mediaId: string
): Promise<MediaResult | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch(`https://gate.whapi.cloud/media/${mediaId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      log(`/media endpoint returned ${response.status}`)
      return null
    }

    const data = await response.json()
    const url = data.link || data.url || data.file?.link || data.file?.url

    if (url) {
      return {
        url,
        storagePath: null,
        metadata: {
          mime_type: data.mime_type || data.mimetype,
          size: data.file_size || data.size,
          filename: data.filename,
          width: data.width,
          height: data.height,
          duration: data.seconds || data.duration,
          id: mediaId,
        },
      }
    }

    return null
  } catch (error) {
    log(`/media fetch error:`, error)
    return null
  }
}

/**
 * Try to fetch message to get media URL
 */
async function tryFetchMessage(
  whapiToken: string,
  waMessageId: string,
  mediaType: string
): Promise<MediaResult | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(`https://gate.whapi.cloud/messages/${waMessageId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      log(`/messages endpoint returned ${response.status}`)
      return null
    }

    const message = await response.json()

    // Extract media object based on type
    const mediaObject =
      message.image ||
      message.video ||
      message.audio ||
      message.voice ||
      message.ptt ||
      message.document ||
      message.sticker

    if (mediaObject) {
      const url = mediaObject.link || mediaObject.url || mediaObject.media_url
      if (url) {
        return {
          url,
          storagePath: null,
          metadata: {
            mime_type: mediaObject.mime_type || mediaObject.mimetype,
            size: mediaObject.size || mediaObject.file_size,
            filename: mediaObject.filename,
            width: mediaObject.width,
            height: mediaObject.height,
            duration: mediaObject.duration || mediaObject.seconds,
          },
        }
      }
    }

    return null
  } catch (error) {
    log(`/messages fetch error:`, error)
    return null
  }
}

/**
 * Download media from Whapi and store in Supabase Storage
 */
async function downloadAndStore(
  supabase: any,
  whapiToken: string,
  workspaceId: string,
  mediaId: string,
  mediaType: string
): Promise<MediaResult | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout for download

    const response = await fetch(`https://gate.whapi.cloud/media/${mediaId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whapiToken}`,
        'Accept': '*/*',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      log(`Media download returned ${response.status}`)
      return null
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    // Check if response is JSON (info) or binary (file)
    if (contentType.includes('application/json')) {
      const jsonData = await response.json()
      if (jsonData.link || jsonData.url) {
        return {
          url: jsonData.link || jsonData.url,
          storagePath: null,
          metadata: {
            mime_type: jsonData.mime_type,
            size: jsonData.file_size,
            filename: jsonData.filename,
            id: mediaId,
          },
        }
      }
      return null
    }

    // It's binary - upload to storage
    const blob = await response.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (buffer.length === 0) {
      log('Downloaded media is empty')
      return null
    }

    // Generate filename and path
    const extension = getExtensionFromMimeType(contentType)
    const filename = `${mediaId}${extension}`
    const storagePath = `workspaces/${workspaceId}/${mediaType}/${filename}`

    log(`Uploading ${buffer.length} bytes to ${storagePath}`)

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      })

    if (uploadError) {
      log('Storage upload error:', uploadError)
      return null
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('media')
      .getPublicUrl(storagePath)

    return {
      url: urlData.publicUrl,
      storagePath,
      metadata: {
        mime_type: contentType,
        size: buffer.length,
        filename,
        id: mediaId,
        stored: true,
      },
    }
  } catch (error) {
    log('Download and store error:', error)
    return null
  }
}

/**
 * Complete a job and update the message
 */
async function completeJob(supabase: any, jobId: string, result: MediaResult) {
  // Try to use the RPC function first
  const { error: rpcError } = await supabase.rpc('complete_media_fetch_job', {
    p_job_id: jobId,
    p_media_url: result.url,
    p_storage_path: result.storagePath || '',
    p_metadata: result.metadata,
  })

  if (rpcError) {
    log('RPC not available, using fallback update')

    // Get the message ID from the job
    const { data: job } = await supabase
      .from('media_fetch_queue')
      .select('message_id')
      .eq('id', jobId)
      .single()

    if (job) {
      // Update message
      await supabase
        .from('messages')
        .update({
          media_url: result.url,
          storage_path: result.storagePath,
          media_metadata: result.metadata,
        })
        .eq('id', job.message_id)
    }

    // Mark job as completed
    await supabase
      .from('media_fetch_queue')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }
}

/**
 * Fail a job with error message
 */
async function failJob(supabase: any, jobId: string, errorMessage: string) {
  // Try RPC first
  const { error: rpcError } = await supabase.rpc('fail_media_fetch_job', {
    p_job_id: jobId,
    p_error: errorMessage,
  })

  if (rpcError) {
    // Fallback - check attempts and update status
    const { data: job } = await supabase
      .from('media_fetch_queue')
      .select('attempts, max_attempts')
      .eq('id', jobId)
      .single()

    if (job) {
      if (job.attempts >= job.max_attempts) {
        // Permanently failed
        await supabase
          .from('media_fetch_queue')
          .update({
            status: 'failed',
            last_error: errorMessage,
            processed_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      } else {
        // Reschedule with backoff
        const backoffMinutes = Math.pow(2, job.attempts)
        const nextAttempt = new Date(Date.now() + backoffMinutes * 60 * 1000)

        await supabase
          .from('media_fetch_queue')
          .update({
            status: 'pending',
            last_error: errorMessage,
            next_attempt_at: nextAttempt.toISOString(),
          })
          .eq('id', jobId)
      }
    }
  }
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/amr': '.amr',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  }
  return mimeToExt[mimeType] || ''
}

interface MediaResult {
  url: string
  storagePath: string | null
  metadata: Record<string, any>
}
