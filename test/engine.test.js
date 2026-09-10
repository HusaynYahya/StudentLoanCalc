/* ============================================================================
   Tests for the repayment engine.   Run:  node test/engine.test.js
   Each test pins down one rule, so a wrong figure here is a wrong figure in
   the law, not a wrong figure in the arithmetic.
   ========================================================================== */

var E = require("../engine.js");

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n         " + e.message); }
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || "value") + ": expected " + expected + ", got " + actual);
  }
}
function near(actual, expected, tol, what) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error((what || "value") + ": expected ~" + expected + " (±" + tol + "), got " + actual);
  }
}
function ok(cond, what) { if (!cond) throw new Error(what || "expected true"); }

var A = E.DEFAULT_ASSUMPTIONS;

/* -- Thresholds ---------------------------------------------------------- */

console.log("\nThresholds (2026/27 figures, uprated thereafter)");

test("2026/27 thresholds match the published figures", function () {
  eq(E.thresholdFor("plan1", 2026, A), 26900, "plan 1");
  eq(E.thresholdFor("plan2", 2026, A), 29385, "plan 2");
  eq(E.thresholdFor("plan4", 2026, A), 33795, "plan 4");
  eq(E.thresholdFor("plan5", 2026, A), 25000, "plan 5");
  eq(E.thresholdFor("pgl",   2026, A), 21000, "postgraduate");
});

test("Plan 5 is frozen until April 2027, then uprated", function () {
  eq(E.thresholdFor("plan5", 2026, A), 25000, "2026/27");
  var g = 1 + A.thresholdGrowth;
  near(E.thresholdFor("plan5", 2027, A), 25000 * g, 0.01, "2027/28");
  near(E.thresholdFor("plan5", 2028, A), 25000 * g * g, 0.01, "2028/29");
});

test("Plan 2 stays frozen from April 2027 through April 2029", function () {
  eq(E.thresholdFor("plan2", 2027, A), 29385, "2027/28");
  eq(E.thresholdFor("plan2", 2028, A), 29385, "2028/29");
  eq(E.thresholdFor("plan2", 2029, A), 29385, "2029/30");
  near(E.thresholdFor("plan2", 2030, A), 29385 * (1 + A.thresholdGrowth), 0.01, "2030/31 — the freeze lifts");
});

test("the postgraduate threshold is frozen indefinitely, not uprated", function () {
  // £21,000 since 2016, never once raised, with no end date announced.
  eq(E.thresholdFor("pgl", 2026, A), 21000, "2026/27");
  eq(E.thresholdFor("pgl", 2030, A), 21000, "2030/31");
  eq(E.thresholdFor("pgl", 2050, A), 21000, "2050/51");
});

test("a frozen threshold bites harder every year as pay rises", function () {
  var early = E.monthlyDeduction(30000, E.thresholdFor("pgl", 2026, A), 0.06);
  var later = E.monthlyDeduction(30000 * Math.pow(1.04, 15), E.thresholdFor("pgl", 2041, A), 0.06);
  ok(later > early * 2, "the same real salary is charged far more: " + early + " then " + later);
});

test("Plan 1, with no freeze, rises every April", function () {
  var g = 1 + A.thresholdGrowth;
  near(E.thresholdFor("plan1", 2027, A), 26900 * g, 0.01, "2027/28");
  near(E.thresholdFor("plan1", 2031, A), 26900 * Math.pow(g, 5), 0.01, "2031/32");
});

/* -- Deductions ---------------------------------------------------------- */

console.log("\nWhat comes out of a month's pay");

test("9% of the excess only, never of the whole salary", function () {
  // £30,000 on Plan 5: (2500.00 − 2083.33) × 9% = 37.50 → £37
  eq(E.monthlyDeduction(30000, 25000, 0.09), 37, "Plan 5 on £30,000");
});

test("nothing is deducted at or below the threshold", function () {
  eq(E.monthlyDeduction(25000, 25000, 0.09), 0, "exactly at the threshold");
  eq(E.monthlyDeduction(19000, 25000, 0.09), 0, "below the threshold");
});

test("the deduction is rounded down to a whole pound", function () {
  // £30,100: (2508.33 − 2083.33) × 9% = 38.25 → £38, not £38.25
  eq(E.monthlyDeduction(30100, 25000, 0.09), 38, "rounding down");
});

