// rtti_export.typ — RTTI rapport template
// Wrapper calls: #show: setup  then  #render(exam_info, student_data)
//
// exam_info : (name: string, global_max_points: int, n_term: float,
//              uitleg_rtti: (R, T1, T2, I: string))
// student_data : array of (
//   name, student_nr, group, score, max_score, grade, grade_num (float or none),
//   vragen: array of (
//     label, rtti, rtti_color, score (or none), max,
//     class_avg, class_pct, dot_color
//   ),
//   observaties: array of (icon, naam, uitleg),
//   leeradvies_rows: array of (cat, score_str, advies)
// )

#import "@preview/cetz:0.3.4": canvas, draw
#import "@preview/unify:0.8.0": num, unit, qty

// Per-student footer state (updated at the start of each student in render)
#let _footer_text = state("footer-text", "")

// ── Document setup ─────────────────────────────────────────────────────────────
#let setup(body) = {
  set page(
    margin: 2cm,
    background: place(
      bottom + right,
      dx: -0.5cm,
      dy: -0.5cm,
      box(width: 3.5cm, height: 3.5cm, clip: true)[
        #image("/data/fotos/school-watermerk.svg", width: 3.5cm, height: 3.5cm, fit: "contain")
        #place(top + left, rect(width: 3.5cm, height: 3.5cm, fill: white.transparentize(20%)))
      ]
    ),
    footer: context {
      let txt = _footer_text.get()
      if txt == "" { return }
      let pg = counter(page).get().first()
      set text(style: "italic", fill: gray.darken(20%), size: 8pt)
      place(left, [#pg / 2])
      align(center, txt)
    }
  )
  set text(font: "Libertinus Serif", size: 10pt)
  set heading(numbering: none)
  show heading.where(level: 1): it => block(
    below: 4pt,
    text(fill: rgb("#1a5276"), size: 13pt, weight: "bold", it.body)
  )
  show heading.where(level: 2): it => block(
    above: 2pt, below: 6pt,
    text(fill: rgb("#1a5276"), size: 11pt, weight: "regular", it.body)
  )
  // Decimal numbers in math: match both dot (7.2) and comma (7,2) variants,
  // normalise to comma, and return a text-mode content block so the comma
  // is NOT treated as a math comma (which would add auto thin-spacing).
  show math.equation: it => {
    show regex("[0-9]+[.,][0-9]+"): m => {
      let s = m.text.replace(".", ",")
      let i = s.position(",")
      [#s.slice(0, i),#h(0pt)#s.slice(i + 1)]
    }
    it
  }
  body
}

// ── Lollipop chart ─────────────────────────────────────────────────────────────
// All x-coordinates are floats in cm (cetz default unit = 1 cm).
// Circle radii and stroke thickness use pt via Typst length values.

#let TRACK_W  = 8.0   // cm
#let TRACK_H  = 0.5   // cm
#let BL       = 0.25  // baseline y (vertical centre of canvas)
#let R_STU    = 0.141 // 4 pt in cm  (1 pt ≈ 0.0353 cm)
#let R_CLS    = 0.106 // 3 pt in cm
#let OVERLAP  = 0.0   // distance below which class circle is raised

#let fmt1(x) = {
  // Format float to 1 decimal with comma, e.g. 1.4 → "1,4", 2.0 → "2,0"
  let r = calc.round(x, digits: 1)
  let s = str(r)
  let s1 = if "." in s { s } else { s + ".0" }
  s1.replace(".", ",")
}

#let lollipop_track(q, global_max) = {
  let gm = float(global_max)
  let sx = if q.score == none { 0.0 } else { float(q.score) / gm * TRACK_W }
  let mx = float(q.max)  / gm * TRACK_W
  let ax = float(q.class_avg) / gm * TRACK_W

  let cat_clr = rgb(q.rtti_color)
  let avg_y   = if calc.abs(ax - sx) < OVERLAP { BL + 0.18 } else { BL }

  canvas(length: 1cm, {
    import draw: line, circle, rect, content

    // Invisible bounding box so the cell is always TRACK_W × TRACK_H
    rect((0, 0), (TRACK_W, TRACK_H), stroke: none, fill: none)

    // Dashed segment — from score (or 0 if not entered) to question maximum
    let dash_x = 0.0
    if dash_x < mx {
      line(
        (dash_x, BL), (mx, BL),
        stroke: (paint: gray.darken(20%), thickness: 0.8pt, dash: "dashed"),
      )
    }

    // Solid segment — from 0 to student score
    if q.score != none and q.score > 0 {
      line(
        (0.0, BL), (sx, BL),
        stroke: (paint: rgb(q.dot_color), thickness: 1.2pt),
      )
    }

    // Draw an invisible circle at zero, to offset the entire drawing horizontally
    // This makes it so all lines have a circle at (0,0), so they all line up in the end
    // Kind of hacky, but it works
    circle(
      (0, BL), radius: R_STU,
      fill: none, stroke: none,
    )

    // Student circle ● and score
    circle(
      (sx, BL), radius: R_STU,
      fill: rgb(q.dot_color), stroke: none,
    )
    if q.score == none { content((sx, BL), text(white, 7pt)[0]) }
    else { content((sx, BL), text(white, 7pt)[#q.score]) }

    // Class average diamond ◇  (raised if it would overlap the student circle)
    line(
      (ax, avg_y + R_CLS), (ax + R_CLS, avg_y),
      (ax, avg_y - R_CLS), (ax - R_CLS, avg_y),
      (ax, avg_y + R_CLS),
      fill: white, stroke: (paint: gray, thickness: 0.8pt),
      close: false,
    )
  })
}

#let scale_track(global_max) = {
  canvas(length: 1cm, {
    import draw: line, content, rect, circle

    rect((0, 0), (TRACK_W, TRACK_H), stroke: none, fill: none)

    // Baseline
    line(
      (0.0, BL), (TRACK_W, BL),
      stroke: (paint: gray.lighten(40%), thickness: 0.5pt),
    )

    // Tick + label at every integer from 0 to global_max
    for v in range(0, global_max + 1) {
      let x = float(v) / float(global_max) * TRACK_W
      line((x, BL - 0.1), (x, BL + 0.1), stroke: gray)
      circle((x, BL), radius: R_STU, fill: gray.darken(10%), stroke: none)
      content((x, BL), text(white, 7pt)[#v])
    }
  })
}

#let lollipop_chart(vragen, global_max) = {
  text(9pt, style: "italic", fill: gray.darken(30%))[Scoretabel]

  set text(size: 9pt)

  table(
    columns: (1.4cm, 1.4cm, 1.4cm, 1.4cm, TRACK_W * 1cm + 1cm, 2.4cm),
    align:   (left + horizon, left + horizon, left + horizon, left + horizon, left + horizon, left + horizon),
    stroke:  (x, y) => if y == 0 { (bottom: 0.5pt + gray) } else { none },
    fill:    (x, y) => if y == 0 or calc.even(y) { white } else { rgb("#EDEEF0") },
    inset:   (x: 4pt, y: 0pt),

    // ── Header ──
    [*Vraag*], [*RTTI*], [*B / D*], [*Jij (●)*], scale_track(global_max), [*Gemiddeld (◇)*],

    // ── Data rows ──
    ..vragen.map(q => {
      let score_str = if q.score == none {
        "N / " + str(q.max)
      } else {
        str(int(q.score)) + " / " + str(q.max)
      }
      let avg_str = fmt1(q.class_avg) + " / " + str(q.max) + " (" + str(q.class_pct) + "%)"
      let is_special = q.kind == "bonus" or q.kind == "diag"
      let muted = rgb("#9aa0ab")
      let bd_label = if q.kind == "bonus" { "Bonus" } else if q.kind == "diag" { "Diag." } else { "" }

      if is_special {
        (
          text(fill: muted, style: "italic")[#q.label],
          text(fill: muted, style: "italic")[#q.rtti],
          text(fill: muted, style: "italic")[#bd_label],
          text(fill: muted, style: "italic")[#score_str],
          lollipop_track(q, global_max),
          text(fill: muted, style: "italic")[#avg_str],
        )
      } else {
        (
          [#q.label],
          [#q.rtti],
          [],
          [#score_str],
          lollipop_track(q, global_max),
          [#avg_str],
        )
      }
    }).flatten()
  )
}

// ── Observations section ───────────────────────────────────────────────────────
#let obs_section(observaties) = {
  text(9pt, style: "italic", fill: gray.darken(30%))[Observaties]
  v(0pt)

  if observaties.len() == 0 {
    [De docent heeft bij jou geen observaties genoteerd voor deze toets.]
  } else {
    set text(size: 9pt)
    table(
      columns: (1cm, 4cm, 1fr),
      align:   (center + horizon, left + horizon, left + horizon),
      stroke:  (x, y) => if y == 0 { (bottom: 0.5pt + gray) } else { none },
      fill:    (x, y) => if y == 0 or calc.even(y) { white } else { rgb("#EDEEF0") },
      inset:   (x: 4pt, y: 4pt),

      [*Afk.*], [*Observatie*], [*Korte uitleg*],

      ..observaties.map(o => (
        text(size: 12pt)[#o.icon],
        [#o.naam],
        [#o.uitleg],
      )).flatten()
    )
  }
}

// ── Shared eval scope for markup fields (num/unit/qty with Dutch defaults) ─────
#let _eval_scope = (
  num: num.with(thousandsep: " "),
  unit: unit.with(per: "fraction-short"),
  qty: qty.with(per: "fraction-short", thousandsep: " "),
)

// ── Leeradvies section ─────────────────────────────────────────────────────────
#let leeradvies_section(rows) = {
  text(9pt, style: "italic", fill: gray.darken(30%))[Leeradvies]

  set text(size: 9pt)
  table(
    columns: (1cm, 2cm, 1fr),
    align:   (center + horizon, left + horizon, left + horizon),
    stroke:  (x, y) => if y == 0 { (bottom: 0.5pt + gray) } else { none },
    fill:    (x, y) => if y == 0 or calc.even(y) { white } else { rgb("#EDEEF0") },
    inset:   (x: 4pt, y: 4pt),

    [*Cat.*], [*Score*], [*Leeradvies*],

    ..rows.map(r => (
      if r.cat == "R" or r.cat == "T1" or r.cat == "T2" {
        text(9pt)[#r.cat]
      } else {
        text(12pt)[#r.cat]
      },
      [#r.score_str],
      eval(r.advies, mode: "markup", scope: _eval_scope),
    )).flatten()
  )
}

// ── RTTI category fill styles ──────────────────────────────────────────────────
// Each fill uses the RTTI color as background with a distinct hatch overlay
// so the charts remain distinguishable when printed in greyscale.
//   R  — solid green       (solid tone is already greyscale-distinct)
//   T1 — cyan  + horizontal white stripes  (—)
//   T2 — orange + diagonal white stripes   (╱)
//   I  — red   + crosshatch white stripes  (╳)

#let FILL_R = rgb("#5cb85c")

#let FILL_T1 = tiling(size: (7pt, 7pt))[
  #place(rect(fill: rgb("#5bc0de"), width: 7pt, height: 7pt))
  #place(dy: 3.5pt, line(length: 7pt, stroke: (paint: white, thickness: 1.5pt)))
]

#let FILL_T2 = tiling(size: (7pt, 7pt))[
  #place(rect(fill: rgb("#f0ad4e"), width: 7pt, height: 7pt))
  #place(line(start: (0pt, 7pt), end: (7pt, 0pt), stroke: (paint: white, thickness: 1.5pt)))
]

#let FILL_I = tiling(size: (7pt, 7pt))[
  #place(rect(fill: rgb("#d9534f"), width: 7pt, height: 7pt))
  #place(line(start: (0pt, 7pt), end: (7pt, 0pt), stroke: (paint: white, thickness: 1.5pt)))
  #place(line(start: (0pt, 0pt), end: (7pt, 7pt), stroke: (paint: white, thickness: 1.5pt)))
]

#let FILL_HIST_HIGHLIGHT = tiling(size: (7pt, 7pt))[
  #place(rect(fill: rgb("#2980b9"), width: 7pt, height: 7pt))
  #place(line(start: (0pt, 7pt), end: (7pt, 0pt), stroke: (paint: white, thickness: 1.5pt)))
  #place(line(start: (0pt, 0pt), end: (7pt, 7pt), stroke: (paint: white, thickness: 1.5pt)))
]

// ── RTTI summary helpers ───────────────────────────────────────────────────────

// Aggregate scored and max points per RTTI category from the vragen array.
// Returns an array of 4 tuples: (cat_label, color, fill, scored_pts, max_pts)
#let rtti_summary(vragen) = {
  let r_s = 0.0;  let r_m = 0.0
  let t1_s = 0.0; let t1_m = 0.0
  let t2_s = 0.0; let t2_m = 0.0
  let i_s = 0.0;  let i_m = 0.0
  for q in vragen {
    if q.kind != "normal" { continue }
    let sc = if q.score == none { 0.0 } else { float(q.score) }
    let mx = float(q.max)
    if q.rtti == "R"  { r_s  += sc; r_m  += mx }
    if q.rtti == "T1" { t1_s += sc; t1_m += mx }
    if q.rtti == "T2" { t2_s += sc; t2_m += mx }
    if q.rtti == "I"  { i_s  += sc; i_m  += mx }
  }
  (
    ("R",  rgb("#5cb85c"), FILL_R,  r_s,  r_m),
    ("T1", rgb("#5bc0de"), FILL_T1, t1_s, t1_m),
    ("T2", rgb("#f0ad4e"), FILL_T2, t2_s, t2_m),
    ("I",  rgb("#d9534f"), FILL_I,  i_s,  i_m),
  )
}

// ── Pie chart: RTTI category distribution by max points ───────────────────────
#let rtti_pie(totals) = {
  let total_max = totals.fold(0.0, (acc, t) => acc + t.at(4))
  if total_max == 0.0 { return [] }

  align(center)[
    #text(9pt, style: "italic", fill: gray.darken(30%))[Verdeling RTTI deze toets]
    #v(4pt)
    #canvas(length: 1cm, {
      import draw: arc, circle, rect, content

      // Bounding box: 8 cm wide, 5.5 cm tall (y-up: 0 at bottom, 5.5 at top)
      rect((0, 0), (8, 5.5), stroke: none, fill: none)

      let cx = 2.7
      let cy = 2.9
      let r  = 2.2
      let angle = 90deg

      for t in totals {
        let (cat, color, fill, scored, maxpts) = t
        if maxpts <= 0.0 { continue }
        let sweep = (maxpts / total_max) * 360deg
        // cetz arc takes the starting point on the circumference, not the center.
        // Compute the circumference point at the current angle.
        let sx = cx + r * calc.cos(angle)
        let sy = cy + r * calc.sin(angle)
        arc(
          (sx, sy),
          start: angle,
          stop:  angle - sweep,
          radius: r,
          mode: "PIE",
          fill: fill,
          stroke: none,
        )
        angle -= sweep
      }

      // Thin outline around the full pie
      circle((cx, cy), radius: r, fill: none, stroke: (paint: gray.lighten(30%), thickness: 0.4pt))

      // Legend: colored swatch + "Cat (XX%)"
      let ly = 3.8
      for t in totals {
        let (cat, color, fill, scored, maxpts) = t
        if maxpts <= 0.0 { continue }
        let pct_int = int(calc.round(maxpts / total_max * 100))
        rect((5.6, ly - 0.22), (6.1, ly + 0.22), fill: fill, stroke: (paint: gray, thickness: 0.3pt))
        content((6.25, ly), text(8pt)[#cat (#pct_int%)], anchor: "west")
        ly -= 0.65
      }
    })
  ]
}

// ── Bar chart: student RTTI scores as percentage correct ──────────────────────
#let rtti_bar(totals) = {
  align(center)[
    #text(9pt, style: "italic", fill: gray.darken(30%))[Jouw RTTI-scores]
    #v(4pt)
    #canvas(length: 1cm, {
      import draw: rect, content, line

      let max_h = 4.0  // cm = 100 %

      // Bounding box
      rect((0, -0.6), (8, max_h + 0.7), stroke: none, fill: none)

      // Dashed gridlines at 25 %, 50 %, 75 %, 100 %
      for p in (25, 50, 75, 100) {
        let y = float(p) / 100.0 * max_h
        line(
          (0.5, y), (7.6, y),
          stroke: (paint: gray.lighten(50%), thickness: 0.4pt, dash: "dashed"),
        )
        content((0.4, y), text(7pt, fill: gray.darken(10%))[#str(p)%], anchor: "east")
      }

      // Baseline
      line((0.5, 0), (7.6, 0), stroke: (paint: gray.lighten(10%), thickness: 0.6pt))

      // Bars — evenly spaced within the canvas
      let bar_w = 1.2
      let x_starts = (0.8, 2.4, 4.0, 5.6)

      for (idx, t) in totals.enumerate() {
        let (cat, color, fill, scored, maxpts) = t
        let x0 = x_starts.at(idx)
        let x1 = x0 + bar_w
        let cx = (x0 + x1) / 2.0

        if maxpts <= 0.0 {
          // Category not present in this exam
          rect((x0, 0), (x1, 2.0), fill: gray.lighten(50%), stroke: none)
          content((cx, 2.22), text(8pt, fill: gray)[NVT], anchor: "south")
        } else {
          let pct     = scored / maxpts
          let bar_h   = pct * max_h
          let pct_int = int(calc.round(pct * 100))
          rect((x0, 0), (x1, bar_h), fill: fill, stroke: none)
          content(
            (cx, bar_h + 0.15),
            text(8pt)[#pct_int%],
            anchor: "south",
          )
        }

        // Category label below baseline
        content((cx, -0.15), text(8pt)[#cat], anchor: "north")
      }
    })
  ]
}

// ── RTTI uitleg section ────────────────────────────────────────────────────────
#let rtti_uitleg_section(uitleg) = {
  let cats = (
    ("R",  "Reproductie",  uitleg.R),
    ("T1", "Training",     uitleg.T1),
    ("T2", "Transfer",     uitleg.T2),
    ("I",  "Inzicht",      uitleg.I),
  )

  text(9pt, style: "italic", fill: gray.darken(30%))[Uitleg RTTI-categorieën]

  set text(size: 9pt)
  table(
    columns: (1cm, 2.5cm, 1fr),
    align:   (left + horizon, left + horizon, left + horizon),
    stroke:  (x, y) => if y == 0 { (bottom: 0.5pt + gray) } else { none },
    fill:    (x, y) => if y == 0 or calc.even(y) { white } else { rgb("#EDEEF0") },
    inset:   (x: 4pt, y: 4pt),

    [*Afk.*], [*Categorie*], [*Beschrijving*],

    ..cats.map(c => {
      let (afk, naam, tekst) = c
      let beschrijving = if tekst == "" {
        [—]
      } else {
        eval(tekst, mode: "markup", scope: _eval_scope)
      }
      (text(9pt)[#afk], [#naam], beschrijving)
    }).flatten()
  )
}

// ── Grade histogram ────────────────────────────────────────────────────────────
// Shows a 12-bin histogram of all student grades for the exam, below the RTTI
// charts on page 2. Skipped entirely when fewer than 3 grades are available.
// The bin containing the current student's grade is highlighted in blue
// crosshatch (only when grade ≥ 5,5). A congratulatory ranking message is
// appended when the student falls in the top-third or top-two-thirds.

#let grade_histogram(student_data, current_grade_num) = {
  let all_grades = student_data.map(s => s.grade_num).filter(g => g != none)
  if all_grades.len() < 10 { return }

  // ── Bin counts ──────────────────────────────────────────────────────────────
  let bins = (
    all_grades.filter(g => g < 4.5).len(),
    all_grades.filter(g => g >= 4.5 and g < 5.0).len(),
    all_grades.filter(g => g >= 5.0 and g < 5.5).len(),
    all_grades.filter(g => g >= 5.5 and g < 6.0).len(),
    all_grades.filter(g => g >= 6.0 and g < 6.5).len(),
    all_grades.filter(g => g >= 6.5 and g < 7.0).len(),
    all_grades.filter(g => g >= 7.0 and g < 7.5).len(),
    all_grades.filter(g => g >= 7.5 and g < 8.0).len(),
    all_grades.filter(g => g >= 8.0 and g < 8.5).len(),
    all_grades.filter(g => g >= 8.5 and g < 9.0).len(),
    all_grades.filter(g => g >= 9.0 and g < 9.5).len(),
    all_grades.filter(g => g >= 9.5).len(),
  )

  let bin_labels = ("<4,5", "<5,0", "<5,5", "<6,0", "<6,5", "<7,0",
                    "<7,5", "<8,0", "<8,5", "<9,0", "<9,5", "\u{2264}10")

  // ── Which bin does the current student fall in? ─────────────────────────────
  let student_bin = if current_grade_num == none { none }
    else if current_grade_num < 4.5 { 0 }
    else if current_grade_num < 5.0 { 1 }
    else if current_grade_num < 5.5 { 2 }
    else if current_grade_num < 6.0 { 3 }
    else if current_grade_num < 6.5 { 4 }
    else if current_grade_num < 7.0 { 5 }
    else if current_grade_num < 7.5 { 6 }
    else if current_grade_num < 8.0 { 7 }
    else if current_grade_num < 8.5 { 8 }
    else if current_grade_num < 9.0 { 9 }
    else if current_grade_num < 9.5 { 10 }
    else { 11 }

  // ── Y-axis scaling ──────────────────────────────────────────────────────────
  let max_count = bins.fold(0, (a, b) => calc.max(a, b))
  let y_max = calc.max(1, max_count)
  let tick_step = if y_max <= 5 { 1 }
    else if y_max <= 10 { 2 }
    else if y_max <= 20 { 5 }
    else { 10 }

  // ── Canvas layout constants ─────────────────────────────────────────────────
  let cv_w = 17.0
  let cv_h = 6.0
  let lm   = 1.0   // left margin (y-axis labels)
  let bm   = 1.0   // bottom margin (space for 9pt rotated x-labels)
  let tm   = 0.4   // top margin
  let rm   = 0.2   // right margin
  let plot_w = cv_w - lm - rm
  let plot_h = cv_h - bm - tm
  let slot_w = plot_w / 12.0
  let bar_w  = 1.0
  let bar_offset = (slot_w - bar_w) / 2.0

  text(9pt, style: "italic", fill: gray.darken(30%))[Verdeling toetscijfers]
  v(4pt)

  canvas(length: 1cm, {
    import draw: rect, line, content

    // Invisible bounding box
    rect((0, 0), (cv_w, cv_h), stroke: none, fill: none)

    // Y-axis gridlines and labels
    let tick = tick_step
    while tick <= y_max {
      let y = float(tick) / float(y_max) * plot_h + bm
      line(
        (lm, y), (lm + plot_w, y),
        stroke: (paint: gray.lighten(50%), thickness: 0.4pt, dash: "dashed"),
      )
      content((lm - 0.08, y), text(9pt, fill: gray.darken(10%))[#tick], anchor: "east")
      tick = tick + tick_step
    }

    // Baseline
    line(
      (lm, bm), (lm + plot_w, bm),
      stroke: (paint: gray.lighten(10%), thickness: 0.6pt),
    )

    // Vertical dividers between bins
    for i in range(0, 13) {
      let x = lm + float(i) * slot_w
      line(
        (x, bm), (x, bm + plot_h),
        stroke: (paint: gray.lighten(40%), thickness: 0.4pt),
      )
    }

    // Bars
    for (i, count) in bins.enumerate() {
      let x0 = lm + float(i) * slot_w + bar_offset
      let x1 = x0 + bar_w
      let cx = (x0 + x1) / 2.0
      let bar_h = if y_max > 0 { float(count) / float(y_max) * plot_h } else { 0.0 }

      let highlight = student_bin != none and i == student_bin and current_grade_num != none and current_grade_num >= 5.5
      let fill = if highlight { FILL_HIST_HIGHLIGHT } else { gray.darken(20%) }

      if count > 0 {
        rect((x0, bm), (x1, bm + bar_h), fill: fill, stroke: none)
        content(
          (cx, bm + bar_h + 0.12),
          text(7pt)[#count],
          anchor: "south",
        )
      }

      // X-axis label, rotated −45°
      // anchor "east" = lower-right tip of the rotated text; placing it well
      // below the baseline ensures the text body clears the plot area.
      content(
        (cx + 0.2, bm - 0.75),
        text(9pt)[#bin_labels.at(i)],
        angle: -45deg,
        anchor: "east",
      )
    }
  })

  // ── Ranking message ─────────────────────────────────────────────────────────
  if current_grade_num != none {
    let sorted_desc = all_grades.sorted().rev()
    let n = sorted_desc.len()
    let idx = sorted_desc.position(g => g == current_grade_num)
    if idx != none {
      if float(idx) < (float(n) / 10.0) - 0.99 {
        v(4pt)
        text(9pt)[Gefeliciteerd! Je resultaat hoort bij de beste 33% van de toetsresultaten! \u{1F451}]
      } else if float(idx) < (float(n) * 2.0 / 10.0) - 0.99 {
        v(4pt)
        text(9pt)[Gefeliciteerd! Je resultaat hoort bij de beste 67% van de toetsresultaten! \u{1F948}]
      }
    }
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
#let render(exam_info, student_data) = {
  let n = student_data.len()
  for (i, student) in student_data.enumerate() {
    // Reset page counter to 1 and set footer text for this student
    counter(page).update(1)
    _footer_text.update(
      exam_info.subject_display + " " + exam_info.name + " \u{2014} " + student.name
    )
    [= Toetsanalyse #exam_info.subject_display #exam_info.name
    == #student.group — #student.name (#student.student_nr)

    #v(8pt)

    Je hebt #student.score / #student.max_score punten behaald en had dus #calc.round(student.score / student.max_score * 100)% goed. De N-term is N=#str(exam_info.n_term).replace(".", ","). Je cijfer is een *#student.grade*.

    #v(4pt)
    ]
    lollipop_chart(student.vragen, exam_info.global_max_points)
    v(10pt)
    obs_section(student.observaties)
    v(10pt)
    leeradvies_section(student.leeradvies_rows)
    pagebreak()
    rtti_uitleg_section(exam_info.uitleg_rtti)
    v(18pt)
    let totals = rtti_summary(student.vragen)
    grid(
      columns: (1fr, 1fr),
      column-gutter: 0.5cm,
      rtti_pie(totals),
      rtti_bar(totals),
    )
    v(10pt)
    grade_histogram(student_data, student.grade_num)
    if i < n - 1 { pagebreak() }
  }
}
