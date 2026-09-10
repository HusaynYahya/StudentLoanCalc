# Student loan repayment simulator

A single page that takes a UK degree and an income and produces the whole
repayment ledger: what is deducted each month, what interest is added, what is
paid off by any given year, and what — usually — is written off at the end.

Open `index.html`. No build step, no framework, no network requests.

```
├── index.html            the page, the form and the reference notes
├── loan.css              styles; design tokens at the top
├── loan.js               the interface: panel, sliders, charts, log, CSV
├── engine.js             the rules and the month-by-month simulation
└── test/engine.test.js   tests for the engine — node test/engine.test.js
```

`engine.js` is pure — circumstances in, ledger out, no DOM — and loads under
both `<script>` and `require()`, which is how the tests run it.

## The timeline

Education and work are not assumed to run straight into one another. The
timeline is set out explicitly:

- **Undergraduate** — the September it starts, and how long it runs
- **Postgraduate** — optional, with its own start year and length. It is a real
  course, not a bare balance: interest accrues while you study it, and its
  repayments begin the April after *it* ends, which is later than the
  undergraduate one
- **Work** — the year pay actually starts, which may be years after either
  course. Repayments still fall due on the statutory date; nothing is deducted
  until there is pay to deduct from
- **Breaks** — any number of year ranges with no income at all: a year out,
  caring, illness, redundancy, further study. Each profile has its own, so
  "with a career break" and "without" can sit side by side on the same chart

The later dates follow the earlier ones as you move them, until you place one
yourself — after which it stays where you put it. A postgraduate course can
never be proposed starting before the degree it follows.

## Income profiles

The dashboard runs up to **five income profiles at once**, plus the life where
you never borrowed, and overlays them on every chart. Each profile carries its
own income, repayment plan and voluntary overpayment; the course, the
assumptions and the rules are shared, so what is being compared is lives rather
than settings.

There are four ways to state an income, and a profile can use any of them:

| | |
| --- | --- |
| **Profession** | One of twelve career curves — doctor, engineer, teacher, nurse, solicitor, City law, software, accountancy, civil service, arts, low-earning |
| **Start + growth** | A starting salary and a percentage a year, taken at face value in cash |
| **5-year bands** | What you expect to earn in each five-year stretch, in today's money, with inflation added on top |
| **Year by year** | Every year, yours to set — £0 for a career break |

Only one set of income controls exists in the page: the profile tabs load a
profile into it and edits are written back, and the panel tints to whichever
profile is selected so it is never ambiguous which line a slider is moving.

## Not borrowing is not free

The obvious baseline for "what does the loan cost me" is zero, and it is
wrong. Choosing not to borrow does not make a degree free — it means finding
£9,790 a year of tuition and your living costs in cash, while you study, out
of money you do not have yet. That is the alternative, and it is what the
grey line is.

So the comparison the dashboard draws is between two real lives:

| | |
| --- | --- |
| **Borrow it** | £61,860 over three years, repaid at 9% above the threshold — around £123,000 handed over across 27 years |
| **Pay upfront** | £61,860 found in cash during the course, then nothing, ever |

On the running-cost chart that baseline is not flat: it climbs steeply for
three years and then stops dead, which is exactly the shape of paying your own
way. It moves with the tuition and the course length, because it is the cost
of the course. In balance mode it becomes the cost of clearing what you owe
today in one payment.

## A recommendation, in a sentence

The panel used to be a wall of figures with no conclusion drawn from them. It
now opens with one:

- **Written off?** *Take the loan, and never overpay.* The deduction is set by
  your salary and the threshold, not by what you owe, so an extra pound paid in
  is a pound that never comes back.
- **A clear winner?** It is named, with how much better off it leaves you.
- **Within 5%?** *Too close to call.* A spread that small is far inside the
  error on a forty-year forecast, and pretending otherwise would be false
  precision.

Where the choice turns on the savings rate, the **break-even** is given: the
return at which repaying and clearing cost exactly the same. Below it, clearing
early wins; above it, keeping the money does. It is found by binary search over
the same future-value arithmetic the panel shows, so it cannot drift away from
the figures beside it.

## The three headline figures

A band of three boxes sits above the charts, for whichever profile is selected:

| | |
| --- | --- |
| **Total repayment** | The cash handed over, added up |
| **In 2026/27 money** | The same repayments valued in the money of the year the loan was taken out — a payment in 2057 is not a payment now |
| **Growth given up** | What those repayments would have earned had they gone into a savings account instead: the pot, less what you put in. Not the money itself — you were always going to part with that — but the growth it never made |

The third is the one worth sitting with. A graduate handing over £137,053 has
also forfeited about £75,000 of compound growth on the way, which never appears
on any statement.

## The other thing you could do with the money

Handing over £137,053 sounds worse than clearing a £67,854 balance today — but
the two numbers fall at different times, and money paid in 2057 is not money
paid now. So both choices are carried forward to the year the loan ends, at
the savings rate you set:

- **Repay as required** — the stream of deductions, each compounded from the
  year it was paid.
- **Clear it today** — the whole balance, compounded from now.

Whichever is the smaller pile at that date is the choice that actually cost
less. On a typical graduate profile at 4.5%, keeping the money wins by about
£10,500: deductions spread over decades are cheap money, and the write-off may
cancel what is left. Drop the savings rate low enough and it flips.

The selected profile gets a panel of its own with every number on one screen —
the loan, what you pay, and what the same money would have done in a savings
account — plus a chart of the two choices racing each other.

## The hard cut-off

