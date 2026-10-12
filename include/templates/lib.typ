// lib.typ — shared helpers for opdracht templates.
// Copied to data/opdrachten/lib.typ on startup (always overwritten — edit here, not there).

// ── Shared block renderer — called from setup's show rules ─────────────────────
// Blocks use the default block spacing above and below (same as paragraphs), so
// the gap before and after a block is equal. Don't set `below` on them.
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
  set text(font: "Libertinus Serif", size: 11pt, lang: "nl")
  set par(justify: true)
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
  show figure.where(kind: "opgave"):    it => _render_block(luma(240), luma(80), "Opgave", it)
  // Exercises can be long: let them (unlike other figures) break across pages.
  show figure.where(kind: "opgave"): set block(breakable: true)
  body
}

// ── Assignment header ───────────────────────────────────────────────────────────
// observaties: list of (icon: ..., name: ...) dictionaries; when given it replaces
// the single obs_icon / obs_name pair (comma-separated).
#let opdracht_header(
  title: "Titel",
  student: "Sandra Jansen",
  group: "4A",
  exam_prefix: "N.a.v.",
  exam: "TW1 H1 Vaardigheden",
  obs_prefix: "",
  obs_icon: "❌",
  obs_name: "Geen observatie",
  observaties: none,
) = {
  let obs_list = if observaties == none { ((icon: obs_icon, name: obs_name),) } else { observaties }
  let obs_cell = [#emph[#obs_prefix] #obs_list.map(o => [#o.icon #o.name]).join([, ])]
  block(below: 8pt)[#text(size: 18pt, weight: "bold", fill: black)[#title]]
  v(8pt)
  block(
    width: 100%,
    fill: luma(232),
    radius: 6pt,
    inset: (x: 0.75em, y: 0.75em),
    below: 6pt,
  )[#grid(
    columns: (2fr, 3fr),
    row-gutter: 6pt,
    align(left)[#strong[#student]],
    align(right)[#emph[#exam_prefix] #exam],
    align(left)[#group],
    align(right)[#obs_cell],
  )]
  v(8pt)
}

// Header for the teacher's answer key (no student data).
#let antwoorden_header(title: "Titel") = {
  block(below: 8pt)[#text(size: 18pt, weight: "bold", fill: black)[#title]]
  block(
    width: 100%,
    fill: luma(232),
    radius: 6pt,
    inset: (x: 0.75em, y: 0.75em),
    below: 6pt,
  )[#strong[Antwoordsleutel]]
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
  stroke: (paint: red, thickness: 1.5pt),
)[
  #set align(left)
  #set block(spacing: 0.65em)
  #set par(spacing: 0.65em)
  #text(fill: rgb("#ac0000"), weight: "extrabold")[Belangrijk!]

  #body
])

// ── Opgaven ─────────────────────────────────────────────────────────────────────
// Exercises are free content: an opdracht's render_opgaven() holds #opgave[…]
// blocks with any layout (grids, figures, text), in which only the questions are
// marked with #vraag(punten: 2, antwoord: […])[…]. Every vraag leaves a
// metadata marker with its answer, so the answers are collected from wherever
// the questions ended up (inside grids too) by antwoorden_omgekeerd() and
// antwoorden_lijst().

#let _vraag_ctr = counter("rtti-vraag")

// Numbered gray block like Voorbeeld/Formule, referable as "Opgave 1".
// The vraag counter restarts inside the body, so opgave() returns a bare figure
// that can carry a label (#opgave[…] <naam>, referenced as @naam).
#let opgave(titel: none, body) = _content_block("Opgave", "opgave", titel, [#_vraag_ctr.update(0)#body])

// Space below a vraag: the normal paragraph spacing (Typst's default; inside the
// opgave block paragraphs follow at line distance).
#let _vraag_na = 1.2em

#let _letter(i) = numbering("a", i)

// "2p", "1,5p" in italics; none when no points were given.
#let _punten(p) = if p == none { none } else {
  text(fill: luma(100), size: 0.9em, style: "italic")[#str(p).replace(".", ",")p]
}

#let _opgave_nr() = counter(figure.where(kind: "opgave")).get().first()

// All vragen as (opgave, nr, antwoord), in document order.
#let _vragen() = query(<__rtti_vraag>).map(m => m.value)

// Label of a vraag: its letter, left out when it is the only vraag in its opgave.
#let _vraag_letter(v, alle) = {
  if alle.filter(w => w.opgave == v.opgave).len() > 1 { _letter(v.nr) } else { "" }
}

// Every vraag in the document, for telling whether the next one follows directly.
#let _vraag_id = counter("rtti-vraag-id")

// Spacing can only grow when two blocks meet (the larger wins), so a vraag
// can't take back the space above it. Instead each vraag checks whether the
// next vraag starts right below it (same page and column, nothing in between)
// using markers at the top and bottom of every vraag, and then leaves out its
// own space below. Settles after a few layout passes.
#let _direct_gevolgd(id) = {
  let mine = query(<__rtti_vraag_onder>).filter(m => m.value == id)
  let next = query(<__rtti_vraag_boven>).filter(m => m.value == id + 1)
  if mine.len() != 1 or next.len() != 1 { return false }
  let a = mine.first().location().position()
  let b = next.first().location().position()
  let dy = b.y - a.y
  (
    a.page == b.page
      and calc.abs((a.x - b.x).pt()) < 0.5
      and dy >= 0pt
      and dy < _vraag_na.to-absolute() + 0.3em.to-absolute()
  )
}

#let vraag(punten: none, antwoord: none, body) = {
  _vraag_ctr.step()
  _vraag_id.step()
  context {
    let id = _vraag_id.get().first()
    let v = (opgave: _opgave_nr(), nr: _vraag_ctr.get().first(), antwoord: antwoord)
    [#metadata(v) <__rtti_vraag>]
    block(
      above: 0.65em,
      below: if _direct_gevolgd(id) { 0.65em } else { _vraag_na },
      width: 100%,
      {
        [#metadata(id) <__rtti_vraag_boven>]
        grid(
          columns: (1.6em, 1fr, auto),
          column-gutter: 0.4em,
          align: (left + top, left + top, right + bottom),
          strong(_vraag_letter(v, _vragen())), body, _punten(punten),
        )
        [#metadata(id) <__rtti_vraag_onder>]
      },
    )
  }
}

// (opgave, label, answer) in order: "1", "2a", "2b", … Vragen without answers are skipped.
#let _antwoorden() = {
  let alle = _vragen()
  alle
    .filter(v => v.antwoord != none)
    .map(v => (v.opgave, str(v.opgave) + _vraag_letter(v, alle), v.antwoord))
}

// All answers (the teacher's answer key): the answers of one opgave run on
// after each other, every opgave starts on a new line.
#let antwoorden_lijst() = context {
  let items = _antwoorden()
  if items.len() == 0 { return [_Er zijn geen antwoorden ingevuld._] }
  let regels = ()
  let huidige = none
  for (opgave, label, a) in items {
    if opgave != huidige {
      regels.push(())
      huidige = opgave
    }
    regels.last().push([#strong(label) #a])
  }
  stack(spacing: 0.8em, ..regels.map(r => block(r.join(h(0.8em)))))
}

// The answers upside down and in gray against the bottom of the page: of the
// last exercise page when they fit there, otherwise of the next page.
#let antwoorden_omgekeerd() = context {
  if _antwoorden().len() == 0 { return }
  place(bottom, float: true, clearance: 2em, rotate(180deg, reflow: true, block(
    width: 100%,
    stroke: (bottom: 0.5pt + luma(170)),
    inset: (bottom: 0.8em),
  )[
    #set text(fill: luma(120), size: 0.9em)
    #set par(spacing: 0.65em)
    #set block(spacing: 0.65em)
    #strong[Antwoorden]
    #antwoorden_lijst()
  ]))
}
