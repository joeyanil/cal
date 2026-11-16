/**
 * reminderMessages.ts — the words people see in a reminder.
 *
 * Pure: it only turns "what is coming, when, and who is reading" into a
 * title and a message. It never sends anything (delivery belongs to the
 * platform's own notification system) and never decides *when* to send
 * (that is reminders.ts). English only for now; every sentence lives in
 * this one file so another language can be added later without touching
 * anything else.
 *
 * The wording was agreed line by line with the school owner. Do not add
 * attendance, lesson or roll-call talk to a message unless the owner asks.
 */
import { formatEthiopian } from './ethiopian-date'
import { weekdayName } from './date-utils'
import type { ISODate } from './date-utils'
import type { HolidayTypeKey } from './types'

// ---------------------------------------------------------------------------
// Who is reading
// ---------------------------------------------------------------------------

export type ReminderAudience =
  | 'STUDENT'
  | 'GRADE_12_STUDENT'
  | 'TEACHER'
  | 'HOMEROOM_TEACHER'
  | 'GRADE_12_HOMEROOM_TEACHER'
  /** Registrar, academic admin, admin, main admin and any custom role. */
  | 'OFFICE'

export type ReminderDays = 30 | 15 | 5

export interface ReminderMessage {
  title: string
  body: string
}

// ---------------------------------------------------------------------------
// What is coming
// ---------------------------------------------------------------------------

export type ReminderTopic =
  | { topic: 'TEST'; name: string; startDate: ISODate; endDate: ISODate }
  | { topic: 'NATIONAL_TEST'; startDate: ISODate; endDate: ISODate }
  | { topic: 'HALF_START'; halfName: string; date: ISODate }
  | { topic: 'HALF_END'; halfName: string; date: ISODate }
  | { topic: 'BREAK_START'; date: ISODate; resumeDate: ISODate }
  | { topic: 'SCHOOL_RESUMES'; date: ISODate }
  | { topic: 'STUDENTS_RETURN'; date: ISODate }
  | { topic: 'YEAR_START'; date: ISODate }
  | { topic: 'YEAR_END'; date: ISODate }
  | { topic: 'HOLIDAY'; holidayKey: HolidayTypeKey; name: string; date: ISODate; closesSchoolDay: boolean }
  | {
      topic: 'SPECIAL_DAY'
      situation: SpecialDaySituation
      name: string
      startDate: ISODate
      endDate: ISODate | null
      studentsCome: boolean
      /** The admin's own wording. Empty or missing = the ready-made wording. */
      customMessage?: string | null
    }
  | { topic: 'DATE_MOVED'; itemName: string; oldDate: ISODate; newDate: ISODate }

// ---------------------------------------------------------------------------
// Special days: ready-made situations
// ---------------------------------------------------------------------------

export const SPECIAL_DAY_SITUATIONS = [
  'SPORTS_DAY',
  'PARENTS_MEETING',
  'TEACHERS_TRAINING',
  'SCHOOL_TRIP',
  'CEREMONY',
  'JOB_CHOICE_WEEK',
  'CLUB_CULTURE_DAY',
  'HEALTH_DAY',
  'CLEANUP_DAY',
  'RESULTS_DAY',
  'CUSTOM',
] as const
export type SpecialDaySituation = (typeof SPECIAL_DAY_SITUATIONS)[number]

interface SituationInfo {
  label: string
  /** Extra sentence after the date, for students. */
  studentExtra: string
  /** null = the admin must choose whether students come. */
  defaultStudentsCome: boolean | null
}

