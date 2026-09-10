/* ============================================================================
   STUDENT LOAN REPAYMENT SIMULATOR — the interface
   Reads the form, hands a scenario to engine.js, and draws the result.
   All the rules live in engine.js; nothing here decides anything about money.
   ========================================================================== */

(function () {
  "use strict";

  var E = window.LoanEngine;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = "ukloan.v1";

  /* ---------------------------------------------------------------------- *
   * CAREER PATHS
   *
   * Anchor salaries at given years of a career, in TODAY'S money — the curve
   * is real progression, and inflation is added on top when it is turned into
   * cash. Illustrative, not a forecast: they are starting points to edit.
   * -------------------------------------------------------------------- */

  var CAREERS = [
    { id: "custom", label: "Set it myself", note: "Type a starting salary and a rate of increase." },
    {
      id: "grad", label: "Graduate, typical",
      note: "Roughly the middle of the graduate labour market: a slow, steady climb.",
      points: { 1: 30000, 5: 38000, 10: 46000, 20: 56000 }, after: 0.005
    },
    {
      id: "tech", label: "Software and tech",
      note: "Fast early progression, flattening once you are senior.",
      points: { 1: 35000, 3: 48000, 6: 65000, 10: 80000, 20: 95000 }, after: 0.005
    },
    {
      id: "medicine", label: "Doctor (NHS)",
      note: "Foundation pay, then the training grades, then consultant. Five- or six-year course.",
      points: { 1: 38000, 3: 52000, 6: 66000, 9: 82000, 13: 110000, 20: 130000 }, after: 0.005
    },
    {
      id: "nursing", label: "Nursing and allied health",
      note: "Agenda for Change: Band 5 to Band 7 over a decade or so.",
      points: { 1: 31000, 4: 38000, 8: 46000, 15: 52000 }, after: 0.005
    },
    {
      id: "teaching", label: "Teaching",
      note: "The main pay scale, then the upper scale — most of the rise comes early.",
      points: { 1: 33000, 4: 42000, 8: 50000, 15: 56000 }, after: 0.005
    },
    {
      id: "law", label: "Law, outside the City",
      note: "Training contract, qualification, then partnership-track progression.",
      points: { 1: 28000, 3: 42000, 6: 58000, 10: 72000, 20: 90000 }, after: 0.005
    },
    {
      id: "citylaw", label: "Law or banking, City",
      note: "The top of the graduate market — a training contract or an analyst seat in the City.",
      points: { 1: 60000, 3: 95000, 6: 130000, 10: 165000, 18: 200000 }, after: 0.005
    },
    {
      id: "engineering", label: "Engineering",
      note: "Graduate scheme, chartership, then a long plateau.",
      points: { 1: 32000, 4: 42000, 8: 52000, 15: 62000 }, after: 0.005
    },
    {
      id: "finance", label: "Accountancy and finance",
      note: "Qualification at around three years is the step change.",
      points: { 1: 30000, 3: 42000, 6: 58000, 10: 75000, 20: 92000 }, after: 0.005
    },
    {
      id: "public", label: "Civil service and local government",
      note: "Predictable grades, modest ceiling.",
      points: { 1: 30000, 4: 37000, 8: 45000, 15: 52000 }, after: 0.005
    },
    {
      id: "creative", label: "Charity, arts and media",
      note: "Graduate-level work at below-graduate pay, with a low ceiling.",
      points: { 1: 26000, 4: 31000, 8: 36000, 15: 42000 }, after: 0.005
    },
    {
      id: "low", label: "Low or intermittent earnings",
      note: "Around or a little above the threshold, with long flat stretches.",
      points: { 1: 24000, 5: 27000, 10: 30000, 20: 34000 }, after: 0.005
    }
  ];

  var LIVING = [
    { id: "away", label: "Living away from home, outside London", max: 10830, min: 5048 },
    { id: "london", label: "Living away from home, in London", max: 14135, min: 7039 },
    { id: "home", label: "Living at home", max: 9118, min: 4013 },
    { id: "none", label: "No maintenance loan", max: 0, min: 0 }
  ];

  /* Real progression, in today's money, at year `k` of the career. */
  function careerReal(career, k) {
    var pts = Object.keys(career.points).map(Number).sort(function (a, b) { return a - b; });
    var first = pts[0], last = pts[pts.length - 1];
    if (k <= first) return career.points[first];
    if (k >= last) return career.points[last] * Math.pow(1 + career.after, k - last);
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (k >= a && k <= b) {
        var lo = career.points[a], hi = career.points[b];
        var t = (k - a) / (b - a);
        return lo * Math.pow(hi / lo, t); // geometric, so the curve reads smoothly
      }
    }
    return career.points[last];
  }

  /* ---------------------------------------------------------------------- *
   * STATE
   * -------------------------------------------------------------------- */

  var state = {
    loanMode: "course",      // "course" | "balance"
    incomeMode: "predict",   // "predict" | "manual"
    basis: "cash",           // "cash" | "real"
    manual: {},              // tax year → salary, once the user has edited
    manualYears: 12,
    hideZeros: false,
    openYears: {}
  };

  var lastSim = null;

  /* ---------------------------------------------------------------------- *
   * READING THE FORM
   * -------------------------------------------------------------------- */

  function num(id, fallback) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : (fallback || 0);
  }

  function assumptions() {
    return {
      rpi: num("rpi", 4.1) / 100,
      bankBase: num("bankBase", 3.75) / 100,
      thresholdGrowth: num("thresholdGrowth", 3) / 100,
      inflation: num("inflation", 4.1) / 100,
      // How a salary line is carried on past its last stated year.
      salaryGrowth: state.incomeMode === "manual"
        ? num("inflation", 4.1) / 100                       // holds its real value
        : ($("career").value === "custom"
          ? num("salaryGrowth", 4) / 100                    // the rate you typed
          : num("inflation", 4.1) / 100 + 0.005),           // inflation, plus a slow real rise
      interestCap: $("useCap").checked ? 0.06 : null,
      interestCapUntil: 2027
    };
  }

  function repayStartYear() {
    if (state.loanMode === "balance") return Math.round(num("repayStartYear", 2026));
    return E.repaymentStartYear(Math.round(num("startYear", 2026)), Math.round(num("courseYears", 3)));
  }

  /* The predicted salary line, in cash, keyed by tax year. */
  function predictedSalaries(a) {
    var start = repayStartYear();
    var out = {};
    var career = CAREERS.filter(function (c) { return c.id === $("career").value; })[0] || CAREERS[0];
    var n = Math.max(state.manualYears, 45);

    if (career.id === "custom") {
      var s = num("startSalary", 30000);
      var g = num("salaryGrowth", 4) / 100;
      for (var i = 0; i < n; i++) out[start + i] = s * Math.pow(1 + g, i);
    } else {
      for (var j = 0; j < n; j++) {
        // Real career progression, then inflation from today to that tax year.
        var real = careerReal(career, j + 1);
        out[start + j] = real * Math.pow(1 + a.inflation, start + j - E.BASE_TAX_YEAR);
      }
    }
    return out;
  }

  function salaries(a) {
    var predicted = predictedSalaries(a);
    if (state.incomeMode !== "manual") return predicted;
    var start = repayStartYear();
    var out = {};
    for (var i = 0; i < state.manualYears; i++) {
      var y = start + i;
      out[y] = state.manual[y] != null ? state.manual[y] : Math.round(predicted[y] || 0);
    }
    return out;
  }

  function scenario() {
    var a = assumptions();
    var planKey = $("plan").value;
    var start = repayStartYear();
    var loans = [];

    if (state.loanMode === "balance") {
      loans.push({ plan: planKey, openingBalance: num("openingBalance", 0), repaymentStartYear: start });
    } else {
      loans.push({
        plan: planKey,
        course: {
          years: Math.round(num("courseYears", 3)),
          startYear: Math.round(num("startYear", 2026)),
          tuitionPerYear: num("tuition", 0),
          maintenancePerYear: num("maintenance", 0)
        },
        repaymentStartYear: start
      });
    }

    if ($("hasPgl").checked) {
      loans.push({ plan: "pgl", openingBalance: num("pglBalance", 0), repaymentStartYear: start });
    }

    return {
      loans: loans,
      salaries: salaries(a),
      assumptions: a,
      overpayment: { monthly: num("overpay", 0) }
    };
  }

  /* ---------------------------------------------------------------------- *
   * FORMATTING
   * -------------------------------------------------------------------- */

  function gbp(n) {
    return "£" + Math.round(n).toLocaleString("en-GB");
  }
  function gbpShort(n) {
    var abs = Math.abs(n);
    if (abs >= 1e6) return "£" + (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "m";
    if (abs >= 1000) return "£" + Math.round(n / 1000) + "k";
    return "£" + Math.round(n);
  }
  function pct(n, dp) { return (n * 100).toFixed(dp == null ? 1 : dp) + "%"; }
  function ageAt(taxYear) {
    var b = parseInt($("birthYear").value, 10);
    if (!b || b < 1900) return "";
    return String(taxYear - b);
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------------------------------------------------------------------- *
   * DRAWING THE RESULT
   * -------------------------------------------------------------------- */

  function run() {
    var sc;
    try { sc = scenario(); } catch (e) { return; }
    var sim = E.simulate(sc);
    lastSim = sim;

    renderVerdict(sim);
    renderStats(sim);
    renderSensitivity(sim);
    renderChart(sim);
    renderMilestones(sim);
    renderLog(sim);
    renderSummaries(sim);
    save();
  }

  function renderVerdict(sim) {
    var r = sim.combined;
    var el = $("verdict");
    var plan = E.RULES[$("plan").value];
    var cleared = r.everRepaidInFull;
    var headline, body;

    if (r.borrowed <= 0) {
      el.className = "verdict";
      el.innerHTML = "<h3>Nothing borrowed, so nothing to repay.</h3>" +
        "<p>Set a tuition fee loan, a maintenance loan, or an opening balance above.</p>";
      return;
    }

    if (cleared) {
      headline = "Repaid in full in " + r.clearedLabel + ", after " + r.yearsRepaying +
        (r.yearsRepaying === 1 ? " year" : " years") + ".";
      body = "You borrowed " + gbp(r.borrowed) + " and handed back " + gbp(r.totalRepaid) +
        " — " + gbp(r.totalInterest) + " of that was interest. In today's money the repayments come to " +
        gbp(r.totalRealRepaid) + ". Nothing was written off; you paid the loan, not the graduate tax.";
    } else {
      headline = gbp(r.writtenOff) + " written off in " + r.writeOffLabel + ".";
      body = "You borrowed " + gbp(r.borrowed) + " and repaid " + gbp(r.totalRepaid) + " over " +
        r.yearsRepaying + " years — " + gbp(r.totalRealRepaid) + " in today's money — before the balance was " +
        "cancelled. On this income the size of the loan never mattered: " +
        "what you paid was set by your salary and the threshold, and would have been the same had you borrowed twice as much.";
    }

    el.className = "verdict" + (cleared ? "" : " is-writtenoff");
    el.innerHTML = "<h3>" + headline + "</h3><p>" + body + "</p>" +
      "<p>" + plan.label + ", " + pct(plan.rate, 0) + " of everything above " +
      gbp(E.thresholdFor($("plan").value, Math.max(E.BASE_TAX_YEAR, repayStartYear()), sim.assumptions)) +
      " a year, written off " + plan.writeOffNote.replace(/^\w/, function (c) { return c.toLowerCase(); }) + "</p>";
  }

  function renderStats(sim) {
    var r = sim.combined;
    var first = r.years.filter(function (y) { return y.phase === "repaying"; })[0];
    var peak = r.years.reduce(function (m, y) {
      return y.closingBalance > m ? y.closingBalance : m;
    }, r.balanceAtRepayStart);

    var stats = [
      { k: "Borrowed", v: gbp(r.borrowed), sub: state.loanMode === "course" ? "tuition and maintenance" : "opening balance" },
      { k: "Owed when repayment starts", v: gbp(r.balanceAtRepayStart), sub: "interest during the course" },
      { k: "First monthly payment", v: first ? gbp(first.monthlyRepayment) : "£0", sub: first ? "in " + first.label : "nothing is due" },
      { k: "Repaid in total", v: gbp(r.totalRepaid), sub: gbp(r.totalRealRepaid) + " in today's money", cls: "is-good" },
      { k: "Interest charged", v: gbp(r.totalInterest), sub: "over the whole term", cls: "is-warn" },
      { k: "Peak balance", v: gbp(peak), sub: peak > r.balanceAtRepayStart * 1.001 ? "the balance grew first" : "never grew" },
      r.everRepaidInFull
        ? { k: "Written off", v: "£0", sub: "cleared in " + r.clearedLabel, cls: "is-good" }
        : { k: "Written off", v: gbp(r.writtenOff), sub: "in " + r.writeOffLabel, cls: "is-bad" },
      { k: "Cost per £1 borrowed", v: "£" + r.perPoundBorrowed.toFixed(2), sub: "in cash terms" }
    ];

    $("stats").innerHTML = stats.map(function (s) {
      return '<dl class="stat ' + (s.cls || "") + '"><dt>' + s.k + "</dt><dd>" + s.v +
        '<span class="sub">' + s.sub + "</span></dd></dl>";
    }).join("");
  }

  /* ---- the chart -------------------------------------------------------- */

  /* ---- how much of the answer is the guess? ----------------------------- */

  function renderSensitivity(sim) {
    var base = scenario();
    var a = sim.assumptions;

    var runWith = function (override) {
      var sc = {
        loans: base.loans,
        salaries: base.salaries,
        overpayment: base.overpayment,
        assumptions: Object.assign({}, a, override)
      };
      var r = E.simulate(sc).combined;
      return {
        repaid: r.totalRepaid,
        real: r.totalRealRepaid,
        cleared: r.everRepaidInFull,
        when: r.everRepaidInFull ? r.clearedLabel : r.writeOffLabel,
        writtenOff: r.writtenOff || 0
      };
    };

    var rows = [
      {
        title: "If the thresholds rise by",
        why: "Below your pay rises, more of your salary falls above the threshold every year.",
        cases: [
          { label: pct(a.inflation - 0.01), o: { thresholdGrowth: a.inflation - 0.01 } },
          { label: pct(a.thresholdGrowth) + " — as set", o: {}, current: true },
          { label: pct(a.inflation) + " — with inflation", o: { thresholdGrowth: a.inflation } }
        ]
      },
      {
        title: "If RPI turns out to be",
        why: {
          plan5: "RPI sets the interest, and on Plan 5 nothing else does.",
          plan2: "RPI is the floor of Plan 2's sliding scale, which runs up to RPI + 3%.",
          plan1: "RPI sets the rate unless the base rate + 1% is lower, which caps it.",
          plan4: "RPI sets the rate unless the base rate + 1% is lower, which caps it."
        }[$("plan").value] || "RPI sets the interest rate.",
        cases: [
          { label: pct(Math.max(0, a.rpi - 0.015)), o: { rpi: Math.max(0, a.rpi - 0.015) } },
          { label: pct(a.rpi) + " — as set", o: {}, current: true },
          { label: pct(a.rpi + 0.015), o: { rpi: a.rpi + 0.015 } }
        ]
      }
    ];

    var html = "";
    rows.forEach(function (row) {
      html += "<tbody><tr class=\"sens-head\"><th colspan=\"3\" scope=\"colgroup\">" + row.title +
        " <span>" + row.why + "</span></th></tr><tr>";
      row.cases.forEach(function (c) {
        var res = runWith(c.o);
        html += "<td class=\"sens-cell" + (c.current ? " is-current" : "") + "\">" +
          "<span class=\"sens-if\">" + c.label + "</span>" +
          "<span class=\"sens-amt\">" + gbp(res.repaid) + "</span>" +
          "<span class=\"sens-note\">repaid — " +
          (res.cleared ? "cleared in " + res.when : gbp(res.writtenOff) + " written off in " + res.when) +
          "</span></td>";
      });
      html += "</tr></tbody>";
    });
    $("sensTable").innerHTML = html;
  }

  function renderChart(sim) {
    var years = sim.combined.years;
    var real = state.basis === "real";
    var W = 820, H = 300, ml = 54, mr = 12, mt = 14, mb = 30;
    var iw = W - ml - mr, ih = H - mt - mb;

    // Cumulative repaid in today's money is a sum of differently-deflated
    // payments, so it has to be accumulated rather than deflated at the end.
    var cumReal = 0;
    var series = years.map(function (y) {
      cumReal += y.realRepaid;
      return {
        label: y.label,
        taxYear: y.taxYear,
        balance: real ? y.realClosingBalance : y.closingBalance,
        repaid: real ? cumReal : y.cumRepaid,
        interest: real ? y.cumInterest * y.deflator : y.cumInterest
      };
    });

    var max = 0;
    series.forEach(function (p) { max = Math.max(max, p.balance, p.repaid, p.interest); });
    if (max <= 0) max = 1000;

    // Round the axis to 1, 2, 2.5 or 5 times a power of ten, so the labels read
    // as money rather than as whatever the data happened to reach.
    var rough = max / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var top = Math.ceil(max / step) * step;

    var x = function (i) { return ml + (series.length < 2 ? iw / 2 : (i / (series.length - 1)) * iw); };
    var y = function (v) { return mt + ih - (v / top) * ih; };

    var line = function (field) {
      return series.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[field]).toFixed(1); }).join(" ");
    };
    var area = function (field) {
      return line(field) + " L" + x(series.length - 1).toFixed(1) + " " + y(0) + " L" + x(0).toFixed(1) + " " + y(0) + " Z";
    };

    // Gridlines and money labels
    var grid = "", ticks = Math.round(top / step);
    for (var g = 0; g <= ticks; g++) {
      var v = step * g, gy = y(v);
      grid += '<line x1="' + ml + '" y1="' + gy.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + gy.toFixed(1) +
        '" stroke="var(--line-soft)" stroke-width="1"/>' +
        '<text x="' + (ml - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--ink-faint)">' +
        gbpShort(v) + "</text>";
    }

    // Year labels, thinned so they never collide
    var everyN = Math.max(1, Math.ceil(series.length / 9));
    var xlab = "";
    series.forEach(function (p, i) {
      if (i % everyN && i !== series.length - 1) return;
      xlab += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--ink-faint)">' +
        p.label.slice(0, 4) + "</text>";
    });

    // The moment the loan ends, marked on the axis
    var endIdx = series.length - 1;
    var endLabel = sim.combined.everRepaidInFull ? "cleared" : "written off";
    var marker = '<line x1="' + x(endIdx).toFixed(1) + '" y1="' + mt + '" x2="' + x(endIdx).toFixed(1) + '" y2="' + (mt + ih) +
      '" stroke="' + (sim.combined.everRepaidInFull ? "var(--accent)" : "var(--danger)") + '" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<rect x="' + (x(endIdx) - 12 - endLabel.length * 6.2).toFixed(1) + '" y="' + (mt + 1) +
      '" width="' + (endLabel.length * 6.2 + 10).toFixed(1) + '" height="16" rx="3" fill="var(--bg-raise)"/>' +
      '<text x="' + (x(endIdx) - 7).toFixed(1) + '" y="' + (mt + 13) + '" text-anchor="end" font-size="11" font-weight="600" fill="' +
      (sim.combined.everRepaidInFull ? "var(--accent)" : "var(--danger)") + '">' + endLabel + "</text>";

    $("chart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Balance outstanding, total repaid and total interest, by tax year">' +
      grid + xlab +
      '<path d="' + area("balance") + '" fill="var(--bg-sink)" opacity=".85"/>' +
      '<path d="' + line("balance") + '" fill="none" stroke="var(--ink-soft)" stroke-width="2"/>' +
      '<path d="' + line("interest") + '" fill="none" stroke="var(--warn)" stroke-width="1.75" stroke-dasharray="4 3"/>' +
      '<path d="' + line("repaid") + '" fill="none" stroke="var(--accent)" stroke-width="2.25"/>' +
      marker +   // last, so its label sits clear of whichever line finishes high
      "</svg>";

    $("chartKey").innerHTML =
      '<i class="k-balance">Balance outstanding</i>' +
      '<i class="k-repaid">Repaid, running total</i>' +
      '<i class="k-interest">Interest charged, running total</i>' +
      (state.basis === "real" ? '<i style="color:var(--ink-mute)">in ' + E.taxYearLabel(series[0].taxYear) + " money</i>" : "");
  }

  function renderMilestones(sim) {
    var list = sim.combined.parts ? sim.loans[0].milestones : sim.combined.milestones;
    if (sim.combined.parts) {
      // Two loans: describe the pair, then each one's ending.
      list = sim.loans.reduce(function (acc, r) {
        return acc.concat(r.milestones.filter(function (m) {
          return m.kind === "cleared" || m.kind === "writtenOff";
        }).map(function (m) {
          return { year: m.year, kind: m.kind, text: r.planLabel + " — " + m.text };
        }));
      }, sim.loans[0].milestones.filter(function (m) { return m.kind !== "cleared" && m.kind !== "writtenOff"; }))
        .sort(function (a, b) { return String(a.year).localeCompare(String(b.year)); });
    }
    $("milestones").innerHTML = list.map(function (m) {
      return '<li class="is-' + m.kind + '"><span class="when">' + m.year + '</span><span class="what">' + m.text + "</span></li>";
    }).join("");
  }

  /* ---- the log ---------------------------------------------------------- */

  function mergedMonths(sim) {
    var by = {};
    sim.loans.forEach(function (r) {
      r.months.forEach(function (m) {
        var t = by[m.month] || (by[m.month] = {
          month: m.month, year: m.year, monthNo: m.monthNo, taxYear: m.taxYear,
          phase: m.phase, salary: 0, drawdown: 0, interest: 0, payment: 0, voluntary: 0, balance: 0
        });
        t.salary = Math.max(t.salary, m.salary);
        t.drawdown += m.drawdown;
        t.interest += m.interest;
        t.payment += m.payment;
        t.voluntary += m.voluntary;
        t.balance += m.balance;
        if (m.phase === "repaying") t.phase = "repaying";
      });
    });
    return by;
  }

  function renderLog(sim) {
    var years = sim.combined.years;
    var months = mergedMonths(sim);
    var body = $("logRows");
    var rows = "";

    years.forEach(function (y) {
      var due = y.repaid + y.voluntary;
      if (state.hideZeros && due < 0.5) return;

      var isOpen = !!state.openYears[y.taxYear];
      var cls = "year" + (y.phase === "studying" ? " study" : "") +
        (y.interestOutranPayments ? " is-warn" : "") + (isOpen ? " is-open" : "");

      rows += '<tr class="' + cls + '" data-year="' + y.taxYear + '" tabindex="0" role="button" aria-expanded="' + isOpen + '">' +
        '<td class="yr">' + y.label + "</td>" +
        '<td class="num">' + ageAt(y.taxYear) + "</td>" +
        '<td class="num">' + (y.phase === "studying" ? "studying" : gbp(y.salary)) + "</td>" +
        '<td class="num">' + (y.phase === "studying" ? "—" : gbp(y.monthlyRepayment)) + "</td>" +
        '<td class="num">' + (due > 0 ? gbp(due) : "—") + "</td>" +
        '<td class="num">' + gbp(y.interest) + "</td>" +
        '<td class="num">' + gbp(y.cumRepaid) + "</td>" +
        '<td class="num">' + gbp(y.closingBalance) + "</td></tr>";

      if (isOpen) rows += monthRows(y, months);
    });

    var r = sim.combined;
    rows += '<tr class="final"><td>Total</td><td class="num"></td><td class="num"></td><td class="num"></td>' +
      '<td class="num">' + gbp(r.totalRepaid) + '</td><td class="num">' + gbp(r.totalInterest) + '</td>' +
      '<td class="num">—</td><td class="num">' +
      (r.everRepaidInFull ? "£0" : gbp(r.writtenOff) + " written off") + "</td></tr>";

    body.innerHTML = rows;
  }

  function monthRows(y, months) {
    var cells = "";
    // A tax year runs April to March, so it spans two calendar years.
    for (var i = 0; i < 12; i++) {
      var monthNo = ((3 + i) % 12) + 1;
      var cal = monthNo >= 4 ? y.taxYear : y.taxYear + 1;
      var m = months[E.ym(cal, monthNo)];
      if (!m) continue;
      cells += "<tr><td>" + MONTHS[monthNo - 1] + " " + cal + "</td>" +
        '<td class="num">' + (m.drawdown ? gbp(m.drawdown) : "—") + "</td>" +
        '<td class="num">' + (m.phase === "repaying" ? gbp(m.salary / 12) : "—") + "</td>" +
        '<td class="num">' + (m.payment + m.voluntary > 0 ? gbp(m.payment + m.voluntary) : "—") + "</td>" +
        '<td class="num">' + gbp(m.interest) + "</td>" +
        '<td class="num">' + gbp(m.balance) + "</td></tr>";
    }
    return '<tr class="months"><td colspan="8"><table class="month-table">' +
      "<thead><tr><th>Month</th><th class=\"num\">Borrowed</th><th class=\"num\">Gross pay</th>" +
      "<th class=\"num\">Deducted</th><th class=\"num\">Interest</th><th class=\"num\">Balance</th></tr></thead>" +
      "<tbody>" + cells + "</tbody></table></td></tr>";
  }

  /* ---- the small running summaries -------------------------------------- */

  function renderSummaries(sim) {
    var a = sim.assumptions;
    var start = repayStartYear();

    if (state.loanMode === "course") {
      var yrs = Math.round(num("courseYears", 3));
      var perYear = num("tuition", 0) + num("maintenance", 0);
      $("borrowSummary").innerHTML =
        "Borrowing <b>" + gbp(perYear) + "</b> a year for <b>" + yrs + " years</b> — <b>" +
        gbp(perYear * yrs) + "</b> in all. With interest running from the first instalment, you owe <b>" +
        gbp(sim.combined.balanceAtRepayStart) + "</b> when repayments begin in April " + start + ".";
      $("startHint").textContent = "Repayments start in April " + start + ", the first April after the course ends.";
    }

    var sal = salaries(a);
    var firstSal = sal[start] || 0;
    var tenth = sal[start + 9] || 0;
    var career = CAREERS.filter(function (c) { return c.id === $("career").value; })[0];
    $("careerNote").textContent = career ? career.note : "";
    $("customSalary").hidden = !!(career && career.id !== "custom");

    $("predictSummary").innerHTML =
      "Starting on <b>" + gbp(firstSal) + "</b> in " + E.taxYearLabel(start) +
      " and reaching <b>" + gbp(tenth) + "</b> ten years later" +
      (career && career.id !== "custom"
        ? ", with inflation of " + pct(a.inflation) + " added to the career curve."
        : ".");
  }

  /* ---------------------------------------------------------------------- *
   * THE SALARY TABLE
   * -------------------------------------------------------------------- */

  function buildSalaryTable() {
    var a = assumptions();
    var predicted = predictedSalaries(a);
    var start = repayStartYear();
    var rows = "";
    for (var i = 0; i < state.manualYears; i++) {
      var y = start + i;
      var v = state.manual[y] != null ? state.manual[y] : Math.round(predicted[y] || 0);
      rows += "<tr><td>" + E.taxYearLabel(y) + '</td><td class="age">' + ageAt(y) + "</td>" +
        '<td><input type="number" min="0" max="1000000" step="500" data-year="' + y + '" value="' + Math.round(v) + '" /></td></tr>';
    }
    $("salaryRows").innerHTML = rows;
  }

  /* ---------------------------------------------------------------------- *
   * CSV
   * -------------------------------------------------------------------- */

  function csv() {
    if (!lastSim) return "";
    var r = lastSim.combined;
    var head = ["Tax year", "Age", "Phase", "Gross salary", "Threshold", "Monthly repayment",
      "Repaid in year", "Interest charged", "Borrowed in year", "Repaid to date",
      "Interest to date", "Closing balance", "Closing balance (today's money)"];
    var lines = [head.join(",")];
    r.years.forEach(function (y) {
      lines.push([
        y.label, ageAt(y.taxYear), y.phase,
        Math.round(y.salary), Math.round(y.threshold || 0), Math.round(y.monthlyRepayment),
        Math.round(y.repaid + y.voluntary), Math.round(y.interest), Math.round(y.borrowed),
        Math.round(y.cumRepaid), Math.round(y.cumInterest),
        Math.round(y.closingBalance), Math.round(y.realClosingBalance)
      ].join(","));
    });
    lines.push("");
    lines.push(["Borrowed", Math.round(r.borrowed)].join(","));
    lines.push(["Repaid in total", Math.round(r.totalRepaid)].join(","));
    lines.push(["Repaid in total (today's money)", Math.round(r.totalRealRepaid)].join(","));
    lines.push(["Interest charged", Math.round(r.totalInterest)].join(","));
    lines.push(["Written off", Math.round(r.writtenOff || 0)].join(","));
    lines.push(["Cost per pound borrowed", r.perPoundBorrowed.toFixed(2)].join(","));
    return lines.join("\n");
  }

  function download() {
    var blob = new Blob([csv()], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "student-loan-" + $("plan").value + "-" + repayStartYear() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------------------------------------------------------------------- *
   * PERSISTENCE — so a refresh does not lose a typed-out salary line
   * -------------------------------------------------------------------- */

  var FIELDS = ["plan", "courseYears", "startYear", "tuition", "living", "maintenance",
    "openingBalance", "repayStartYear", "hasPgl", "pglBalance", "career", "startSalary",
    "salaryGrowth", "birthYear", "overpay", "rpi", "bankBase", "thresholdGrowth",
    "inflation", "useCap"];

  function save() {
    try {
      var data = { state: { loanMode: state.loanMode, incomeMode: state.incomeMode, manual: state.manual, manualYears: state.manualYears }, fields: {} };
      FIELDS.forEach(function (id) {
        var el = $(id);
        if (el) data.fields[id] = el.type === "checkbox" ? el.checked : el.value;
      });
      localStorage.setItem(STORE, JSON.stringify(data));
    } catch (e) { /* private browsing, or storage refused — the tool still works */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return false;
      var data = JSON.parse(raw);
      Object.keys(data.fields || {}).forEach(function (id) {
        var el = $(id);
        if (!el) return;
        if (el.type === "checkbox") el.checked = data.fields[id];
        else el.value = data.fields[id];
      });
      if (data.state) {
        state.loanMode = data.state.loanMode || "course";
        state.incomeMode = data.state.incomeMode || "predict";
        state.manual = data.state.manual || {};
        state.manualYears = data.state.manualYears || 12;
      }
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------------------- *
   * SETUP
   * -------------------------------------------------------------------- */

  function fillSelects() {
    $("plan").innerHTML = ["plan5", "plan2", "plan1", "plan4"].map(function (k) {
      return '<option value="' + k + '">' + E.RULES[k].label + " — " + E.RULES[k].blurb.split(",")[0] + "</option>";
    }).join("");
    $("career").innerHTML = CAREERS.map(function (c) {
      return '<option value="' + c.id + '">' + c.label + "</option>";
    }).join("");
    $("living").innerHTML = LIVING.map(function (l) {
      return '<option value="' + l.id + '">' + l.label + " — up to " + gbp(l.max) + "</option>";
    }).join("");
  }

  function fillRulesTable() {
    var a = E.DEFAULT_ASSUMPTIONS;
    var describe = {
      rpi: "RPI",
      rpiPlus3: "RPI + 3%",
      lowerOfRpiAndBase: "the lower of RPI and base rate + 1%",
      slidingScale: "RPI below the threshold, rising to RPI + 3% by £49,130"
    };
    $("rulesRows").innerHTML = ["plan1", "plan2", "plan4", "plan5", "pgl"].map(function (k) {
      var p = E.RULES[k];
      return "<tr><td class=\"plan\">" + p.label + '</td><td class="who">' + p.blurb + "</td>" +
        '<td class="num">' + gbp(p.threshold) + "</td>" +
        '<td class="num">' + pct(p.rate, 0) + "</td>" +
        "<td>" + describe[p.interest] + "</td>" +
        '<td class="num">' + p.writeOffYears + " years</td></tr>";
    }).join("");
  }

  function selectTab(group, name) {
    var tabs = document.querySelectorAll('[role="tab"][data-tab]');
    Array.prototype.forEach.call(tabs, function (t) {
      var pane = $("pane-" + t.dataset.tab);
      if (!pane || t.parentNode !== group) return;
      var on = t.dataset.tab === name;
      t.setAttribute("aria-selected", on ? "true" : "false");
      pane.hidden = !on;
    });
  }

  function wire() {
    // Tabs
    document.querySelectorAll('[role="tab"][data-tab]').forEach(function (t) {
      t.addEventListener("click", function () {
        var name = t.dataset.tab;
        selectTab(t.parentNode, name);
        if (name === "course" || name === "balance") state.loanMode = name;
        if (name === "predict" || name === "manual") {
          state.incomeMode = name;
          if (name === "manual") buildSalaryTable();
        }
        run();
      });
    });

    // Any input rerun the simulation
    $("form").addEventListener("input", function (ev) {
      var t = ev.target;
      if (t.dataset && t.dataset.year) {
        var v = parseFloat(t.value);
        state.manual[t.dataset.year] = isFinite(v) ? Math.max(0, v) : 0;
        run();
        return;
      }
      if (t.id === "living") {
        var l = LIVING.filter(function (x) { return x.id === t.value; })[0];
        if (l) $("maintenance").value = l.max;
      }
      if (t.id === "hasPgl") $("pglRow").hidden = !t.checked;
      if (t.id === "birthYear" && state.incomeMode === "manual") buildSalaryTable();
      if (t.id === "career" || t.id === "startYear" || t.id === "courseYears" || t.id === "repayStartYear") {
        if (state.incomeMode === "manual") { state.manual = {}; buildSalaryTable(); }
      }
      run();
    });
    $("form").addEventListener("change", function () { run(); });

    // Salary table controls
    $("addYears").addEventListener("click", function () {
      state.manualYears = Math.min(state.manualYears + 5, 45);
      buildSalaryTable(); run();
    });
    $("resetSalaries").addEventListener("click", function () {
      state.manual = {}; buildSalaryTable(); run();
    });

    // Cash / today's money
    document.querySelectorAll("[data-basis]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.basis = b.dataset.basis;
        document.querySelectorAll("[data-basis]").forEach(function (o) { o.classList.toggle("on", o === b); });
        renderChart(lastSim);
      });
    });

    // Opening a year in the log
    $("logRows").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr.year");
      if (!tr) return;
      toggleYear(tr.dataset.year);
    });
    $("logRows").addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var tr = ev.target.closest("tr.year");
      if (!tr) return;
      ev.preventDefault();
      toggleYear(tr.dataset.year);
    });

    $("toggleZeros").addEventListener("click", function () {
      state.hideZeros = !state.hideZeros;
      $("toggleZeros").textContent = state.hideZeros
        ? "Show every year" : "Hide the years with nothing to pay";
      renderLog(lastSim);
    });

    $("downloadCsv").addEventListener("click", download);

    $("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
  }

  function toggleYear(y) {
    state.openYears[y] = !state.openYears[y];
    renderLog(lastSim);
  }

  function init() {
    fillSelects();
    fillRulesTable();
    var restored = restore();
    if (!restored) {
      $("plan").value = "plan5";
      $("career").value = "grad";
    }
    $("pglRow").hidden = !$("hasPgl").checked;
    selectTab($("tab-course").parentNode, state.loanMode);
    selectTab($("tab-predict").parentNode, state.incomeMode);
    $("planBlurb").textContent = E.RULES[$("plan").value].blurb;
    $("plan").addEventListener("change", function () {
      $("planBlurb").textContent = E.RULES[$("plan").value].blurb;
    });
    if (state.incomeMode === "manual") buildSalaryTable();
    wire();
    run();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
