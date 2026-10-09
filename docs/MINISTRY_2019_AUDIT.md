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