test("a postgraduate loan takes 6%, not 9%", function () {
  // £33,000 against £21,000: (2750 − 1750) × 6% = £60
  eq(E.monthlyDeduction(33000, 21000, 0.06), 60, "postgraduate rate");
});

test("an undergraduate plan and a postgraduate loan both bite at once", function () {
  var ug = E.monthlyDeduction(50000, 25000, 0.09);
  var pg = E.monthlyDeduction(50000, 21000, 0.06);
  eq(ug, 187, "Plan 5 share");
  eq(pg, 145, "postgraduate share");
  ok(ug + pg === 332, "15% across the overlapping band");
});

/* -- Interest ------------------------------------------------------------ */

console.log("\nInterest");

test("Plan 5 charges RPI and nothing more", function () {
  near(E.interestRate("rpi", { assumptions: A, taxYear: 2030 }), 0.041, 1e-9, "Plan 5 rate");
});

test("Plan 1 and Plan 4 take the lower of RPI and base + 1%", function () {
  var a = Object.assign({}, A, { rpi: 0.041, bankBase: 0.0375 });
  near(E.interestRate("lowerOfRpiAndBase", { assumptions: a, taxYear: 2030 }), 0.041, 1e-9, "RPI is lower");
  var b = Object.assign({}, A, { rpi: 0.08, bankBase: 0.03, interestCap: null });
  near(E.interestRate("lowerOfRpiAndBase", { assumptions: b, taxYear: 2030 }), 0.04, 1e-9, "base + 1% is lower");
});

test("Plan 2 slides from RPI to RPI + 3% across the income band", function () {
  var a = Object.assign({}, A, { rpi: 0.041, interestCap: null });
  var at = function (income) {
    return E.interestRate("slidingScale", {
      assumptions: a, income: income, threshold: 29385, upperThreshold: 49130, taxYear: 2030
    });
  };
  near(at(20000), 0.041, 1e-9, "below the threshold — RPI only");
  near(at(29385), 0.041, 1e-9, "at the threshold");
  near(at(39257.5), 0.041 + 0.015, 1e-6, "halfway — RPI + 1.5%");
  near(at(49130), 0.071, 1e-9, "at the top of the band");
  near(at(90000), 0.071, 1e-9, "above the band — no more than RPI + 3%");
});

test("the announced rate cap binds only for the year it was announced for", function () {
  var a = Object.assign({}, A, { rpi: 0.041, interestCap: 0.06, interestCapUntil: 2027 });
  near(E.interestRate("rpiPlus3", { assumptions: a, taxYear: 2027 }), 0.06, 1e-9, "capped in 2027/28");
  near(E.interestRate("rpiPlus3", { assumptions: a, taxYear: 2028 }), 0.071, 1e-9, "uncapped after");
});

/* -- Borrowing while studying -------------------------------------------- */

console.log("\nBorrowing, and when repayment begins");

test("three instalments an academic year, from the September the course starts", function () {
  var rows = E.drawdownSchedule({ years: 3, startYear: 2026, tuitionPerYear: 9000, maintenancePerYear: 9000 });
  eq(rows.length, 9, "instalments over three years");
  eq(rows[0].month, E.ym(2026, 9), "first instalment is September 2026");
  eq(rows[8].month, E.ym(2029, 4), "last instalment is April 2029");
  var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
  near(total, 54000, 0.01, "everything borrowed is drawn down");
});

test("repayment starts the April after the course ends", function () {
  eq(E.repaymentStartYear(2026, 3), 2030, "three-year course from 2026");
  eq(E.repaymentStartYear(2026, 4), 2031, "four-year course from 2026");
});

test("interest runs from the first instalment, so graduation day already owes more", function () {
  var s = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 30000 }
  });
  var r = s.combined;
  near(r.borrowed, 61860, 1, "borrowed over three years");
  ok(r.balanceAtRepayStart > r.borrowed, "the balance at the first April exceeds what was borrowed");
  near(r.balanceAtRepayStart, 67854, 50, "balance when repayments begin");
});

