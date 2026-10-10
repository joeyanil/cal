# Ministry 2019 E.C. plan vs K2 Calendar Engine — audit

Method: every Ministry date was converted with the engine's own `ethiopian-date.ts`, then run through `buildFullYearTimeline()` and `validateCalendarConfiguration()`. Ministry text was read from the supplied plan file; Amharic wording should be confirmed by a native reader before acting on items marked (confirm).

## Real conflicts
1. **S1 Regional Model, Hidar 3-7** = Thu 2026-11-12 to Mon 2026-11-16. Spans a weekend, so `CALENDAR_EXAM_ON_WEEKEND` rejects it. Nearest clean windows: 3 days earlier (2026-11-09 to 11-13, Tikimt 30 - Hidar 4) or 4 days later (2026-11-16 to 11-20, Hidar 7-11).
2. **Vocational choice, Sene 1-6** = Tue to Sun (4 weekdays + weekend). The engine has no slot for it, so nothing validates it.
3. **Day-count basis differs.** Ministry's monthly working days (20/21/22/21/14, 20/22/19/21/21) reproduce exactly as weekdays minus weekday holidays minus Tir 24-28, with exam weeks counted as working days. K2 excludes school-closing exam weekdays, giving 183 teaching days vs 201 (difference = 18 exam weekdays). Admins comparing K2 to the Ministry's 210/200 will see an unexplained gap. Suggested fix: show a "Ministry basis" count next to the strict count.
4. **Sene 30 (Parents' Day, Wed)** is non-working in the Ministry count (Sene = 21) but K2 treats it as a teaching day.
5. **No-exam-in-holiday-week rule** (Ministry notice) is not enforced; the engine only blocks exams on the holiday day itself. The 2019 plan happens to comply. Suggested fix: WARNING `CALENDAR_EXAM_IN_HOLIDAY_WEEK`, and have `suggestExamShift` avoid such weeks.
6. **Model exams close school in K2**, but the Ministry closure list names the two final-exam weeks, not the regional model weeks (confirm). Consider a per-exam closure toggle.
7. **Grade 12 exam**: the Ministry says secondary-school teaching is interrupted; K2 models it as non-closing. Depends on whether K2 tenants include secondary schools. The Ministry's own 200 for secondary does not reconcile (210 - 5 = 205).

## Items that look like conflicts but are not
- "07 closed days" vs 8 listed holidays: Eid al-Adha (Ginbot 8) is a Sunday.
- Derived semester break Tir 24-30 includes Sat/Sun; no teaching day is affected (the earlier note in `2019-workflow.test.ts` calling this a gap is a false alarm).
- Meskerem 4 is the placement day (non-teaching); Meskerem 5 is the first teaching day.

## Inconsistencies inside the Ministry document
- Sene 14-18 is described as both the S2 final exam week and the paper-correction period.
- 8th-grade completion exam is called national in one place and regional in another.
- The 210 count includes days the closure list says have no regular lessons.

## Not modelled by the engine
Teachers' return (Nehase 25), registration window, plasma starts, 6th/8th model exam (Ginbot 23-27), 6th and 8th completion exams, vocational choice, result notification (Sene 28), Parents' Day. Meskel (Meskerem 17, a Sunday in 2019) has no fixed-holiday entry for other years (as far as the catalog shows).

## UX gaps noticed
- Exam errors show Gregorian ISO dates and raw keys (`S1_REGIONAL_MODEL`) instead of Ethiopian dates and labels.
- Fasika always falls on a Sunday two days after Siklet; a one-click "declare Fasika = Siklet + 2" dependency rule would save manual entry.
- Extending year start to include Student Return could be one click.

## Implemented here
`suggestExamShift()` in `src/lib/calendar/exams.ts`, wired into `ExamForm`: after a weekend/closing-holiday rejection it offers the nearest clean window earlier and later as one-click chips. Chips fill the fields only; the admin still presses Save.

## Decisions applied (follow-up)
- **Day count:** `teachingDayBreakdown` now also returns `ministryBasisDays` = teaching days + exam days + student-return day. Those days stay non-learning with no attendance; they are counted only so K2 can be compared with the Ministry's 210.
- **Holiday-week rule enforced:** new hard stop `CALENDAR_EXAM_IN_HOLIDAY_WEEK` (Mon-Fri week containing a school-closing holiday). A holiday on a Saturday/Sunday does not trigger it (assumption: confirm with the Ministry). Exam suggestions use the same rules, so an accepted suggestion always saves.
- **Year-end day:** the last day of the academic year (Sene 30) is never a teaching day and never takes attendance (`reasons` contains `YEAR_END`; school stays open for staff). No database change needed.
- **Sene 1-6 vocational choice:** intentionally not modelled.

## Exam date helper (what an admin now sees)
While typing an exam's start/end, the form checks the window live with the same function the server uses (`analyzeExamWindow`):
- Explains each problem in Ethiopian dates (weekend, holiday, holiday week, end before start, outside semester/year, overlaps another exam).
- Offers **Swap** when start is after end, and the nearest clean window **earlier** and **later**. Suggestions stay inside the exam's own semester, avoid other school-closing exams, and always pass every rule.
- Says so when no clean window exists nearby, instead of showing nothing.
- Save is disabled while a hard problem exists. The server also rejects it and returns the same suggestions in the error `details`, so any other client can use them.
- Known limit: the database trigger (`fn_validate_exam_placement`) still only checks weekend and closing-holiday; the holiday-week rule is enforced in the app layer.

## Guided setup (replaces the old single page of Save buttons)
`/calendar/[yearId]/setup` is now a six-step flow, in the order things depend on each other: **School year, Semesters, Holidays, Exams, Student return, Review**.
- One **Continue** per step saves only what changed; there are no per-row Save buttons. Back never loses typing.
- Year and semesters must be filled in first (exams and breaks are checked against them). Later steps can be left incomplete and finished later.
- The page opens on the first step that still needs something; a year still on the default boundary opens on step 1.
- The same rules the server enforces run live while typing; errors block Continue, and exam fixes (swap, earlier, later) are one click.
- Review shows every date in Ethiopian form, the learning-day count and the Ministry-basis count, and lists what must be fixed, what is still to enter, and what is worth a look, each with a jump link. Finishing builds and publishes the timeline.
- **Permanent holidays need no clicks.** They are added to every year automatically (on creation, on opening setup, before validation and before every timeline build), marked confirmed, and always counted. The old "Propose" and "Confirm" buttons are gone (the API endpoints remain).
- Validation messages everywhere now show Ethiopian dates and holiday/exam names instead of ISO dates and internal keys.
- Exam rule violations are now attached to their exam, so a holiday entered later that lands in an exam week shows as an error on that exam.

## Deploying this change (Cloudflare + Supabase)
1. Run `supabase/migrations/0020_calendar_exam_holiday_week.sql` in the Supabase SQL Editor (adds the holiday-week rule to the database check; safe to run twice).
2. Deploy the branch (a Cloudflare preview if branch builds are enabled, otherwise merge to main).