The write-off is not a taper. On its anniversary — 25 years for Plan 1, 30 for
Plans 2 and 4, 40 for Plan 5 — whatever is left is cancelled outright, however
large, and the deductions stop. For most Plan 5 borrowers that, not a final
payment, is how the loan ends.

So it is drawn as a wall. Every time-series chart carries a dashed vertical
line at the cut-off, labelled with the term, and the axis always runs to it
even when every profile clears long beforehand — that empty stretch to the
right is the point. A balance that runs all the way to the wall does not taper
off: the chart shows the drop to zero, because that is what happens to it.

Profiles on different plans get their own walls, labelled and staggered so
25-, 30- and 40-year terms can be read together.

## What is always in view

A strip along the top of the results carries the things that decide everything
and are easy to forget: **which plan** each profile is on, **RPI**, **inflation**,
how fast **thresholds** rise, the **savings return**, and the threshold in cash
today. Interest rates get a chart of their own, since they move — Plan 2 slides
with income, and the announced cap lapses.

## The two ways to give it an income

A note on the year-by-year table: one row per tax year, pre-filled from the prediction
so you are editing rather than typing forty numbers. Any year can be set to £0
for a career break, a year out or further study — the engine takes it literally
and deducts nothing that year. Past the last row the last figure carries on
rising with inflation.

## The rules encoded

Thresholds are the **2026/27** figures; interest is what was announced for
1 September 2026 to 31 August 2027.

| Plan | Who | Threshold | Rate | Interest | Written off |
| --- | --- | --- | --- | --- | --- |
| Plan 1 | England/Wales pre-2012, Northern Ireland | £26,900 | 9% | lower of RPI and base + 1% | 25 years |
| Plan 2 | England/Wales, 2012 to July 2023 | £29,385 | 9% | RPI, sliding to RPI + 3% by £49,130 | 30 years |
| Plan 4 | Scotland | £33,795 | 9% | lower of RPI and base + 1% | 30 years |
| Plan 5 | England, from August 2023 | £25,000 | 9% | RPI only | 40 years |
| Postgraduate | master's or doctoral | £21,000 | 6% | RPI + 3% | 30 years |

Beyond the table, the things that actually decide the answer:

1. **Deductions are per pay period, not annual.** 9% of whatever *that month's*
   gross pay exceeds a twelfth of the annual threshold, rounded down to a whole
   pound. A month with no pay costs nothing however good the rest of the year was.
2. **Interest runs from the first instalment**, in the September the course
   begins. Student Finance pays in three instalments an academic year — tuition
   25/25/50 to the university, maintenance in thirds — so three years of borrowing
   already owes more than it borrowed by graduation day.
3. **Repayment starts the April after the course ends**, and the write-off clock
   counts from that April. A four-year course therefore borrows a year more and
   starts a year later.
4. **The write-off is unconditional.** Whatever is left on the anniversary is
   cancelled, however large. For most Plan 5 borrowers that, not a final payment,
   is how the loan ends.
5. **Threshold freezes are honoured**: Plan 5 held at £25,000 until April 2027,
   Plan 2 held at £29,385 from April 2027 to April 2030. After that they are
   uprated at the rate you set.
6. **An undergraduate plan and a postgraduate loan run side by side**, each
   against its own threshold — 9% and 6%, so 15% across the band where both bite.
7. **The announced 6% rate cap** binds only for the year it was announced for.
   Applying it for forty years would be a fiction, so it lapses.

Interest is charged monthly here, at a twelfth of the annual rate. The Student
Loans Company charges it daily; across forty years that difference is a rounding
error beside the uncertainty in RPI.

## Why there is a sensitivity panel

Because almost the whole answer is guesswork, and it is better to see that than
to be handed a number. For a Plan 5 graduate on £30,000 with flat real pay, over
the life of the loan:

| If thresholds rise by | Repaid in cash | Written off |
| --- | --- | --- |
| 3.0% | £71,520 | £225,862 |
| 3.6% (the default) | £38,208 | £282,803 |
| 4.1%, with inflation | £5,400 | £337,943 |

Same rules, same salary, same borrower — a thirteenfold difference in what they
hand over, decided entirely by an assumption about future policy. The results
panel therefore re-runs the scenario with the threshold uprating and RPI moved
either side of the figures you chose, so the size of the guess is visible next
to the answer.

The default threshold uprating is set *below* inflation because that is what has
happened in practice: thresholds have been frozen outright more often than they
have been raised.

## The log

The year-by-year table is the point of the tool. Each row carries the salary,
the threshold, the monthly deduction, what was paid that year, the interest
rate, the interest charged, the running total paid off and the closing balance;
selecting a row opens its twelve months. Everything reconciles — opening balance plus borrowing
plus interest less repayments equals the closing balance, and there is a test
that says so. **Download as CSV** exports the whole thing, including each year's
balance restated in today's money.

Inputs are kept in `localStorage`, so a typed-out salary line survives a reload.

## Tests

```sh
node test/engine.test.js
```

Thirty-five tests over the thresholds and their freezes, the rounding of a
monthly deduction, each interest recipe including Plan 2's sliding scale, the
drawdown schedule, the write-off dates for every plan, clearing a loan without
overshooting, overpayments, career breaks, and the internal consistency of the
log.

## What it cannot tell you

Nothing here is a forecast. A forty-year projection turns entirely on RPI, on how
fast thresholds are uprated, and on a salary nobody can know — and governments
have changed all three, retrospectively, more than once. Use it to see how the
rules behave under an assumption you have chosen, then change the assumption.

For a real balance and plan type, sign in to the Student Loans Company repayment
account; for the rules as they stand, see
[gov.uk/repaying-your-student-loan](https://www.gov.uk/repaying-your-student-loan).
Not financial advice.
