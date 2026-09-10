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
    { id: "away", label: "Away \u00b7 outside London", full: "Living away from home, outside London", max: 10830, min: 5048 },
    { id: "london", label: "Away \u00b7 in London", full: "Living away from home, in London", max: 14135, min: 7039 },
    { id: "home", label: "At home", full: "Living at home", max: 9118, min: 4013 },
    { id: "none", label: "No maintenance loan", full: "No maintenance loan", max: 0, min: 0 }
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
    scen: [],                // the comparable runs
    panelOpen: true,         // the controls, or the whole screen for the charts
    active: 0,               // which one the controls are editing
    showNoLoan: true,        // the life where you never borrowed
    loanMode: "course",      // "course" | "balance"
    incomeMode: "predict",   // "predict" | "manual"
    basis: "cash",           // "cash" | "real"
    manual: {},              // tax year → salary, once the user has edited
    manualYears: 12,
    hideZeros: false,
    openYears: {}
  };

  var lastSim = null;
  var lastRuns = null;

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
      savings: num("savings", 4.5) / 100,
      // How a salary line is carried on past its last stated year.
      salaryGrowth: (function () {
        var p = profile();
        var infl = num("inflation", 4.1) / 100;
        if (p.mode === "growth") return p.growth / 100;     // the rate you typed
        if (p.mode === "manual" || p.mode === "bands") return infl;  // holds its real value
        return infl + 0.005;                                // a career curve, flattening out
      })(),
      interestCap: $("useCap").checked ? 0.06 : null,
      interestCapUntil: 2027
    };
  }

  function repayStartYear() {
    if (state.loanMode === "balance") return Math.round(num("repayStartYear", 2026));
    return E.repaymentStartYear(Math.round(num("startYear", 2026)), Math.round(num("courseYears", 3)));
  }

  /* ---------------------------------------------------------------------- *
   * INCOME PROFILES
   *
   * Four ways to say what you will earn. All of them are stated in today's
   * money and have inflation added when they become cash, so a flat profile
   * means flat in real terms rather than quietly eroding.
   * -------------------------------------------------------------------- */

  var BAND_YEARS = 5;
  var BAND_COUNT = 8;               // 40 years, enough for a Plan 5 term

  var currentProfile = null;        // lent to scenario() for one simulate

  function profile() { return currentProfile || state.scen[state.active]; }

  function predictedSalaries(a) {
    var p = profile();
    var start = repayStartYear();
    var out = {};
    var n = Math.max(p.manualYears || 12, 45);
    var toCash = function (real, i) {
      return real * Math.pow(1 + a.inflation, start + i - E.BASE_TAX_YEAR);
    };

    if (p.mode === "growth") {
      // A starting salary and a rate, both taken at face value in cash.
      for (var g = 0; g < n; g++) out[start + g] = p.startSalary * Math.pow(1 + p.growth / 100, g);
      return out;
    }

    if (p.mode === "bands") {
      for (var b = 0; b < n; b++) {
        var band = Math.min(Math.floor(b / BAND_YEARS), p.bands.length - 1);
        out[start + b] = toCash(Number(p.bands[band]) || 0, b);
      }
      return out;
    }

    // A profession: real progression along the curve, inflation on top.
    var career = CAREERS.filter(function (c) { return c.id === p.career; })[0] || CAREERS[1];
    if (!career.points) career = CAREERS[1];
    for (var k = 0; k < n; k++) out[start + k] = toCash(careerReal(career, k + 1), k);
    return out;
  }

  function salaries(a) {
    var p = profile();
    var predicted = predictedSalaries(a);
    if (p.mode !== "manual") return predicted;

    var start = repayStartYear();
    var out = {};
    var years = p.manualYears || 12;
    for (var i = 0; i < years; i++) {
      var y = start + i;
      out[y] = p.manual && p.manual[y] != null ? p.manual[y] : Math.round(predicted[y] || 0);
    }
    return out;
  }

  function scenario() {
    var a = assumptions();
    var planKey = profile().plan;
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
      overpayment: { monthly: Number(profile().overpay) || 0 }
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
    captureScenario();

    var runs;
    try { runs = runAll(); } catch (e) { return; }
    if (!runs.length) return;

    lastRuns = runs;
    var focus = runs.filter(function (s) { return s.index === state.active; })[0] || runs[0];
    lastSim = focus;

    renderHero(runs);
    renderAllCharts(runs);
    renderSensitivity(focus);
    renderMilestones(focus);
    renderLog(focus);
    renderSummaries(focus);
    markScens();
    save();
  }

  /* ---------------------------------------------------------------------- *
   * SCENARIOS
   *
   * Up to three runs on the chart at once, plus the life where you never
   * borrowed at all. Only one set of income controls exists in the DOM; the
   * tabs load a scenario into it and edits are written back, so every input
   * keeps a stable id and the slider and persistence machinery is untouched.
   * -------------------------------------------------------------------- */

  var SCEN_META = [
    { id: "A", colour: "var(--sA)" },
    { id: "B", colour: "var(--sB)" },
    { id: "C", colour: "var(--sC)" },
    { id: "D", colour: "var(--sD)" },
    { id: "E", colour: "var(--sE)" }
  ];

  var SEED_CAREERS = ["grad", "medicine", "creative", "engineering", "citylaw"];

  function blankScenario(i) {
    return {
      on: i < 2,                       // A and B on to begin with — it is a comparison
      mode: "career",                  // career | growth | bands | manual
      career: SEED_CAREERS[i] || "grad",
      startSalary: 30000,
      growth: 4,
      bands: [28000, 36000, 44000, 50000, 54000, 56000, 56000, 56000],
      manual: {},
      manualYears: 12,
      plan: "plan5",
      overpay: 0
    };
  }

  // Move the active scenario's settings into the shared controls.
  function loadScenario() {
    var s = state.scen[state.active];
    $("career").value = s.career;
    $("startSalary").value = s.startSalary;
    $("salaryGrowth").value = s.growth;
    $("plan").value = s.plan;
    $("overpay").value = s.overpay;
    selectMode(s.mode);
    buildBandRows();
    buildSalaryTable();
    syncSliders();
    markCareer();
    var tag = SCEN_META[state.active].id;
    // Tint the whole panel to the scenario being edited, so it is never
    // ambiguous which of the lines on the chart a slider is moving.
    var panel = document.querySelector(".panel");
    if (panel) {
      panel.style.setProperty("--live", "var(--s" + tag + ")");
      panel.style.setProperty("--live-g", "var(--s" + tag + "-g)");
    }
    ["whoIncome", "whoPlan", "whoLog"].forEach(function (id) {
      var el = $(id);
      if (el) { el.textContent = tag; el.style.color = SCEN_META[state.active].colour; }
    });
    $("planBlurb").textContent = E.RULES[s.plan].blurb;
  }

  // And back the other way, after any edit.
  function captureScenario() {
    var s = state.scen[state.active];
    s.career = $("career").value;
    s.startSalary = num("startSalary", 30000);
    s.growth = num("salaryGrowth", 4);
    s.plan = $("plan").value;
    s.overpay = num("overpay", 0);
  }

  /* ---- the four ways of stating an income -------------------------------- */

  var MODES = ["career", "growth", "bands", "manual"];

  function selectMode(mode) {
    if (MODES.indexOf(mode) < 0) mode = "career";
    state.scen[state.active].mode = mode;
    MODES.forEach(function (m) {
      var tab = $("tab-" + m), pane = $("pane-" + m);
      if (tab) tab.setAttribute("aria-selected", m === mode ? "true" : "false");
      if (pane) pane.hidden = m !== mode;
    });
  }

  // Five-year bands: "what will I be on in my first five years, my second…"
  function buildBandRows() {
    var host = $("bandRows");
    if (!host) return;
    var p = state.scen[state.active];
    host.innerHTML = p.bands.map(function (v, i) {
      var from = i * BAND_YEARS + 1, to = from + BAND_YEARS - 1;
      return '<div class="band">' +
        '<label for="band' + i + '">Years ' + from + "\u2013" + to + "</label>" +
        '<span class="ctl__val"><i>\u00a3</i><input type="number" id="band' + i + '" data-band="' + i +
          '" min="0" max="500000" step="500" value="' + Math.round(v) + '" /></span>' +
        '<input type="range" tabindex="-1" aria-hidden="true" min="0" max="150000" step="1000" value="' +
          Math.min(150000, Math.round(v)) + '" data-bandrange="' + i + '" />' +
        "</div>";
    }).join("");
  }

  function syncSliders() {
    var boxes = document.querySelectorAll("input[data-slider]");
    Array.prototype.forEach.call(boxes, function (box) {
      var ctl = box.closest(".ctl");
      var range = ctl && ctl.querySelector('input[type="range"]');
      if (!range) return;
      var v = parseFloat(box.value);
      if (isFinite(v)) range.value = clamp(v, parseFloat(range.min), parseFloat(range.max));
    });
  }

  function buildScenTabs() {
    var host = $("scenTabs");
    host.innerHTML = SCEN_META.map(function (m, i) {
      return '<div class="scen" data-scen="' + i + '">' +
        '<button type="button" class="scen__pick" role="tab" aria-selected="false" data-pick="' + i + '">' +
          '<span class="scen__dot" style="background:' + m.colour + '"></span>' +
          '<span class="scen__id">' + m.id + '</span>' +
          '<span class="scen__name" data-name="' + i + '">—</span>' +
        "</button>" +
        '<button type="button" class="scen__on" data-toggle="' + i + '" aria-pressed="false" title="Show or hide on the charts">' +
          '<span aria-hidden="true"></span><span class="sr-only">Show scenario ' + m.id + '</span></button>' +
        "</div>";
    }).join("");

    host.addEventListener("click", function (ev) {
      var pick = ev.target.closest("[data-pick]");
      var tog = ev.target.closest("[data-toggle]");
      if (tog) {
        var j = Number(tog.dataset.toggle);
        var lit = state.scen.filter(function (s) { return s.on; }).length;
        if (state.scen[j].on && lit <= 1) return;      // never leave the charts empty
        state.scen[j].on = !state.scen[j].on;
        if (state.scen[j].on) { state.active = j; loadScenario(); }
        markScens(); run();
        return;
      }
      if (pick) {
        var i = Number(pick.dataset.pick);
        state.active = i;
        if (!state.scen[i].on) state.scen[i].on = true;
        loadScenario(); markScens(); run();
      }
    });
  }

  function markScens() {
    Array.prototype.forEach.call($("scenTabs").children, function (el, i) {
      var s = state.scen[i];
      el.classList.toggle("is-active", i === state.active);
      el.classList.toggle("is-off", !s.on);
      el.querySelector(".scen__pick").setAttribute("aria-selected", i === state.active ? "true" : "false");
      el.querySelector(".scen__on").setAttribute("aria-pressed", s.on ? "true" : "false");
      el.querySelector("[data-name]").textContent = scenarioName(s) +
        (s.plan !== "plan5" ? " \u00b7 " + E.RULES[s.plan].label : "") +
        (s.overpay > 0 ? " \u00b7 +" + gbpShort(s.overpay) + "/m" : "");
    });
  }

  /* ---- running every live scenario -------------------------------------- */

  function runAll() {
    var out = [];
    state.scen.forEach(function (s, i) {
      if (!s.on) return;
      currentProfile = s;                 // scenario() reads income from here
      try {
        var sim = E.simulate(scenario());
        sim.meta = SCEN_META[i];
        sim.index = i;
        sim.settings = s;
        out.push(sim);
      } finally {
        currentProfile = null;
      }
    });
    return out;
  }

  /* ---- the comparison headline ------------------------------------------ */

  function renderHero(runs) {
    var cells = runs.map(function (sim) {
      var r = sim.combined;
      var repaying = r.years.filter(function (y) { return y.phase === "repaying"; });
      var first = repaying.filter(function (y) { return y.monthlyRepayment > 0; })[0];
      var name = scenarioName(sim.settings);
      return '<div class="hcell' + (sim.index === state.active ? " is-active" : "") +
        '" data-jump="' + sim.index + '" style="--c:' + sim.meta.colour + '">' +
        '<p class="hcell__who"><span class="dot"></span>' + sim.meta.id + " · " + name + "</p>" +
        '<p class="hcell__fig">' + gbp(r.totalRepaid) + "</p>" +
        '<p class="hcell__sub">' +
          (r.everRepaidInFull ? "cleared " + r.clearedLabel : gbp(r.writtenOff) + " written off") +
          " · " + (first ? gbp(first.monthlyRepayment) + "/mo at first" : "never deducted") +
        "</p></div>";
    });

    if (state.showNoLoan) {
      cells.push('<div class="hcell is-ghost"><p class="hcell__who"><span class="dot"></span>No loan</p>' +
        '<p class="hcell__fig">£0</p><p class="hcell__sub">nothing is ever deducted</p></div>');
    }

    $("heroRow").innerHTML = cells.join("");

    // The spread between the cheapest and dearest run is the point of the page.
    if (runs.length > 1) {
      var tot = runs.map(function (s) { return s.combined.totalRepaid; });
      var lo = Math.min.apply(null, tot), hi = Math.max.apply(null, tot);
      var loRun = runs[tot.indexOf(lo)], hiRun = runs[tot.indexOf(hi)];
      $("heroGap").innerHTML = hi - lo < 1 ? "" :
        "<b>" + gbp(hi - lo) + "</b> between " + hiRun.meta.id + " and " + loRun.meta.id +
        " — the same rules, a different life.";
    } else {
      var only = runs[0].combined;
      $("heroGap").innerHTML = "<b>" + gbp(only.totalRepaid) + "</b> is what the loan costs you; " +
        "without one you would keep every penny of it.";
    }
  }

  function scenarioName(s) {
    if (s.mode === "growth") return gbpShort(s.startSalary) + " +" + s.growth + "%";
    if (s.mode === "bands") return gbpShort(s.bands[0]) + " \u2192 " + gbpShort(s.bands[s.bands.length - 1]);
    if (s.mode === "manual") return "typed by year";
    var c = CAREERS.filter(function (x) { return x.id === s.career; })[0];
    return c ? c.label : "Career";
  }

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
        '" stroke="var(--line-2)" stroke-width="1"/>' +
        '<text x="' + (ml - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--ink-4)">' +
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
        '" text-anchor="middle" font-size="11" fill="var(--ink-4)">' + yr.label.slice(0, 4) + "</text>";
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

  /* ---- 1. balance outstanding, one line per scenario -------------------- */

  function renderChart(runs) {
    var real = state.basis === "real";
    var series = runs.map(function (sim) {
      return {
        meta: sim.meta,
        pts: sim.combined.years.map(function (y) {
          return { taxYear: y.taxYear, label: y.label,
                   v: real ? y.realClosingBalance : y.closingBalance };
        }),
        done: sim.combined.everRepaidInFull,
        cutoff: repayStartYear() + E.RULES[sim.settings.plan].writeOffYears
      };
    });
    var f = spanFrame(runs, series, gbpShort, "Balance outstanding by tax year", 760, 300, true);

    var body = series.map(function (S) {
      var path = '<path d="' + line(S.pts, f) + '" fill="none" stroke="' + S.meta.colour +
        '" stroke-width="2.25"/>';
      // A loan that runs to the wall does not taper off — it is cancelled where
      // it stands, so draw the drop rather than letting the line just stop.
      if (!S.done && S.cutoff != null) {
        var last = S.pts[S.pts.length - 1];
        path += '<path d="M' + f.x(last.taxYear).toFixed(1) + " " + f.y(last.v).toFixed(1) +
          "L" + f.x(S.cutoff).toFixed(1) + " " + f.y(last.v).toFixed(1) +
          "L" + f.x(S.cutoff).toFixed(1) + " " + f.y(0).toFixed(1) +
          '" fill="none" stroke="' + S.meta.colour + '" stroke-width="2.25" stroke-dasharray="4 3" opacity=".75"/>';
      }
      return path + endDot(S, f);
    }).join("");

    $("chart").innerHTML = f.open + body + cutoffMarks(runs, f) + f.close;
    $("chartKey").innerHTML = runKeys(runs) +
      '<i style="color:var(--ink-3)">the write-off wall — whatever is left is cancelled</i>';
  }

  function endDot(S, f) {
    var last = S.pts[S.pts.length - 1];
    return '<circle cx="' + f.x(last.taxYear).toFixed(1) + '" cy="' + f.y(last.v).toFixed(1) +
      '" r="3.5" fill="' + (S.done ? S.meta.colour : "var(--bad)") + '"/>';
  }

  /* ---- 2. salary against the threshold ---------------------------------- */

  function renderSalaryChart(runs) {
    var series = runs.map(function (sim) {
      var ys = sim.combined.years.filter(function (y) { return y.phase === "repaying"; });
      return { meta: sim.meta,
        pts: ys.map(function (y) { return { taxYear: y.taxYear, label: y.label, v: scaled(y, y.salary) }; }),
        thr: ys.map(function (y) { return { taxYear: y.taxYear, label: y.label, v: scaled(y, y.threshold || 0) }; }) };
    });
    if (!series.length || !series[0].pts.length) { $("salaryChart").innerHTML = ""; return; }

    var all = series.map(function (S) { return { pts: S.pts.concat(S.thr) }; });
    var f = spanFrame(runs, all, gbpShort, "Gross salary against the repayment threshold", 440, 260, false);

    var body = series.map(function (S) {
      var band = S.pts.map(function (p, i) {
        return (i ? "L" : "M") + f.x(p.taxYear).toFixed(1) + " " + f.y(Math.max(p.v, S.thr[i].v)).toFixed(1);
      }).join(" ") + " " + S.thr.slice().reverse().map(function (p) {
        return "L" + f.x(p.taxYear).toFixed(1) + " " + f.y(p.v).toFixed(1);
      }).join(" ") + " Z";
      return '<path d="' + band + '" fill="' + S.meta.colour + '" opacity=".13"/>' +
        '<path d="' + line(S.pts, f) + '" fill="none" stroke="' + S.meta.colour + '" stroke-width="2"/>';
    }).join("");

    // One threshold line: it is the same law for everyone on the same plan.
    var thrLine = '<path d="' + line(series[0].thr, f) +
      '" fill="none" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="5 3"/>';

    $("salaryChart").innerHTML = f.open + body + thrLine + f.close;
    $("salaryKey").innerHTML = runKeys(runs) + '<i class="k-int">Threshold</i>';
  }

  /* ---- 3. what leaves your pay each month ------------------------------- */

  function renderMonthlyChart(runs) {
    var series = runs.map(function (sim) {
      return { meta: sim.meta, pts: sim.combined.years
        .filter(function (y) { return y.phase === "repaying"; })
        .map(function (y) { return { taxYear: y.taxYear, label: y.label, v: scaled(y, y.monthlyRepayment) }; }) };
    });
    if (!series.length || !series[0].pts.length) { $("monthlyChart").innerHTML = ""; return; }

    var f = spanFrame(runs, series, function (v) { return "£" + Math.round(v); },
                      "Monthly repayment by tax year", 440, 260, true);

    var body = series.map(function (S) {
      return '<path d="' + area(S.pts, f) + '" fill="' + S.meta.colour + '" opacity=".10"/>' +
             '<path d="' + line(S.pts, f) + '" fill="none" stroke="' + S.meta.colour + '" stroke-width="2"/>';
    }).join("");

    var zero = state.showNoLoan
      ? '<line x1="' + f.ml + '" y1="' + f.y(0).toFixed(1) + '" x2="' + (f.W - 14) + '" y2="' + f.y(0).toFixed(1) +
        '" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 3"/>'
      : "";

    $("monthlyChart").innerHTML = f.open + zero + body + cutoffMarks(runs, f, { label: false }) + f.close;
    $("monthlyKey").innerHTML = runKeys(runs) +
      (state.showNoLoan ? '<i style="color:var(--ink-3)">No loan — £0, always</i>' : "");
  }

  /* ---- 4. the interest rate --------------------------------------------- */

  function renderRateChart(runs) {
    var a = runs[0].assumptions;
    var series = [];
    runs.forEach(function (sim) {
      sim.loans.forEach(function (r, k) {
        series.push({
          meta: sim.meta,
          dash: k > 0,
          label: sim.meta.id + " · " + r.planLabel,
          pts: r.years.map(function (y) { return { taxYear: y.taxYear, label: y.label, v: y.rateHigh }; })
        });
      });
    });

    var max = a.rpi;
    series.forEach(function (S) { S.pts.forEach(function (p) { max = Math.max(max, p.v); }); });
    var top = Math.ceil(max * 100 + 0.5) / 100;
    var f = spanFrame(runs, series, function (v) { return (v * 100).toFixed(0) + "%"; },
                      "Interest rate charged by tax year", 440, 260, true, { top: top, step: top > 0.08 ? 0.02 : 0.01 });

    var rpiLine = '<line x1="' + f.ml + '" y1="' + f.y(a.rpi).toFixed(1) + '" x2="' + (f.W - 14) +
      '" y2="' + f.y(a.rpi).toFixed(1) + '" stroke="var(--ink-4)" stroke-width="1" stroke-dasharray="2 4"/>';

    var body = series.map(function (S) {
      var d = "", prev = null;
      S.pts.forEach(function (p, i) {
        var px = f.x(p.taxYear), py = f.y(p.v);
        if (i === 0) d += "M" + px.toFixed(1) + " " + py.toFixed(1);
        else d += "L" + px.toFixed(1) + " " + prev.toFixed(1) + "L" + px.toFixed(1) + " " + py.toFixed(1);
        prev = py;
      });
      return '<path d="' + d + '" fill="none" stroke="' + S.meta.colour + '" stroke-width="2"' +
        (S.dash ? ' stroke-dasharray="4 3"' : "") + ' stroke-linejoin="round"/>';
    }).join("");

    $("rateChart").innerHTML = f.open + rpiLine + body + cutoffMarks(runs, f, { label: false }) + f.close;
    $("rateKey").innerHTML = runKeys(runs) + '<i style="color:var(--ink-4)">RPI, ' + pct(a.rpi) + "</i>";
    $("rateNote").textContent = rateExplanation(runs[0]);
  }

  /* ---- 5. where it ends up, for the selected scenario -------------------- */

  function renderFlowChart(runs) {
    var sim = runs.filter(function (s) { return s.index === state.active; })[0] || runs[0];
    var r = sim.combined;
    var total = r.borrowed + r.totalInterest;
    if (!(total > 0)) { $("flowChart").innerHTML = ""; $("flowKey").innerHTML = ""; return; }

    var W = 760, H = 200, ml = 10, iw = W - 20, barH = 46, gap = 26, top = 30;
    var bar = function (yPos, segs) {
      var xc = ml, out = "";
      segs.forEach(function (s) {
        var w = (s.value / total) * iw;
        if (w <= 0) return;
        out += '<rect x="' + xc.toFixed(1) + '" y="' + yPos + '" width="' + w.toFixed(1) +
          '" height="' + barH + '" fill="' + s.colour + '"/>';
        if (w > 104) {
          out += '<text x="' + (xc + 10).toFixed(1) + '" y="' + (yPos + 19) +
            '" font-size="12.5" font-weight="600" fill="#0b0e13">' + s.label + "</text>" +
            '<text x="' + (xc + 10).toFixed(1) + '" y="' + (yPos + 35) +
            '" font-size="13" fill="#0b0e13" opacity=".88">' + gbp(s.value) + "</text>";
        } else {
          // Too narrow to write inside; label it underneath instead.
          out += '<text x="' + (xc + w / 2).toFixed(1) + '" y="' + (yPos + barH + 12) +
            '" text-anchor="middle" font-size="10.5" fill="' + s.colour + '">' +
            s.label + " " + gbpShort(s.value) + "</text>";
        }
        xc += w;
      });
      return out;
    };
    var cap = function (t, y) {
      return '<text x="' + ml + '" y="' + y + '" font-size="12" font-weight="600" letter-spacing=".05em" ' +
        'fill="var(--ink-4)">' + t.toUpperCase() + "</text>";
    };

    $("flowChart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="What you were charged, and where it ended up">' +
      cap("Scenario " + sim.meta.id + " — charged", top - 10) +
      bar(top, [{ label: "Borrowed", value: r.borrowed, colour: "var(--info)" },
                { label: "Interest", value: r.totalInterest, colour: "var(--warn)" }]) +
      cap("Where it went", top + barH + gap + 10) +
      bar(top + barH + gap + 20, [{ label: "You repaid", value: r.totalRepaid, colour: sim.meta.colour },
                                  { label: "Written off", value: r.writtenOff || 0, colour: "var(--bad)" }]) +
      "</svg>";

    $("flowKey").innerHTML = '<i style="color:var(--info)">Borrowed</i><i class="k-int">Interest</i>' +
      '<i style="color:' + sim.meta.colour + '">Repaid</i>' +
      ((r.writtenOff || 0) > 0 ? '<i style="color:var(--bad)">Written off</i>' : "") +
      '<i style="color:var(--ink-4)">£' + r.perPoundBorrowed.toFixed(2) + " per £1 borrowed</i>";
  }

  /* ---- 6. the running cost of having a loan ------------------------------ *
   * The whole comparison in one picture: each line is money gone for good,
   * and the flat line along the bottom is the life where you never borrowed.
   * ---------------------------------------------------------------------- */

  function renderCostChart(runs) {
    var real = state.basis === "real";
    var series = runs.map(function (sim) {
      var cum = 0;
      return { meta: sim.meta, pts: sim.combined.years.map(function (y) {
        cum += real ? y.realRepaid : (y.repaid + y.voluntary);
        return { taxYear: y.taxYear, label: y.label, v: cum };
      }) };
    });
    var f = spanFrame(runs, series, gbpShort, "Total handed over, accumulating, by tax year", 760, 280, true);

    var body = series.map(function (S) {
      return '<path d="' + area(S.pts, f) + '" fill="' + S.meta.colour + '" opacity=".08"/>' +
             '<path d="' + line(S.pts, f) + '" fill="none" stroke="' + S.meta.colour + '" stroke-width="2.25"/>';
    }).join("");

    var zero = state.showNoLoan
      ? '<line x1="' + f.ml + '" y1="' + f.y(0).toFixed(1) + '" x2="' + (f.W - 14) + '" y2="' + f.y(0).toFixed(1) +
        '" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 4"/>' +
        '<text x="' + (f.W - 18) + '" y="' + (f.y(0) - 8).toFixed(1) +
        '" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-3)">No loan \u2014 you keep it all</text>'
      : "";

    $("costChart").innerHTML = f.open + zero + body + cutoffMarks(runs, f) + f.close;
    $("costKey").innerHTML = runKeys(runs) +
      (state.showNoLoan ? '<i style="color:var(--ink-3)">Never borrowed</i>' : "");
  }

  /* ---- 7. side by side --------------------------------------------------- */

  function renderBarsChart(runs) {
    var rows = runs.map(function (sim) {
      return { label: sim.meta.id + " · " + scenarioName(sim.settings),
               value: sim.combined.totalRepaid, colour: sim.meta.colour,
               note: sim.combined.everRepaidInFull
                 ? "cleared " + sim.combined.clearedLabel
                 : gbp(sim.combined.writtenOff) + " written off" };
    });
    if (state.showNoLoan) rows.push({ label: "No loan", value: 0, colour: "var(--ink-3)", note: "you keep it all" });

    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    var rowH = 46, padT = 8, W = 760, labelW = 238, barW = W - labelW - 132;
    var H = padT * 2 + rows.length * rowH;

    var body = rows.map(function (r, i) {
      var y = padT + i * rowH;
      var w = Math.max((r.value / max) * barW, r.value > 0 ? 2 : 0);
      return '<text x="0" y="' + (y + 18) + '" font-size="13" font-weight="600" fill="var(--ink-2)">' + r.label + "</text>" +
        '<text x="0" y="' + (y + 33) + '" font-size="11" fill="var(--ink-4)">' + r.note + "</text>" +
        '<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + w.toFixed(1) + '" height="22" rx="3" fill="' + r.colour + '"/>' +
        '<text x="' + (labelW + w + 10).toFixed(1) + '" y="' + (y + 22) +
        '" font-size="13" font-family="ui-monospace,monospace" fill="var(--ink)">' + gbp(r.value) + "</text>";
    }).join("");

    $("barsChart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lifetime cost of each scenario">' + body + "</svg>";
    $("barsKey").innerHTML = '<i style="color:var(--ink-4)">Cash handed over across the whole term</i>';
  }

  /* ---- the facts that decide everything, always in view ------------------ */

  function renderFacts(runs) {
    var a = runs[0].assumptions;
    var plans = {};
    runs.forEach(function (s) { plans[s.settings.plan] = true; });
    var planNames = Object.keys(plans).map(function (k) { return E.RULES[k].label; }).join(", ");

    var facts = [
      { k: "Plan", v: planNames },
      { k: "RPI", v: pct(a.rpi) },
      { k: "Inflation", v: pct(a.inflation) },
      { k: "Thresholds", v: "+" + pct(a.thresholdGrowth) + " a year" },
      { k: "Savings", v: pct(a.savings) },
      { k: "Write-off", v: (function () {
          var cs = cutoffs(runs).sort(function (x, y) { return x.years - y.years; });
          // Three plans spelled out in full ran the strip off a phone screen.
          return cs.length === 1
            ? cs[0].years + " yrs \u00b7 " + E.taxYearLabel(cs[0].taxYear - 1)
            : cs.map(function (c) { return c.years; }).join(" / ") + " yrs";
        })() },
      { k: "Threshold now", v: gbp(E.thresholdFor(runs[0].settings.plan, Math.max(E.BASE_TAX_YEAR, repayStartYear()), a)) }
    ];
    $("facts").innerHTML = facts.map(function (f) {
      return "<div><dt>" + f.k + "</dt><dd>" + f.v + "</dd></div>";
    }).join("");
  }

  /* ---- the selected profile, in full ------------------------------------- *
   * Everything about one profile on one screen: what it costs, and what the
   * same money would have done had it never left your hands.
   * ---------------------------------------------------------------------- */

  function renderFocus(runs) {
    var sim = runs.filter(function (s) { return s.index === state.active; })[0] || runs[0];
    var r = sim.combined, o = sim.opportunity;
    var real = state.basis === "real";
    var money = function (cash, deflated) { return gbp(real ? deflated : cash); };

    $("whoFocus").textContent = sim.meta.id;
    $("whoFocus").style.color = sim.meta.colour;
    $("focusCard").style.setProperty("--c", sim.meta.colour);

    var repaying = r.years.filter(function (y) { return y.phase === "repaying"; });
    var firstPaid = repaying.filter(function (y) { return y.monthlyRepayment > 0; })[0];
    var peak = repaying.reduce(function (m, y) { return Math.max(m, y.monthlyRepayment); }, 0);

    var rows = [
      { g: "The loan", k: "Borrowed", v: gbp(r.borrowed) },
      { g: "The loan", k: "Owed when repayment starts", v: gbp(r.balanceAtRepayStart) },
      { g: "The loan", k: "Interest charged", v: gbp(r.totalInterest), c: "warn" },
      { g: "The loan", k: "Peak balance", v: gbp(repaying.reduce(function (m, y) {
          return Math.max(m, y.closingBalance); }, r.balanceAtRepayStart)) },

      { g: "What you pay", k: "Handed over, in cash", v: gbp(r.totalRepaid), c: "good" },
      { g: "What you pay", k: "Handed over, today's money", v: gbp(r.totalRealRepaid), c: "good" },
      { g: "What you pay", k: "First deduction", v: firstPaid ? gbp(firstPaid.monthlyRepayment) + " a month" : "never" },
      { g: "What you pay", k: "Peak deduction", v: gbp(peak) + " a month" },
      { g: "What you pay", k: "Years repaying", v: String(r.yearsRepaying) },
      { g: "What you pay", k: r.everRepaidInFull ? "Cleared" : "Written off",
        v: r.everRepaidInFull ? r.clearedLabel : gbp(r.writtenOff) + " in " + r.writeOffLabel,
        c: r.everRepaidInFull ? "good" : "bad" },

      { g: "Or you could have saved it", k: "Clear it today, in one payment", v: gbp(o.lump) },
      { g: "Or you could have saved it", k: "…that lump, saved for " + o.years + " years",
        v: money(o.fvLump, o.realFvLump) },
      { g: "Or you could have saved it", k: "Your repayments, saved as you go",
        v: money(o.fvRepayments, o.realFvRepayments) },
      { g: "Or you could have saved it", k: "Cheaper option",
        v: o.clearingIsBetter ? "clear it today" : "keep the money",
        c: o.clearingIsBetter ? "warn" : "good" },
      { g: "Or you could have saved it", k: "By",
        v: money(Math.abs(o.clearingSaves), Math.abs(o.realClearingSaves)) }
    ];

    var groups = [];
    rows.forEach(function (row) {
      var g = groups.filter(function (x) { return x.name === row.g; })[0];
      if (!g) { g = { name: row.g, rows: [] }; groups.push(g); }
      g.rows.push(row);
    });

    $("focusGrid").innerHTML = groups.map(function (g) {
      return '<div class="fgroup"><h4>' + g.name + "</h4><dl>" + g.rows.map(function (row) {
        return "<div><dt>" + row.k + '</dt><dd class="' + (row.c || "") + '">' + row.v + "</dd></div>";
      }).join("") + "</dl></div>";
    }).join("");

    renderOppChart(sim);

    $("oppVerdict").innerHTML = o.years === 0
      ? "Nothing is ever deducted on this profile, so there is nothing to weigh against saving."
      : (o.clearingIsBetter
        ? "Clearing the balance today would cost <b>" + gbp(o.lump) + "</b> — and even after giving up " +
          pct(o.savingsRate) + " a year on that money for " + o.years + " years, it comes out <b>" +
          gbp(Math.abs(o.clearingSaves)) + "</b> ahead of repaying as required."
        : "Clearing the balance today would cost <b>" + gbp(o.lump) + "</b> now. Keeping that money and " +
          "letting it earn " + pct(o.savingsRate) + " while you repay as required leaves you <b>" +
          gbp(Math.abs(o.clearingSaves)) + "</b> better off by " + (repaying.length ?
          E.taxYearLabel(repaying[repaying.length - 1].taxYear + 1) : "the end") +
          " — because deductions spread over decades are cheap money, and the write-off may cancel what is left.");
  }

  /* ---- the two choices, racing --------------------------------------------
   * One line is the repayments piling up with interest you never earned; the
   * other is the balance you did not clear, growing. Where they cross is the
   * moment one choice overtakes the other.
   * ---------------------------------------------------------------------- */

  function renderOppChart(sim) {
    var o = sim.opportunity;
    if (!o.track.length) { $("oppChart").innerHTML = ""; $("oppKey").innerHTML = ""; return; }

    var pts = o.track.map(function (t) {
      return { taxYear: t.taxYear, label: t.label, v: t.repaymentsSaved, w: t.lumpGrown };
    });
    var max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.v, p.w); });
    var s = niceScale(max);
    var f = frame({ years: pts, xMin: pts[0].taxYear, xMax: pts[pts.length - 1].taxYear,
                    top: s.top, step: s.step, fmt: gbpShort, w: 760, h: 260,
                    title: "Repaying as required against clearing the balance today and saving" });

    var lineW = pts.map(function (p, i) {
      return (i ? "L" : "M") + f.x(p.taxYear).toFixed(1) + " " + f.y(p.w).toFixed(1);
    }).join(" ");

    $("oppChart").innerHTML = f.open +
      '<path d="' + line(pts, f) + '" fill="none" stroke="' + sim.meta.colour + '" stroke-width="2.25"/>' +
      '<path d="' + lineW + '" fill="none" stroke="var(--warn)" stroke-width="2.25" stroke-dasharray="5 4"/>' +
      f.close;

    $("oppKey").innerHTML =
      '<i style="color:' + sim.meta.colour + '">Your repayments, saved instead</i>' +
      '<i class="k-int">The balance you did not clear, growing at ' + pct(o.savingsRate) + "</i>" +
      '<i style="color:var(--ink-4)">whichever is lower is the cheaper choice</i>';
  }

  /* ---- the hard cut-off --------------------------------------------------- *
   * The write-off is not a soft landing: on its anniversary the balance is
   * cancelled outright, however large, and the deductions stop. That wall is
   * the single most important feature of the whole scheme, so it gets drawn.
   * ---------------------------------------------------------------------- */

  function cutoffs(runs) {
    var seen = {}, out = [];
    runs.forEach(function (sim) {
      var years = E.RULES[sim.settings.plan].writeOffYears;
      var at = repayStartYear() + years;                 // the April it lands on
      var k = at + ":" + years;
      if (seen[k]) { seen[k].plans.push(sim.meta.id); return; }
      seen[k] = { taxYear: at, years: years, plans: [sim.meta.id], colour: sim.meta.colour };
      out.push(seen[k]);
    });
    // A cut-off every profile shares is not one profile's business — grey it.
    out.forEach(function (c) { if (out.length === 1) c.colour = "var(--ink-3)"; });
    return out;
  }

  // The wall itself, drawn over the plotted lines.
  function cutoffMarks(runs, f, opts) {
    opts = opts || {};
    var walls = cutoffs(runs).sort(function (a, b) { return a.taxYear - b.taxYear; });
    return walls.map(function (c, i) {
      var x = f.x(c.taxYear);
      if (!isFinite(x)) return "";
      var label = c.years + " years \u2014 written off";
      var out =
        '<line x1="' + x.toFixed(1) + '" y1="' + f.mt + '" x2="' + x.toFixed(1) + '" y2="' + (f.mt + f.ih) +
        '" stroke="' + c.colour + '" stroke-width="1.5" stroke-dasharray="2 4" opacity=".8"/>';
      if (opts.label !== false) {
        // Terms only five years apart would put their labels on top of each
        // other, so each wall gets its own line.
        out += '<text x="' + (x - 7).toFixed(1) + '" y="' + (f.mt + 11 + i * 14) +
          '" text-anchor="end" font-size="10.5" font-weight="600" fill="' + c.colour + '">' +
          (c.plans.length < runs.length ? c.plans.join("") + " \u00b7 " : "") + label + "</text>";
      }
      return out;
    }).join("");
  }

  // The furthest cut-off, so the wall is always inside the frame even when
  // every profile clears long before it.
  function cutoffMax(runs) {
    return cutoffs(runs).reduce(function (m, c) { return Math.max(m, c.taxYear); }, -Infinity);
  }

  /* ---- shared plumbing --------------------------------------------------- */

  function line(pts, f) {
    return pts.map(function (p, i) {
      return (i ? "L" : "M") + f.x(p.taxYear).toFixed(1) + " " + f.y(p.v).toFixed(1);
    }).join(" ");
  }
  function area(pts, f) {
    return line(pts, f) + " L" + f.x(pts[pts.length - 1].taxYear).toFixed(1) + " " + f.y(0) +
           " L" + f.x(pts[0].taxYear).toFixed(1) + " " + f.y(0) + " Z";
  }

  // One frame wide enough for every scenario on the chart, so the lines are
  // read against the same axes rather than each against its own.
  function spanFrame(runs, series, fmt, title, w, h, showCutoff, forced) {
    var lo = Infinity, hi = -Infinity, max = 0, years = null;
    series.forEach(function (S) {
      S.pts.forEach(function (p) {
        if (p.taxYear < lo) lo = p.taxYear;
        if (p.taxYear > hi) hi = p.taxYear;
        if (p.v > max) max = p.v;
      });
      if (!years || S.pts.length > years.length) years = S.pts;
    });
    // Keep the write-off wall in view even when every line stops well short of
    // it — that gap is the point.
    if (showCutoff) {
      var wall = cutoffMax(runs);
      if (isFinite(wall) && wall > hi) {
        hi = wall;
        years = years.concat([{ taxYear: wall, label: E.taxYearLabel(wall) }]);
      }
    }
    var s = forced || niceScale(max);
    return frame({ years: years, xMin: lo, xMax: hi, top: s.top, step: s.step,
                   fmt: fmt, title: title, w: w, h: h });
  }

  function runKeys(runs) {
    return runs.map(function (sim) {
      return '<i style="color:' + sim.meta.colour + '">' + sim.meta.id + " · " +
        scenarioName(sim.settings) + "</i>";
    }).join("");
  }

  function renderAllCharts(runs) {
    renderFacts(runs);
    renderChart(runs);
    renderSalaryChart(runs);
    renderMonthlyChart(runs);
    renderRateChart(runs);
    renderFlowChart(runs);
    renderCostChart(runs);
    renderBarsChart(runs);
    renderFocus(runs);
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
        '<td class="n">' + ageAt(y.taxYear) + "</td>" +
        '<td class="n">' + (y.phase === "studying" ? "studying" : gbp(y.salary)) + "</td>" +
        '<td class="n">' + (y.threshold ? gbp(y.threshold) : "\u2014") + "</td>" +
        '<td class="n">' + (y.phase === "studying" ? "\u2014" : gbp(y.monthlyRepayment)) + "</td>" +
        '<td class="n">' + (due > 0 ? gbp(due) : "—") + "</td>" +
        '<td class="n">' + rateCell(y) + "</td>" +
        '<td class="n">' + gbp(y.interest) + "</td>" +
        '<td class="n">' + gbp(y.cumRepaid) + "</td>" +
        '<td class="n">' + gbp(y.closingBalance) + "</td></tr>";

      if (isOpen) rows += monthRows(y, months);
    });

    var r = sim.combined;
    rows += '<tr class="final"><td>Total</td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td>' +
      '<td class="n">' + gbp(r.totalRepaid) + '</td><td class="n">' + gbp(r.totalInterest) + '</td>' +
      '<td class="n">—</td><td class="n">' +
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
        '<td class="n">' + (m.drawdown ? gbp(m.drawdown) : "—") + "</td>" +
        '<td class="n">' + (m.phase === "repaying" ? gbp(m.salary / 12) : "—") + "</td>" +
        '<td class="n">' + (m.payment + m.voluntary > 0 ? gbp(m.payment + m.voluntary) : "—") + "</td>" +
        '<td class="n">' + (m.rate != null ? pct(m.rate, 2) : "—") + "</td>" +
        '<td class="n">' + gbp(m.interest) + "</td>" +
        '<td class="n">' + gbp(m.balance) + "</td></tr>";
    }
    return '<tr class="months"><td colspan="10"><table class="month-table">' +
      "<thead><tr><th>Month</th><th class=\"n\">Borrowed</th><th class=\"n\">Gross pay</th>" +
      "<th class=\"n\">Deducted</th><th class=\"n\">Rate</th><th class=\"n\">Interest</th><th class=\"n\">Balance</th></tr></thead>" +
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
    markCareer();
    markLength();

    $("predictSummary").innerHTML =
      "Starting on <b>" + gbp(firstSal) + "</b> in " + E.taxYearLabel(start) +
      " and reaching <b>" + gbp(tenth) + "</b> ten years later" +
      (profile().mode === "growth" ? "." : ", with inflation of " + pct(a.inflation) + " added on top.");
  }

  /* ---------------------------------------------------------------------- *
   * THE SALARY TABLE
   * -------------------------------------------------------------------- */

  function buildSalaryTable() {
    var host = $("salaryRows");
    if (!host) return;
    var p = state.scen[state.active];
    var a = assumptions();
    var predicted = predictedSalaries(a);
    var start = repayStartYear();
    var rows = "";
    for (var i = 0; i < (p.manualYears || 12); i++) {
      var y = start + i;
      var v = p.manual && p.manual[y] != null ? p.manual[y] : Math.round(predicted[y] || 0);
      rows += "<tr><td>" + E.taxYearLabel(y) + '</td><td class="age">' + ageAt(y) + "</td>" +
        '<td><input type="number" min="0" max="1000000" step="500" data-year="' + y + '" value="' + Math.round(v) + '" /></td></tr>';
    }
    host.innerHTML = rows;
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
      var data = { state: {
        loanMode: state.loanMode, incomeMode: state.incomeMode,
        manual: state.manual, manualYears: state.manualYears,
        scen: state.scen, active: state.active, showNoLoan: state.showNoLoan,
        panelOpen: state.panelOpen
      }, fields: {} };
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
        if (Array.isArray(data.state.scen) && data.state.scen.length === SCEN_META.length) state.scen = data.state.scen;
        if (typeof data.state.active === "number") state.active = data.state.active;
        if (typeof data.state.showNoLoan === "boolean") state.showNoLoan = data.state.showNoLoan;
        if (typeof data.state.panelOpen === "boolean") state.panelOpen = data.state.panelOpen;
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

      var ctl = box.closest(".ctl");
      if (!ctl) return;
      if (box.dataset.slid) return;      // already fitted; this runs more than once
      box.dataset.slid = "1";
      var range = document.createElement("input");
      range.type = "range";
      range.min = lo; range.max = hi; range.step = step;
      range.value = clamp(parseFloat(box.value) || lo, lo, hi);
      range.tabIndex = -1;                       // the value box is the tab stop
      range.setAttribute("aria-hidden", "true");

      // Straight under the label-and-value row, above any select or note.
      var top = ctl.querySelector(".ctl__top");
      top.parentNode.insertBefore(range, top.nextSibling);

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

  function buildCareerCards() {
    var host = $("careerCards");
    host.innerHTML = CAREERS.map(function (c) {
      var keys = Object.keys(c.points).map(Number).sort(function (a, b) { return a - b; });
      var from = "from " + gbpShort(c.points[keys[0]]);
      return '<button type="button" class="pick" role="radio" aria-checked="false" data-career="' + c.id + '">' +
        "<b>" + c.label + "</b><span>" + from + "</span></button>";
    }).join("");

    host.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".pick");
      if (!btn) return;
      $("career").value = btn.dataset.career;
      captureScenario();
      markCareer();
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
        n + "</button>";
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
      return '<option value="' + l.id + '" title="' + l.full + '">' + l.label +
        (l.max ? " \u00b7 up to " + gbpShort(l.max) : "") + "</option>";
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
        '<td class="n">' + gbp(p.threshold) + "</td>" +
        '<td class="n">' + pct(p.rate, 0) + "</td>" +
        "<td>" + describe[p.interest] + "</td>" +
        '<td class="n">' + p.writeOffYears + " years</td></tr>";
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
    // Income mode
    document.querySelectorAll("[data-mode]").forEach(function (t) {
      t.addEventListener("click", function () {
        selectMode(t.dataset.mode);
        buildBandRows();
        buildSalaryTable();
        fitSliders();
        run();
      });
    });

    // Tabs
    document.querySelectorAll('[role="tab"][data-tab]').forEach(function (t) {
      t.addEventListener("click", function () {
        var name = t.dataset.tab;
        selectTab(t.parentNode, name);
        if (name === "course" || name === "balance") state.loanMode = name;
        run();
      });
    });

    // Any input rerun the simulation
    $("form").addEventListener("input", function (ev) {
      var t = ev.target;
      var p = state.scen[state.active];

      if (t.dataset && t.dataset.year) {
        var v = parseFloat(t.value);
        if (!p.manual) p.manual = {};
        p.manual[t.dataset.year] = isFinite(v) ? Math.max(0, v) : 0;
        run();
        return;
      }
      if (t.dataset && t.dataset.band != null) {
        var bv = parseFloat(t.value);
        p.bands[Number(t.dataset.band)] = isFinite(bv) ? Math.max(0, bv) : 0;
        var mate = document.querySelector('[data-bandrange="' + t.dataset.band + '"]');
        if (mate) mate.value = clamp(p.bands[Number(t.dataset.band)], 0, 150000);
        run();
        return;
      }
      if (t.dataset && t.dataset.bandrange != null) {
        var rv = parseFloat(t.value);
        p.bands[Number(t.dataset.bandrange)] = rv;
        var box = $("band" + t.dataset.bandrange);
        if (box) box.value = Math.round(rv);
        run();
        return;
      }
      if (t.id === "living") {
        var l = LIVING.filter(function (x) { return x.id === t.value; })[0];
        if (l) $("maintenance").value = l.max;
      }
      if (t.id === "hasPgl") $("pglRow").hidden = !t.checked;
      if (t.id === "birthYear") buildSalaryTable();
      if (t.id === "startYear" || t.id === "repayStartYear") {
        state.scen[state.active].manual = {};
        buildSalaryTable();
      }
      run();
    });
    $("form").addEventListener("change", function () { run(); });

    // Salary table controls
    $("addYears").addEventListener("click", function () {
      var p = state.scen[state.active];
      p.manualYears = Math.min((p.manualYears || 12) + 5, 45);
      buildSalaryTable(); run();
    });
    $("resetSalaries").addEventListener("click", function () {
      state.scen[state.active].manual = {}; buildSalaryTable(); run();
    });

    // Cash / today's money
    document.querySelectorAll("[data-basis]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.basis = b.dataset.basis;
        document.querySelectorAll("[data-basis]").forEach(function (o) { o.classList.toggle("on", o === b); });
        renderAllCharts(lastRuns);
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

    $("panelToggle").addEventListener("click", function () {
      state.panelOpen = !state.panelOpen;
      applyPanel();
      if (lastRuns) renderAllCharts(lastRuns);   // the charts have more room now
      save();
    });

    $("showNoLoan").addEventListener("change", function () {
      state.showNoLoan = $("showNoLoan").checked;
      run();
    });

    // The headline cells are also a way of selecting a scenario.
    $("heroRow").addEventListener("click", function (ev) {
      var cell = ev.target.closest("[data-jump]");
      if (!cell) return;
      state.active = Number(cell.dataset.jump);
      loadScenario(); markScens(); run();
    });

    $("form").addEventListener("submit", function (ev) { ev.preventDefault(); });
  }

  function applyPanel() {
    document.body.classList.toggle("panel-shut", !state.panelOpen);
    var btn = $("panelToggle");
    btn.setAttribute("aria-expanded", state.panelOpen ? "true" : "false");
    btn.textContent = state.panelOpen ? "\u2190 Hide controls" : "\u2192";
    btn.title = state.panelOpen ? "Hide the controls" : "Show the controls";
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
    buildScenTabs();
    state.scen = [0,1,2,3,4].map(blankScenario);
    var restored = restore();
    if (!restored) {
      $("plan").value = "plan5";
      $("career").value = "grad";
    }
    $("pglRow").hidden = !$("hasPgl").checked;
    selectTab($("tab-course").parentNode, state.loanMode);
    $("plan").addEventListener("change", function () {
      $("planBlurb").textContent = E.RULES[$("plan").value].blurb;
    });
    fitSliders();
    $("showNoLoan").checked = state.showNoLoan;
    applyPanel();
    loadScenario();
    fitSliders();
    markScens();
    markCareer();
    markLength();
    wire();
    run();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