export const SPECIAL_DAY_INFO: Record<SpecialDaySituation, SituationInfo> = {
  SPORTS_DAY: { label: 'Sports day', studentExtra: 'Remember your sports clothes.', defaultStudentsCome: true },
  PARENTS_MEETING: { label: "Parents' meeting day", studentExtra: 'Please let your parents know.', defaultStudentsCome: null },
  TEACHERS_TRAINING: { label: "Teachers' training day", studentExtra: '', defaultStudentsCome: false },
  SCHOOL_TRIP: { label: 'School trip', studentExtra: 'Ask your teacher what to bring.', defaultStudentsCome: true },
  CEREMONY: { label: 'Ceremony', studentExtra: '', defaultStudentsCome: true },
  JOB_CHOICE_WEEK: { label: 'Job-choice week', studentExtra: '', defaultStudentsCome: true },
  CLUB_CULTURE_DAY: { label: 'Club or culture day', studentExtra: 'Come and join in.', defaultStudentsCome: true },
  HEALTH_DAY: { label: 'Health day', studentExtra: '', defaultStudentsCome: true },
  CLEANUP_DAY: { label: 'Clean-up or community day', studentExtra: '', defaultStudentsCome: true },
  RESULTS_DAY: { label: 'Results day', studentExtra: '', defaultStudentsCome: true },
  CUSTOM: { label: 'My own', studentExtra: '', defaultStudentsCome: null },
}

// ---------------------------------------------------------------------------
// Holiday greetings (the ending of a holiday reminder)
// ---------------------------------------------------------------------------

const HOLIDAY_GREETING: Record<HolidayTypeKey, string> = {
  NEW_YEAR: 'Happy New Year to everyone.',
  GENNA: 'Happy Genna to everyone.',
  TIMKAT: 'Happy Timkat to everyone.',
  ADWA: "Let's remember and honour the victory of Adwa.",
  PATRIOTS: "Let's remember and honour our patriots.",
  DERG_DOWNFALL: 'Wishing everyone a peaceful National Day.',
  SIKLET: 'Wishing everyone a blessed Good Friday.',
  FASIKA: 'Happy Easter to everyone.',
  EID_FITR: 'Eid Mubarak to everyone.',
  EID_ADHA: 'Eid Mubarak to everyone.',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase()
}

/** "Friday, Tir 11, 2019" */
export function whenText(date: ISODate): string {
  return `${titleCase(weekdayName(date))}, ${formatEthiopian(date)}`
}

function isStudent(a: ReminderAudience): boolean {
  return a === 'STUDENT' || a === 'GRADE_12_STUDENT'
}
function isHomeroom(a: ReminderAudience): boolean {
  return a === 'HOMEROOM_TEACHER' || a === 'GRADE_12_HOMEROOM_TEACHER'
}

/** Picks the line for the reader. Homeroom falls back to teacher wording. */
function pick<T extends string>(
  a: ReminderAudience,
  lines: { student: T; teacher: T; homeroom?: T; office: T },
): T {
  if (isStudent(a)) return lines.student
  if (isHomeroom(a)) return lines.homeroom ?? lines.teacher
  if (a === 'TEACHER') return lines.teacher
  return lines.office
}

function fillCustom(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
}

