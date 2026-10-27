/* =========================================================================
   Аналитический дашборд продаж ЖК «МБ» (вариант 1)
   Частица данных — квартира. Все графики считаются из одного массива FLATS
   и связаны кросс-фильтрацией: клик (или выделение недель) на любом графике
   фильтрует остальные.
   ========================================================================= */
function startDashboard(FLATS) {
  "use strict";

  // ---------- данные ----------
  var parseDMY = d3.timeParse("%d.%m.%Y");
  var FL = FLATS.map(function (r) {
    var deal = r[11] ? parseDMY(r[11]) : null;
    return {
      id: r[0], korpus: r[1], floor: r[2], rooms: r[3], area: r[4], view: r[5],
      ppm: r[6], cost: r[7], disc: r[8] || 0, sum: r[9] || 0, manager: r[10],
      dealDate: deal, inqDate: r[12] ? parseDMY(r[12]) : null, days: r[13], plan: r[14],
      sold: !!deal, num: +r[0].split("-")[2],
      week: deal ? d3.timeMonday.floor(deal) : null
    };
  });

  var SIDE = {
    "на Садовое": "sadovoe", "на реку": "river", "на реку и во двор": "river+yard",
    "во двор и на реку": "river+yard", "в сад": "garden", "в сад и во двор": "garden+yard",
    "на улицу и в сад": "street+garden", "во двор": "yard", "на улицу и во двор": "street+yard",
    "во двор и на улицу": "street+yard", "на улицу": "street", "во двор и окна ЖК": "yard+wall",
    "в окна ЖК и на улицу": "wall+street"
  };
  var SIDE_ORDER = ["sadovoe", "river", "river+yard", "garden", "garden+yard", "street+garden",
    "yard", "street+yard", "street", "yard+wall", "wall+street"];
  var SIDE_LABEL = {
    sadovoe: "на Садовое", river: "на реку", "river+yard": "на реку и во двор", garden: "в сад",
    "garden+yard": "в сад и во двор", "street+garden": "на улицу и в сад", yard: "во двор",
    "street+yard": "на улицу и во двор", street: "на улицу", "yard+wall": "во двор и в окна ЖК",
    "wall+street": "в окна ЖК и на улицу"
  };
  FL.forEach(function (f) { f.side = SIDE[f.view] || "yard"; });

  var WEEKS = d3.timeMonday.range(d3.min(FL, function (f) { return f.week; }),
    d3.timeDay.offset(d3.max(FL, function (f) { return f.week; }), 1));

  // ---------- палитра (пастель) ----------
  var C = {
    fast: "#4fae96", mid: "#86cdb8", slow: "#bfe6d9",
    empty: "#ffffff", emptyStroke: "#c9bdb1",
    mullSold: "rgba(25,85,70,0.45)", mullEmpty: "#ddd2c7",
    ink: "#2b2f36", ink2: "#59606b", muted: "#8c939d", grid: "#eceef1",
    good: "#2f8f7d", bad: "#d0574a", accent: "#4fae96", accentSoft: "#bfe6d9", coral: "#ef9a8a",
    dim: "#e9ebee",
    ground: { sadovoe: "#b3bac4", street: "#d4d8de", river: "#a9d4f0", garden: "#b8dfb2", yard: "#f0ddb8", wall: "#d2d7e0" },
    decor: { sadovoe: "#ffffff", street: "#ffffff", river: "#ffffff", garden: "#86c47c", yard: "#d9bf8e", wall: "#aeb8c6" }
  };
  var FACADE = { "К1": "#f7e3d3", "К2": "#efe2f3", "К3": "#fbefd2", "К4": "#f6dfe1", "К5": "#ece4d5", "К6": "#e6e2f4" };
  function speedColor(d) { return d <= 7 ? C.fast : d <= 14 ? C.mid : C.slow; }

  // ---------- форматтеры ----------
  var ru = d3.formatLocale({ decimal: ",", thousands: " ", grouping: [3], currency: ["", " ₽"] });
  var fInt = ru.format(",d");
  var f1 = ru.format(".1f");
  function bln(v) { return ru.format(".2f")(v / 1e9) + " млрд ₽"; }
  function mln(v) { return fInt(Math.round(v / 1e6)) + " млн ₽"; }
  function rub(v) { return fInt(Math.round(v)) + " ₽"; }
  function pct(v) { return isFinite(v) ? Math.round(v * 100) + "%" : "—"; }
  var fDate = d3.timeFormat("%d.%m.%Y");
  var fWeek = d3.timeFormat("%d.%m");
  function plural(n, f) {
    var a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? f[1] : f[2];
  }
  var ROOMS_LABEL = { 1: "1-комнатные", 2: "2-комнатные", 3: "3-комнатные", 4: "4-комнатные" };

  // ---------- состояние фильтров ----------
  var state = { korpus: null, side: null, rooms: null, manager: null, weeks: null };

  // Фильтры двух видов: по свойствам квартиры (корпус, сторона, комнаты)
  // и по сделкам (менеджер, недели). Фильтр по сделкам не убирает непроданные
  // квартиры из знаменателя: «продано» = подходящие сделки / подходящие квартиры.
  function matchFlat(f, skip) {
    if (state.korpus && skip !== "korpus" && f.korpus !== state.korpus) return false;
    if (state.side && skip !== "korpus" && f.side !== state.side) return false;
    if (state.rooms && skip !== "rooms" && f.rooms !== state.rooms) return false;
    return true;
  }
  function dealFilter(skip) { return !!((state.manager && skip !== "manager") || (state.weeks && skip !== "weeks")); }
  function matchDeal(f, skip) {
    if (!f.sold) return false;
    if (state.manager && skip !== "manager" && f.manager !== state.manager) return false;
    if (state.weeks && skip !== "weeks" && !(f.week >= state.weeks[0] && f.week < state.weeks[1])) return false;
    return true;
  }
  function counted(f, skip) { return f.sold && matchDeal(f, skip); }   // засчитывается как продажа
  function match(f, skip) { return matchFlat(f, skip) && (!dealFilter(skip) || matchDeal(f, skip)); }
  function filtered(skip) { return FL.filter(function (f) { return match(f, skip); }); }
  function anyFilter() { return !!(state.korpus || state.rooms || state.manager || state.weeks); }

  function setFilter(key, value) {
    if (key === "korpus") {
      var same = state.korpus === value.korpus && state.side === value.side;
      state.korpus = same ? null : value.korpus;
      state.side = same ? null : value.side;
    } else {
      state[key] = state[key] === value ? null : value;
    }
    update();
  }

  // ---------- тултип ----------
  var tip = d3.select("#tip");
  function row(a, b) { return '<div class="r"><span>' + a + "</span><span>" + b + "</span></div>"; }
  function showTip(html, ev) {
    tip.html(html).attr("hidden", null);
    var n = tip.node(), w = n.offsetWidth, h = n.offsetHeight;
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tip.style("left", Math.max(8, x) + "px").style("top", Math.max(8, y) + "px");
  }
  function hideTip() { tip.attr("hidden", true); }
  function flatTip(f) {
    return "<b>" + f.id + "</b>" + row("Корпус, этаж", f.korpus + ", " + f.floor) +
      row("Комнат, площадь", f.rooms + ", " + String(f.area).replace(".", ",") + " м²") +
      row("Вид", f.view) + row("Цена за м²", rub(f.ppm)) + row("Стоимость", mln(f.cost)) +
      (f.sold ? row("Статус", "продана " + fDate(f.dealDate)) + row("Дней в работе", f.days) +
        row("Скидка", rub(f.disc)) + row("Менеджер", f.manager) : row("Статус", "в продаже"));
  }
  function groupTip(title, list) {
    var sold = list.filter(function (f) { return f.sold; });
    return "<b>" + title + "</b>" + row("Квартир", list.length) +
      row("Продано", sold.length + " (" + pct(sold.length / list.length) + ")") +
      row("Выручка", bln(d3.sum(sold, function (f) { return f.sum; }))) +
      row("В продаже на", bln(d3.sum(list.filter(function (f) { return !f.sold; }), function (f) { return f.cost; })));
  }

  /* ======================================================================
     1. ОСНОВНОЙ ГРАФИК — «шахматка» фасадов
     ====================================================================== */
  function renderMain() {
    var host = d3.select("#main");
    host.selectAll("*").remove();

    var K = 0.46, LEG_H = 16, GAP = 3, PAD = 5, SEAM = 3, BGAP = 30, MIN_SEC = 40;
    var LEFT = 48, TOP = 60;
    var FLOOR_MIN = 2, FLOOR_MAX = d3.max(FL, function (f) { return f.floor; });
    var NFL = FLOOR_MAX - FLOOR_MIN + 1;
    var ROW, WIN_H, baseY;   // высота этажа подбирается ниже — под высоту правой колонки
    function rowTop(fl) { return baseY - (fl - FLOOR_MIN + 1) * ROW; }

    var korpuses = Array.from(new Set(FL.map(function (f) { return f.korpus; }))).sort();
    var x = LEFT;
    var buildings = korpuses.map(function (k) {
      var kf = FL.filter(function (f) { return f.korpus === k; });
      var sides = Array.from(new Set(kf.map(function (f) { return f.side; })))
        .sort(function (a, b) { return SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b); });
      var b = { korpus: k, x0: x, top: d3.max(kf, function (f) { return f.floor; }), flats: kf, sections: [] };
      sides.forEach(function (s, i) {
        var sf = kf.filter(function (f) { return f.side === s; });
        var byFloor = d3.group(sf, function (f) { return f.floor; });
        var w = 0;
        byFloor.forEach(function (list) {
          var sw = d3.sum(list, function (f) { return f.area * K + GAP; }) - GAP;
          if (sw > w) w = sw;
        });
        w = Math.max(MIN_SEC, w + PAD * 2);
        byFloor.forEach(function (list) {
          list.sort(function (a, c) { return a.num - c.num; });
          var cx = x + PAD;
          list.forEach(function (f) { f.x = cx; f.w = f.area * K; cx += f.w + GAP; });
        });
        b.sections.push({ side: s, x0: x, w: w, flats: sf, korpus: k });
        x += w + (i < sides.length - 1 ? SEAM : 0);
      });
      b.x1 = x; x += BGAP;
      return b;
    });
    var facadesEnd = x - BGAP;
    var BAR_X = facadesEnd + 40, BAR_W = 70;
    var W = BAR_X + BAR_W + 48;
    // Высота этажа: график растягивается на всю высоту карточки (= высота правой колонки).
    // Ширина viewBox от высоты не зависит, поэтому масштаб известен заранее.
    var cssW = host.node().clientWidth || 1000;
    var cssH = host.node().clientHeight;
    var scale = cssW / W;
    var EXTRA = TOP + 40 + 72;                  // подписи сверху + земля и проценты снизу
    ROW = (cssH > 200 ? (cssH / scale - EXTRA) / NFL : 34);
    ROW = Math.max(22, Math.min(90, ROW));
    WIN_H = Math.min(ROW * 0.66, ROW - 6);
    baseY = TOP + 40 + NFL * ROW;
    var H = baseY + 72;

    var svg = host.append("svg").attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img").attr("aria-label", "Шахматка продаж: квартиры по корпусам, сторонам фасада и этажам");

    function text(g, x, y, s, size, fill, weight, anchor) {
      return g.append("text").attr("x", x).attr("y", y).attr("font-size", size).attr("fill", fill)
        .attr("font-weight", weight || 400).attr("text-anchor", anchor || "start").text(s);
    }
    function share(list) { return list.length ? d3.mean(list, function (f) { return f.sold ? 1 : 0; }) : NaN; }
    var active = anyFilter();
    var on = function (f) { return match(f); };

    // ось этажей
    var gAxis = svg.append("g");
    for (var fl = FLOOR_MIN; fl <= FLOOR_MAX; fl++) {
      text(gAxis, LEFT - 8, rowTop(fl) + ROW / 2 + 4.5, String(fl), 12.5, fl % 5 === 0 ? C.ink2 : C.muted, fl % 5 === 0 ? 600 : 400, "end");
    }
    text(gAxis, LEFT - 8, rowTop(FLOOR_MAX) - 10, "этаж", 12.5, C.muted, 400, "end");

    // полоски «что видно из окон»
    function groundStrip(g, x0, w, kind, y0) {
      g.append("rect").attr("x", x0).attr("y", y0).attr("width", w).attr("height", 14).attr("rx", 2).attr("fill", C.ground[kind]);
      var p = "";
      if (kind === "river") {
        for (var xx = x0 + 2; xx < x0 + w - 6; xx += 8) p += "M" + xx + "," + (y0 + 8) + " q2,-3 4,0 t4,0 ";
        g.append("path").attr("d", p).attr("fill", "none").attr("stroke", C.decor.river).attr("stroke-width", 1.2);
      } else if (kind === "garden") {
        for (var t = x0 + 5; t < x0 + w - 3; t += 9) p += "M" + (t - 3.6) + "," + (y0 + 7) + "a3.6,3.6 0 1,0 7.2,0a3.6,3.6 0 1,0 -7.2,0";
        g.append("path").attr("d", p).attr("fill", C.decor.garden);
      } else if (kind === "sadovoe" || kind === "street") {
        g.append("line").attr("x1", x0 + 3).attr("x2", x0 + w - 3).attr("y1", y0 + 7).attr("y2", y0 + 7)
          .attr("stroke", "#fff").attr("stroke-width", kind === "sadovoe" ? 1.6 : 1.2).attr("stroke-dasharray", kind === "sadovoe" ? "6 4" : "3 4");
        if (kind === "sadovoe") {
          g.append("path").attr("d", "M" + (x0 + 3) + "," + (y0 + 2.5) + "H" + (x0 + w - 3) + "M" + (x0 + 3) + "," + (y0 + 11.5) + "H" + (x0 + w - 3))
            .attr("stroke", "#fff").attr("stroke-width", 0.8);
        }
      } else if (kind === "yard") {
        for (var q = x0 + 5; q < x0 + w - 4; q += 10) p += "M" + q + "," + (y0 + 5) + "h4v4h-4Z";
        g.append("path").attr("d", p).attr("fill", C.decor.yard);
      } else if (kind === "wall") {
        for (var r = x0 + 3; r < x0 + w - 4; r += 7) p += "M" + r + "," + (y0 + 3) + "h4v8h-4Z";
        g.append("path").attr("d", p).attr("fill", C.decor.wall);
      }
    }
    function ground(g, x0, w, side, y0) {
      var parts = side.split("+");
      if (parts.length === 1) return groundStrip(g, x0, w, parts[0], y0);
      var half = (w - 2) / 2;
      groundStrip(g, x0, half, parts[0], y0);
      groundStrip(g, x0 + half + 2, half, parts[1], y0);
    }

    // корпуса
    buildings.forEach(function (b) {
      var g = svg.append("g");
      var topY = rowTop(b.top) - 6;
      var selB = state.korpus === b.korpus && !state.side;
      var dimB = state.korpus && state.korpus !== b.korpus;
      g.append("rect").attr("x", b.x0 - 3).attr("y", topY - 7).attr("width", b.x1 - b.x0 + 6).attr("height", 7).attr("rx", 1.5)
        .attr("fill", d3.color(FACADE[b.korpus]).darker(0.45).formatHex());
      var bs = share(b.flats), soldN = b.flats.filter(function (f) { return f.sold; }).length;
      var lbl = g.append("g").attr("class", "pick").attr("opacity", dimB ? 0.45 : 1)
        .on("click", function () { setFilter("korpus", { korpus: b.korpus, side: null }); })
        .on("mousemove", function (ev) { showTip(groupTip("Корпус " + b.korpus, b.flats), ev); })
        .on("mouseleave", hideTip);
      lbl.append("rect").attr("x", b.x0 - 5).attr("y", topY - 54).attr("width", 190).attr("height", 44).attr("rx", 6)
        .attr("fill", selB ? "#e3f4ee" : "transparent");
      text(lbl, b.x0, topY - 31, b.korpus, 21, C.ink, 700);
      text(lbl, b.x0 + 36, topY - 31, "продано " + pct(bs), 14.5, C.ink, 600);
      text(lbl, b.x0, topY - 15, soldN + " из " + b.flats.length + " квартир", 12.5, C.muted);

      var mullSold = "", mullEmpty = "";
      b.sections.forEach(function (s) {
        var selS = state.korpus === s.korpus && state.side === s.side;
        g.append("rect").attr("x", s.x0).attr("y", topY).attr("width", s.w).attr("height", baseY - topY)
          .attr("fill", FACADE[b.korpus]).attr("stroke", selS ? C.ink : "none").attr("stroke-width", 1.5);
        s.flats.forEach(function (f) {
          var wy = rowTop(f.floor) + (ROW - WIN_H) / 2;
          var isOn = !active || on(f);
          g.append("rect").attr("class", "win").attr("x", f.x).attr("y", wy).attr("width", f.w).attr("height", WIN_H).attr("rx", 1.2)
            .attr("fill", f.sold ? speedColor(f.days) : C.empty)
            .attr("stroke", f.sold ? "none" : C.emptyStroke).attr("stroke-width", f.sold ? 0 : 1)
            .attr("opacity", isOn ? 1 : 0.13)
            .on("mousemove", function (ev) { showTip(flatTip(f), ev); })
            .on("mouseleave", hideTip);
          for (var i = 1; i < f.rooms; i++) {
            var mx = (f.x + f.w * i / f.rooms).toFixed(1);
            if (!isOn) continue;
            if (f.sold) mullSold += "M" + mx + "," + wy + "v" + WIN_H; else mullEmpty += "M" + mx + "," + wy + "v" + WIN_H;
          }
        });
        // земля + доля проданных (кликабельно: фильтр по стороне фасада)
        var gs = g.append("g").attr("class", "pick")
          .on("click", function () { setFilter("korpus", { korpus: s.korpus, side: s.side }); })
          .on("mousemove", function (ev) { showTip(groupTip(s.korpus + ", окна " + SIDE_LABEL[s.side], s.flats), ev); })
          .on("mouseleave", hideTip);
        gs.append("rect").attr("x", s.x0).attr("y", baseY + 2).attr("width", s.w).attr("height", 64).attr("fill", selS ? "#e3f4ee" : "transparent").attr("rx", 4);
        ground(gs, s.x0, s.w, s.side, baseY + 5);
        var ss = share(s.flats);
        text(gs, s.x0 + s.w / 2, baseY + 40, pct(ss), 14.5, ss < 0.5 ? C.bad : ss >= 0.8 ? C.good : C.ink, 700, "middle");
        text(gs, s.x0 + s.w / 2, baseY + 56, s.flats.length + " кв.", 11.5, C.muted, 400, "middle");
      });
      g.append("path").attr("d", mullSold).attr("stroke", C.mullSold).attr("fill", "none").attr("pointer-events", "none");
      g.append("path").attr("d", mullEmpty).attr("stroke", C.mullEmpty).attr("fill", "none").attr("pointer-events", "none");
    });

    // доля проданных по этажам (с учётом фильтров)
    var gF = svg.append("g");
    text(gF, BAR_X, rowTop(FLOOR_MAX) - 27, "продано", 13, C.ink2, 600);
    text(gF, BAR_X, rowTop(FLOOR_MAX) - 11, "по этажам", 13, C.ink2, 600);
    var base = FL.filter(function (f) { return matchFlat(f); });
    var byFl = d3.group(base, function (f) { return f.floor; });
    for (var fl2 = FLOOR_MIN; fl2 <= FLOOR_MAX; fl2++) {
      var list = byFl.get(fl2) || [];
      var y0 = rowTop(fl2) + (ROW - 12) / 2;
      gF.append("rect").attr("x", BAR_X).attr("y", y0).attr("width", BAR_W).attr("height", 12).attr("rx", 2).attr("fill", "#f1f3f5");
      if (!list.length) continue;
      var sh = d3.mean(list, function (f) { return counted(f) ? 1 : 0; });
      gF.append("rect").attr("x", BAR_X).attr("y", y0).attr("width", Math.max(1, BAR_W * sh)).attr("height", 12).attr("rx", 2).attr("fill", C.mid);
      text(gF, BAR_X + BAR_W + 5, y0 + 10.5, pct(sh), 11.5, C.ink2);
    }

    // легенда — в свободном «небе» над низкими корпусами
    var lx = buildings[1].x0, ly = TOP - 30;
    var gL = svg.append("g");
    text(gL, lx, ly, "ОКНО = КВАРТИРА", 12, C.muted, 600);
    [[C.fast, "продана за 7 дней и быстрее"], [C.mid, "продана за 8–14 дней"], [C.slow, "продана за 15–42 дня"], [C.empty, "ещё в продаже"]]
      .forEach(function (l, i) {
        var yy = ly + 12 + i * 25;
        gL.append("rect").attr("x", lx).attr("y", yy).attr("width", 30).attr("height", LEG_H).attr("rx", 1.2)
          .attr("fill", l[0]).attr("stroke", l[0] === C.empty ? C.emptyStroke : "none");
        text(gL, lx + 40, yy + 13, l[1], 14, C.ink2);
      });
    var sy = ly + 12 + 4 * 25 + 4;
    gL.append("rect").attr("x", lx).attr("y", sy).attr("width", 20).attr("height", LEG_H).attr("rx", 1.2).attr("fill", C.mid);
    gL.append("rect").attr("x", lx + 25).attr("y", sy).attr("width", 60).attr("height", LEG_H).attr("rx", 1.2).attr("fill", C.mid);
    gL.append("path").attr("d", [1, 2, 3].map(function (i) { return "M" + (lx + 25 + 15 * i) + "," + sy + "v" + LEG_H; }).join(""))
      .attr("stroke", C.mullSold);
    text(gL, lx + 94, sy + 13, "ширина — площадь, створки — комнаты", 14, C.ink2);

    var gx = lx + 380;
    text(gL, gx, ly, "ЧТО ВИДНО ИЗ ОКОН", 12, C.muted, 600);
    [["river", "река"], ["sadovoe", "Садовое кольцо"], ["garden", "сад"], ["street", "улица"], ["yard", "двор"], ["wall", "окна соседнего корпуса"]]
      .forEach(function (it, i) {
        var gx2 = gx + (i < 3 ? 0 : 190), gy = ly + 12 + (i % 3) * 25;
        groundStrip(gL, gx2, 44, it[0], gy);
        text(gL, gx2 + 52, gy + 12, it[1], 14, C.ink2);
      });
    text(gL, gx, ly + 100, "Клик по подписи корпуса или полоске под фасадом — фильтр", 13, C.muted);
  }

  /* ======================================================================
     2. ДИНАМИКА ПО НЕДЕЛЯМ — сделки и выручка, выделение недель = фильтр
     ====================================================================== */
  var weekBrushSync = null;
  function renderWeeks() {
    var host = d3.select("#weeks");
    host.selectAll("*").remove();
    var data = filtered("weeks").filter(function (f) { return f.sold; });
    var byW = d3.rollup(data, function (v) {
      return { n: v.length, sum: d3.sum(v, function (f) { return f.sum; }), disc: d3.sum(v, function (f) { return f.disc; }) };
    }, function (f) { return +f.week; });
    var rows = WEEKS.map(function (w) { var r = byW.get(+w) || { n: 0, sum: 0, disc: 0 }; return { week: w, n: r.n, sum: r.sum, disc: r.disc }; });

    var W = host.node().clientWidth, H = 196;
    var m = { l: 52, r: 8, t: 14, b: 22 }, gap = 22;
    var h1 = 70, h2 = H - m.t - m.b - h1 - gap;
    var svg = host.append("svg").attr("viewBox", "0 0 " + W + " " + H);
    var x = d3.scaleBand().domain(WEEKS.map(Number)).range([m.l, W - m.r]).paddingInner(0.25);
    var y1 = d3.scaleLinear().domain([0, Math.max(4, d3.max(rows, function (d) { return d.n; }))]).nice(3).range([m.t + h1, m.t]);
    var y2 = d3.scaleLinear().domain([0, Math.max(1, d3.max(rows, function (d) { return d.sum; }))]).nice(3).range([m.t + h1 + gap + h2, m.t + h1 + gap]);
    var bw = Math.min(14, x.bandwidth());
    var inSel = function (d) { return !state.weeks || (d.week >= state.weeks[0] && d.week < state.weeks[1]); };

    function axis(y, fmt, label, ty) {
      var g = svg.append("g");
      y.ticks(3).forEach(function (t) {
        g.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", t ? C.grid : "#d5d9de");
        g.append("text").attr("x", m.l - 5).attr("y", y(t) + 3.5).attr("text-anchor", "end").attr("font-size", 9.5).attr("fill", C.muted).text(fmt(t));
      });
      svg.append("text").attr("x", m.l).attr("y", ty).attr("font-size", 10.5).attr("font-weight", 600).attr("fill", C.ink2).text(label);
    }
    axis(y1, fInt, "сделок в неделю", m.t - 3);
    var maxRev = y2.domain()[1];
    axis(y2, function (v) { return v === 0 ? "0" : maxRev >= 1e9 ? ru.format(".1~f")(v / 1e9) + " млрд" : fInt(v / 1e6) + " млн"; }, "выручка, ₽", m.t + h1 + gap - 3);

    function bar(y, key, fill) {
      svg.append("g").selectAll("rect").data(rows).join("rect")
        .attr("x", function (d) { return x(+d.week) + (x.bandwidth() - bw) / 2; })
        .attr("width", bw)
        .attr("y", function (d) { return y(d[key]); })
        .attr("height", function (d) { return y(0) - y(d[key]); })
        .attr("rx", 2).attr("fill", fill)
        .attr("opacity", function (d) { return inSel(d) ? 1 : 0.3; });
    }
    bar(y1, "n", C.mid);
    bar(y2, "sum", "#b9b2e6");

    // средний темп
    var avg = d3.mean(rows, function (d) { return d.n; });
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y1(avg)).attr("y2", y1(avg)).attr("stroke", C.ink2).attr("stroke-dasharray", "3 3");
    svg.append("text").attr("x", m.l + 4).attr("y", y1(avg) - 4).attr("font-size", 10).attr("font-weight", 600).attr("fill", C.ink2)
      .attr("stroke", "#fff").attr("stroke-width", 3).attr("paint-order", "stroke")
      .text("в среднем " + f1(avg));

    // подписи месяцев
    var months = d3.timeMonth.range(d3.timeMonth.ceil(WEEKS[0]), WEEKS[WEEKS.length - 1]);
    var fm = d3.timeFormat("%m");
    var MN = { "01": "янв", "02": "фев", "03": "мар", "04": "апр", "05": "май", "06": "июн", "07": "июл", "08": "авг", "09": "сен", "10": "окт", "11": "ноя", "12": "дек" };
    [WEEKS[0]].concat(months).forEach(function (mo) {
      var w = d3.timeMonday.ceil(mo);
      if (x(+w) == null) return;
      svg.append("text").attr("x", x(+w)).attr("y", H - 6).attr("font-size", 9.5).attr("fill", C.muted).text(MN[fm(mo)]);
    });

    // наведение
    svg.append("g").selectAll("rect").data(rows).join("rect")
      .attr("x", function (d) { return x(+d.week); }).attr("width", x.step()).attr("y", m.t).attr("height", H - m.t - m.b)
      .attr("fill", "transparent")
      .on("mousemove", function (ev, d) {
        showTip("<b>Неделя с " + fWeek(d.week) + "</b>" + row("Сделок", d.n) + row("Выручка", mln(d.sum)) + row("Скидки", mln(d.disc)), ev);
      }).on("mouseleave", hideTip);

    // выделение недель
    var brush = d3.brushX().extent([[m.l, m.t], [W - m.r, H - m.b]]).on("end", function (ev) {
      if (!ev.sourceEvent) return;
      if (!ev.selection) { state.weeks = null; update(); return; }
      var picked = WEEKS.filter(function (w) { var c = x(+w) + x.bandwidth() / 2; return c >= ev.selection[0] && c <= ev.selection[1]; });
      state.weeks = picked.length ? [picked[0], d3.timeDay.offset(picked[picked.length - 1], 7)] : null;
      update();
    });
    var gb = svg.append("g").attr("class", "brush").call(brush);
    gb.selectAll(".overlay").attr("cursor", "crosshair");
    if (state.weeks) {
      var last = d3.timeDay.offset(state.weeks[1], -7);
      gb.call(brush.move, [x(+state.weeks[0]) - 1, x(+last) + x.bandwidth() + 1]);
    }
    // наведение должно работать и под кистью
    gb.select(".overlay").on("mousemove.tip", function (ev) {
      var mx = d3.pointer(ev)[0];
      var i = Math.floor((mx - m.l) / x.step());
      var d = rows[Math.max(0, Math.min(rows.length - 1, i))];
      showTip("<b>Неделя с " + fWeek(d.week) + "</b>" + row("Сделок", d.n) + row("Выручка", mln(d.sum)) + row("Скидки", mln(d.disc)), ev);
    }).on("mouseleave.tip", hideTip);

    // фактоид под графиком: темп и средний чек в первой и второй половине периода
    var half = Math.floor(rows.length / 2);
    function check(part) { var n = d3.sum(part, function (d) { return d.n; }); return n ? d3.sum(part, function (d) { return d.sum; }) / n : 0; }
    var c1 = check(rows.slice(0, half)), c2 = check(rows.slice(half));
    var txt = "В среднем " + f1(avg) + " " + plural(Math.round(avg), ["сделка", "сделки", "сделок"]) + " в неделю. ";
    if (c1 && c2) {
      txt += "Средний чек во второй половине периода — " + mln(c2) + " против " + mln(c1) + " в первой" +
        (c2 < c1 * 0.9 ? ": дорогие квартиры распродаются, остаются более дешёвые, и выручка за неделю падает." :
         c2 > c1 * 1.1 ? ": стали чаще покупать дорогие квартиры." : ".");
    }
    d3.select("#weeksNote").html(txt);
  }

  /* ======================================================================
     3. МЕНЕДЖЕРЫ — сделки, выручка, скидки, скорость
     ====================================================================== */
  function renderManagers() {
    var host = d3.select("#managers");
    host.selectAll("*").remove();
    var sold = filtered("manager").filter(function (f) { return f.sold; });
    var rows = d3.rollups(sold, function (v) {
      var cost = d3.sum(v, function (f) { return f.cost; }), disc = d3.sum(v, function (f) { return f.disc; });
      var months = d3.rollup(v, function (x) { return x.length; }, function (f) { return f.dealDate.getMonth(); });
      return {
        n: v.length, sum: d3.sum(v, function (f) { return f.sum; }), disc: disc, discPct: cost ? disc / cost : 0,
        discDeals: v.filter(function (f) { return f.disc > 0; }).length,
        days: d3.mean(v, function (f) { return f.days; }), months: months
      };
    }, function (f) { return f.manager; }).map(function (d) { return Object.assign({ name: d[0] }, d[1]); })
      .sort(function (a, b) { return b.sum - a.sum; });

    var maxSum = d3.max(rows, function (d) { return d.sum; }) || 1;
    var maxDisc = Math.max(0.025, d3.max(rows, function (d) { return d.discPct; }) || 0);
    var totalDisc = d3.sum(rows, function (d) { return d.disc; });
    var monthsAll = d3.range(2, 9); // март–сентябрь (0 = январь)

    var t = host.append("div").attr("class", "mgr");
    var head = t.append("div").attr("class", "mgr-row mgr-head");
    ["Менеджер", "Выручка", "Скидка", "Дней", "Сделки по месяцам"].forEach(function (h) { head.append("div").text(h); });

    rows.forEach(function (d) {
      var r = t.append("div").attr("class", "mgr-row pick" + (state.manager === d.name ? " is-sel" : "") + (state.manager && state.manager !== d.name ? " is-dim" : ""))
        .on("click", function () { setFilter("manager", d.name); })
        .on("mousemove", function (ev) {
          showTip("<b>" + d.name + "</b>" + row("Сделок", d.n) + row("Выручка", bln(d.sum)) + row("Средний чек", mln(d.sum / d.n)) +
            row("Скидки", mln(d.disc) + " (" + pct(d.disc / totalDisc) + " всех)") + row("Сделок со скидкой", d.discDeals + " из " + d.n) +
            row("В среднем дней в работе", f1(d.days)), ev);
        }).on("mouseleave", hideTip);
      var short = d.name.split(" ");
      r.append("div").attr("class", "mgr-name").html(short[0] + " <span>" + (short[1] || "") + "</span>");
      var c1 = r.append("div").attr("class", "cellbar");
      c1.append("i").style("width", (d.sum / maxSum * 100) + "%").style("background", C.mid);
      c1.append("b").text(ru.format(".1f")(d.sum / 1e9) + " · " + d.n);
      var c2 = r.append("div").attr("class", "cellbar");
      c2.append("i").style("width", (d.discPct / maxDisc * 100) + "%").style("background", d.discPct > 0.015 ? C.coral : "#f6d3cb");
      c2.append("b").text(ru.format(".1f")(d.discPct * 100) + "%");
      r.append("div").attr("class", "num" + (d.days > 16 ? " warn" : d.days < 7 ? " ok" : "")).text(f1(d.days));
      // спарклайн по месяцам — столбики
      var sp = r.append("div").attr("class", "spark");
      var maxM = 12;
      monthsAll.forEach(function (mo) {
        var v = d.months.get(mo) || 0;
        sp.append("i").style("height", Math.max(1, v / maxM * 100) + "%").style("background", v ? C.fast : "#f0c6bd").attr("title", v);
      });
    });
    var top = rows[0];
    var discLeader = rows.slice().sort(function (a, b) { return b.disc - a.disc; })[0];
    d3.select("#managersNote").html(rows.length ? (
      "Больше всех продаёт <b>" + top.name.split(" ")[0] + "</b> — " + bln(top.sum) + ". " +
      (discLeader ? "Скидок больше всех даёт <b>" + discLeader.name.split(" ")[0] + "</b>: " + pct(discLeader.disc / (totalDisc || 1)) + " от всех скидок." : "")) : "Нет сделок при выбранных фильтрах.");
  }

  /* ======================================================================
     4. КОМНАТНОСТЬ — продано / в продаже
     ====================================================================== */
  function renderRooms() {
    var host = d3.select("#rooms");
    host.selectAll("*").remove();
    var data = FL.filter(function (f) { return matchFlat(f, "rooms"); });
    var rows = [1, 2, 3, 4].map(function (k) {
      var v = data.filter(function (f) { return f.rooms === k; });
      var s = v.filter(function (f) { return counted(f); });
      return { k: k, n: v.length, sold: s.length, days: d3.median(s, function (f) { return f.days; }),
        stock: d3.sum(v.filter(function (f) { return !f.sold; }), function (f) { return f.cost; }),
        other: v.filter(function (f) { return f.sold && !counted(f); }).length };
    });
    var maxN = d3.max(rows, function (d) { return d.n; }) || 1;
    var wrap = host.append("div").attr("class", "rooms");
    rows.forEach(function (d) {
      var r = wrap.append("div").attr("class", "room pick" + (state.rooms === d.k ? " is-sel" : "") + (state.rooms && state.rooms !== d.k ? " is-dim" : ""))
        .on("click", function () { setFilter("rooms", d.k); })
        .on("mousemove", function (ev) {
          showTip("<b>" + ROOMS_LABEL[d.k] + "</b>" + row("Квартир", d.n) + row("Продано", d.sold + " (" + pct(d.sold / d.n) + ")") +
            row("Медиана дней в работе", d.days == null ? "—" : d.days) + row("В продаже на", bln(d.stock)), ev);
        }).on("mouseleave", hideTip);
      r.append("div").attr("class", "room-name").text(ROOMS_LABEL[d.k]);
      var bar = r.append("div").attr("class", "room-bar").style("width", (d.n / maxN * 100) + "%");
      bar.append("i").attr("class", "sold").style("flex", d.sold);
      if (d.other) bar.append("i").attr("class", "other").style("flex", d.other);
      bar.append("i").attr("class", "left").style("flex", d.n - d.sold - d.other);
      r.append("div").attr("class", "room-val").html(d.n ? "<b>" + pct(d.sold / d.n) + "</b> " + d.sold + " из " + d.n : "—");
    });
    var valid = rows.filter(function (d) { return d.n; });
    var shares = valid.map(function (d) { return d.sold / d.n; });
    var best = valid.slice().sort(function (p, q) { return q.sold / q.n - p.sold / p.n; })[0];
    var note = "";
    if (valid.length && dealFilter()) {
      note = "Какая доля квартир каждого типа пришлась на выбранные сделки. Больше всего — " + ROOMS_LABEL[best.k].toLowerCase() + " (" + pct(best.sold / best.n) + ").";
    } else if (valid.length) {
      var spread = d3.max(shares) - d3.min(shares);
      note = "Продано от " + pct(d3.min(shares)) + " до " + pct(d3.max(shares)) + (spread < 0.15
        ? ": число комнат почти не влияет на продажи — решает вид из окон."
        : ": лучше всего продаются " + ROOMS_LABEL[best.k].toLowerCase() + ".");
    }
    d3.select("#roomsNote").html(note);
  }

  /* ======================================================================
     ФАКТОИДЫ (KPI) и строка фильтров
     ====================================================================== */
  function renderFacts() {
    var data = FL.filter(function (f) { return matchFlat(f); });
    var sold = data.filter(function (f) { return counted(f); });
    var left = data.filter(function (f) { return !f.sold; });
    var revenue = d3.sum(sold, function (f) { return f.sum; });
    var disc = d3.sum(sold, function (f) { return f.disc; });
    var cost = d3.sum(sold, function (f) { return f.cost; });
    var weeks = state.weeks ? d3.timeWeek.count(state.weeks[0], state.weeks[1]) : WEEKS.length;
    var pace = sold.length / weeks;
    var facts = [
      { k: "Выручка", v: bln(revenue), n: sold.length + " " + plural(sold.length, ["сделка", "сделки", "сделок"]) },
      { k: "Потеряли на скидках", v: mln(disc), n: (cost ? ru.format(".1f")(disc / cost * 100) : "0") + "% от прайсовой стоимости", bad: true },
      { k: "Продано квартир", v: pct(data.length ? sold.length / data.length : 0), n: sold.length + " из " + data.length },
      { k: "В продаже", v: left.length + " кв.", n: "на " + bln(d3.sum(left, function (f) { return f.cost; })) +
        (pace > 0 && left.length && !dealFilter() ? " · ≈" + Math.ceil(left.length / pace) + " нед. при текущем темпе" : "") }
    ];
    d3.select("#facts").selectAll(".fact").data(facts).join(function (e) {
      var d = e.append("div").attr("class", "fact");
      d.append("div").attr("class", "fact-k"); d.append("div").attr("class", "fact-v"); d.append("div").attr("class", "fact-n");
      return d;
    }).call(function (s) {
      s.select(".fact-k").text(function (d) { return d.k; });
      s.select(".fact-v").text(function (d) { return d.v; }).classed("bad", function (d) { return d.bad; });
      s.select(".fact-n").text(function (d) { return d.n; });
    });

    // активные фильтры
    var chips = [];
    if (state.korpus) chips.push({ key: "korpus", label: "Корпус " + state.korpus + (state.side ? ", окна " + SIDE_LABEL[state.side] : "") });
    if (state.rooms) chips.push({ key: "rooms", label: ROOMS_LABEL[state.rooms] });
    if (state.manager) chips.push({ key: "manager", label: state.manager });
    if (state.weeks) chips.push({ key: "weeks", label: "Сделки " + fWeek(state.weeks[0]) + "–" + fWeek(d3.timeDay.offset(state.weeks[1], -1)) });
    var bar = d3.select("#filters");
    bar.selectAll("*").remove();
    if (!chips.length) { bar.append("span").attr("class", "hint").text("Фильтры: кликните по корпусу, полоске под фасадом, менеджеру, комнатности или выделите недели мышью"); return; }
    chips.forEach(function (c) {
      bar.append("button").attr("class", "chip").text(c.label + " ✕").on("click", function () {
        if (c.key === "korpus") { state.korpus = null; state.side = null; } else state[c.key] = null;
        update();
      });
    });
    bar.append("button").attr("class", "chip chip-reset").text("Сбросить всё").on("click", function () {
      state = { korpus: null, side: null, rooms: null, manager: null, weeks: null }; update();
    });
  }

  function update() {
    hideTip();
    renderFacts();
    renderWeeks();       // сначала правая колонка — от её высоты зависит высота шахматки
    renderManagers();
    renderRooms();
    renderMain();
  }

  update();
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(update, 150); });
}