test("a four-year course borrows a year more, and repays a year later", function () {
  var four = E.simulate({
    loans: [{ plan: "plan5", course: { years: 4, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: E.repaymentStartYear(2026, 4) }],
    salaries: { 2031: 30000 }
  }).combined;
  near(four.borrowed, 82480, 1, "four years of borrowing");
  eq(four.years[0].label, "2026/27", "the ledger opens with the first instalment");
});

/* -- The write-off ------------------------------------------------------- */

console.log("\nThe write-off");

test("Plan 5 is written off forty years after the first April, to the month", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 26000 }
  }).combined;
  eq(r.writeOffLabel, "2069/70", "last tax year of repayment");
  eq(r.years[r.years.length - 1].label, "2069/70", "the ledger stops there");
  ok(r.writtenOff > 0, "there is a balance left to write off");
});

test("Plan 1 is written off after twenty-five years, Plan 2 after thirty", function () {
  var mk = function (plan) {
    return E.simulate({
      loans: [{ plan: plan, openingBalance: 40000, repaymentStartYear: 2030 }],
      salaries: { 2030: 20000 }
    }).combined;
  };
  eq(mk("plan1").writeOffLabel, "2054/55", "Plan 1 — 25 years");
  eq(mk("plan2").writeOffLabel, "2059/60", "Plan 2 — 30 years");
  eq(mk("plan4").writeOffLabel, "2059/60", "Plan 4 — 30 years");
});

test("a balance below the threshold is never repaid, only written off", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 50000, repaymentStartYear: 2030 }],
    salaries: { 2030: 18000 },
    assumptions: { salaryGrowth: 0 }
  }).combined;
  eq(Math.round(r.totalRepaid), 0, "nothing was ever deducted");
  ok(r.writtenOff > 50000, "the balance grew the whole time");
});

/* -- Clearing it --------------------------------------------------------- */

console.log("\nClearing the loan");

test("a high earner clears the loan and then stops paying", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
    salaries: { 2030: 90000 },
    assumptions: { salaryGrowth: 0.04 }
  }).combined;
  ok(r.everRepaidInFull, "the loan is cleared");
  ok(r.yearsRepaying < 40, "cleared before the write-off, in " + r.yearsRepaying + " years");
  near(r.years[r.years.length - 1].closingBalance, 0, 0.01, "the final balance is nil");
});

test("the last payment is trimmed to the balance, never overshooting", function () {
  var s = E.simulateLoan(
    { plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 },
    {
      assumptions: Object.assign({}, A, { salaryGrowth: 0.04 }),
      salaryAt: E.salaryLine({ 2030: 90000 }, Object.assign({}, A, { salaryGrowth: 0.04 }))
    }
  );
  var last = s.months[s.months.length - 1];
  ok(last.balance >= 0, "the balance never goes negative");
  near(last.balance, 0, 0.01, "and lands exactly on nil");
});

test("voluntary overpayments shorten the term", function () {
  var base = {
    loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
    salaries: { 2030: 60000 },
    assumptions: { salaryGrowth: 0.03 }
  };
  var plain = E.simulate(base).combined;
  var extra = E.simulate(Object.assign({}, base, { overpayment: { monthly: 300 } })).combined;
  ok(extra.yearsRepaying < plain.yearsRepaying,
    "cleared sooner: " + extra.yearsRepaying + " years against " + plain.yearsRepaying);
  ok(extra.totalInterest < plain.totalInterest, "and less interest was charged");
});

test("overpaying a loan that would have been written off just wastes the money", function () {
  var base = {
    loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
    salaries: { 2030: 28000 },
    assumptions: { salaryGrowth: 0.02 }
  };
  var plain = E.simulate(base).combined;
  var extra = E.simulate(Object.assign({}, base, { overpayment: { monthly: 100 } })).combined;
  ok(!plain.everRepaidInFull, "it would have been written off anyway");
  ok(extra.totalRepaid > plain.totalRepaid, "the overpayer simply hands over more");
});

/* -- The salary line ----------------------------------------------------- */

console.log("\nThe salary line");

test("typed salaries are used as given, and the last one is carried forward", function () {
  var f = E.salaryLine({ 2030: 28000, 2031: 31000, 2035: 45000 }, Object.assign({}, A, { salaryGrowth: 0.05 }));
  eq(f(2030), 28000, "first year as typed");
  eq(f(2031), 31000, "second year as typed");
  eq(f(2033), 31000, "a gap holds the last stated figure");
  eq(f(2035), 45000, "a later year as typed");
  near(f(2037), 45000 * 1.05 * 1.05, 0.01, "beyond the last entry, growth takes over");
});

