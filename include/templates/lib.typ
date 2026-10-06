// lib.typ — shared helpers for opdracht templates.
// Copied to data/opdrachten/lib.typ on startup (always overwritten — edit here, not there).

// ── Shared block renderer — called from setup's show rules ─────────────────────
// Keeps show rules out of _content_block so the returned figure is bare and
// directly labelable (avoids "cannot reference styled/sequence" errors).
#let _render_block(bg, title_color, title_str, it) = {
  let n = context counter(figure.where(kind: it.kind)).display()
  let title_text = if it.caption != none {
    text(fill: title_color, weight: "extrabold")[#title_str #n (#it.caption.body)]
  } else {
    text(fill: title_color, weight: "extrabold")[#title_str #n]
  }
  align(left, block(
    width: 100%,
    fill: bg,
    radius: 6pt,
    inset: (x: 0.75em, y: 0.75em),
    below: 6pt,
  )[
    #set align(left)
    #set block(spacing: 0.65em)
    #set par(spacing: 0.65em)
    #title_text

    #it.body
  ])
}

// ── Document setup ─────────────────────────────────────────────────────────────
#let setup(body) = {
  set page(margin: 1.5cm)
  set text(font: "Libertinus Serif", size: 11pt)
  set heading(numbering: none)
  show heading.where(level: 1): it => block(
    above: 10pt, below: 10pt,
    text(fill: black, size: 14pt, weight: "bold", it.body)
  )
  show heading.where(level: 2): it => block(
    above: 10pt, below: 10pt,
    text(fill: black, size: 12pt, weight: "semibold", it.body)
  )
  show figure.where(kind: "voorbeeld"): it => _render_block(rgb("#C7D6EE"), rgb("#1a3e72"), "Voorbeeld", it)
  show figure.where(kind: "formule"):   it => _render_block(rgb("#FFF0AE"), rgb("#7a5200"), "Formule",   it)
  show figure.where(kind: "context"):   it => _render_block(rgb("#D6FDCF"), rgb("#1a5c14"), "Context",   it)
  body
}

// ── Assignment header ───────────────────────────────────────────────────────────
#let opdracht_header(
  title: "Titel",
  student: "Sandra Jansen",
  group: "4A",
  exam_prefix: "N.a.v.",
  exam: "TW1 H1 Vaardigheden",
  obs_prefix: "",
  obs_icon: "❌",
  obs_name: "Geen observatie",
) = {
  block(below: 8pt)[#text(size: 18pt, weight: "bold", fill: black)[#title]]
  v(8pt)
  block(
    width: 100%,
    fill: luma(232),
    radius: 6pt,
    inset: (x: 0.75em, y: 0.75em),
    below: 6pt,
  )[#grid(
    columns: (1fr, 1fr),
    row-gutter: 6pt,
    align(left)[#strong[#student]],
    align(right)[#emph[#exam_prefix] #exam],
    align(left)[#group],
    align(right)[#emph[#obs_prefix] #obs_icon #obs_name],
  )]
  v(8pt)
}

// ── Numbered content blocks ─────────────────────────────────────────────────────
// Returns a bare figure so @label references resolve to e.g. "Voorbeeld 1".
// The optional name parameter is stored in the figure's caption field so
// _render_block can read it from the show rule.

#let _content_block(title_str, kind, name, body) = figure(
  kind: kind,
  supplement: title_str,
  numbering: "1",
  caption: if name != none { [#name] } else { none },
  body,
)

#let voorbeeld_blok(name: none, body) = _content_block("Voorbeeld", "voorbeeld", name, body)
#let formule_blok(name: none, body)   = _content_block("Formule",   "formule",   name, body)
#let context_blok(name: none, body)   = _content_block("Context",   "context",   name, body)

#let belangrijk_blok(body) = align(left, block(
  width: 100%,
  fill: rgb("#ffb4b4"),
  radius: 6pt,
  inset: (x: 0.75em, y: 0.75em),
  below: 6pt,
  stroke: (paint: red, thickness: 1.5pt),
)[
  #set align(left)
  #set block(spacing: 0.65em)
  #set par(spacing: 0.65em)
  #text(fill: rgb("#ac0000"), weight: "extrabold")[Belangrijk!]

  #body
])
