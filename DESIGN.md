# Railgaddi design: calm, clear, quick

Railgaddi is for deciding where to go. Everything on screen should help with that and nothing
else: the map shows where, one panel beside it says what, and nothing moves unless you asked.

(The first version, September 2026, borrowed the journey's objects: split-flap times, LED
boards, trains moving on the map, lines spreading out, a landscape passing while things load.
Each was charming; together they made the site feel slow. They're gone, or quietened into their
plain forms.)

## Layout

- **One panel** beside the map (a sheet you pull up on phones) holds everything, top to bottom:
  the brand and a few icons; *Explore* or *Plan a trip*; the From / To fields; then what you're
  looking at: the places you can reach, a place, a train, a trip, Discover, what you saved.
- **The map** shows where. Lines from where you start, coloured by ride time; photos of the
  places worth going to, a few at first and more as you zoom in; the picked place ringed.
- **Over the map**, top right: the weather layer and zoom. Nothing else floats.

## Colour

- **White surfaces**, a pale blue-grey sea, near-white land. Night swaps them for deep slate.
- **Blue** is trains: the lines, a train's stops, links, the ride you're on.
- **Red** is you and what you picked: where you start, the picked place, a trip's stops, the
  pin of a place without a station. One red thing per view, ideally.
- **Yellow** is the brand mark, and the soft note on things that aren't trains (a place with no
  station, a toy train). Nothing loud.
- Ride time on the map is one hue getting lighter the further you'd go, not a rainbow. The
  weather layer is the one place with a full scale, because temperature has one.

All colours are CSS variables in `src/ui/style.css`; the canvas map reads the same variables.

## Type

Archivo for everything, at reading width; Noto Sans for Indian scripts. Figures are tabular so
times line up. Headings are semibold and small; the only big type is a place's name and a
train's times.

## Motion

Short and only in answer to you: the view moves to what you picked in about half a second; the
lines from a new start fade in over a quarter of a second; photos appear as they load. Nothing
loops, nothing moves on its own, and `prefers-reduced-motion` makes all of it instant.

## Rules

1. One place for everything: if it isn't the map, it's in the panel.
2. Show little at first. A dozen photos, four trains, the stops around yours; more when asked.
3. Say where facts come from (the timetable, Wikipedia, Open-Meteo) and when they're estimates
   (road times).
4. Cards only where there's a real thing (a ticket's facts, a train you could take, a trip's
   stretch); otherwise ruled lines and space.
5. Photos are real (Wikimedia Commons) and always credited.
6. Every view has an address, so it can be shared and the Back button works.