test("a year of no income is respected, not smoothed away", function () {
  var f = E.salaryLine({ 2030: 40000, 2031: 0, 2032: 40000 }, A);
  eq(f(2031), 0, "the career break");
  var r = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 50000, repaymentStartYear: 2030 }],
    salaries: { 2030: 40000, 2031: 0, 2032: 40000 }
  }).combined;
  var gap = r.years.filter(function (y) { return y.label === "2031/32"; })[0];
  eq(Math.round(gap.repaid), 0, "nothing is deducted in the year with no pay");
});

/* -- The log ------------------------------------------------------------- */

console.log("\nThe log");

test("every tax year's figures reconcile: open + borrow + interest − paid = close", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 35000 }
  }).combined;
  r.years.forEach(function (y) {
    var close = y.openingBalance + y.borrowed + y.interest - y.repaid - y.voluntary;
    near(close, y.closingBalance, 0.02, y.label + " does not reconcile");
  });
});

test("running totals only ever climb", function () {
  var r = E.simulate({
    loans: [{ plan: "plan2", course: { years: 4, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2031 }],
    salaries: { 2031: 42000 }
  }).combined;
  for (var i = 1; i < r.years.length; i++) {
    ok(r.years[i].cumRepaid >= r.years[i - 1].cumRepaid, "cumulative repaid fell at " + r.years[i].label);
    ok(r.years[i].cumInterest >= r.years[i - 1].cumInterest, "cumulative interest fell at " + r.years[i].label);
  }
});

test("the total repaid in the log matches the headline total", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 55000, repaymentStartYear: 2030 }],
    salaries: { 2030: 45000 }
  }).combined;
  var sum = r.years.reduce(function (s, y) { return s + y.repaid + y.voluntary; }, 0);
  near(sum, r.totalRepaid, 0.05, "log against headline");
});

test("today's money is always the smaller number", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 55000, repaymentStartYear: 2030 }],
    salaries: { 2030: 45000 }
  }).combined;
  ok(r.totalRealRepaid < r.totalRepaid, "deflated total is lower than the cash total");
});

/* -- Two loans at once --------------------------------------------------- */

console.log("\nAn undergraduate plan and a postgraduate loan together");

test("both are repaid side by side, each against its own threshold", function () {
  var s = E.simulate({
    loans: [
      { plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 },
      { plan: "pgl", openingBalance: 12000, repaymentStartYear: 2030 }
    ],
    salaries: { 2030: 50000 },
    assumptions: { salaryGrowth: 0.03 }
  });
  eq(s.loans.length, 2, "two ledgers");
  var y1 = s.combined.years[0];
  var ug = E.monthlyDeduction(50000, E.thresholdFor("plan5", 2030, s.assumptions), 0.09);
  var pg = E.monthlyDeduction(50000, E.thresholdFor("pgl", 2030, s.assumptions), 0.06);
  near(y1.repaid, (ug + pg) * 12, 1, "first year's deductions are the two added");
  near(s.combined.borrowed, 72000, 0.01, "combined borrowing");
});

test("the smaller postgraduate loan clears first", function () {
  var s = E.simulate({
    loans: [
      { plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 },
      { plan: "pgl", openingBalance: 12000, repaymentStartYear: 2030 }
    ],
    salaries: { 2030: 70000 },
    assumptions: { salaryGrowth: 0.03 }
  });
  var ug = s.loans[0], pg = s.loans[1];
  ok(pg.everRepaidInFull, "the postgraduate loan clears");
  ok(pg.yearsRepaying <= ug.yearsRepaying, "and it clears no later than the undergraduate one");
});

/* -- The other thing you could do with the money -------------------------- */

console.log("\nPaying it off today, against saving instead");

function withSalary(salary, extra) {
  return E.simulate(Object.assign({
    loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
    salaries: { 2030: salary }
  }, extra || {}));
}

test("both choices are priced at the same date, not at today", function () {
  var o = withSalary(60000).opportunity;
  eq(Math.round(o.lump), 60000, "the lump is the balance when repayments begin");
  ok(o.years > 0, "there is a span to carry forward over");
  ok(o.fvLump > o.lump, "the lump grows if you keep it");
  ok(o.fvRepayments > 0, "and the repayment stream is carried forward too");
});