/* ---------- загрузка данных: sales.csv — исходный датасет ---------- */
(function () {
  var iso = d3.timeParse("%Y-%m-%d"), dmy = d3.timeFormat("%d.%m.%Y");
  function d(v) { return v ? dmy(iso(v)) : null; }
  function n(v) { return v === "" || v == null ? null : +v; }
  d3.csv("sales.csv").then(function (rows) {
    // приводим строки к компактному виду: [квартира, корпус, этаж, комнат, площадь, вид, цена м², стоимость,
    //  скидка, сумма сделки, менеджер, дата сделки, дата обращения, дней в работе, планировка]
    var flats = rows.map(function (r) {
      return [r["Квартира"], r["Корпус"], +r["Этаж"], +r["Комнат"], +r["Площадь, м²"], r["Вид"],
        Math.round(+r["Цена за м², руб."]), Math.round(+r["Стоимость, руб."]),
        n(r["Скидка, руб."]), n(r["Сумма сделки, руб."]), r["Менеджер"] || null,
        d(r["Дата сделки"]), d(r["Дата обращения"]), n(r["Дней в работе"]), r["Планировка"]];
    });
    startDashboard(flats);
  }).catch(function (err) {
    console.error(err);
    document.getElementById("main").innerHTML =
      '<p class="load-error">Не удалось загрузить <b>sales.csv</b>. Браузер не читает файлы при открытии index.html двойным кликом — ' +
      'откройте дашборд через GitHub Pages или локальный сервер: <code>python -m http.server</code> и затем http://localhost:8000</p>';
  });
})();
