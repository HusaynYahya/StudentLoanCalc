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
    renderRail(sim);
    renderStats(sim);
    renderSensitivity(sim);
    renderAllCharts(sim);
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

  /* ---------------------------------------------------------------------- *
   * CHARTS
   *
   * One frame helper and five pictures, all plain SVG built as strings and
   * coloured through CSS custom properties, so light and dark come free.
   * -------------------------------------------------------------------- */

  function niceScale(max, want) {
    if (!(max > 0)) return { step: 1, top: 1 };
    var rough = max / (want || 4);
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    return { step: step, top: Math.ceil(max / step) * step };
  }

  // Shared axes. `fmt` turns a value into an axis label; `years` are the rows
  // being plotted, thinned so the labels never collide.
  function frame(o) {
    var W = o.w || 760, H = o.h || 240;
    var ml = o.ml == null ? (W < 600 ? 44 : 54) : o.ml;
    var mr = 14, mt = 16, mb = 28;
    var iw = W - ml - mr, ih = H - mt - mb;
    var xSpan = (o.xMax - o.xMin) || 1;

    var x = function (v) { return ml + ((v - o.xMin) / xSpan) * iw; };
    var y = function (v) { return mt + ih - (v / o.top) * ih; };

    var grid = "";
    for (var v = 0; v <= o.top + 1e-9; v += o.step) {
      var gy = y(v);
      grid += '<line x1="' + ml + '" y1="' + gy.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + gy.toFixed(1) +
        '" stroke="var(--line-soft)" stroke-width="1"/>' +
        '<text x="' + (ml - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--ink-faint)">' +
        o.fmt(v) + "</text>";
    }

    // Pick the years to label, then drop any that would sit on top of the
    // final one — the last year always earns its place, the stride does not.
    var every = Math.max(1, Math.ceil(o.years.length / (W < 600 ? 5 : 7)));
    var lastIdx = o.years.length - 1;
    var picked = o.years.map(function (yr, i) { return i; })
      .filter(function (i) { return i % every === 0 || i === lastIdx; });
    var minGap = 36;
    picked = picked.filter(function (i, n) {
      if (i === lastIdx || n === picked.length - 1) return true;
      return x(o.years[lastIdx].taxYear) - x(o.years[i].taxYear) >= minGap;
    });

    var xlab = picked.map(function (i) {
      var yr = o.years[i];
      return '<text x="' + x(yr.taxYear).toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="middle" font-size="11" fill="var(--ink-faint)">' + yr.label.slice(0, 4) + "</text>";
    }).join("");

    return {
      x: x, y: y, W: W, H: H, ml: ml, mt: mt, iw: iw, ih: ih,
      grid: grid, xlab: xlab,
      open: '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + o.title + '">' + grid + xlab,
      close: "</svg>"
    };
  }

  function polyline(pts, f, key) {
    return pts.map(function (p, i) {
      return (i ? "L" : "M") + f.x(p.taxYear).toFixed(1) + " " + f.y(p[key]).toFixed(1);
    }).join(" ");
  }

  // Is the reader looking at cash of the day, or today's money?
  function scaled(y, v) { return state.basis === "real" ? v * y.deflator : v; }

  /* ---- 1. the balance, and what you have paid --------------------------- */

  function renderChart(sim) {
    var years = sim.combined.years;
    var real = state.basis === "real";

    // In today's money the running total has to be accumulated from each
    // year's deflated payment, not deflated once at the end.
    var cumReal = 0;
    var pts = years.map(function (y) {
      cumReal += y.realRepaid;
      return {
        taxYear: y.taxYear, label: y.label,
        balance: real ? y.realClosingBalance : y.closingBalance,
        repaid: real ? cumReal : y.cumRepaid,
        interest: real ? y.cumInterest * y.deflator : y.cumInterest
      };
    });

    var max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.balance, p.repaid, p.interest); });
    var s = niceScale(max);
    var f = frame({ years: years, xMin: years[0].taxYear, xMax: years[years.length - 1].taxYear,
                    top: s.top, step: s.step, fmt: gbpShort, title: "Balance outstanding, total repaid and total interest, by tax year" });

    var area = polyline(pts, f, "balance") +
      " L" + f.x(pts[pts.length - 1].taxYear).toFixed(1) + " " + f.y(0) +
      " L" + f.x(pts[0].taxYear).toFixed(1) + " " + f.y(0) + " Z";

    var endX = f.x(pts[pts.length - 1].taxYear);
    var done = sim.combined.everRepaidInFull;
    var endLabel = done ? "cleared" : "written off";
    var endColour = done ? "var(--accent)" : "var(--danger)";
    var marker =
      '<line x1="' + endX.toFixed(1) + '" y1="' + f.mt + '" x2="' + endX.toFixed(1) + '" y2="' + (f.mt + f.ih) +
      '" stroke="' + endColour + '" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<rect x="' + (endX - 12 - endLabel.length * 6.2).toFixed(1) + '" y="' + (f.mt + 1) +
      '" width="' + (endLabel.length * 6.2 + 10).toFixed(1) + '" height="16" rx="3" fill="var(--bg-raise)"/>' +
      '<text x="' + (endX - 7).toFixed(1) + '" y="' + (f.mt + 13) +
      '" text-anchor="end" font-size="11" font-weight="600" fill="' + endColour + '">' + endLabel + "</text>";

    $("chart").innerHTML = f.open +
      '<path d="' + area + '" fill="var(--bg-sink)" opacity=".85"/>' +
      '<path d="' + polyline(pts, f, "balance") + '" fill="none" stroke="var(--ink-soft)" stroke-width="2"/>' +
      '<path d="' + polyline(pts, f, "interest") + '" fill="none" stroke="var(--warn)" stroke-width="1.75" stroke-dasharray="4 3"/>' +
      '<path d="' + polyline(pts, f, "repaid") + '" fill="none" stroke="var(--accent)" stroke-width="2.25"/>' +
      marker + f.close;

    $("chartKey").innerHTML =
      '<i class="k-balance">Still owed</i><i class="k-repaid">Repaid, running total</i>' +
      '<i class="k-interest">Interest charged, running total</i>';
  }

  /* ---- 2. salary against the threshold ---------------------------------- */

  function renderSalaryChart(sim) {
    var years = sim.combined.years.filter(function (y) { return y.phase === "repaying"; });
    if (!years.length) { $("salaryChart").innerHTML = ""; $("salaryKey").innerHTML = ""; return; }

    var pts = years.map(function (y) {
      return {
        taxYear: y.taxYear, label: y.label,
        salary: scaled(y, y.salary),
        threshold: scaled(y, y.threshold || 0)
      };
    });
    pts.forEach(function (p) { p.upper = Math.max(p.salary, p.threshold); });

    var max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.salary, p.threshold); });
    var s = niceScale(max);
    var f = frame({ years: years, xMin: years[0].taxYear, xMax: years[years.length - 1].taxYear,
                    top: s.top, step: s.step, fmt: gbpShort, w: 440, h: 250,
                    title: "Gross salary against the repayment threshold, by tax year" });

    // The band between the two lines is the only part that is ever charged.
    var band = polyline(pts, f, "upper") + " " +
      pts.slice().reverse().map(function (p) {
        return "L" + f.x(p.taxYear).toFixed(1) + " " + f.y(p.threshold).toFixed(1);
      }).join(" ") + " Z";

    $("salaryChart").innerHTML = f.open +
      '<path d="' + band + '" fill="var(--accent)" opacity=".16"/>' +
      '<path d="' + polyline(pts, f, "threshold") + '" fill="none" stroke="var(--warn)" stroke-width="1.75" stroke-dasharray="5 3"/>' +
      '<path d="' + polyline(pts, f, "salary") + '" fill="none" stroke="var(--accent)" stroke-width="2.25"/>' +
      f.close;

    var first = pts[0], last = pts[pts.length - 1];
    var gapNow = Math.max(0, first.salary - first.threshold);
    var gapEnd = Math.max(0, last.salary - last.threshold);
    $("salaryKey").innerHTML =
      '<i class="k-repaid">Gross salary</i><i class="k-interest">Threshold</i>' +
      '<i style="color:var(--ink-mute)">Charged on ' + gbp(gapNow) + " at the start, " + gbp(gapEnd) + " at the end</i>";
  }

  /* ---- 3. what leaves your pay each month ------------------------------- */

  function renderMonthlyChart(sim) {
    var years = sim.combined.years.filter(function (y) { return y.phase === "repaying"; });
    if (!years.length) { $("monthlyChart").innerHTML = ""; $("monthlyKey").innerHTML = ""; return; }

    var pts = years.map(function (y) {
      return { taxYear: y.taxYear, label: y.label, monthly: scaled(y, y.monthlyRepayment) };
    });

    var max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.monthly); });
    var s = niceScale(max);
    var f = frame({ years: years, xMin: years[0].taxYear, xMax: years[years.length - 1].taxYear,
                    top: s.top, step: s.step, fmt: function (v) { return "£" + Math.round(v); },
                    w: 440, h: 250, title: "Monthly repayment, by tax year" });

    var area = polyline(pts, f, "monthly") +
      " L" + f.x(pts[pts.length - 1].taxYear).toFixed(1) + " " + f.y(0) +
      " L" + f.x(pts[0].taxYear).toFixed(1) + " " + f.y(0) + " Z";

    var peak = pts.reduce(function (m, p) { return p.monthly > m.monthly ? p : m; }, pts[0]);

    $("monthlyChart").innerHTML = f.open +
      '<path d="' + area + '" fill="var(--accent)" opacity=".16"/>' +
      '<path d="' + polyline(pts, f, "monthly") + '" fill="none" stroke="var(--accent)" stroke-width="2.25"/>' +
      '<circle cx="' + f.x(peak.taxYear).toFixed(1) + '" cy="' + f.y(peak.monthly).toFixed(1) +
      '" r="3.5" fill="var(--accent)"/>' + f.close;

    $("monthlyKey").innerHTML =
      '<i class="k-repaid">Deducted each month</i>' +
      '<i style="color:var(--ink-mute)">' + gbp(pts[0].monthly) + " at the start, peaking at " +
      gbp(peak.monthly) + " in " + peak.label + "</i>";
  }

  /* ---- 4. the interest rate --------------------------------------------- */

  function renderRateChart(sim) {
    var years = sim.combined.years;
    var a = sim.assumptions;

    var lines = sim.loans.map(function (r, i) {
      return {
        label: r.planLabel,
        colour: i === 0 ? "var(--warn)" : "var(--accent)",
        points: r.years.map(function (y) { return { taxYear: y.taxYear, rate: y.rateHigh }; })
      };
    });

    var max = a.rpi;
    lines.forEach(function (L) { L.points.forEach(function (p) { max = Math.max(max, p.rate); }); });
    var top = Math.ceil(max * 100 + 0.5) / 100;
    var step = top > 0.08 ? 0.02 : 0.01;

    var f = frame({ years: years, xMin: years[0].taxYear, xMax: years[years.length - 1].taxYear,
                    top: top, step: step, w: 440, h: 250,
                    fmt: function (v) { return (v * 100).toFixed(0) + "%"; },
                    title: "The interest rate charged, by tax year" });

    // RPI itself, for reference: the gap to it is the whole of the "+3%" story.
    var rpiLine = '<line x1="' + f.ml + '" y1="' + f.y(a.rpi).toFixed(1) + '" x2="' + (f.W - 14) +
      '" y2="' + f.y(a.rpi).toFixed(1) + '" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="2 4"/>';

    var repayAt = years.filter(function (y) { return y.phase === "repaying"; })[0];
    var startMark = "";
    if (repayAt && repayAt.taxYear > years[0].taxYear) {
      var mx = f.x(repayAt.taxYear);
      startMark = '<line x1="' + mx.toFixed(1) + '" y1="' + f.mt + '" x2="' + mx.toFixed(1) +
        '" y2="' + (f.mt + f.ih) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (mx + 5).toFixed(1) + '" y="' + (f.mt + 11) +
        '" font-size="10" fill="var(--ink-faint)">repayment starts</text>';
    }

    // A step line: the rate holds for a whole tax year, then jumps on 6 April.
    var paths = lines.map(function (L) {
      var d = "", prev = null;
      L.points.forEach(function (p, i) {
        var px = f.x(p.taxYear), py = f.y(p.rate);
        if (i === 0) d += "M" + px.toFixed(1) + " " + py.toFixed(1);
        else d += "L" + px.toFixed(1) + " " + prev.toFixed(1) + "L" + px.toFixed(1) + " " + py.toFixed(1);
        prev = py;
      });
      return '<path d="' + d + '" fill="none" stroke="' + L.colour + '" stroke-width="2" stroke-linejoin="round"/>';
    }).join("");

    $("rateChart").innerHTML = f.open + rpiLine + startMark + paths + f.close;
    $("rateKey").innerHTML = lines.map(function (L) {
      return '<i style="color:' + L.colour + '">' + L.label + "</i>";
    }).join("") + '<i style="color:var(--ink-faint)">RPI, ' + pct(a.rpi) + "</i>";
    $("rateNote").textContent = rateExplanation(sim);
  }

  function rateExplanation(sim) {
    var a = sim.assumptions;
    var yrs = sim.combined.years.filter(function (y) { return y.phase === "repaying"; });
    if (!yrs.length) return "";
    var lo = Math.min.apply(null, yrs.map(function (y) { return y.rateLow; }));
    var hi = Math.max.apply(null, yrs.map(function (y) { return y.rateHigh; }));
    var range = Math.abs(hi - lo) < 0.0001 ? "a flat " + pct(hi) : pct(lo) + " to " + pct(hi);

    var why = {
      plan5: "Plan 5 charges RPI and nothing else, so the line only moves if RPI does.",
      plan2: "Plan 2 slides with your income — RPI at the threshold, RPI + 3% past the upper limit — and sits at RPI + 3% all through the course.",
      plan1: "Plan 1 takes the lower of RPI and the base rate + 1%.",
      plan4: "Plan 4 takes the lower of RPI and the base rate + 1%."
    }[$("plan").value] || "";

    // Only worth mentioning where it actually bites.
    var capped = (a.interestCap != null && hi > a.interestCap + 1e-9)
      ? " The announced " + pct(a.interestCap, 0) + " cap holds it down to " +
        E.taxYearLabel(a.interestCapUntil) + ", then lapses."
      : "";

    return "Charged at " + range + ". " + why + capped;
  }

  /* ---- 5. where it all ends up ------------------------------------------ *
   * Two bars of identical length, because they are the same money seen from
   * each end: borrowed + interest charged = repaid + written off, exactly.
   * ---------------------------------------------------------------------- */

  function renderFlowChart(sim) {
    var r = sim.combined;
    var total = r.borrowed + r.totalInterest;
    if (!(total > 0)) { $("flowChart").innerHTML = ""; $("flowKey").innerHTML = ""; return; }

    var W = 440, H = 200, ml = 10, mr = 10, iw = W - ml - mr;
    var barH = 46, gap = 26, top = 30;

    var bar = function (yPos, segs) {
      var xCur = ml, out = "";
      segs.forEach(function (s) {
        var w = (s.value / total) * iw;
        if (w <= 0) return;
        out += '<rect x="' + xCur.toFixed(1) + '" y="' + yPos + '" width="' + w.toFixed(1) +
          '" height="' + barH + '" fill="' + s.colour + '" opacity="' + (s.opacity || 1) + '"/>';
        // Only label a segment wide enough to hold the words.
        if (w > 104) {
          out += '<text x="' + (xCur + 10).toFixed(1) + '" y="' + (yPos + 19) +
            '" font-size="12.5" font-weight="600" fill="' + (s.ink || "#fff") + '">' + s.label + "</text>" +
            '<text x="' + (xCur + 10).toFixed(1) + '" y="' + (yPos + 35) +
            '" font-size="13" fill="' + (s.ink || "#fff") + '" opacity=".88">' + gbp(s.value) + "</text>";
        }
        xCur += w;
      });
      return out;
    };

    var charged = [
      { label: "Borrowed", value: r.borrowed, colour: "var(--ink-soft)" },
      { label: "Interest charged", value: r.totalInterest, colour: "var(--warn)" }
    ];
    var landed = [
      { label: "You repaid", value: r.totalRepaid, colour: "var(--accent)" },
      { label: "Written off", value: r.writtenOff || 0, colour: "var(--danger)" }
    ];

    var caption = function (t, yPos) {
      return '<text x="' + ml + '" y="' + yPos + '" font-size="12" font-weight="600" ' +
        'letter-spacing=".05em" fill="var(--ink-mute)">' + t.toUpperCase() + "</text>";
    };

    $("flowChart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="What you were charged, and where it ended up">' +
      caption("What you were charged", top - 10) + bar(top, charged) +
      caption("Where it went", top + barH + gap + 10) + bar(top + barH + gap + 20, landed) +
      "</svg>";

    var perPound = r.perPoundBorrowed;
    $("flowKey").innerHTML =
      '<i style="color:var(--ink-soft)">Borrowed</i><i class="k-interest">Interest</i>' +
      '<i class="k-repaid">Repaid</i>' + ((r.writtenOff || 0) > 0 ? '<i style="color:var(--danger)">Written off</i>' : "") +
      '<i style="color:var(--ink-mute)">£' + perPound.toFixed(2) + " handed over per £1 borrowed</i>";
  }

  function renderAllCharts(sim) {
    renderChart(sim);
    renderSalaryChart(sim);
    renderMonthlyChart(sim);
    renderRateChart(sim);
    renderFlowChart(sim);
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
          phase: m.phase, salary: 0, drawdown: 0, interest: 0, payment: 0, voluntary: 0, balance: 0, rate: null
        });
        t.salary = Math.max(t.salary, m.salary);
        t.rate = t.rate == null ? m.rate : Math.max(t.rate, m.rate);
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
        '<td class="num">' + rateCell(y) + "</td>" +
        '<td class="num">' + gbp(y.interest) + "</td>" +
        '<td class="num">' + gbp(y.cumRepaid) + "</td>" +
        '<td class="num">' + gbp(y.closingBalance) + "</td></tr>";

      if (isOpen) rows += monthRows(y, months);
    });

    var r = sim.combined;
    rows += '<tr class="final"><td>Total</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td>' +
      '<td class="num">' + gbp(r.totalRepaid) + '</td><td class="num">' + gbp(r.totalInterest) + '</td>' +
      '<td class="num">—</td><td class="num">' +
      (r.everRepaidInFull ? "£0" : gbp(r.writtenOff) + " written off") + "</td></tr>";

    body.innerHTML = rows;
  }

  // A rate that moved within the year is shown as the range it moved across.
  function rateCell(y) {
    if (y.rateHigh == null) return "—";
    return Math.abs(y.rateHigh - y.rateLow) < 0.0001
      ? pct(y.rateHigh, 2)
      : pct(y.rateLow, 2) + "–" + pct(y.rateHigh, 2);
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
        '<td class="num">' + (m.rate != null ? pct(m.rate, 2) : "—") + "</td>" +
        '<td class="num">' + gbp(m.interest) + "</td>" +
        '<td class="num">' + gbp(m.balance) + "</td></tr>";
    }
    return '<tr class="months"><td colspan="9"><table class="month-table">' +
      "<thead><tr><th>Month</th><th class=\"num\">Borrowed</th><th class=\"num\">Gross pay</th>" +
      "<th class=\"num\">Deducted</th><th class=\"num\">Rate</th><th class=\"num\">Interest</th><th class=\"num\">Balance</th></tr></thead>" +
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
    markCareer();
    markLength();

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
      "Interest rate", "Repaid in year", "Interest charged", "Borrowed in year", "Repaid to date",
      "Interest to date", "Closing balance", "Closing balance (today's money)"];
    var lines = [head.join(",")];
    r.years.forEach(function (y) {
      lines.push([
        y.label, ageAt(y.taxYear), y.phase,
        Math.round(y.salary), Math.round(y.threshold || 0), Math.round(y.monthlyRepayment),
        y.rateHigh != null ? (y.rateHigh * 100).toFixed(2) + "%" : "",
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
   * SLIDERS
   *
   * Any number input carrying data-slider="min,max,step" gets a range control
   * fitted above it. The slider covers the sensible range; the box still
   * accepts anything outside it, so neither gets in the other's way.
   * -------------------------------------------------------------------- */

  function fitSliders() {
    var boxes = document.querySelectorAll("input[data-slider]");
    Array.prototype.forEach.call(boxes, function (box) {
      var spec = box.dataset.slider.split(",").map(Number);
      var lo = spec[0], hi = spec[1], step = spec[2];

      var wrap = box.closest(".money-input, .pct-input") || box;
      var range = document.createElement("input");
      range.type = "range";
      range.className = "range";
      range.min = lo; range.max = hi; range.step = step;
      range.value = clamp(parseFloat(box.value) || lo, lo, hi);
      range.tabIndex = -1;                       // the box itself is the tab stop
      range.setAttribute("aria-hidden", "true");

      wrap.parentNode.insertBefore(range, wrap);

      range.addEventListener("input", function () {
        box.value = range.value;
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      box.addEventListener("input", function () {
        var v = parseFloat(box.value);
        if (isFinite(v)) range.value = clamp(v, lo, hi);
      });
    });
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------------------------------------------------------------------- *
   * CAREER PATHS, AS CARDS
   *
   * The dropdown is kept as the state, hidden, so everything that reads
   * $("career").value carries on working — the cards just drive it.
   * -------------------------------------------------------------------- */

  var PATH_MARKS = {
    custom: "✎", grad: "🎓", tech: "💻", medicine: "🩺", nursing: "💊",
    teaching: "📚", law: "⚖️", citylaw: "🏙", engineering: "⚙️",
    finance: "📊", public: "🏛", creative: "🎭", low: "🧭"
  };

  function buildCareerCards() {
    var host = $("careerCards");
    host.innerHTML = CAREERS.map(function (c) {
      var start = c.points ? c.points[Object.keys(c.points).map(Number).sort(function (a, b) { return a - b; })[0]] : null;
      return '<button type="button" class="path" role="radio" aria-checked="false" data-career="' + c.id + '">' +
        '<span class="path__mark" aria-hidden="true">' + (PATH_MARKS[c.id] || "•") + "</span>" +
        '<span class="path__name">' + c.label + "</span>" +
        '<span class="path__from">' + (start ? "from " + gbpShort(start) : "your figures") + "</span>" +
        "</button>";
    }).join("");

    host.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".path");
      if (!btn) return;
      $("career").value = btn.dataset.career;
      markCareer();
      if (state.incomeMode === "manual") { state.manual = {}; buildSalaryTable(); }
      run();
    });
  }

  function markCareer() {
    var current = $("career").value;
    Array.prototype.forEach.call($("careerCards").children, function (b) {
      var on = b.dataset.career === current;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  /* ---- course length, as chips ------------------------------------------ */

  function buildLengthChips() {
    var host = $("lenChips");
    host.innerHTML = [2, 3, 4, 5, 6].map(function (n) {
      return '<button type="button" class="chip" role="radio" aria-checked="false" data-years="' + n + '">' +
        n + " yrs</button>";
    }).join("");
    host.addEventListener("click", function (ev) {
      var b = ev.target.closest(".chip");
      if (!b) return;
      $("courseYears").value = b.dataset.years;
      markLength();
      if (state.incomeMode === "manual") { state.manual = {}; buildSalaryTable(); }
      run();
    });
  }

  function markLength() {
    var n = String(Math.round(num("courseYears", 3)));
    Array.prototype.forEach.call($("lenChips").children, function (b) {
      var on = b.dataset.years === n;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  /* ---------------------------------------------------------------------- *
   * THE RUNNING RAIL
   *
   * Sticky beside the controls, so every slider drag moves a number you can
   * see without scrolling.
   * -------------------------------------------------------------------- */

  function renderRail(sim) {
    var r = sim.combined;
    var repaying = r.years.filter(function (y) { return y.phase === "repaying"; });
    var first = repaying[0];
    var peak = repaying.reduce(function (m, y) {
      return y.monthlyRepayment > m ? y.monthlyRepayment : m;
    }, 0);

    $("railMonthly").textContent = first ? gbp(first.monthlyRepayment) : "£0";
    $("railSub").textContent = first
      ? "a month from " + first.label + ", rising to " + gbp(peak)
      : "nothing is ever due";

    var rows = [
      { k: "Borrowed", v: gbp(r.borrowed) },
      { k: "Owed on day one", v: gbp(r.balanceAtRepayStart) },
      { k: "Interest charged", v: gbp(r.totalInterest), cls: "is-warn" },
      { k: "You hand over", v: gbp(r.totalRepaid), cls: "is-good" },
      { k: "In today's money", v: gbp(r.totalRealRepaid) },
      r.everRepaidInFull
        ? { k: "Written off", v: "nothing", cls: "" }
        : { k: "Written off", v: gbp(r.writtenOff), cls: "is-bad" },
      { k: "Per £1 borrowed", v: "£" + r.perPoundBorrowed.toFixed(2) }
    ];

    $("railList").innerHTML = rows.map(function (row) {
      return "<dt>" + row.k + '</dt><dd class="' + (row.cls || "") + '">' + row.v + "</dd>";
    }).join("");

    $("railEnd").innerHTML = r.everRepaidInFull
      ? '<b class="is-good">Cleared in ' + r.clearedLabel + "</b> after " + r.yearsRepaying + " years of repayments."
      : '<b class="is-bad">Written off in ' + r.writeOffLabel + "</b> — you stop paying whatever is left.";
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
      if (t.id === "career" || t.id === "startYear" || t.id === "repayStartYear") {
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
        renderAllCharts(lastSim);
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
    buildCareerCards();
    buildLengthChips();
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
    fitSliders();
    markCareer();
    markLength();
    wire();
    run();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