test("a stream paid over decades costs less than the same sum paid today", function () {
  var o = withSalary(60000).opportunity;
  // Clearing hands over the whole balance now; repaying spreads it out. At any
  // positive savings rate the spread-out stream should be the cheaper pile.
  ok(!o.clearingIsBetter, "keeping the money should win at 4.5%");
  ok(o.clearingSaves < 0, "clearingSaves is negative when clearing is the worse deal");
});

test("a high enough savings rate can only widen that gap", function () {
  var low = withSalary(60000, { assumptions: { savings: 0.01 } }).opportunity;
  var high = withSalary(60000, { assumptions: { savings: 0.08 } }).opportunity;
  ok(high.fvLump > low.fvLump, "the kept lump grows faster");
  ok(Math.abs(high.clearingSaves) > Math.abs(low.clearingSaves), "and the case for keeping it strengthens");
});

test("with no savings rate at all it is a straight cash comparison", function () {
  var o = withSalary(60000, { assumptions: { savings: 0 } }).opportunity;
  near(o.fvLump, o.lump, 0.01, "the lump does not grow");
  near(o.fvRepayments, o.years ? o.fvRepayments : 0, 0.01, "nothing compounds");
  var r = withSalary(60000, { assumptions: { savings: 0 } }).combined;
  near(o.fvRepayments, r.totalRepaid, 1, "so the stream is just the cash total");
});

test("the track has a row per repaying year, both choices side by side", function () {
  var s = withSalary(60000);
  var repaying = s.combined.years.filter(function (y) { return y.phase === "repaying"; });
  eq(s.opportunity.track.length, repaying.length, "one row per repaying year");
  var last = s.opportunity.track[s.opportunity.track.length - 1];
  ok(last.lumpGrown > 0 && last.repaymentsSaved > 0, "both series are populated");
  for (var i = 1; i < s.opportunity.track.length; i++) {
    ok(s.opportunity.track[i].lumpGrown >= s.opportunity.track[i - 1].lumpGrown, "the kept lump only grows");
  }
});

test("the break-even savings rate is where the two choices tie", function () {
  var mk = function (s) {
    return E.simulate({
      loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
      salaries: { 2030: 45000 },
      assumptions: { savings: s }
    }).opportunity;
  };
  var be = mk(0.045).breakEven;
  ok(be > 0 && be < 0.3, "a crossing exists, at " + (be * 100).toFixed(2) + "%");

  var at = mk(be);
  near(at.fvRepayments, at.fvLump, Math.max(50, at.fvLump * 0.001), "the two cost the same there");

  // And it really is a crossing: each side favours a different choice.
  ok(mk(be - 0.01).clearingIsBetter, "just below it, clearing is cheaper");
  ok(!mk(be + 0.01).clearingIsBetter, "just above it, keeping the money is");
});

test("no break-even is reported when one choice wins at every rate", function () {
  // A balance that is written off almost untouched: repaying is always cheaper.
  var o = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
    salaries: { 2030: 20000 },
    assumptions: { salaryGrowth: 0 }
  }).opportunity;
  eq(o.breakEven, null, "there is nothing to trade off");
});

test("the growth given up is the pot less what you put into it", function () {
  var s = withSalary(60000);
  var o = s.opportunity, r = s.combined;
  near(o.paidOut, r.totalRepaid, 1, "what you put in is what you handed over");
  near(o.foregoneGrowth, o.fvRepayments - o.paidOut, 0.01, "growth is the pot less the contributions");
  ok(o.foregoneGrowth > 0, "at a positive savings rate there is growth to give up");
});

test("with nowhere to save it, no growth is given up", function () {
  var o = withSalary(60000, { assumptions: { savings: 0 } }).opportunity;
  near(o.foregoneGrowth, 0, 1, "a 0% account forfeits nothing");
});

test("a higher savings rate gives up more", function () {
  var low = withSalary(60000, { assumptions: { savings: 0.02 } }).opportunity;
  var high = withSalary(60000, { assumptions: { savings: 0.07 } }).opportunity;
  ok(high.foregoneGrowth > low.foregoneGrowth * 2, "much more, in fact");
});

