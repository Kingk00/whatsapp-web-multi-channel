import {
  formatDistanceToNow,
  formatDate,
  formatTime,
  formatMessageTime,
  formatMessageDateHeader,
  isSameDay,
} from '@/lib/date-utils'

describe('Date Utils', () => {
  // Use fixed dates for testing
  const NOW = new Date('2024-01-15T14:30:00.000Z')

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('formatDistanceToNow', () => {
    it('should return "Just now" for times less than 60 seconds ago', () => {
      const date = new Date(NOW.getTime() - 30 * 1000)
      expect(formatDistanceToNow(date)).toBe('Just now')
    })

    it('should return minutes for times less than 1 hour ago', () => {
      const date = new Date(NOW.getTime() - 5 * 60 * 1000)
      expect(formatDistanceToNow(date)).toBe('5 min')
    })

    it('should return hours for times less than 24 hours ago', () => {
      const date = new Date(NOW.getTime() - 3 * 60 * 60 * 1000)
      expect(formatDistanceToNow(date)).toBe('3h')
    })

    it('should return "Yesterday" for times 24-48 hours ago', () => {
      const date = new Date(NOW.getTime() - 25 * 60 * 60 * 1000)
      expect(formatDistanceToNow(date)).toBe('Yesterday')
    })

    it('should return days for times 2-7 days ago', () => {
      const date = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
      expect(formatDistanceToNow(date)).toBe('3d')
    })

    it('should return formatted date for times more than 7 days ago', () => {
      const date = new Date('2024-01-05T10:00:00.000Z')
      expect(formatDistanceToNow(date)).toBe('Jan 5')
    })
  })

  describe('formatDate', () => {
    it('should format date in same year without year', () => {
      const date = new Date('2024-03-15T10:00:00.000Z')
      expect(formatDate(date)).toBe('Mar 15')
    })

    it('should format date in different year with year', () => {
      const date = new Date('2023-03-15T10:00:00.000Z')
      expect(formatDate(date)).toBe('Mar 15, 2023')
    })
  })

  describe('formatTime', () => {
    it('should format time in 12-hour format', () => {
      const date = new Date('2024-01-15T14:30:00.000Z')
      // Note: Result depends on timezone, but should be in format "X:XX AM/PM"
      const result = formatTime(date)
      expect(result).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/)
    })

    it('should handle midnight', () => {
      const date = new Date('2024-01-15T00:00:00.000Z')
      const result = formatTime(date)
      expect(result).toMatch(/12:00\s(AM|PM)/)
    })

    it('should handle noon', () => {
      const date = new Date('2024-01-15T12:00:00.000Z')
      const result = formatTime(date)
      expect(result).toMatch(/12:00\s(PM|AM)/)
    })
  })

  describe('formatMessageTime', () => {
    it('should return time only for today', () => {
      const date = new Date(NOW.getTime() - 2 * 60 * 60 * 1000) // 2 hours ago
      const result = formatMessageTime(date)
      expect(result).toMatch(/\d{1,2}:\d{2}\s(AM|PM)/)
      expect(result).not.toContain('Yesterday')
    })

    it('should return "Yesterday" prefix for yesterday', () => {
      // Create yesterday date at same time
      const yesterday = new Date(NOW)
      yesterday.setDate(yesterday.getDate() - 1)
      const result = formatMessageTime(yesterday)
      expect(result).toContain('Yesterday')
    })

    it('should return date and time for older messages', () => {
      const date = new Date('2024-01-10T14:30:00.000Z')
      const result = formatMessageTime(date)
      expect(result).toContain('Jan 10')
    })
  })

  describe('formatMessageDateHeader', () => {
    it('should return "Today" for today', () => {
      const date = new Date(NOW.getTime() - 2 * 60 * 60 * 1000)
      expect(formatMessageDateHeader(date)).toBe('Today')
    })

    it('should return "Yesterday" for yesterday', () => {
      const yesterday = new Date(NOW)
      yesterday.setDate(yesterday.getDate() - 1)
      expect(formatMessageDateHeader(yesterday)).toBe('Yesterday')
    })

    it('should return full date for older dates', () => {
      const date = new Date('2024-01-10T14:30:00.000Z')
      const result = formatMessageDateHeader(date)
      expect(result).toContain('January')
      expect(result).toContain('10')
      expect(result).toContain('2024')
    })
  })

  describe('isSameDay', () => {
    it('should return true for same day', () => {
      const date1 = new Date('2024-01-15T10:00:00.000Z')
      const date2 = new Date('2024-01-15T20:00:00.000Z')
      expect(isSameDay(date1, date2)).toBe(true)
    })

    it('should return false for different days', () => {
      const date1 = new Date('2024-01-15T10:00:00.000Z')
      const date2 = new Date('2024-01-16T10:00:00.000Z')
      expect(isSameDay(date1, date2)).toBe(false)
    })

    it('should return false for different months', () => {
      const date1 = new Date('2024-01-15T10:00:00.000Z')
      const date2 = new Date('2024-02-15T10:00:00.000Z')
      expect(isSameDay(date1, date2)).toBe(false)
    })

    it('should return false for different years', () => {
      const date1 = new Date('2024-01-15T10:00:00.000Z')
      const date2 = new Date('2023-01-15T10:00:00.000Z')
      expect(isSameDay(date1, date2)).toBe(false)
    })
  })
})
