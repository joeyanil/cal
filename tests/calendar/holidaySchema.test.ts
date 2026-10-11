import { describe, it, expect } from 'vitest'
import { enterMovableHolidaySchema } from '@/lib/services/holiday.service'

describe('enterMovableHolidaySchema', () => {
  it('accepts a normal dated holiday', () => {
    expect(enterMovableHolidaySchema.safeParse({ holidayTypeKey: 'SIKLET', date: '2027-04-30', closesSchool: true }).success).toBe(true)
  })
  it('accepts a holiday the school teaches on, with no date', () => {
    expect(enterMovableHolidaySchema.safeParse({ holidayTypeKey: 'EID_FITR', date: null, closesSchool: false }).success).toBe(true)
    expect(enterMovableHolidaySchema.safeParse({ holidayTypeKey: 'EID_FITR', closesSchool: false }).success).toBe(true)
  })
  it('rejects a closed holiday with no date', () => {
    expect(enterMovableHolidaySchema.safeParse({ holidayTypeKey: 'EID_FITR', date: null, closesSchool: true }).success).toBe(false)
    expect(enterMovableHolidaySchema.safeParse({ holidayTypeKey: 'EID_FITR' }).success).toBe(false)
  })
})