// Countdown endings for tests (tone changes as the day gets closer).
const TEST_TONE: Record<'student' | 'homeroom' | 'office', Record<ReminderDays, string>> = {
  student: {
    30: 'There is plenty of time to prepare.',
    15: 'Two weeks to go. Keep your revision on track.',
    5: 'Only a few days left. Rest well and review calmly.',
  },
  homeroom: {
    30: 'Your class has plenty of time to prepare.',
    15: 'Two weeks to go. Please remind your class to keep revising.',
    5: 'Only a few days left. Please remind your class to rest well and review calmly.',
  },
  office: {
    30: 'Please confirm the dates are final.',
    15: 'Two weeks to go. Please make sure everything is ready.',
    5: 'Only a few days left.',
  },
}
const TEACHER_TEST_TONE: Record<ReminderDays, string> = {
  30: 'Plenty of time to plan your last lessons and marking.',
  15: 'Two weeks to go. Please plan your remaining lessons and marking.',
  5: 'Only a few days left. Please wrap up your lessons and marking.',
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Builds the title and message one person should see.
 * Returns null when this reader is not meant to get this reminder at all
 * (for example, students outside Grade 12 never get the national test).
 */
export function buildReminderMessage(
  audience: ReminderAudience,
  topic: ReminderTopic,
  days: ReminderDays,
): ReminderMessage | null {
  switch (topic.topic) {
    case 'TEST': {
      const head = `${topic.name} is in ${days} days, on ${whenText(topic.startDate)}, and runs until ${whenText(topic.endDate)}.`
      const tone = isStudent(audience)
        ? TEST_TONE.student[days]
        : isHomeroom(audience)
          ? TEST_TONE.homeroom[days]
          : audience === 'TEACHER'
            ? TEACHER_TEST_TONE[days]
            : TEST_TONE.office[days]
      return { title: `${topic.name} is in ${days} days`, body: `${head} ${tone}` }
    }

    case 'NATIONAL_TEST': {
      const title = `The Grade 12 national test is in ${days} days`
      const s = whenText(topic.startDate)
      const e = whenText(topic.endDate)
      switch (audience) {
        case 'STUDENT':
          return null
        case 'GRADE_12_STUDENT': {
          const wish = days === 5 ? ' We wish you the very best.' : ''
          return {
            title,
            body: `Your national test is in ${days} days, on ${s}, and ends on ${e}. ${TEST_TONE.student[days]}${wish}`,
          }
        }
        case 'TEACHER':
          return {
            title,
            body: `The Grade 12 national test is in ${days} days, on ${s}, and ends on ${e}. Grade 12 students will be away. All other grades carry on as normal.`,
          }
        case 'GRADE_12_HOMEROOM_TEACHER':
          return {
            title,
            body: `Your class sits the national test in ${days} days, on ${s}, and it ends on ${e}. Please encourage your students.`,
          }
        case 'HOMEROOM_TEACHER':
          return {
            title,
            body: `Grade 12 sits the national test in ${days} days, on ${s}. Your class is not affected.`,
          }
        case 'OFFICE':
          return { title, body: `The Grade 12 national test is in ${days} days, on ${s}, and ends on ${e}.` }
      }
      return null
    }

    case 'HALF_START': {
      const w = whenText(topic.date)
      const head = `${topic.halfName} starts in ${days} days, on ${w}.`
      return {
        title: `${topic.halfName} starts in ${days} days`,
        body: `${head} ${pick(audience, {
          student: 'Get ready for a fresh start.',
          teacher: 'Please have your lesson plans ready.',
          homeroom: 'Please check that your class list is ready.',
          office: 'Please check that everything is ready.',
        })}`,
      }
    }

    case 'HALF_END': {
      const w = whenText(topic.date)
      const head = `${topic.halfName} ends in ${days} days, on ${w}.`
      return {
        title: `${topic.halfName} ends in ${days} days`,
        body: `${head} ${pick(audience, {
          student: 'Finish any work you still owe your teachers.',
          teacher: 'Please make sure your marks are entered in time.',
          homeroom: 'Please make sure your class records are complete.',
          office: 'Please make sure marks and records are complete.',
        })}`,
      }
    }

    case 'BREAK_START':
      return {
        title: `The school break starts in ${days} days`,
        body: `The school break starts in ${days} days, on ${whenText(topic.date)}. School is back on ${whenText(topic.resumeDate)}.${
          audience === 'TEACHER' ? ' Enjoy the rest.' : ''
        }`,
      }

    case 'SCHOOL_RESUMES': {
      const head = `School is back in ${days} days, on ${whenText(topic.date)}.`
      return {
        title: `School is back in ${days} days`,
        body: `${head}${
          isStudent(audience)
            ? ' Get ready.'
            : isHomeroom(audience)
              ? ' Welcome your class back.'
              : audience === 'TEACHER'
                ? ' Please have your lessons ready.'
                : ''
        }`,
      }
    }

    case 'STUDENTS_RETURN': {
      const w = whenText(topic.date)
      return {
        title: `Students' return day is in ${days} days`,
        body: pick(audience, {
          student: `Students' return day is in ${days} days, on ${w}. We'll see you at school.`,
          teacher: `Students return to school in ${days} days, on ${w}. Please be ready to welcome them.`,
          homeroom: `Students return in ${days} days, on ${w}. Please be ready to welcome your class and check your class list.`,
          office: `Students return in ${days} days, on ${w}. Please make sure registration and class lists are ready.`,
        }),
      }
    }

    case 'YEAR_START': {
      const head = `The new school year starts in ${days} days, on ${whenText(topic.date)}.`
      return {
        title: `The school year starts in ${days} days`,
        body: `${head} ${pick(audience, {
          student: 'Get ready.',
          teacher: 'Please have your first lessons ready.',
          homeroom: 'Get ready to welcome your class.',
          office: 'Please check that everything is ready.',
        })}`,
      }
    }

    case 'YEAR_END': {
      const head = `The school year ends in ${days} days, on ${whenText(topic.date)}.`
      return {
        title: `The school year ends in ${days} days`,
        body: `${head} ${pick(audience, {
          student: 'Finish strong.',
          teacher: 'Please finish your marks and records before then.',
          homeroom: 'Please make sure your class records are complete.',
          office: 'Please finish results and records.',
        })}`,
      }
    }

    case 'HOLIDAY': {
      const closed = topic.closesSchoolDay ? ' School will be closed.' : ''
      return {
        title: `${topic.name} is in ${days} days`,
        body: `${topic.name} is in ${days} days, on ${whenText(topic.date)}.${closed} ${HOLIDAY_GREETING[topic.holidayKey]}`,
      }
    }

    case 'SPECIAL_DAY': {
      const when = whenText(topic.startDate)
      const end = topic.endDate && topic.endDate !== topic.startDate ? whenText(topic.endDate) : null
      const vars: Record<string, string> = {
        name: topic.name,
        days: String(days),
        date: when,
        endDate: end ?? when,
      }
      const custom = topic.customMessage?.trim()
      if (custom) {
        return { title: `${topic.name} is in ${days} days`, body: fillCustom(custom, vars) }
      }
      const info = SPECIAL_DAY_INFO[topic.situation]
      const lead =
        topic.situation === 'RESULTS_DAY'
          ? `Results day is in ${days} days, on ${when}.`
          : end
            ? `${topic.name} starts in ${days} days, on ${when}, and runs until ${end}.`
            : `${topic.name} is in ${days} days, on ${when}.`
      const title = `${topic.name} is in ${days} days`

      if (isStudent(audience)) {
        const extra = info.studentExtra ? ` ${info.studentExtra}` : ''
        const ending = topic.studentsCome ? ' See you at school.' : ' There is no school for students that day.'
        return { title, body: `${lead}${extra}${ending}` }
      }

      let ending: string
      if (topic.situation === 'TEACHERS_TRAINING' && (audience === 'TEACHER' || isHomeroom(audience))) {
        ending = 'You are expected to attend.'
      } else if (topic.situation === 'PARENTS_MEETING' && (audience === 'TEACHER' || isHomeroom(audience))) {
        ending = 'Parents will be visiting. Please be available.'
      } else if (isHomeroom(audience)) {
        ending = topic.studentsCome ? 'Your class will be at school.' : 'Your class stays home that day.'
      } else if (audience === 'TEACHER') {
        ending = topic.studentsCome ? 'Students will be at school.' : 'Students stay home that day.'
      } else {
        ending = topic.studentsCome ? 'Students come to school that day.' : 'Students stay home that day.'
      }
      return { title, body: `${lead} ${ending}` }
    }

    case 'DATE_MOVED': {
      const head = `${topic.itemName} has moved. It was on ${whenText(topic.oldDate)} and is now on ${whenText(topic.newDate)}.`
      return {
        title: `${topic.itemName} has moved`,
        body: `${head}${pick(audience, {
          student: '',
          teacher: ' Please adjust your plans.',
          homeroom: ' Please let your class know.',
          office: ' Everyone affected has been told.',
        })}`,
      }
    }
  }
}
