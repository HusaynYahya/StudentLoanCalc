/* ============================================================================
   UK STUDENT LOAN REPAYMENT ENGINE
   ----------------------------------------------------------------------------
   A pure simulation: rules and circumstances in, a month-by-month ledger out.
   No DOM, no globals beyond the single export, so it runs in the browser and
   under `node` alike (see test/engine.test.js).

   Every figure that the government changes each April lives in RULES or in the
   `assumptions` block of a scenario, never buried in the arithmetic.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LoanEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   * THE RULES
   *
   * Thresholds are the 2026/27 figures, which apply from 6 April 2026.
   * Interest is expressed as a recipe over the assumptions (RPI, the Bank
   * base rate) rather than as a number, because that is how the law states
   * it — the number changes every September.
   * -------------------------------------------------------------------- */

  var BASE_TAX_YEAR = 2026; // the tax year beginning 6 April 2026

  var RULES = {
    plan1: {
      label: "Plan 1",
      blurb: "England or Wales, course started before 1 September 2012; or Northern Ireland.",
      rate: 0.09,
      threshold: 26900,
      // Frozen until April of this year (exclusive). null = uprated every year.
      thresholdFrozenUntil: null,
      writeOffYears: 25,
      writeOffNote: "25 years after the April you were first due to repay.",
      interest: "lowerOfRpiAndBase",
      studyInterest: "lowerOfRpiAndBase"
    },
    plan2: {
      label: "Plan 2",
      blurb: "England or Wales, course started between 1 September 2012 and 31 July 2023.",
      rate: 0.09,
      threshold: 29385,
      thresholdFrozenUntil: 2030, // frozen April 2027 → April 2030
      upperThreshold: 49130,      // top of the interest sliding scale
      writeOffYears: 30,
      writeOffNote: "30 years after the April you were first due to repay.",
      interest: "slidingScale",
      studyInterest: "rpiPlus3"
    },
    plan4: {
      label: "Plan 4",
      blurb: "Scotland (SAAS).",
      rate: 0.09,
      threshold: 33795,
      thresholdFrozenUntil: null,
      writeOffYears: 30,
      writeOffNote: "30 years after the April you were first due to repay.",
      interest: "lowerOfRpiAndBase",
      studyInterest: "lowerOfRpiAndBase"
    },
    plan5: {
      label: "Plan 5",
      blurb: "England, course started on or after 1 August 2023. Most of today's undergraduates.",
      rate: 0.09,
      threshold: 25000,
      thresholdFrozenUntil: 2027, // frozen until April 2027, then uprated
      writeOffYears: 40,
      writeOffNote: "40 years after the April you were first due to repay.",
      interest: "rpi",
      studyInterest: "rpi"
    },
    pgl: {
      label: "Postgraduate Loan",
      blurb: "Master's or doctoral loan. Repaid alongside an undergraduate plan, not instead of it.",
      rate: 0.06,
      threshold: 21000,
      // Frozen since postgraduate loans began in 2016 and never once uprated,
      // with no end date announced — so it is modelled as staying put, unlike
      // the Plan 2 and Plan 5 freezes which have dates attached.
      thresholdFrozenUntil: Infinity,
      writeOffYears: 30,
      writeOffNote: "30 years after the April you were first due to repay.",
      interest: "rpiPlus3",
      studyInterest: "rpiPlus3"
    }
  };

  var DEFAULT_ASSUMPTIONS = {
    rpi: 0.041,               // March 2026 RPI, sets rates from 1 Sep 2026
    bankBase: 0.0375,         // Bank of England base rate
    interestCap: 0.06,        // "prevailing market rate" cap, in force to Aug 2027
    interestCapUntil: 2027,   // the last tax year that cap has been announced for
    thresholdGrowth: 0.036,   // how fast thresholds rise once unfrozen
    salaryGrowth: 0.03,       // used only to extend a salary line past its last entry
    inflation: 0.041,         // used to restate the ledger in today's money
    savings: 0.045            // what the money would earn if you kept it instead
  };

  /* ---------------------------------------------------------------------- *
   * SMALL HELPERS
   * -------------------------------------------------------------------- */

  // An absolute month index, so arithmetic across year boundaries is trivial.
  function ym(year, month) { return year * 12 + (month - 1); }
  function yearOf(i) { return Math.floor(i / 12); }
  function monthOf(i) { return (i % 12) + 1; }

  // The UK tax year runs 6 April → 5 April. The tax year "2030/31" begins in
  // April 2030, so any month before April belongs to the previous one.
  function taxYearOf(i) {
    return monthOf(i) >= 4 ? yearOf(i) : yearOf(i) - 1;
  }
  function taxYearLabel(y) {
    return y + "/" + String((y + 1) % 100).padStart(2, "0");
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  /* ---------------------------------------------------------------------- *
   * THRESHOLDS
   *
   * The published figure applies to 2026/27. Earlier years are not modelled
   * (nobody is simulating the past); later years are uprated once any freeze
   * has expired.
   * -------------------------------------------------------------------- */

  function upratedThreshold(base, plan, taxYear, growth) {
    if (taxYear <= BASE_TAX_YEAR) return base;
    var frozenUntil = plan.thresholdFrozenUntil;
    var risenYears;
    if (frozenUntil == null) {
      risenYears = taxYear - BASE_TAX_YEAR;          // uprated every April
    } else if (taxYear < frozenUntil) {
      risenYears = 0;                                // still inside the freeze
    } else {
      risenYears = taxYear - frozenUntil + 1;        // the freeze has expired
    }
    return base * Math.pow(1 + growth, Math.max(0, risenYears));
  }

  function thresholdFor(planKey, taxYear, a) {
    var plan = RULES[planKey];
    return upratedThreshold(plan.threshold, plan, taxYear, a.thresholdGrowth);
  }

  function upperThresholdFor(planKey, taxYear, a) {
    var plan = RULES[planKey];
    if (!plan.upperThreshold) return null;
    return upratedThreshold(plan.upperThreshold, plan, taxYear, a.thresholdGrowth);
  }

  /* ---------------------------------------------------------------------- *
   * INTEREST
   *
   * `recipe` is the string named in RULES. Income only matters for Plan 2's
   * sliding scale, and only once you have left the course.
   * -------------------------------------------------------------------- */

  function interestRate(recipe, opts) {
    var a = opts.assumptions;
    var r;
    switch (recipe) {
      case "rpi":
        r = a.rpi;
        break;
      case "rpiPlus3":
        r = a.rpi + 0.03;
        break;
      case "lowerOfRpiAndBase":
        r = Math.min(a.rpi, a.bankBase + 0.01);
        break;
      case "slidingScale": {
        var lo = opts.threshold, hi = opts.upperThreshold;
        var frac = hi > lo ? clamp((opts.income - lo) / (hi - lo), 0, 1) : 0;
        r = a.rpi + 0.03 * frac;
        break;
      }
      default:
        r = a.rpi;
    }
    // The "prevailing market rate" cap is announced a year at a time. Past
    // the year it has been announced for, the statutory rate stands.
    var capLives = a.interestCapUntil == null || opts.taxYear == null
      || opts.taxYear <= a.interestCapUntil;
    if (a.interestCap != null && capLives) r = Math.min(r, a.interestCap);
    return Math.max(r, 0);
  }

  /* ---------------------------------------------------------------------- *
   * WHAT IS DEDUCTED FROM A MONTH'S PAY
   *
   * PAYE looks at the pay period in isolation, not the year: 9% of whatever
   * that month's gross pay exceeds a twelfth of the annual threshold, rounded
   * down to a whole pound.
   * -------------------------------------------------------------------- */

  function monthlyDeduction(annualSalary, annualThreshold, rate) {
    var pay = annualSalary / 12;
    var thr = annualThreshold / 12;
    if (pay <= thr) return 0;
    return Math.floor((pay - thr) * rate);
  }

  /* ---------------------------------------------------------------------- *
   * BORROWING
   *
   * Student Finance pays in three instalments an academic year: tuition goes
   * to the university 25% / 25% / 50%, maintenance reaches the student in
   * three roughly equal parts. Interest runs from the first instalment, which
   * is why a three-year course already owes more than it borrowed on
   * graduation day.
   * -------------------------------------------------------------------- */

  function drawdownSchedule(course) {
    var rows = [];
    var tuitionSplit = [0.25, 0.25, 0.5];
    var maintSplit = [1 / 3, 1 / 3, 1 / 3];
    for (var i = 0; i < course.years; i++) {
      var acadStart = course.startYear + i;
      var months = [ym(acadStart, 9), ym(acadStart + 1, 1), ym(acadStart + 1, 4)];
      var tuition = course.tuitionPerYear[i] != null ? course.tuitionPerYear[i] : course.tuitionPerYear;
      var maint = course.maintenancePerYear[i] != null ? course.maintenancePerYear[i] : course.maintenancePerYear;
      for (var t = 0; t < 3; t++) {
        var amount = (Number(tuition) || 0) * tuitionSplit[t] + (Number(maint) || 0) * maintSplit[t];
        if (amount > 0) rows.push({ month: months[t], amount: amount, academicYear: i + 1 });
      }
    }
    return rows;
  }

  /* ---------------------------------------------------------------------- *
   * THE SALARY LINE
   *
   * `salaries` is a sparse map of tax year → gross annual salary. Years before
   * the first entry take the first value; years after the last one grow at the
   * assumed rate, so a ledger that runs to a 40-year write-off never runs out
   * of income to test against.
   * -------------------------------------------------------------------- */

  function salaryLine(salaries, a) {
    var years = Object.keys(salaries).map(Number).sort(function (x, y) { return x - y; });
    if (!years.length) return function () { return 0; };
    var first = years[0], last = years[years.length - 1];
    return function (taxYear) {
      if (taxYear <= first) return Number(salaries[first]) || 0;
      if (salaries[taxYear] != null) return Number(salaries[taxYear]) || 0;
      if (taxYear > last) {
        return (Number(salaries[last]) || 0) * Math.pow(1 + a.salaryGrowth, taxYear - last);
      }
      // A gap between two given years: hold the last stated figure.
      for (var i = years.length - 1; i >= 0; i--) {
        if (years[i] < taxYear) return Number(salaries[years[i]]) || 0;
      }
      return 0;
    };
  }

  /* ---------------------------------------------------------------------- *
   * ONE LOAN, MONTH BY MONTH
   * -------------------------------------------------------------------- */

  function simulateLoan(loan, ctx) {
    var plan = RULES[loan.plan];
    if (!plan) throw new Error("Unknown plan: " + loan.plan);

    var a = ctx.assumptions;
    var salaryAt = ctx.salaryAt;

    // When does the first instalment land, and when do repayments begin?
    var draws = loan.openingBalance != null ? [] : drawdownSchedule(loan.course);
    // A course with no tuition and no maintenance draws nothing down; the
    // ledger then simply starts at the first April, with nothing in it.
    var firstMonth = (loan.openingBalance != null || !draws.length)
      ? ym(loan.repaymentStartYear, 4)
      : draws[0].month;
    var repayStart = ym(loan.repaymentStartYear, 4);
    var writeOffAt = ym(loan.repaymentStartYear + plan.writeOffYears, 4);

    var balance = loan.openingBalance != null ? Number(loan.openingBalance) : 0;
    var borrowed = balance;
    var repaid = 0, interestTotal = 0, voluntaryTotal = 0;

    var months = [];
    var i = firstMonth;
    var cleared = null, writtenOff = null;
    var balanceAtRepayStart = null;

    // Repayments run from that first April up to, and including, the March
    // before the write-off anniversary — exactly `writeOffYears` years.
    var lastMonth = writeOffAt - 1;

    while (i <= lastMonth) {
      var tYear = taxYearOf(i);
      var inRepayment = i >= repayStart;
      var draw = 0;

      for (var d = 0; d < draws.length; d++) {
        if (draws[d].month === i) { draw += draws[d].amount; }
      }
      if (draw > 0) { balance += draw; borrowed += draw; }

      if (i === repayStart) balanceAtRepayStart = balance;

      var salary = inRepayment ? salaryAt(tYear) : 0;
      var threshold = thresholdFor(loan.plan, tYear, a);
      var upper = upperThresholdFor(loan.plan, tYear, a);

      var recipe = inRepayment ? plan.interest : plan.studyInterest;
      var rate = interestRate(recipe, {
        assumptions: a,
        income: salary,
        threshold: threshold,
        upperThreshold: upper,
        taxYear: tYear
      });

      var interest = balance > 0 ? balance * (rate / 12) : 0;
      balance += interest;
      interestTotal += interest;

      var payment = 0, voluntary = 0;
      if (inRepayment && balance > 0) {
        payment = monthlyDeduction(salary, threshold, plan.rate);
        if (loan.share != null) payment = payment * loan.share;
        payment = Math.min(payment, balance);
        balance -= payment;
        repaid += payment;

        if (balance > 0 && ctx.overpayment) {
          voluntary = Math.min(ctx.overpayment.monthly || 0, balance);
          var lump = (ctx.overpayment.lumpSums || []).filter(function (l) {
            return ym(Number(l.year), Number(l.month || 4)) === i;
          });
          for (var L = 0; L < lump.length; L++) voluntary += Number(lump[L].amount) || 0;
          voluntary = Math.min(voluntary, balance);
          balance -= voluntary;
          repaid += voluntary;
          voluntaryTotal += voluntary;
        }
      }

      months.push({
        month: i,
        year: yearOf(i),
        monthNo: monthOf(i),
        taxYear: tYear,
        phase: inRepayment ? "repaying" : "studying",
        drawdown: draw,
        salary: salary,
        threshold: threshold,
        rate: rate,
        interest: interest,
        payment: payment,
        voluntary: voluntary,
        balance: balance
      });

      if (inRepayment && balance <= 0.005 && cleared === null) {
        balance = 0;
        cleared = i;
        break;
      }
      i++;
    }

    if (cleared === null) {
      writtenOff = balance;
      balance = 0;
    }

    return summarise({
      key: loan.key || loan.plan,
      plan: loan.plan,
      planLabel: plan.label,
      months: months,
      borrowed: borrowed,
      repaid: repaid,
      interest: interestTotal,
      voluntary: voluntaryTotal,
      writtenOff: writtenOff,
      cleared: cleared,
      repayStart: repayStart,
      writeOffAt: writeOffAt,
      balanceAtRepayStart: balanceAtRepayStart == null ? borrowed : balanceAtRepayStart,
      assumptions: a
    });
  }

  /* ---------------------------------------------------------------------- *
   * THE LOG
   *
   * Months roll up into tax years, because that is the unit anyone actually
   * thinks in — and every row carries the running totals, so the log answers
   * "how much have I paid off by then?" at a glance.
   * -------------------------------------------------------------------- */

  function summarise(r) {
    var years = [];
    var byYear = {};
    var order = [];

    r.months.forEach(function (m) {
      if (!byYear[m.taxYear]) {
        byYear[m.taxYear] = {
          taxYear: m.taxYear,
          label: taxYearLabel(m.taxYear),
          phase: m.phase,
          openingBalance: m.balance - m.interest + m.payment + m.voluntary - m.drawdown,
          salary: m.salary,
          threshold: m.threshold,
          borrowed: 0, interest: 0, repaid: 0, voluntary: 0,
          rateHigh: m.rate, rateLow: m.rate,
          months: 0
        };
        order.push(m.taxYear);
      }
      var y = byYear[m.taxYear];
      y.borrowed += m.drawdown;
      y.interest += m.interest;
      y.repaid += m.payment;
      y.voluntary += m.voluntary;
      y.closingBalance = m.balance;
      y.salary = Math.max(y.salary, m.salary);
      y.threshold = m.threshold;
      y.rateHigh = Math.max(y.rateHigh, m.rate);
      y.rateLow = Math.min(y.rateLow, m.rate);
      y.months++;
      if (m.phase === "repaying") y.phase = "repaying";
    });

    var cumRepaid = 0, cumInterest = 0, cumBorrowed = 0;
    order.forEach(function (k) {
      var y = byYear[k];
      cumBorrowed += y.borrowed;
      cumInterest += y.interest;
      cumRepaid += y.repaid + y.voluntary;
      y.cumBorrowed = cumBorrowed;
      y.cumInterest = cumInterest;
      y.cumRepaid = cumRepaid;
      y.monthlyRepayment = y.phase === "repaying" && y.months ? (y.repaid / y.months) : 0;
      y.interestOutranPayments = y.phase === "repaying" && y.interest > (y.repaid + y.voluntary);
      years.push(y);
    });

    // Restate everything in today's money, so a 40-year projection means
    // something. Deflated to the tax year the simulation opens in.
    var baseYear = years.length ? years[0].taxYear : BASE_TAX_YEAR;
    var infl = r.assumptions.inflation;
    years.forEach(function (y) {
      var f = Math.pow(1 + infl, -(y.taxYear - baseYear));
      y.deflator = f;
      y.realClosingBalance = y.closingBalance * f;
      y.realRepaid = (y.repaid + y.voluntary) * f;
      y.realSalary = y.salary * f;
    });

    var totalRepaid = r.repaid;
    var realRepaid = years.reduce(function (s, y) { return s + y.realRepaid; }, 0);

    r.years = years;
    r.totalRepaid = totalRepaid;
    r.totalRealRepaid = realRepaid;
    r.totalInterest = r.interest;
    r.perPoundBorrowed = r.borrowed > 0 ? totalRepaid / r.borrowed : 0;
    r.clearedLabel = r.cleared != null ? taxYearLabel(taxYearOf(r.cleared)) : null;
    r.clearedMonth = r.cleared;
    r.writeOffLabel = taxYearLabel(taxYearOf(r.writeOffAt) - 1);
    r.everRepaidInFull = r.cleared != null;
    r.yearsRepaying = years.filter(function (y) { return y.phase === "repaying"; }).length;
    r.milestones = milestones(r);
    return r;
  }

  function milestones(r) {
    var out = [];
    var borrowedAtStart = r.balanceAtRepayStart;
    var seenHalf = false, seenTurn = false, seenPeak = false;
    var peak = borrowedAtStart, peakYear = null;

    r.years.forEach(function (y) {
      if (y.closingBalance > peak) { peak = y.closingBalance; peakYear = y; }
    });

    var firstRepayYear = r.years.filter(function (y) { return y.phase === "repaying"; })[0];

    r.years.forEach(function (y) {
      if (y.phase !== "repaying") return;
      if (!seenTurn && (y.repaid + y.voluntary) > y.interest) {
        seenTurn = true;
        // If that is true from the very first year, the balance never grew and
        // there was no turning point to report.
        if (y !== firstRepayYear) {
          out.push({
            year: y.label,
            kind: "turn",
            text: "Repayments overtake interest for the first time — the balance starts to fall."
          });
        }
      }
      if (!seenHalf && borrowedAtStart > 0 && y.cumRepaid >= borrowedAtStart / 2) {
        seenHalf = true;
        out.push({
          year: y.label,
          kind: "half",
          text: "Total repaid passes half of what was owed when repayments began."
        });
      }
    });

    if (peakYear && peak > borrowedAtStart * 1.0001) {
      out.unshift({
        year: peakYear.label,
        kind: "peak",
        text: "The balance peaks at " + money(peak) + " — interest is still outrunning the deductions."
      });
    }
    if (!seenTurn && r.yearsRepaying > 0) {
      out.push({
        year: "—",
        kind: "never",
        text: "Repayments never overtake interest. The balance grows every year until it is written off."
      });
    }
    if (r.cleared != null) {
      out.push({
        year: taxYearLabel(taxYearOf(r.cleared)),
        kind: "cleared",
        text: "Cleared in full — " + money(r.totalRepaid) + " repaid on " + money(r.borrowed) + " borrowed."
      });
    } else {
      out.push({
        year: r.writeOffLabel,
        kind: "writtenOff",
        text: "Written off with " + money(r.writtenOff) + " outstanding, after " + r.yearsRepaying + " years of repayments."
      });
    }
    return out;
  }

  function money(n) {
    return "£" + Math.round(n).toLocaleString("en-GB");
  }

  /* ---------------------------------------------------------------------- *
   * THE OTHER THING YOU COULD DO WITH THE MONEY
   *
   * Two choices, priced at the same date so they can be compared honestly:
   *
   *   Repay as required  — hand over the stream of deductions.
   *   Clear it today     — hand over the whole balance now, then pay nothing.
   *
   * The second looks cheaper because the number is smaller, but money paid
   * today is worth more than money paid in 2060. So both are carried forward
   * to the year the loan ends at the savings rate: whichever is the smaller
   * pile at that date is the one that actually cost less.
   *
   * Payments are treated as falling mid-year, which is what a stream of twelve
   * monthly deductions averages out to.
   * -------------------------------------------------------------------- */

  // Both choices, carried to `endYear` at savings rate `s`. Separated out so
  // the break-even search can run it many times without re-simulating.
  function fvAt(r, s) {
    var repaying = r.years.filter(function (y) { return y.phase === "repaying"; });
    if (!repaying.length) return null;

    var startYear = repaying[0].taxYear;
    var endYear = repaying[repaying.length - 1].taxYear + 1;
    var span = endYear - startYear;
    var lump = r.balanceAtRepayStart || 0;

    var fvRepayments = 0, paidOut = 0;
    repaying.forEach(function (y) {
      var paid = y.repaid + y.voluntary;
      paidOut += paid;
      fvRepayments += paid * Math.pow(1 + s, Math.max(0, endYear - y.taxYear - 0.5));
    });

    var upfrontPaid = 0, fvUpfront = 0;
    r.years.forEach(function (y) {
      if (!(y.borrowed > 0)) return;
      upfrontPaid += y.borrowed;
      fvUpfront += y.borrowed * Math.pow(1 + s, Math.max(0, endYear - y.taxYear - 0.5));
    });

    var fvLump = lump * Math.pow(1 + s, span);
    if (upfrontPaid <= 0) { upfrontPaid = lump; fvUpfront = fvLump; }

    return { startYear: startYear, endYear: endYear, span: span, lump: lump,
             fvRepayments: fvRepayments, paidOut: paidOut,
             upfrontPaid: upfrontPaid, fvUpfront: fvUpfront, fvLump: fvLump };
  }

  /* The savings rate at which repaying as required and clearing the balance
     today cost exactly the same. Below it, clearing wins; above it, keeping
     the money does. Returned as null when one choice wins at every rate. */
  function breakEvenSavings(r) {
    var f = function (s) {
      var v = fvAt(r, s);
      return v ? v.fvRepayments - v.fvLump : 0;
    };
    var lo = 0, hi = 0.30;
    var flo = f(lo), fhi = f(hi);
    if (!isFinite(flo) || !isFinite(fhi) || flo === 0) return null;
    if (flo > 0 === fhi > 0) return null;             // no crossing in range
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (f(mid) > 0 === flo > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function opportunity(r, opts) {
    var s = opts && opts.savings != null ? opts.savings : 0.045;
    var infl = opts && opts.inflation != null ? opts.inflation : DEFAULT_ASSUMPTIONS.inflation;

    var repaying = r.years.filter(function (y) { return y.phase === "repaying"; });
    if (!repaying.length) {
      return { lump: r.balanceAtRepayStart || 0, years: 0, savingsRate: s,
               fvRepayments: 0, fvLump: r.balanceAtRepayStart || 0,
               paidOut: 0, foregoneGrowth: 0, realForegoneGrowth: 0,
               upfrontPaid: 0, fvUpfront: 0, realFvUpfront: 0, cheapest: null, breakEven: null,
               clearingSaves: -(r.balanceAtRepayStart || 0), clearingIsBetter: false,
               realFvRepayments: 0, realFvLump: r.balanceAtRepayStart || 0,
               realClearingSaves: -(r.balanceAtRepayStart || 0), track: [] };
    }

    var startYear = repaying[0].taxYear;
    var endYear = repaying[repaying.length - 1].taxYear + 1;   // the loan is done by here
    var span = endYear - startYear;
    var lump = r.balanceAtRepayStart || 0;

    var fvRepayments = 0, track = [], running = 0;
    repaying.forEach(function (y) {
      var paid = y.repaid + y.voluntary;
      var carried = Math.max(0, endYear - y.taxYear - 0.5);
      fvRepayments += paid * Math.pow(1 + s, carried);

      // What the two choices are worth as the years pass, for the chart.
      running = running * (1 + s) + paid * Math.pow(1 + s, 0.5);
      track.push({
        taxYear: y.taxYear,
        label: y.label,
        repaymentsSaved: running,                                  // the stream, compounding
        lumpGrown: lump * Math.pow(1 + s, y.taxYear - startYear + 1) // the balance, left to grow
      });
    });

    var deflate = Math.pow(1 + infl, -span);

    // What the repayments would have earned on top of themselves had they gone
    // into a savings account instead: the pot, less what you actually put in.
    // This is the growth forfeited, not the money — that you were always going
    // to part with.
    var fvLump = lump * Math.pow(1 + s, span);
    var paidOut = repaying.reduce(function (t, y) { return t + y.repaid + y.voluntary; }, 0);
    var foregoneGrowth = fvRepayments - paidOut;

    // The third life: never borrow, and find the fees in cash while you study.
    // That money leaves your hands decades before any repayment does, so to
    // compare it fairly it has to be carried to the same date as the rest.
    var upfrontPaid = 0, fvUpfront = 0;
    r.years.forEach(function (y) {
      if (!(y.borrowed > 0)) return;
      upfrontPaid += y.borrowed;
      fvUpfront += y.borrowed * Math.pow(1 + s, Math.max(0, endYear - y.taxYear - 0.5));
    });
    if (upfrontPaid <= 0) {
      // No drawdowns to find — the scenario opened with a balance, so paying
      // your own way and clearing it today are the same act.
      upfrontPaid = lump;
      fvUpfront = fvLump;
    }

    return {
      lump: lump,
      years: span,
      savingsRate: s,
      fvRepayments: fvRepayments,
      fvLump: fvLump,
      paidOut: paidOut,
      upfrontPaid: upfrontPaid,
      fvUpfront: fvUpfront,
      realFvUpfront: fvUpfront * deflate,
      // Cheapest of the three, priced at the same date.
      cheapest: (function () {
        var opts = [
          { key: "repay", label: "borrow and repay", fv: fvRepayments },
          { key: "upfront", label: "pay the fees in cash", fv: fvUpfront },
          { key: "clear", label: "clear the balance today", fv: fvLump }
        ].filter(function (o) { return o.fv > 0; });
        opts.sort(function (a, b) { return a.fv - b.fv; });
        return opts.length ? opts[0] : null;
      })(),
      breakEven: breakEvenSavings(r),
      foregoneGrowth: foregoneGrowth,
      realForegoneGrowth: foregoneGrowth * deflate,
      // Positive means clearing the balance today was the cheaper of the two.
      clearingSaves: fvRepayments - fvLump,
      clearingIsBetter: fvRepayments > fvLump,
      realFvRepayments: fvRepayments * deflate,
      realFvLump: fvLump * deflate,
      realClearingSaves: (fvRepayments - fvLump) * deflate,
      track: track
    };
  }

  /* ---------------------------------------------------------------------- *
   * PUBLIC ENTRY POINT
   * -------------------------------------------------------------------- */

  function simulate(scenario) {
    var a = Object.assign({}, DEFAULT_ASSUMPTIONS, scenario.assumptions || {});
    var salaryAt = salaryLine(scenario.salaries || {}, a);
    var ctx = { assumptions: a, salaryAt: salaryAt, overpayment: scenario.overpayment };

    var results = (scenario.loans || []).map(function (loan) {
      return simulateLoan(loan, ctx);
    });

    var combined = combine(results, a);
    return {
      loans: results,
      combined: combined,
      opportunity: opportunity(combined, {
        savings: a.savings,
        inflation: a.inflation
      }),
      assumptions: a
    };
  }

  // Two loans repaid at once (an undergraduate plan plus a postgraduate loan)
  // are deducted from the same pay independently, so the ledgers simply add.
  function combine(results, a) {
    if (!results.length) return null;
    if (results.length === 1) return results[0];

    var byYear = {};
    var order = [];
    results.forEach(function (r) {
      r.years.forEach(function (y) {
        if (!byYear[y.taxYear]) {
          byYear[y.taxYear] = {
            taxYear: y.taxYear, label: y.label, phase: y.phase,
            salary: y.salary, threshold: null, rateLow: null, rateHigh: null,
            openingBalance: 0, closingBalance: 0,
            borrowed: 0, interest: 0, repaid: 0, voluntary: 0, months: y.months
          };
          order.push(y.taxYear);
        }
        var t = byYear[y.taxYear];
        if (t.threshold == null) t.threshold = y.threshold;
        t.rateLow = t.rateLow == null ? y.rateLow : Math.min(t.rateLow, y.rateLow);
        t.rateHigh = t.rateHigh == null ? y.rateHigh : Math.max(t.rateHigh, y.rateHigh);
        t.openingBalance += y.openingBalance;
        t.closingBalance += y.closingBalance;
        t.borrowed += y.borrowed;
        t.interest += y.interest;
        t.repaid += y.repaid;
        t.voluntary += y.voluntary;
        t.salary = Math.max(t.salary, y.salary);
        if (y.phase === "repaying") t.phase = "repaying";
      });
    });

    order.sort(function (x, y) { return x - y; });
    var cumRepaid = 0, cumInterest = 0, cumBorrowed = 0;
    var years = order.map(function (k) {
      var y = byYear[k];
      cumBorrowed += y.borrowed; cumInterest += y.interest;
      cumRepaid += y.repaid + y.voluntary;
      y.cumBorrowed = cumBorrowed; y.cumInterest = cumInterest; y.cumRepaid = cumRepaid;
      y.monthlyRepayment = y.months ? y.repaid / y.months : 0;
      y.interestOutranPayments = y.phase === "repaying" && y.interest > (y.repaid + y.voluntary);
      var f = Math.pow(1 + a.inflation, -(y.taxYear - order[0]));
      y.deflator = f;
      y.realClosingBalance = y.closingBalance * f;
      y.realRepaid = (y.repaid + y.voluntary) * f;
      y.realSalary = y.salary * f;
      return y;
    });

    var sum = function (f) { return results.reduce(function (s, r) { return s + f(r); }, 0); };
    var borrowed = sum(function (r) { return r.borrowed; });
    var repaid = sum(function (r) { return r.totalRepaid; });

    return {
      key: "combined",
      planLabel: results.map(function (r) { return r.planLabel; }).join(" + "),
      years: years,
      borrowed: borrowed,
      totalRepaid: repaid,
      totalRealRepaid: years.reduce(function (s, y) { return s + y.realRepaid; }, 0),
      totalInterest: sum(function (r) { return r.totalInterest; }),
      voluntary: sum(function (r) { return r.voluntary; }),
      writtenOff: sum(function (r) { return r.writtenOff || 0; }),
      balanceAtRepayStart: sum(function (r) { return r.balanceAtRepayStart; }),
      perPoundBorrowed: borrowed > 0 ? repaid / borrowed : 0,
      everRepaidInFull: results.every(function (r) { return r.everRepaidInFull; }),
      yearsRepaying: Math.max.apply(null, results.map(function (r) { return r.yearsRepaying; })),
      clearedLabel: results.every(function (r) { return r.everRepaidInFull; })
        ? results.map(function (r) { return r.clearedLabel; }).sort().pop() : null,
      writeOffLabel: results.map(function (r) { return r.writeOffLabel; }).sort().pop(),
      milestones: [],
      parts: results
    };
  }

  /* ---------------------------------------------------------------------- *
   * CONVENIENCES THE INTERFACE LEANS ON
   * -------------------------------------------------------------------- */

  // The April after a course of `years` starting in September `startYear`.
  function repaymentStartYear(startYear, years) {
    return startYear + years + 1;
  }

  return {
    RULES: RULES,
    DEFAULT_ASSUMPTIONS: DEFAULT_ASSUMPTIONS,
    BASE_TAX_YEAR: BASE_TAX_YEAR,
    simulate: simulate,
    simulateLoan: simulateLoan,
    opportunity: opportunity,
    breakEvenSavings: breakEvenSavings,
    thresholdFor: thresholdFor,
    upperThresholdFor: upperThresholdFor,
    interestRate: interestRate,
    monthlyDeduction: monthlyDeduction,
    drawdownSchedule: drawdownSchedule,
    salaryLine: salaryLine,
    repaymentStartYear: repaymentStartYear,
    taxYearLabel: taxYearLabel,
    taxYearOf: taxYearOf,
    ym: ym,
    money: money
  };
});
