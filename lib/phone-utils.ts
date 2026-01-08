import { parsePhoneNumber, CountryCode, isValidPhoneNumber } from 'libphonenumber-js'

/**
 * Normalize a phone number to E.164 format using libphonenumber-js.
 * Handles international numbers properly unlike the previous basic implementation.
 *
 * @param phone - The phone number to normalize
 * @param defaultCountry - Default country code for numbers without country prefix (default: 'US')
 * @returns The normalized E.164 phone number, or null if invalid/empty
 */
export function normalizePhoneNumber(
  phone: string,
  defaultCountry: CountryCode = 'US'
): string | null {
  if (!phone) return null

  // Clean the input
  const cleaned = phone.trim()
  if (!cleaned) return null

  try {
    // First try parsing as-is (handles numbers with country code)
    const parsed = parsePhoneNumber(cleaned)
    if (parsed?.isValid()) {
      return parsed.format('E.164')
    }
  } catch {
    // Parsing failed, try with default country
  }

  try {
    // Try parsing with the default country
    const parsedWithDefault = parsePhoneNumber(cleaned, defaultCountry)
    if (parsedWithDefault?.isValid()) {
      return parsedWithDefault.format('E.164')
    }
  } catch {
    // Parsing failed
  }

  // Fallback: basic cleanup for malformed numbers
  // This ensures we don't completely reject numbers that might still be usable
  let fallback = phone.replace(/[^\d+]/g, '')
  if (!fallback) return null

  // Ensure it starts with +
  if (!fallback.startsWith('+')) {
    // Apply some basic heuristics
    if (fallback.length === 10) {
      // Likely US number without country code
      fallback = '+1' + fallback
    } else if (fallback.length === 11 && fallback.startsWith('1')) {
      // US number with leading 1
      fallback = '+' + fallback
    } else {
      // Just prepend +
      fallback = '+' + fallback
    }
  }

  return fallback
}

/**
 * Check if a phone number is valid.
 *
 * @param phone - The phone number to validate
 * @param defaultCountry - Default country code for numbers without country prefix
 * @returns True if the phone number is valid
 */
export function isValidPhone(
  phone: string,
  defaultCountry: CountryCode = 'US'
): boolean {
  if (!phone) return false

  try {
    // Try validating as-is first
    if (isValidPhoneNumber(phone)) {
      return true
    }

    // Try with default country
    return isValidPhoneNumber(phone, defaultCountry)
  } catch {
    return false
  }
}

/**
 * Format a phone number for display (national format with formatting).
 *
 * @param phone - The phone number to format
 * @param defaultCountry - Default country code for numbers without country prefix
 * @returns The formatted phone number, or the original if parsing fails
 */
export function formatPhoneForDisplay(
  phone: string,
  defaultCountry: CountryCode = 'US'
): string {
  if (!phone) return phone

  try {
    const parsed = parsePhoneNumber(phone, defaultCountry)
    if (parsed?.isValid()) {
      return parsed.formatInternational()
    }
  } catch {
    // Parsing failed
  }

  return phone
}

/**
 * Get the country code from a phone number.
 *
 * @param phone - The phone number
 * @returns The country calling code (e.g., "1" for US), or null if not found
 */
export function getCountryCallingCode(phone: string): string | null {
  if (!phone) return null

  try {
    const parsed = parsePhoneNumber(phone)
    if (parsed?.countryCallingCode) {
      return parsed.countryCallingCode
    }
  } catch {
    // Parsing failed
  }

  return null
}
