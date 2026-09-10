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

  /* Six paths, chosen to span the range of outcomes rather than the range of
     job titles: their ceilings run £34k, £42k, £56k, £95k, £130k, £200k, each
     about half again the last. Twelve were offered before, but five of them
     shared a ceiling near £55k and three more sat within £5k of each other at
     £90k, so most of the list was saying the same thing twice. Anything not
     represented here is exactly what "Start + growth" and "5-year bands" are
     for. */
  var CAREERS = [
    {
      id: "low", label: "Low or intermittent",
      note: "Around or a little above the threshold, with long flat stretches. The case the write-off exists for.",
      points: { 1: 24000, 5: 27000, 10: 30000, 20: 34000 }, after: 0.005
    },
    {
      id: "creative", label: "Charity, arts and media",
      note: "Graduate-level work at below-graduate pay, with a low ceiling.",
      points: { 1: 26000, 4: 31000, 8: 36000, 15: 42000 }, after: 0.005
    },
    {
      id: "grad", label: "Graduate, typical",
      note: "The middle of the graduate labour market — and close to teaching, nursing, engineering and the civil service, which all plateau near the same place.",
      points: { 1: 30000, 5: 38000, 10: 46000, 20: 56000 }, after: 0.005
    },
    {
      id: "tech", label: "Tech, law or finance",
      note: "Fast early progression flattening once you are senior. Software, accountancy and law outside the City all land within a few thousand of each other.",
      points: { 1: 35000, 3: 48000, 6: 65000, 10: 80000, 20: 95000 }, after: 0.005
    },
    {
      id: "medicine", label: "Doctor (NHS)",
      note: "Foundation pay, then the training grades, then consultant. A five- or six-year course.",
      points: { 1: 38000, 3: 52000, 6: 66000, 9: 82000, 13: 110000, 20: 130000 }, after: 0.005
    },
    {
      id: "citylaw", label: "Law or banking, City",
      note: "The top of the graduate market — a training contract or an analyst seat in the City.",
      points: { 1: 60000, 3: 95000, 6: 130000, 10: 165000, 18: 200000 }, after: 0.005
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
    pgTouched: false,        // has the reader placed these dates themselves?
    workTouched: false,
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
      rpiKnown: E.DEFAULT_ASSUMPTIONS.rpiKnown,
      rpiReformYear: E.DEFAULT_ASSUMPTIONS.rpiReformYear,
      rpiReformDrop: num("rpiReformDrop", 0.9) / 100,
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
   * THE TIMELINE
   *
   * Education and work are no longer assumed to run straight into one another.
   * An undergraduate course, optionally a postgraduate one, and a year work
   * actually starts — which may be later than either, and need not be the year
   * repayments become due. Repayment dates follow the law; income follows the
   * life.
   * -------------------------------------------------------------------- */

  function timeline() {
    var ugStart = Math.round(num("startYear", 2026));
    var ugYears = Math.round(num("courseYears", 3));
    var pg = $("hasPgl").checked;
    var pgStart = Math.round(num("pgStartYear", ugStart + ugYears));
    var pgYears = Math.round(num("pgYears", 1));
    return {
      ugStart: ugStart,
      ugYears: ugYears,
      ugEnds: ugStart + ugYears,                       // the summer it finishes
      ugRepayFrom: E.repaymentStartYear(ugStart, ugYears),
      pg: pg,
      pgStart: pgStart,
      pgYears: pgYears,
      pgEnds: pgStart + pgYears,
      pgRepayFrom: E.repaymentStartYear(pgStart, pgYears),
      workStart: Math.round(num("workStartYear", ugStart + ugYears))
    };
  }

  // The year work would naturally begin if nothing intervened.
  function defaultWorkStart(t) {
    return t.pg ? t.pgEnds : t.ugEnds;
  }

  /* ---------------------------------------------------------------------- *
   * THE TIMELINE, AS BLOCKS YOU CAN GRAB
   *
   * Five sliders and two rows of chips described a sequence of years without
   * showing it. These are the years: undergraduate, postgraduate and the
   * career, laid on a track and dragged into place. A gap between blocks is
   * a year out — it needs no block of its own to say so. The career block
   * has no right edge, because nobody knows where it ends.
   * -------------------------------------------------------------------- */

  var TL_MIN = 1, TL_PAD = 3;
  var tlGrab = null;

  // The span the track covers. Frozen while dragging so the ground does not
  // move under the pointer.
  function tlRange() {
    if (tlGrab && tlGrab.range) return tlGrab.range;
    var t = timeline();
    var p = state.scen[state.active];
    var last = Math.max(t.ugEnds, t.workStart + 8, t.pg ? t.pgEnds : 0);
    var from = t.ugStart - 1;
    return { from: from, to: Math.max(from + 12, last + TL_PAD) };
  }

  function tlBlocks() {
    var t = timeline();
    var p = state.scen[state.active];
    var out = [
      { id: "ug", lane: "A", kind: "ug", from: t.ugStart, to: t.ugEnds,
        label: "Undergrad", short: "UG", resizable: true, movable: true }
    ];
    if (t.pg) {
      out.push({ id: "pg", lane: "A", kind: "pg", from: t.pgStart, to: t.pgEnds,
                 label: "Postgrad", short: "PG", resizable: true, movable: true, removable: true });
    }
    out.push({ id: "work", lane: "A", kind: "work", from: t.workStart, to: null,
               label: "Career", short: "WORK", resizable: false, movable: true });
    return out;
  }

  function renderTimelineTrack() {
    var host = $("tlTrack");
    if (!host) return;
    var r = tlRange(), span = Math.max(1, r.to - r.from);
    var pc = function (y) { return ((y - r.from) / span) * 100; };

    var px = $("tlLaneA").clientWidth || 280;
    var every = span > 24 ? 5 : span > 14 ? 3 : 2;
    var scale = "";
    for (var y = r.from; y <= r.to; y++) {
      if ((y - r.from) % every) continue;
      var at = pc(y);
      if (at > 93) continue;          // it would crowd the one pinned to the end
      // a tick centred on the very edge is half cut off, so pin that one flush
      var pin = at < 3 ? " is-first" : "";
      scale += '<span class="tl__tick' + pin + '" style="left:' + at.toFixed(2) + '%">' + y + "</span>";
    }
    scale += '<span class="tl__tick is-last">' + r.to + "</span>";
    $("tlScale").innerHTML = scale;

    var lanes = { A: "" };
    tlBlocks().forEach(function (b) {
      var left = pc(b.from);
      var width = Math.max(b.to == null ? (100 - left) : (pc(b.to) - left), 1.2);
      // A name wider than its block is a smear of half-letters. It gives way
      // to a two-letter form, and then to the tooltip alone.
      var wpx = (width / 100) * px;
      var fits = function (s) { return wpx > s.length * 6.6 + 20; };
      var name = fits(b.label) ? b.label : fits(b.short) ? b.short : "";
      lanes[b.lane] +=
        '<div class="tl__blk k-' + b.kind + (b.to == null ? " is-open" : "") + '" data-blk="' + b.id +
          '" style="left:' + left.toFixed(2) + "%;width:" + width.toFixed(2) + '%" ' +
          'title="' + b.label + " " + b.from + (b.to == null ? " onwards" : "\u2013" + b.to) + '">' +
        (b.resizable ? '<i class="tl__grip is-l" data-edge="l"></i>' : "") +
        (name ? '<span class="tl__name">' + name + "</span>" : "") +
        (b.removable ? '<button type="button" class="tl__x" data-drop="' + b.id + '" aria-label="Remove ' + b.label + '">\u00d7</button>' : "") +
        (b.resizable ? '<i class="tl__grip is-r" data-edge="r"></i>' : "") +
        "</div>";
    });
    $("tlLaneA").innerHTML = lanes.A;

    var t = timeline();
    var gap = t.workStart - defaultWorkStart(t);
    $("tlNote").innerHTML =
      "Studying " + t.ugStart + "\u2013" + t.ugEnds +
      (t.pg ? ", then " + t.pgStart + "\u2013" + t.pgEnds : "") +
      ". Working from <b>" + t.workStart + "</b>" +
      (gap > 0 ? ", after " + gap + (gap === 1 ? " year" : " years") + " out" : "") + ".";
    $("tlAddPg").textContent = t.pg ? "− Postgrad" : "+ Postgrad";
  }

  function tlYearAtX(clientX) {
    var rect = $("tlLaneA").getBoundingClientRect();
    var r = tlRange(), span = Math.max(1, r.to - r.from);
    return r.from + ((clientX - rect.left) / rect.width) * span;
  }

  function tlApply(g, year) {
    var t = timeline();
    var p = state.scen[state.active];
    var d = Math.round(year - g.grabbedAt);
    var set = function (id, v) { $(id).value = v; };

    if (g.id === "ug") {
      if (g.edge === "l") {
        var to = g.orig.to;
        var from = clamp(g.orig.from + d, 2000, to - TL_MIN);
        set("startYear", from); set("courseYears", to - from);
      } else if (g.edge === "r") {
        set("courseYears", clamp(g.orig.to + d - g.orig.from, TL_MIN, 8));
      } else {
        set("startYear", clamp(g.orig.from + d, 2000, 2060));
      }
      if (!state.pgTouched) set("pgStartYear", timeline().ugEnds);
    } else if (g.id === "pg") {
      state.pgTouched = true;
      if (g.edge === "l") {
        var pto = g.orig.to;
        var pfrom = clamp(g.orig.from + d, t.ugEnds, pto - TL_MIN);
        set("pgStartYear", pfrom); set("pgYears", pto - pfrom);
      } else if (g.edge === "r") {
        set("pgYears", clamp(g.orig.to + d - g.orig.from, TL_MIN, 6));
      } else {
        set("pgStartYear", clamp(g.orig.from + d, t.ugEnds, 2060));
      }
    } else if (g.id === "work") {
      state.workTouched = true;
      set("workStartYear", clamp(g.orig.from + d, t.ugStart, 2070));
    }

    if (g.id !== "work" && !state.workTouched) set("workStartYear", defaultWorkStart(timeline()));
    p.manual = {};
  }

  function wireTimelineTrack() {
    var host = $("tlTrack");
    if (!host) return;

    host.addEventListener("click", function (ev) {
      var drop = ev.target.closest("[data-drop]");
      if (!drop) return;
      var id = drop.dataset.drop;
      if (id === "pg") { $("hasPgl").checked = false; $("pglRow").hidden = true; }
      renderTimelineTrack(); run(); save();
    });

    host.addEventListener("pointerdown", function (ev) {
      if (ev.target.closest("[data-drop]")) return;   // that is the remove cross
      var el = ev.target.closest("[data-blk]");
      if (!el) return;
      var blk = tlBlocks().filter(function (b) { return b.id === el.dataset.blk; })[0];
      if (!blk) return;
      var edge = (ev.target.closest("[data-edge]") || {}).dataset;
      tlGrab = {
        id: blk.id, index: blk.index,
        edge: edge ? edge.edge : null,
        orig: { from: blk.from, to: blk.to == null ? blk.from + 1 : blk.to },
        grabbedAt: tlYearAtX(ev.clientX),
        range: tlRange()
      };
      ev.preventDefault();
      host.setPointerCapture(ev.pointerId);
      host.classList.add("is-grabbed");
    });

    host.addEventListener("pointermove", function (ev) {
      if (!tlGrab) return;
      tlApply(tlGrab, tlYearAtX(ev.clientX));
      renderTimelineTrack();
      buildSalaryTable();
      run();
    });

    var stop = function (ev) {
      if (!tlGrab) return;
      tlGrab = null;
      host.classList.remove("is-grabbed");
      try { host.releasePointerCapture(ev.pointerId); } catch (e) { /* gone */ }
      renderTimelineTrack();
      buildSalaryTable();
      run();
      save();
    };
    host.addEventListener("pointerup", stop);
    host.addEventListener("pointercancel", stop);

    $("tlAddPg").addEventListener("click", function () {
      var on = !$("hasPgl").checked;
      $("hasPgl").checked = on;
      $("pglRow").hidden = !on;
      if (on) { state.pgTouched = false; followTimeline("hasPgl"); }
      renderTimelineTrack(); run();
    });
  }

  /* ---------------------------------------------------------------------- *
   * INCOME PROFILES
   *
   * Four ways to say what you will earn. All of them are stated in today's
   * money and have inflation added when they become cash, so a flat profile
   * means flat in real terms rather than quietly eroding.
   * -------------------------------------------------------------------- */


  var currentProfile = null;        // lent to scenario() for one simulate

  function profile() { return currentProfile || state.scen[state.active]; }

  function predictedSalaries(a) {
    var p = profile();
    var start = incomeStartYear();
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

    if (p.mode === "bands") {                 // the drawn curve
      var pts = pointsOf(p);
      for (var b = 0; b < n; b++) out[start + b] = toCash(drawnSalary(pts, b + 1), b);
      return out;
    }

    // A profession: real progression along the curve, inflation on top.
    // A profile saved before the list was trimmed may name a path that has
    // since gone; fall back rather than throwing.
    var career = CAREERS.filter(function (c) { return c.id === p.career; })[0] || CAREERS[2];
    for (var k = 0; k < n; k++) out[start + k] = toCash(careerReal(career, k + 1), k);
    return out;
  }

  function salaries(a) {
    var p = profile();
    var predicted = predictedSalaries(a);
    var out;

    if (p.mode !== "manual") {
      out = predicted;
    } else {
      var start = incomeStartYear();
      out = {};
      var years = p.manualYears || 12;
      for (var i = 0; i < years; i++) {
        var y = start + i;
        out[y] = p.manual && p.manual[y] != null ? p.manual[y] : Math.round(predicted[y] || 0);
      }
    }

    // Nothing before work begins, and nothing during a break. The career curve
    // picks up where it left off rather than restarting, which is closer to
    // what happens than either extreme.
    var work = incomeStartYear();
    var withGaps = {};
    Object.keys(out).forEach(function (k) {
      var y = Number(k);
      withGaps[y] = y < work ? 0 : out[y];
    });

    // Repayments can fall due before work starts; those years need to exist in
    // the map as zero, or the line would be carried backwards from the first
    // salary.
    var due = repayStartYear();
    for (var z = due; z < work; z++) if (withGaps[z] == null) withGaps[z] = 0;
    return withGaps;
  }

  // Income begins the year work does, which may be well after the course ends.
  function incomeStartYear() {
    if (state.loanMode === "balance") return Math.round(num("repayStartYear", 2026));
    return Math.max(timeline().workStart, E.BASE_TAX_YEAR);
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
      var t = timeline();
      if (state.loanMode === "balance") {
        loans.push({ plan: "pgl", openingBalance: num("pglBalance", 0), repaymentStartYear: start });
      } else {
        // Borrowed across the postgraduate course, and repaid from the April
        // after that course ends — which is later than the undergraduate one.
        loans.push({
          plan: "pgl",
          course: {
            years: t.pgYears,
            startYear: t.pgStart,
            tuitionPerYear: num("pglBalance", 0) / Math.max(1, t.pgYears),
            maintenancePerYear: 0
          },
          repaymentStartYear: t.pgRepayFrom
        });
      }
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
    if (!tlGrab) renderTimelineTrack();   // not while a block is under the pointer

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
   * DRAWING AN INCOME
   *
   * Eight sliders described a salary curve without ever showing its shape.
   * This is the shape: years across, salary up, and points you place yourself.
   * Stored as {t, v} — years since work began, and salary in today's money —
   * so moving the year work starts carries the whole curve with it.
   * -------------------------------------------------------------------- */

  var DRAW_YEARS = 40;
  var DRAW_MAX = 150000;          // top of the axis; typing elsewhere goes higher

  // Nothing. The chart opens blank and the curve is yours from the first
  // click, rather than five borrowed points to be dragged out of the way.
  function defaultPoints() { return []; }

  function pointsOf(p) {
    if (!Array.isArray(p.points)) {
      // Carry over a profile saved when this was eight five-year bands.
      p.points = Array.isArray(p.bands) && p.bands.length
        ? p.bands.map(function (v, i) { return { t: i * 5 + 1, v: Number(v) || 0 }; })
        : defaultPoints();
    }
    return p.points.slice().sort(function (a, b) { return a.t - b.t; });
  }

  // Salary in year `t` of the career, straight-line between the points either
  // side of it, flat beyond the ends.
  function drawnSalary(pts, t) {
    if (!pts.length) return 0;
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (var i = 0; i < pts.length - 1; i++) {
      if (t >= pts[i].t && t <= pts[i + 1].t) {
        var span = pts[i + 1].t - pts[i].t;
        if (!span) return pts[i + 1].v;
        var f = (t - pts[i].t) / span;
        return pts[i].v + (pts[i + 1].v - pts[i].v) * f;
      }
    }
    return pts[pts.length - 1].v;
  }

  var DRAW = { W: 300, H: 190, ml: 34, mr: 8, mt: 10, mb: 20 };

  function drawX(t) {
    return DRAW.ml + ((t - 1) / (DRAW_YEARS - 1)) * (DRAW.W - DRAW.ml - DRAW.mr);
  }
  function drawY(v) {
    return DRAW.mt + (1 - v / DRAW_MAX) * (DRAW.H - DRAW.mt - DRAW.mb);
  }

  function buildIncomeChart() {
    var host = $("drawChart");
    if (!host) return;
    var p = state.scen[state.active];
    var pts = pointsOf(p);

    var grid = "", step = 25000;
    for (var v = 0; v <= DRAW_MAX; v += step) {
      grid += '<line x1="' + DRAW.ml + '" y1="' + drawY(v).toFixed(1) + '" x2="' + (DRAW.W - DRAW.mr) +
        '" y2="' + drawY(v).toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (DRAW.ml - 5) + '" y="' + (drawY(v) + 3.5).toFixed(1) +
        '" text-anchor="end" font-size="8.5" fill="var(--ink-4)">' + gbpShort(v) + "</text>";
    }
    for (var t = 1; t <= DRAW_YEARS; t += 10) {
      grid += '<text x="' + drawX(t).toFixed(1) + '" y="' + (DRAW.H - 6) +
        '" text-anchor="middle" font-size="8.5" fill="var(--ink-4)">yr ' + t + "</text>";
    }

    var line = "", lead = "", tail = "";
    if (pts.length) {
      line = pts.map(function (q, i) {
        return (i ? "L" : "M") + drawX(q.t).toFixed(1) + " " + drawY(q.v).toFixed(1);
      }).join(" ");
      // Flat runs either side, so the curve reads as what it actually models.
      lead = "M" + drawX(1).toFixed(1) + " " + drawY(pts[0].v).toFixed(1) +
             "L" + drawX(pts[0].t).toFixed(1) + " " + drawY(pts[0].v).toFixed(1);
      tail = "M" + drawX(pts[pts.length - 1].t).toFixed(1) + " " + drawY(pts[pts.length - 1].v).toFixed(1) +
             "L" + drawX(DRAW_YEARS).toFixed(1) + " " + drawY(pts[pts.length - 1].v).toFixed(1);
    }

    var dots = pts.map(function (q, i) {
      return '<circle class="dp" data-pt="' + i + '" cx="' + drawX(q.t).toFixed(1) + '" cy="' +
        drawY(q.v).toFixed(1) + '" r="5" fill="var(--warn)" stroke="var(--bg-2)" stroke-width="1.5"/>';
    }).join("");

    host.innerHTML =
      '<svg viewBox="0 0 ' + DRAW.W + " " + DRAW.H + '" role="img" ' +
      'aria-label="Salary by year of career. Click to add a point, drag to move, double-click to remove.">' +
      '<rect class="dp-bg" x="' + DRAW.ml + '" y="' + DRAW.mt + '" width="' + (DRAW.W - DRAW.ml - DRAW.mr) +
        '" height="' + (DRAW.H - DRAW.mt - DRAW.mb) + '" fill="transparent"/>' +
      grid +
      '<path d="' + lead + '" fill="none" stroke="var(--live)" stroke-width="1.5" stroke-dasharray="3 3" opacity=".6"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--live)" stroke-width="2"/>' +
      '<path d="' + tail + '" fill="none" stroke="var(--live)" stroke-width="1.5" stroke-dasharray="3 3" opacity=".6"/>' +
      dots + "</svg>";

    var held = dpDrag && dpDrag.pt;
    $("drawNote").innerHTML = held
      ? "Year <b>" + held.t + "</b> of your career \u2014 <b>" + gbp(held.v) + "</b> a year, in today\u2019s money."
      : pts.length
        ? pts.length + (pts.length === 1 ? " point" : " points") +
          " \u2014 click to add one, drag to move it, click it twice to take it away."
        : "Empty. Click anywhere on the chart to place your first point.";
  }

  // Where a pointer is, in career-year and salary.
  function drawAt(ev, svg) {
    var rect = svg.getBoundingClientRect();
    var sx = (ev.clientX - rect.left) / rect.width * DRAW.W;
    var sy = (ev.clientY - rect.top) / rect.height * DRAW.H;
    var t = Math.round(1 + (sx - DRAW.ml) / (DRAW.W - DRAW.ml - DRAW.mr) * (DRAW_YEARS - 1));
    var v = (1 - (sy - DRAW.mt) / (DRAW.H - DRAW.mt - DRAW.mb)) * DRAW_MAX;
    return { t: clamp(t, 1, DRAW_YEARS), v: Math.max(0, Math.round(v / 250) * 250) };
  }

  var dpDrag = null, dpLast = null;

  function wireIncomeChart() {
    var host = $("drawChart");
    if (!host) return;

    // Points are held by reference, never by index: the list re-sorts the
    // moment a dragged point passes another, and an index taken before that
    // then names somebody else's point.
    host.addEventListener("pointerdown", function (ev) {
      var svg = host.querySelector("svg");
      if (!svg) return;
      var p = state.scen[state.active];
      var pts = pointsOf(p);
      var dot = ev.target.closest(".dp");

      if (dot) {
        var pt = pts[Number(dot.dataset.pt)];
        var now = Date.now();
        if (dpLast && dpLast.pt === pt && now - dpLast.at < 400) {
          p.points = pts.filter(function (q) { return q !== pt; });
          dpLast = null;
          dpDrag = null;
          buildIncomeChart();
          run();
          ev.preventDefault();
          return;
        }
        dpLast = { pt: pt, at: now };
        dpDrag = { pt: pt };
      } else if (ev.target.closest(".dp-bg")) {
        var at = drawAt(ev, svg);
        var here = pts.filter(function (q) { return q.t === at.t; })[0];
        if (here) { here.v = at.v; dpDrag = { pt: here }; }
        else {
          var added = { t: at.t, v: at.v };
          pts.push(added);
          dpDrag = { pt: added };
        }
        p.points = pts;
        buildIncomeChart();
        run();
      }
      if (dpDrag) { ev.preventDefault(); host.setPointerCapture(ev.pointerId); }
    });

    host.addEventListener("pointermove", function (ev) {
      if (!dpDrag || !dpDrag.pt) return;
      var live = host.querySelector("svg");     // always the current one
      if (!live) return;
      var p = state.scen[state.active];
      var pts = pointsOf(p);
      var q = dpDrag.pt;
      var at = drawAt(ev, live);
      // Two points cannot share a year; the drag simply stops at the neighbour.
      if (!pts.some(function (o) { return o !== q && o.t === at.t; })) q.t = at.t;
      q.v = at.v;
      p.points = pts;
      buildIncomeChart();
      run();
    });

    var stop = function (ev) {
      if (!dpDrag) return;
      dpDrag = null;
      try { host.releasePointerCapture(ev.pointerId); } catch (e) { /* gone already */ }
      buildIncomeChart();          // the live figure gives way to the count
      save();
    };
    host.addEventListener("pointerup", stop);
    host.addEventListener("pointercancel", stop);

    $("drawReset").addEventListener("click", function () {
      state.scen[state.active].points = defaultPoints();
      buildIncomeChart();
      run();
    });
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

  function blankScenario(i) {
    return {
      // Only the first is filled in. The rest are empty until asked for, so
      // the list does not arrive pre-loaded with four opinions.
      on: i === 0,
      mode: "career",                  // career | growth | bands | manual
      career: i === 0 ? "grad" : null,
      startSalary: 30000,
      growth: 4,
      points: null,                    // drawn on demand; see defaultPoints()
      manual: {},
      manualYears: 12,
      plan: "plan5",
      overpay: 0
    };
  }

  // Move the active scenario's settings into the shared controls.
  function loadScenario() {
    var s = state.scen[state.active];
    $("career").value = s.career || "";
    $("startSalary").value = s.startSalary;
    $("salaryGrowth").value = s.growth;
    $("plan").value = s.plan;
    $("overpay").value = s.overpay;
    selectMode(s.mode);
    buildIncomeChart();
    renderTimelineTrack();
    buildSalaryTable();
    syncSliders();
    markCareer();
    var tag = SCEN_META[state.active].id;
    if ($("incomeLede")) {
      $("incomeLede").textContent =
        "Use one of the four methods below to model Income " + tag + " over time.";
    }
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
          '<span class="scen__id">Income ' + m.id + '</span>' +
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
        if (state.scen[j].on) {
          if (!state.scen[j].career) state.scen[j].career = "grad";
          state.active = j;
          loadScenario();
        }
        markScens(); run();
        return;
      }
      if (pick) {
        var i = Number(pick.dataset.pick);
        state.active = i;
        if (!state.scen[i].on) state.scen[i].on = true;
        if (!state.scen[i].career) state.scen[i].career = "grad";
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
      var up = upfrontTotal(runs[0]);
      cells.push('<div class="hcell is-ghost"><p class="hcell__who"><span class="dot"></span>Paid upfront</p>' +
        '<p class="hcell__fig">' + gbp(up) + "</p>" +
        '<p class="hcell__sub">' + (state.loanMode === "balance"
          ? "clearing the whole balance, in cash, today"
          : "the fees and living costs, found in cash") + "</p></div>");
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
    if (!s.career && s.mode === "career") return "";      // not chosen yet
    if (s.mode === "growth") return gbpShort(s.startSalary) + " +" + s.growth + "%";
    if (s.mode === "bands") {
      var dp = pointsOf(s);
      if (!dp.length) return "nothing drawn yet";
      return gbpShort(dp[0].v) + " \u2192 " + gbpShort(dp[dp.length - 1].v);
    }
    if (s.mode === "manual") return "typed by year";
    var c = CAREERS.filter(function (x) { return x.id === s.career; })[0];
    return c ? c.label : "Career";
  }

  /* ---- how much of the answer is the guess? ------------------------------ *
   * A tornado: one bar per unknowable, spanning the outcome from its low case
   * to its high, sorted widest first. The point is not the numbers but the
   * lengths — when one bar is twenty times another, the whole forecast turns
   * on that one figure and the rest is decoration.
   * ---------------------------------------------------------------------- */

  function renderSensitivity(sim) {
    var base = scenario();
    var a = sim.assumptions;

    var runWith = function (override) {
      var r = E.simulate({
        loans: base.loans, salaries: base.salaries, overpayment: base.overpayment,
        assumptions: Object.assign({}, a, override)
      }).combined;
      return {
        repaid: r.totalRepaid,
        cleared: r.everRepaidInFull,
        when: r.everRepaidInFull ? r.clearedLabel : r.writeOffLabel,
        writtenOff: r.writtenOff || 0
      };
    };

    var planWhy = {
      plan5: "RPI sets the interest, and on Plan 5 nothing else does.",
      plan2: "RPI is the floor of Plan 2's sliding scale, which runs to RPI + 3%.",
      plan1: "RPI sets the rate unless the base rate + 1% is lower.",
      plan4: "RPI sets the rate unless the base rate + 1% is lower."
    }[profile().plan] || "RPI sets the interest rate.";

    var specs = [
      { title: "RPI", why: planWhy,
        lo: { label: pct(Math.max(0, a.rpi - 0.015)), o: { rpi: Math.max(0, a.rpi - 0.015) } },
        hi: { label: pct(a.rpi + 0.015), o: { rpi: a.rpi + 0.015 } },
        now: pct(a.rpi) + " as set" },
      { title: "Threshold uprating", why: "Below your pay rises, more of your salary falls above it every year.",
        lo: { label: pct(Math.max(0, a.inflation - 0.01)), o: { thresholdGrowth: Math.max(0, a.inflation - 0.01) } },
        hi: { label: pct(a.inflation), o: { thresholdGrowth: a.inflation } },
        now: pct(a.thresholdGrowth) + " as set" },
      { title: "Your pay", why: "A fifth either way on everything you ever earn.",
        lo: { label: "\u2212" + "20%", o: {}, salaryScale: 0.8 },
        hi: { label: "+20%", o: {}, salaryScale: 1.2 },
        now: "as modelled" },
      { title: "Inflation", why: "Drags the cash salaries, and with them the whole ledger.",
        lo: { label: pct(Math.max(0, a.inflation - 0.015)), o: { inflation: Math.max(0, a.inflation - 0.015) } },
        hi: { label: pct(a.inflation + 0.015), o: { inflation: a.inflation + 0.015 } },
        now: pct(a.inflation) + " as set" }
    ];

    var mid = runWith({});
    var bars = specs.map(function (sp) {
      var scaled = function (side) {
        if (side.o && side.o.inflation != null) {
          // Inflation drives the salary curve itself, so the line has to be
          // rebuilt rather than the assumption merely swapped underneath it.
          var a2 = Object.assign({}, a, side.o);
          var r2 = E.simulate({ loans: base.loans, salaries: salaries(a2),
                                overpayment: base.overpayment, assumptions: a2 }).combined;
          return { repaid: r2.totalRepaid, cleared: r2.everRepaidInFull,
                   when: r2.everRepaidInFull ? r2.clearedLabel : r2.writeOffLabel,
                   writtenOff: r2.writtenOff || 0 };
        }
        if (!side.salaryScale) return runWith(side.o);
        // Scaling pay needs the salary line rebuilt, not an assumption changed.
        var sal = {};
        Object.keys(base.salaries).forEach(function (k) { sal[k] = base.salaries[k] * side.salaryScale; });
        var r = E.simulate({ loans: base.loans, salaries: sal, overpayment: base.overpayment,
                             assumptions: a }).combined;
        return { repaid: r.totalRepaid, cleared: r.everRepaidInFull,
                 when: r.everRepaidInFull ? r.clearedLabel : r.writeOffLabel,
                 writtenOff: r.writtenOff || 0 };
      };
      var lo = scaled(sp.lo), hi = scaled(sp.hi);
      var a1 = Math.min(lo.repaid, hi.repaid), b1 = Math.max(lo.repaid, hi.repaid);
      return { title: sp.title, why: sp.why, now: sp.now,
               loLabel: sp.lo.label, hiLabel: sp.hi.label,
               lo: lo, hi: hi, min: a1, max: b1, range: b1 - a1 };
    }).sort(function (x, y) { return y.range - x.range; });

    // A common axis, so bar lengths can be compared against each other.
    var lo = bars.reduce(function (m, b) { return Math.min(m, b.min); }, mid.repaid);
    var hi = bars.reduce(function (m, b) { return Math.max(m, b.max); }, mid.repaid);
    var pad = (hi - lo) * 0.08 || 1000;
    lo = Math.max(0, lo - pad); hi = hi + pad;

    var W = 760, rowH = 54, padT = 28, labelW = 168, right = 18;
    var iw = W - labelW - right;
    var H = padT + bars.length * rowH + 26;
    var x = function (v) { return labelW + ((v - lo) / (hi - lo)) * iw; };

    var body = bars.map(function (b, i) {
      var y = padT + i * rowH;
      var x1 = x(b.min), x2 = x(b.max);
      return '<text x="0" y="' + (y + 13) + '" font-size="12.5" font-weight="600" fill="var(--ink-2)">' + b.title + "</text>" +
        '<text x="0" y="' + (y + 28) + '" font-size="10.5" fill="var(--ink-4)">' + b.now + "</text>" +
        '<rect x="' + x1.toFixed(1) + '" y="' + (y + 2) + '" width="' + Math.max(2, x2 - x1).toFixed(1) +
          '" height="20" rx="3" fill="var(--warn)" opacity=".55"/>' +
        '<text x="' + (x1 - 7).toFixed(1) + '" y="' + (y + 17) + '" text-anchor="end" font-size="11" ' +
          'font-family="ui-monospace,monospace" fill="var(--ink-3)">' + gbpShort(b.min) + "</text>" +
        '<text x="' + (x2 + 7).toFixed(1) + '" y="' + (y + 17) + '" font-size="11" ' +
          'font-family="ui-monospace,monospace" fill="var(--ink-3)">' + gbpShort(b.max) + "</text>" +
        (x2 - x1 > 70
          ? '<text x="' + x1.toFixed(1) + '" y="' + (y + 36) + '" font-size="10" fill="var(--ink-4)">' + b.loLabel + "</text>" +
            '<text x="' + x2.toFixed(1) + '" y="' + (y + 36) + '" text-anchor="end" font-size="10" fill="var(--ink-4)">' + b.hiLabel + "</text>"
          : '<text x="' + ((x1 + x2) / 2).toFixed(1) + '" y="' + (y + 36) + '" text-anchor="middle" font-size="10" fill="var(--ink-4)">' +
            b.loLabel + " \u2013 " + b.hiLabel + "</text>");
    }).join("");

    // Where the answer sits on today's assumptions.
    var nowX = x(mid.repaid);
    var spine = '<line x1="' + nowX.toFixed(1) + '" y1="' + (padT - 12) + '" x2="' + nowX.toFixed(1) +
      '" y2="' + (padT + bars.length * rowH - 8) + '" stroke="var(--good)" stroke-width="1.5"/>' +
      '<text x="' + nowX.toFixed(1) + '" y="' + (padT - 17) + '" text-anchor="middle" font-size="11.5" ' +
      'font-weight="700" fill="var(--good)">' + gbp(mid.repaid) + " as set</text>";

    $("sensChart").innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="How far each assumption moves the total repaid">' +
      spine + body + "</svg>";

    var widest = bars[0], narrowest = bars[bars.length - 1];
    $("sensNote").innerHTML = widest.range > narrowest.range * 3
      ? "<b>" + widest.title + "</b> decides this forecast. Moving it across the range shown swings the " +
        "total by <b>" + gbp(widest.range) + "</b>, against <b>" + gbp(narrowest.range) + "</b> for <b>" +
        narrowest.title.toLowerCase() + "</b> — so the honest error bar on every other figure on this " +
        "page is roughly the length of that top bar."
      : "No single assumption dominates: the four move the total by between <b>" + gbp(narrowest.range) +
        "</b> and <b>" + gbp(widest.range) + "</b>. Treat any figure on this page as carrying at least " +
        "that much uncertainty.";
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
  /* ---- how wide to draw ---------------------------------------------------
   * These charts are drawn once and stretched to whatever the card is. A
   * frame drawn 440 across and shown over 1,086px of card is the whole chart
   * at two and a half times its intended size: 11px axis labels land at 27px,
   * and a single card fills the screen. So the drawing widens to match the
   * space it is given, and comes out at the height it was drawn for.
   * ---------------------------------------------------------------------- */

  function vizW(hostId, h, drawn, targetPx) {
    var el = $(hostId), px = el ? el.clientWidth : 0;
    if (!px) return drawn;                    // not laid out yet; keep as drawn
    var tall = targetPx || Math.max(190, Math.min(270, Math.round(px * 0.26)));
    return Math.round(h * px / tall);
  }

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
    var f = spanFrame(runs, series, gbpShort, "Balance outstanding by tax year", vizW("chart", 300, 760), 300, true);

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
    var f = spanFrame(runs, all, gbpShort, "Gross salary against the repayment threshold", vizW("salaryChart", 260, 440), 260, false);

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
                      "Monthly repayment by tax year", vizW("monthlyChart", 260, 440), 260, true);

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
      (state.showNoLoan ? '<i style="color:var(--ink-3)">Paid upfront — nothing leaves your pay</i>' : "");
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
    var f = spanFrame(runs, series, gbpShort, "Total handed over, accumulating, by tax year", vizW("costChart", 280, 760), 280, true);

    var body = series.map(function (S) {
      return '<path d="' + area(S.pts, f) + '" fill="' + S.meta.colour + '" opacity=".08"/>' +
             '<path d="' + line(S.pts, f) + '" fill="none" stroke="' + S.meta.colour + '" stroke-width="2.25"/>';
    }).join("");

    // Paying your own way is not a flat zero: it is a steep climb while the
    // course runs, then nothing at all for the rest of your life.
    var zero = "";
    if (state.showNoLoan) {
      var up = upfrontSeries(runs[0]);
      var total = up[up.length - 1].v;
      zero = '<path d="' + line(up, f) + '" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 4"/>' +
        '<text x="' + (f.W - 18) + '" y="' + (f.y(total) - 8).toFixed(1) +
        '" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-3)">Paid upfront \u2014 ' +
        gbp(total) + "</text>";
    }

    $("costChart").innerHTML = f.open + zero + body + cutoffMarks(runs, f) + f.close;
    $("costKey").innerHTML = runKeys(runs) +
      (state.showNoLoan ? '<i style="color:var(--ink-3)">Paid upfront, no loan</i>' : "");
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
    if (state.showNoLoan) {
      var up = upfrontTotal(runs[0]);
      rows.push({ label: "Paid upfront", value: up, colour: "var(--ink-3)",
                  note: "fees and living costs, in cash, during the course" });
    }

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
    $("barsKey").innerHTML =
      '<i style="color:var(--ink-4)">Cash handed over across the whole term</i>' +
      '<i style="color:var(--ink-4)">money spent sooner costs more than the same sum spent later — see the profile panel</i>';
  }

  /* ---- the alternative: find the money yourself -------------------------- *
   * Not borrowing does not make a degree free. It means paying the fees and
   * living costs in cash, as they fall due, during the course. That — not
   * zero — is what the other life actually costs.
   * ---------------------------------------------------------------------- */

  function upfrontSeries(sim) {
    var cum = 0;
    return sim.combined.years.map(function (y) {
      cum += y.borrowed;
      return { taxYear: y.taxYear, label: y.label, v: cum };
    });
  }

  function upfrontTotal(sim) { return sim.combined.borrowed; }

  /* ---- what to actually do ------------------------------------------------ *
   * The panel was a wall of figures with no conclusion. This states one, in
   * a sentence, and says when the numbers are too close to support one.
   * ---------------------------------------------------------------------- */

  function recommend(sim) {
    var r = sim.combined, o = sim.opportunity;

    if (r.borrowed <= 0) return null;

    if (!o.years) {
      return { tone: "good", verdict: "Take the loan. It will never cost you anything.",
        body: "Nothing is ever deducted on this income, and the balance is written off in " +
              r.writeOffLabel + ". Paying a penny towards it would be a gift to the Treasury." };
    }

    // Written off with a real balance left: overpaying is money thrown away.
    if (!r.everRepaidInFull) {
      return { tone: "good", verdict: "Take the loan, and never overpay.",
        body: "<b>" + gbp(r.writtenOff) + "</b> of this balance is cancelled in " + r.writeOffLabel +
              ". You repay <b>" + gbp(r.totalRepaid) + "</b> whatever the balance is, because the " +
              "deduction is set by your salary and the threshold, not by what you owe — so an extra " +
              "pound paid in is a pound that simply never comes back." };
    }

    // It clears. Now the timing argument decides, and often barely.
    var opts = (state.loanMode !== "balance"
      ? [
          { k: "repay", label: "borrow and repay as required", fv: o.pvRepayments },
          { k: "upfront", label: "pay the fees in cash", fv: o.pvUpfront }
        ]
      : [
          { k: "repay", label: "keep repaying as required", fv: o.pvRepayments },
          { k: "clear", label: "pay it all off today", fv: o.pvLump }
        ]
    ).filter(function (c) { return c.fv > 0; }).sort(function (a, b) { return a.fv - b.fv; });

    var atStartRec = state.loanMode !== "balance";
    var best = opts[0], worst = opts[opts.length - 1];
    var spread = worst.fv - best.fv;
    var margin = best.fv > 0 ? spread / best.fv : 0;

    var flip = o.breakEven != null
      ? " The two swap places at a savings return of <b>" + pct(o.breakEven) +
        "</b>: below that, settling it outright wins; above it, keeping the money does."
      : "";

    // Under a twentieth apart is not a difference anyone should act on.
    if (margin < 0.05) {
      return { tone: "even", verdict: "Too close to call — do whichever suits you.",
        body: "In " + E.taxYearLabel(o.baseYear) + " money the options " +
              "sit within <b>" + gbp(spread) + "</b> of each other, about " + pct(margin, 0) +
              ". That is far inside the error on a forecast this long, so treat it as a wash and " +
              "decide on how much you would rather hold cash." + flip };
    }

    return { tone: best.k === "repay" ? "good" : "warn",
      verdict: best.k === "repay"
                 ? (atStartRec ? "Take the loan and repay as required." : "Keep repaying as required.")
             : best.k === "clear" ? "Pay it off today if you can."
             : "Pay the fees in cash if you can.",
      body: "In " + E.taxYearLabel(o.baseYear) + " money that comes to <b>" + gbp(best.fv) +
            "</b> against <b>" + gbp(worst.fv) + "</b> for the dearest \u2014 <b>" + gbp(spread) +
            "</b> better off." + flip };
  }

  /* ---- the three figures that matter most -------------------------------- *
   * For the selected profile: what it costs in cash, what that is worth in
   * the money of the year the loan was taken out, and what the same payments
   * would have earned had they gone into a savings account instead.
   * ---------------------------------------------------------------------- */

  function renderBigs(runs) {
    var sim = runs.filter(function (s) { return s.index === state.active; })[0] || runs[0];
    var r = sim.combined, o = sim.opportunity;
    var baseYear = r.years.length ? r.years[0].label : "today";
    var endYearLabel = r.years.length
      ? E.taxYearLabel(r.years[r.years.length - 1].taxYear + 1) : "the end";

    var boxes = [
      {
        k: "Total repayment",
        v: gbp(r.totalRepaid),
        sub: r.everRepaidInFull
          ? "cash handed over, cleared in " + r.clearedLabel
          : "cash handed over before " + gbp(r.writtenOff) + " was written off",
        tone: ""
      },
      {
        k: "In " + baseYear + " money",
        v: gbp(r.totalRealRepaid),
        sub: "the same repayments, valued when the loan was taken out, at " +
             pct(sim.assumptions.inflation) + " inflation",
        tone: "cool"
      },
      {
        k: "Growth given up, by " + endYearLabel,
        v: gbp(o.foregoneGrowth),
        sub: o.foregoneGrowth > 0
          ? "saved at " + pct(o.savingsRate) + " instead, those repayments would have become " +
            gbp(o.fvRepayments) + " by " + endYearLabel + " — this is the part you never earned"
          : "nothing is deducted on this profile, so nothing is forfeited",
        tone: "warm"
      },
      {
        k: "…and in " + baseYear + " money",
        v: gbp(o.realForegoneGrowth),
        sub: o.foregoneGrowth > 0
          ? "the same forfeited growth, valued when the loan was taken out, at " +
            pct(sim.assumptions.inflation) + " inflation"
          : "nothing forfeited, in any money",
        tone: "warm"
      }
    ];

    $("bigs").innerHTML = boxes.map(function (bx) {
      return '<div class="big ' + bx.tone + '" style="--c:' + sim.meta.colour + '">' +
        '<p class="big__k">' + bx.k + "</p>" +
        '<p class="big__v">' + bx.v + "</p>" +
        '<p class="big__s">' + bx.sub + "</p></div>";
    }).join("") +
      '<p class="bigs__who">Profile <b style="color:' + sim.meta.colour + '">' + sim.meta.id +
      "</b> · " + scenarioName(sim.settings) + "</p>";
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

    // All three lives priced at the year the loan ends, so they can be
    // compared without the timing doing the arguing.
    var endLabel = o.years
      ? E.taxYearLabel(r.years[r.years.length - 1].taxYear + 1)
      : "the end";
    var baseLabel = o.baseYear != null ? E.taxYearLabel(o.baseYear) : "today";

    var peakBalance = repaying.reduce(function (m, y) {
      return Math.max(m, y.closingBalance);
    }, r.balanceAtRepayStart);

    var rows = [
      { g: "The loan", k: "Borrowed", v: gbp(r.borrowed) },
      { g: "The loan", k: "Owed when repayment starts", v: gbp(r.balanceAtRepayStart) },
      { g: "The loan", k: "Interest charged", v: gbp(r.totalInterest), c: "warn" },
      { g: "The loan", k: "Peak balance", v: gbp(peakBalance),
        hide: Math.abs(peakBalance - r.balanceAtRepayStart) < 1 },

      { g: "What you pay", k: "Handed over, in cash", v: gbp(r.totalRepaid), c: "good" },
      { g: "What you pay", k: "Handed over, today's money", v: gbp(r.totalRealRepaid), c: "good" },
      { g: "What you pay", k: "First deduction", v: firstPaid ? gbp(firstPaid.monthlyRepayment) + " a month" : "never" },
      { g: "What you pay", k: "Peak deduction", v: gbp(peak) + " a month",
        hide: !firstPaid || Math.abs(peak - firstPaid.monthlyRepayment) < 1 },
      { g: "What you pay", k: "Years repaying", v: String(r.yearsRepaying) },
      { g: "What you pay", k: r.everRepaidInFull ? "Cleared" : "Written off",
        v: r.everRepaidInFull ? r.clearedLabel : gbp(r.writtenOff) + " in " + r.writeOffLabel,
        c: r.everRepaidInFull ? "good" : "bad" },

      { g: "What you pay", k: "\u00a0", v: "" }
    ];

    var groups = [];
    rows.filter(function (row) { return !row.hide; }).forEach(function (row) {
      var g = groups.filter(function (x) { return x.name === row.g; })[0];
      if (!g) { g = { name: row.g, rows: [] }; groups.push(g); }
      g.rows.push(row);
    });

    // Which alternatives exist depends on where you are standing. Before the
    // course, the choice is whether to borrow at all; once you owe something,
    // the fees are long spent and the only question left is whether to clear
    // it. Offering both at once produced two rows a hair apart — the study
    // interest, near enough cancelled by discounting it — which read as the
    // same thing said twice, and fairly so.
    var atStart = state.loanMode !== "balance";

    var choices = (atStart
      ? [
          { key: "repay",   k: "Borrow and repay",     cash: r.totalRepaid, fv: o.pvRepayments,
            why: "spread over " + r.yearsRepaying + " years, ending " + endLabel },
          { key: "upfront", k: "Pay the fees in cash", cash: o.upfrontPaid, fv: o.pvUpfront,
            why: (function () {
              var yrs = r.years.filter(function (y) { return y.borrowed > 0; });
              return "never borrow — found across " + yrs.length +
                (yrs.length === 1 ? " year" : " years") + ", " +
                (yrs.length ? yrs[0].label : "") + " to " +
                (yrs.length ? yrs[yrs.length - 1].label : "");
            })() }
        ]
      : [
          { key: "repay",   k: "Keep repaying as required", cash: r.totalRepaid, fv: o.pvRepayments,
            why: "spread over " + r.yearsRepaying + " years, ending " + endLabel },
          { key: "clear",   k: "Pay it all off today",      cash: o.lump,        fv: o.pvLump,
            why: "the whole balance as it stands now" }
        ]
    ).filter(function (c) { return c.cash > 0; })
     // Cheapest first, so the answer is the first thing read rather than
     // something to be hunted for down a fixed list.
     .sort(function (a, b) { return a.fv - b.fv; });

    var best = choices[0];

    var table = choices.length < 2 ? "" :
      '<div class="fgroup fgroup--wide"><h4>Which is actually cheapest?</h4>' +
      '<p class="fgroup__lede">Money paid sooner costs you more than the same money paid later, because ' +
      'what you keep can earn ' + pct(o.savingsRate) + ' in the meantime. Each option is therefore ' +
      'discounted back to <b>' + baseLabel + "</b>, so all three are stated in money you can picture " +
      "rather than in three different decades.</p>" +
      '<div class="scroll"><table class="choices"><thead><tr><th scope="col">Option</th>' +
      '<th scope="col" class="n">You pay</th>' +
      '<th scope="col" class="n">Cost in ' + baseLabel + " money</th>" +
      '<th scope="col" class="n">Difference</th>' +
      "</tr></thead><tbody>" +
      choices.map(function (c, i) {
        var gap = c.fv - best.fv;
        return '<tr class="' + (i === 0 ? "is-win" : "") + '">' +
          "<th scope=\"row\">" + c.k + "<span>" + c.why + "</span></th>" +
          '<td class="n">' + gbp(c.cash) + "</td>" +
          '<td class="n lead">' + gbp(c.fv) + "</td>" +
          '<td class="n gap">' + (i === 0 ? "cheapest" : "+" + gbp(gap)) + "</td></tr>";
      }).join("") +
      "</tbody></table></div>" +
      '<p class="choices__now">' + (atStart
        ? "Clearing the whole balance takes <b>" + gbp(o.lump) + "</b> \u2014 what will be owed by " +
          E.taxYearLabel(repayStartYear()) + ", once the last instalment is drawn and the interest " +
          "accrued through the course has run. On <b>" + gbp(r.borrowed) + "</b> borrowed."
        : "Clearing the whole balance right now takes <b>" + gbp(o.lump) + "</b>.") + "</p></div>";

    $("focusGrid").innerHTML = groups.map(function (g) {
      return '<div class="fgroup"><h4>' + g.name + "</h4><dl>" + g.rows.filter(function (row) {
        return row.v !== "";
      }).map(function (row) {
        return "<div><dt>" + row.k + '</dt><dd class="' + (row.c || "") + '">' + row.v + "</dd></div>";
      }).join("") + "</dl></div>";
    }).join("") + table;

    var rec = recommend(sim);
    $("recBox").innerHTML = rec
      ? '<p class="rec__k">Recommendation</p><p class="rec__v">' + rec.verdict + "</p>" +
        '<p class="rec__b">' + rec.body + "</p>"
      : "";
    $("recBox").className = "rec" + (rec ? " is-" + rec.tone : " is-empty");

    renderOppChart(sim);

    $("oppVerdict").innerHTML = o.years === 0
      ? "Nothing is ever deducted on this profile, so there is nothing to weigh against saving."
      : (function () {
          var owing = state.loanMode === "balance";
          var alt = owing ? o.lump : o.upfrontPaid;
          var cash = "In cash the loan looks like <b>" + gbp(r.totalRepaid) + "</b> against <b>" +
            gbp(alt) + "</b> to " + (owing ? "clear it outright today" : "have paid the fees yourself") +
            ". But that money leaves your hands " + (owing ? "now" : "during the course") +
            " and the repayments trickle out over " + r.yearsRepaying +
            " years, so the two are not the same money. ";
          var priced = "In " + E.taxYearLabel(o.baseYear) + " money they come to <b>" +
            gbp(o.pvRepayments) + "</b> and <b>" + gbp(owing ? o.pvLump : o.pvUpfront) + "</b>";
          var better = o.pvRepayments <= (owing ? o.pvLump : o.pvUpfront)
            ? "repaying as required" : (owing ? "clearing it today" : "paying the fees in cash");
          return cash + priced + " — so the cheaper of the two is <b>" + better + "</b>.";
        })();
  }

  /* ---- what you hand over, against what it could have been ----------------
   * Three lines. The fees and living costs found in cash, which is what the
   * other life costs and stops the day the course does. The repayments piling
   * up as you make them. And those same repayments in a savings account,
   * earning — the gap to the line below being the growth you never got, not
   * money you were ever holding, but money the loan cost you all the same.
   * ---------------------------------------------------------------------- */

  function renderOppChart(sim) {
    var o = sim.opportunity;
    if (!o.track.length) { $("oppChart").innerHTML = ""; $("oppKey").innerHTML = ""; return; }

    // The pot, by the year it reaches that size.
    var saved = {};
    o.track.forEach(function (t) { saved[t.taxYear] = t.repaymentsSaved; });

    // What you have actually handed over by each year, what the same payments
    // would have been worth had you kept them, and what the other life costs:
    // the fees and living costs found in cash while the course runs.
    var pts = [];
    sim.combined.years.forEach(function (y) {
      pts.push({ taxYear: y.taxYear, label: y.label,
                 v: saved[y.taxYear] || 0, paid: y.cumRepaid, up: y.cumBorrowed });
    });
    if (pts.length < 2) { $("oppChart").innerHTML = ""; $("oppKey").innerHTML = ""; return; }

    var last = pts[pts.length - 1];
    var max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.v, p.paid, p.up); });
    var s = niceScale(max);

    // Both lines stop the year the loan does — cleared, or cut off at the
    // write-off. When it is the write-off that ends them, the wall is what
    // the reader is looking at, so make room for it and draw it.
    var wall = sim.combined.writtenOff > 0 ? cutoffMax([sim]) : null;
    var f = frame({ years: pts, xMin: pts[0].taxYear,
                    xMax: wall != null ? Math.max(last.taxYear, wall) : last.taxYear,
                    top: s.top, step: s.step, fmt: gbpShort, w: vizW("oppChart", 260, 760), h: 260,
                    title: "What you hand over against what the same money would have grown to" });

    var runOf = function (key) {
      return pts.map(function (p, i) {
        return (i ? "L" : "M") + f.x(p.taxYear).toFixed(1) + " " + f.y(p[key]).toFixed(1);
      }).join(" ");
    };

    $("oppChart").innerHTML = f.open +
      // In Balance mode the fees are already spent; there is no cash
      // alternative left to draw, and cumBorrowed stays at zero.
      (last.up > 0
        ? '<path d="' + runOf("up") + '" fill="none" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="5 4"/>'
        : "") +
      '<path d="' + runOf("paid") + '" fill="none" stroke="var(--warn)" stroke-width="2.25"/>' +
      '<path d="' + line(pts, f) + '" fill="none" stroke="var(--good)" stroke-width="2.25"/>' +
      (wall != null ? cutoffMarks([sim], f) : "") +
      f.close;

    $("oppKey").innerHTML =
      (last.up > 0
        ? '<i style="color:var(--ink-3)">Paid upfront, never borrowing \u2014 ' + gbp(last.up) + "</i>"
        : "") +
      '<i style="color:var(--warn)">What you hand over \u2014 ' + gbp(last.paid) + "</i>" +
      '<i style="color:var(--good)">The same money, saved instead at ' + pct(o.savingsRate) +
        " \u2014 " + gbp(last.v) + "</i>" +
      '<i style="color:var(--ink-4)">the gap between the last two is the ' +
        gbp(Math.max(0, last.v - last.paid)) + " of growth you never earned</i>";
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
    renderBigs(runs);
    renderFacts(runs);
    renderChart(runs);
    renderSalaryChart(runs);
    renderMonthlyChart(runs);
    renderFlowChart(runs);
    renderCostChart(runs);
    renderBarsChart(runs);
    renderFocus(runs);
  }

  /* ---- the years, on a line ---------------------------------------------- *
   * A grid of boxes gave thirty cells to show six events and broke the axis
   * every time it wrapped. One line, marked where something happens, and the
   * gaps between the marks carry the meaning.
   * -------------------------------------------------------------------- */

  function renderMilestones(sim) {
    var r = sim.combined;
    var host = $("milestones");
    if (!r.years.length) { host.innerHTML = ""; return; }

    var events = [];
    var note = function (taxYear, kind, text) {
      if (taxYear == null) return;
      var at = events.filter(function (e) { return e.year === taxYear; })[0];
      if (at) { at.text += " · " + text; return; }
      events.push({ year: taxYear, kind: kind, text: text });
    };

    // A combined ledger has no milestones of its own; the undergraduate loan
    // is the larger story, so its turning points stand for both.
    var turns = (r.milestones && r.milestones.length)
      ? r.milestones : (sim.loans[0].milestones || []);

    turns.forEach(function (m) {
      if (!/^\d{4}/.test(m.year)) return;
      var y = Number(m.year.slice(0, 4));
      if (m.kind === "peak") note(y, "peak", "balance peaks at " + gbp(r.years.reduce(function (mx, yy) {
        return Math.max(mx, yy.closingBalance); }, 0)));
      else if (m.kind === "turn") note(y, "peak", "repayments overtake interest");
      else if (m.kind === "half") note(y, "plain", "half of it repaid");
      else if (sim.loans.length === 1 && m.kind === "cleared") note(y, "end", "cleared in full");
      else if (sim.loans.length === 1 && m.kind === "writtenOff") note(y, "off", "written off");
    });

    if (sim.loans.length > 1) {
      sim.loans.forEach(function (loan) {
        var lbl = loan.everRepaidInFull ? loan.clearedLabel : loan.writeOffLabel;
        if (lbl) note(Number(lbl.slice(0, 4)), loan.everRepaidInFull ? "end" : "off",
                      loan.planLabel + (loan.everRepaidInFull ? " cleared" : " written off"));
      });
    }

    var repaying = r.years.filter(function (y) { return y.phase === "repaying"; });
    if (repaying.length) note(repaying[0].taxYear, "plain", "repayments begin");
    events.sort(function (a, b) { return a.year - b.year; });

    var from = r.years[0].taxYear, to = r.years[r.years.length - 1].taxYear;
    var span = Math.max(1, to - from);
    var W = 760, ml = 8, mr = 8, iw = W - ml - mr, axis = 34;
    var x = function (y) { return ml + ((y - from) / span) * iw; };

    // Study and repayment as two weights of the same line, not two colours
    // fighting for attention.
    var studyEnd = repaying.length ? repaying[0].taxYear : to;
    var line =
      '<line x1="' + x(from) + '" y1="' + axis + '" x2="' + x(studyEnd).toFixed(1) + '" y2="' + axis +
        '" stroke="var(--info)" stroke-width="5" stroke-linecap="round"/>' +
      '<line x1="' + x(studyEnd).toFixed(1) + '" y1="' + axis + '" x2="' + x(to) + '" y2="' + axis +
        '" stroke="var(--bg-5)" stroke-width="5" stroke-linecap="round"/>';

    var every = Math.max(1, Math.round(span / 8));
    var ticks = "";
    for (var ty = from; ty <= to; ty += every) {
      // The last year is drawn separately and always; a tick that would land
      // on top of it is dropped rather than printed over it.
      if (x(to) - x(ty) < 34) continue;
      ticks += '<text x="' + x(ty).toFixed(1) + '" y="' + (axis - 13) +
        '" text-anchor="middle" font-size="10.5" fill="var(--ink-4)">' + ty + "</text>";
    }
    ticks += '<text x="' + x(to).toFixed(1) + '" y="' + (axis - 13) +
      '" text-anchor="end" font-size="10.5" fill="var(--ink-4)">' + to + "</text>";

    var colour = { peak: "var(--warn)", end: "var(--good)", off: "var(--bad)", plain: "var(--ink-2)" };
    // A label near the end reads leftwards, so it takes the space to its left,
    // not its right. Packing every label as though it grew rightwards is what
    // laid them on top of one another.
    var rows = [], marks = "";
    events.forEach(function (e) {
      var ex = x(e.year);
      var label = e.year + " · " + e.text;
      var width = label.length * 6.2 + 18;   // runs wide on purpose
      var flip = ex + width > iw;            // near the end, label leftwards
      var x0 = flip ? ex - width : ex - 10;
      var x1 = flip ? ex + 10 : ex + width;
      var row = 0;
      while (rows[row] && rows[row].some(function (s) { return x0 < s[1] && x1 > s[0]; })) row++;
      (rows[row] || (rows[row] = [])).push([x0, x1]);
      var ey = axis + 24 + row * 19;
      var c = colour[e.kind] || colour.plain;
      marks +=
        '<line x1="' + ex.toFixed(1) + '" y1="' + (axis + 4) + '" x2="' + ex.toFixed(1) + '" y2="' +
          (ey - 5) + '" stroke="' + c + '" stroke-width="1" opacity=".45"/>' +
        '<circle cx="' + ex.toFixed(1) + '" cy="' + axis + '" r="4.5" fill="' + c +
          '" stroke="var(--bg-3)" stroke-width="2"/>' +
        '<text x="' + (flip ? ex - 7 : ex + 7).toFixed(1) + '" y="' + ey + '" font-size="11" ' +
          'text-anchor="' + (flip ? "end" : "start") + '" fill="' + c + '">' + label + "</text>";
    });

    var H = axis + 24 + (rows.length || 1) * 19 + 8;
    host.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="What happens to the loan, by year">' +
      ticks + line + marks + "</svg>" +
      '<p class="cal__legend"><i class="cal__key is-study">studying</i>' +
      '<i class="cal__key is-repay">repaying</i>' +
      '<i class="cal__key k-peak">the balance turns</i>' +
      '<i class="cal__key k-cleared">it ends</i></p>';
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
      var t = timeline();
      var bits = ["Undergraduate " + t.ugStart + "\u2013" + t.ugEnds];
      if (t.pg) bits.push("postgraduate " + t.pgStart + "\u2013" + t.pgEnds);
      bits.push("work from " + t.workStart);
      $("startHint").textContent = bits.join(" \u00b7 ") + ".";

      var gap = t.workStart - defaultWorkStart(t);
      $("workHint").textContent = gap > 0
        ? gap + (gap === 1 ? " year" : " years") + " after the course ends. Repayments still fall due from April " +
          start + ", but nothing is deducted until there is pay to deduct it from."
        : (gap < 0
          ? "Before the course ends \u2014 working while studying. No deductions until April " + start + " either way."
          : "Straight after the course. Repayments fall due from April " + start + ".");
    }

    var sal = salaries(a);
    var firstSal = sal[start] || 0;
    var tenth = sal[start + 9] || 0;
    var career = CAREERS.filter(function (c) { return c.id === $("career").value; })[0];
    $("careerNote").textContent = career ? career.note : "";
    markCareer();

    var sim = lastSim;
    if (sim && $("savingsReadout")) {
      var o = sim.opportunity;
      $("savingsReadout").innerHTML = o.foregoneGrowth > 0
        ? "At <b>" + pct(a.savings) + "</b> those repayments would have grown to <b>" +
          gbp(o.fvRepayments) + "</b> — <b>" + gbp(o.foregoneGrowth) + "</b> more than you handed over."
        : "Nothing is deducted on this profile, so there is nothing to have saved instead.";
    }

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
    "openingBalance", "repayStartYear", "hasPgl", "pglBalance", "pgStartYear", "pgYears",
    "workStartYear", "career", "startSalary", "salaryGrowth", "birthYear", "overpay",
    "rpi", "bankBase", "thresholdGrowth", "inflation", "savings", "useCap"];

  function save() {
    try {
      var data = { state: {
        loanMode: state.loanMode, incomeMode: state.incomeMode,
        manual: state.manual, manualYears: state.manualYears,
        scen: state.scen, active: state.active, showNoLoan: state.showNoLoan,
        pgTouched: state.pgTouched, workTouched: state.workTouched
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
        if (Array.isArray(data.state.scen) && data.state.scen.length === SCEN_META.length) {
          state.scen = data.state.scen;
          // A profile saved before the path list was trimmed may name one that
          // has gone. Move it to the nearest thing rather than leaving it
          // pointing at nothing.
          state.scen.forEach(function (s) {
            var known = CAREERS.some(function (c) { return c.id === s.career; });
            if (!known) s.career = "grad";
          });
        }
        if (typeof data.state.active === "number") state.active = data.state.active;
        if (typeof data.state.showNoLoan === "boolean") state.showNoLoan = data.state.showNoLoan;
        state.pgTouched = !!data.state.pgTouched;
        state.workTouched = !!data.state.workTouched;
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
        buildIncomeChart();
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
      if (t.id === "living") {
        var l = LIVING.filter(function (x) { return x.id === t.value; })[0];
        if (l) $("maintenance").value = l.max;
      }
      if (t.id === "hasPgl") { $("pglRow").hidden = !t.checked; followTimeline("hasPgl"); }
      if (t.id === "pgStartYear") state.pgTouched = true;
      if (t.id === "workStartYear") state.workTouched = true;
      if (t.id === "birthYear") buildSalaryTable();
      if (t.id === "startYear" || t.id === "courseYears" || t.id === "pgStartYear" || t.id === "pgYears") {
        followTimeline(t.id);
      }
      if (t.id === "startYear" || t.id === "repayStartYear" || t.id === "workStartYear") {
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

    // Settings persist, which is right until the page changes underneath
    // them — a profile saved last week can outlive the thing that made it.
    $("resetAll").addEventListener("click", function () {
      try { localStorage.removeItem(STORE); } catch (e) { /* nothing to clear */ }
      location.reload();
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

  // Moving the undergraduate course should drag the dates that hang off it,
  // unless the reader has deliberately placed them somewhere else.
  function followTimeline(changed) {
    var t = timeline();
    if (changed === "startYear" || changed === "courseYears" || changed === "hasPgl") {
      if (!state.pgTouched) $("pgStartYear").value = t.ugEnds;
    }
    // Even a hand-placed one cannot start before the degree it follows.
    if ($("hasPgl").checked && num("pgStartYear", t.ugEnds) < t.ugEnds) {
      $("pgStartYear").value = t.ugEnds;
    }
    var t2 = timeline();
    if (!state.workTouched) $("workStartYear").value = defaultWorkStart(t2);
    syncSliders();
  }

  /* ---- the header, walked through ----------------------------------------
   * The controls used to be a column beside the results. They are a band
   * across the top now, one section at a time: the header sticks while you
   * scroll the length of it, and each section gives way to the next as you
   * pass it. Which one is open is a function of how far you have scrolled,
   * not of anything the sections themselves measure — so opening one cannot
   * move the ground and set off the next.
   * ---------------------------------------------------------------------- */

  var HDR_STEP = 130;          // scroll to spend on each section
  var hdrGrps = [], hdrAt = -2;

  // Narrow enough and there is no room to pin a header and walk it: the
  // sections all show at once and the page is simply scrolled, or the walk
  // would advance off-screen where nobody could see it or reach it.
  function hdrNarrow() {
    return window.matchMedia("(max-width: 939px)").matches;
  }

  function hdrShowAll() {
    hdrGrps.forEach(function (g) { g.el.hidden = false; });
    Array.prototype.forEach.call($("hdrNav").children, function (b) {
      b.classList.remove("is-on");
      b.removeAttribute("aria-current");
    });
    hdrAt = -2;
    document.body.classList.remove("hdr-shut");
    buildIncomeChart();
    renderTimelineTrack();
    fitSliders();
    syncSliders();
  }

  // -1 means every section closed: you have walked past the controls and the
  // header is down to its bar, which stays so you can get back to any of them.
  function hdrShow(i) {
    if (!hdrGrps.length || hdrNarrow()) return;
    i = clamp(i, -1, hdrGrps.length - 1);
    if (i === hdrAt) return;
    hdrAt = i;
    hdrGrps.forEach(function (g, k) { g.el.hidden = k !== i; });
    Array.prototype.forEach.call($("hdrNav").children, function (b, k) {
      b.classList.toggle("is-on", k === i);
      b.setAttribute("aria-current", k === i ? "true" : "false");
    });
    document.body.classList.toggle("hdr-shut", i < 0);
    if (i < 0) return;
    // A section that owns a chart has to draw it now it has a width.
    if (hdrGrps[i].el.querySelector("#drawChart")) buildIncomeChart();
    if (hdrGrps[i].el.querySelector("#tlTrack")) renderTimelineTrack();
    fitSliders();
    syncSliders();
  }

  function hdrOnScroll() {
    if (hdrNarrow()) return;
    var y = window.scrollY || window.pageYOffset || 0;
    hdrShow(y >= HDR_STEP * hdrGrps.length ? -1 : Math.floor(y / HDR_STEP));
  }

  function hdrApply() {
    if (hdrNarrow()) { hdrShowAll(); return; }
    hdrAt = -2;
    hdrOnScroll();
  }

  function buildHeaderNav() {
    var nav = $("hdrNav"), form = $("form");
    if (!nav || !form) return;
    hdrGrps = Array.prototype.map.call(form.querySelectorAll("[data-grp]"), function (el) {
      return { el: el, name: el.dataset.grp };
    });
    nav.innerHTML = hdrGrps.map(function (g, i) {
      return '<button type="button" data-go="' + i + '"><i></i>' + g.name + "</button>";
    }).join("");
    nav.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-go]");
      if (!b) return;
      var i = Number(b.dataset.go);
      if (hdrNarrow()) {
        hdrGrps[i].el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      // Move the page back to where that section lives; the scroll handler
      // opens it on the way, and opens it now in case the page is already there.
      window.scrollTo({ top: i * HDR_STEP + 4, behavior: "smooth" });
      hdrShow(i);
    });
    hdrApply();
    window.addEventListener("scroll", hdrOnScroll, { passive: true });
    var settle = null;
    window.addEventListener("resize", function () {
      clearTimeout(settle);
      settle = setTimeout(function () {
        hdrApply();
        if (lastRuns) renderAllCharts(lastRuns);
      }, 120);
    });
  }

  function toggleYear(y) {
    state.openYears[y] = !state.openYears[y];
    renderLog(lastSim);
  }

  function init() {
    fillSelects();
    fillRulesTable();
    buildCareerCards();
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
    loadScenario();
    fitSliders();
    markScens();
    markCareer();
    if (!state.workTouched) $("workStartYear").value = defaultWorkStart(timeline());
    if (!state.pgTouched) $("pgStartYear").value = timeline().ugEnds;
    syncSliders();
    wire();
    wireIncomeChart();
    wireTimelineTrack();
    renderTimelineTrack();
    buildHeaderNav();
    run();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