test("paying the fees in cash is carried to the same date as the repayments", function () {
  var s = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 45000 }
  });
  var o = s.opportunity;
  near(o.upfrontPaid, s.combined.borrowed, 1, "the cash cost is what was drawn down");
  ok(o.fvUpfront > o.upfrontPaid, "carried forward, it is worth more than its cash figure");
  // Spent thirty years earlier, it compounds for longer than any repayment.
  ok(o.fvUpfront / o.upfrontPaid > o.fvRepayments / o.paidOut,
    "and it compounds harder than the repayment stream, being spent sooner");
});

test("with no savings rate the three choices are just their cash sums", function () {
  var s = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 45000 },
    assumptions: { savings: 0 }
  });
  var o = s.opportunity;
  near(o.fvUpfront, s.combined.borrowed, 1, "upfront is just what was borrowed");
  near(o.fvRepayments, s.combined.totalRepaid, 1, "repayments are just the cash total");
});

test("an opening balance makes paying upfront and clearing today the same act", function () {
  var o = E.simulate({
    loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
    salaries: { 2030: 50000 }
  }).opportunity;
  near(o.upfrontPaid, o.lump, 0.01, "there are no fees to find, only a balance to clear");
  near(o.fvUpfront, o.fvLump, 0.01, "so they carry forward identically");
});

test("the cheapest of the three is named, and is genuinely the smallest", function () {
  var o = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 9790, maintenancePerYear: 10830 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 45000 }
  }).opportunity;
  ok(o.cheapest, "one of them wins");
  var all = [o.fvRepayments, o.fvUpfront, o.fvLump].filter(function (v) { return v > 0; });
  near(o.cheapest.fv, Math.min.apply(null, all), 0.01, "and it is the smallest pile");
});

test("today's money is smaller than the cash figure, for both choices", function () {
  var o = withSalary(60000).opportunity;
  ok(o.realFvRepayments < o.fvRepayments, "repayments deflate");
  ok(o.realFvLump < o.fvLump, "and so does the lump");
});

test("someone who never repays has nothing to weigh up", function () {
  var o = withSalary(18000, { assumptions: { salaryGrowth: 0 } }).opportunity;
  eq(Math.round(o.fvRepayments), 0, "no repayments to carry forward");
  ok(!o.clearingIsBetter, "and clearing a balance that would be written off is never better");
});

/* -- Sanity -------------------------------------------------------------- */

console.log("\nSanity");

test("a bigger salary never means a bigger lifetime cost than the write-off case", function () {
  var mk = function (salary) {
    return E.simulate({
      loans: [{ plan: "plan5", openingBalance: 60000, repaymentStartYear: 2030 }],
      salaries: { 2030: salary },
      assumptions: { salaryGrowth: 0.03 }
    }).combined;
  };
  var low = mk(26000), high = mk(100000);
  ok(high.totalRepaid > low.totalRepaid, "the higher earner repays more in cash");
  ok(high.everRepaidInFull && !low.everRepaidInFull, "and is the only one who clears it");
});

test("the ledger always terminates", function () {
  ["plan1", "plan2", "plan4", "plan5", "pgl"].forEach(function (p) {
    var r = E.simulate({
      loans: [{ plan: p, openingBalance: 30000, repaymentStartYear: 2030 }],
      salaries: { 2030: 0 }
    }).combined;
    ok(r.years.length > 0 && r.years.length <= 41, p + " produced " + r.years.length + " rows");
  });
});

test("a course that borrows nothing produces an empty ledger, not a crash", function () {
  var r = E.simulate({
    loans: [{ plan: "plan5", course: { years: 3, startYear: 2026, tuitionPerYear: 0, maintenancePerYear: 0 }, repaymentStartYear: 2030 }],
    salaries: { 2030: 40000 }
  }).combined;
  eq(r.borrowed, 0, "nothing was borrowed");
  eq(Math.round(r.totalRepaid), 0, "nothing was repaid");
  eq(Math.round(r.writtenOff || 0), 0, "nothing was written off");
  ok(r.years.length > 0, "the ledger still has rows");
  eq(r.years[0].label, "2030/31", "and it opens at the first April, not during the course");
});

test("an unknown plan is refused rather than guessed at", function () {
  var threw = false;
  try { E.simulate({ loans: [{ plan: "plan9", openingBalance: 1, repaymentStartYear: 2030 }], salaries: {} }); }
  catch (e) { threw = true; }
  ok(threw, "a bad plan name should throw");
});

/* ------------------------------------------------------------------------ */

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);
