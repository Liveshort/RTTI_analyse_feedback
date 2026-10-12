#import "lib.typ": *

// Extra aanpassingen bovenop setup — voeg hier inhoud of stijlen toe.
#let setup_extra() = []

// Achtergrondinfo, theorie, context.
#let render_uitleg() = [
  Plaats hier de uitleg...
]

// De opgaven. Schrijf elke opgave als gewone tekst in #opgave[…]: grids,
// figuren en tekst tussen de vragen kunnen overal. Markeer alleen de vragen met
//   #vraag(punten: 2, antwoord: [Het antwoord.])[De vraag.]
// Punten en antwoord zijn optioneel. De vragen krijgen automatisch a, b, c, …
// (geen letter als een opgave maar één vraag heeft) en de antwoorden worden
// automatisch verzameld voor het antwoordblok.
#let render_opgaven() = [
  #opgave(titel: "Titel van de opgave")[
    Inleidende tekst van de opgave.

    #vraag(punten: 2, antwoord: [Antwoord op de eerste vraag.])[Eerste vraag.]
    #vraag(punten: 1, antwoord: [Antwoord op de tweede vraag.])[Tweede vraag.]

    Extra informatie tussen de vragen.

    #vraag(punten: 1, antwoord: [Antwoord op de derde vraag.])[Derde vraag.]
  ]

  #opgave(titel: "Opgave met een figuur")[
    #grid(
      columns: (3fr, 2fr),
      gutter: 1em,
      [
        Tekst naast de figuur.

        #vraag(punten: 1, antwoord: [Het antwoord.])[De vraag.]
      ],
      rect(width: 100%, height: 3cm, stroke: luma(160))[
        #align(center + horizon)[Figuur]
      ],
    )
  ]
]
