# Railgaddi design: the journey itself

Railgaddi should feel like an Indian train trip, not like an app about one. Every visual
element is borrowed from something people see or hold on the journey: the station board, the
departures board, the coach, the window, the timetable, the ticket, the poster on the platform
wall. Each borrowed thing has one job, and that job never changes. That consistency is what makes
the site feel calm and familiar, even with five kinds of object on it.

The five design directions explored in September 2026 (station board, night departures, window
seat, line diagram, travel poster) all live here, each as one of those objects, not as a skin.

## The vocabulary

| On the journey | Its one job in Railgaddi | Where |
|---|---|---|
| **Station name board**: yellow, black keyline, bold condensed capitals, local scripts above English | **Names of places**. Nothing else is ever yellow. | Logo, the From/To ticket, map labels, place header, where you board and get off |
| **Split-flap tiles** from a departures board: dark tiles, a hairline split, digits that fold over | **Clock times of departures** | "Next train" on the ticket, a train's or a journey's departure and arrival |
| **LED board** on a coach's side or over a platform: amber dots, English and Hindi taking turns | **What's departing**: which train this is, or everything leaving a station | A train's header, the list of places from where you start |
| **Coach livery**: ICF blue (lamp yellow at night) | Railway lines, ink, structure | Routes, text, selected tabs |
| **Rajdhani red** | **You, and what you picked**. Used sparingly. | Selected place ring, your train on the map, links, "Day 2" |
| **Printed timetable** (Trains at a Glance): ruled lines, small capitals, tabular figures | Facts and schedules | Train list, dock filters, section headings |
| **Ticket** with notched edges | One journey's facts: from → to, fastest, trains, distance, next train; a saved route | Place panel, "Ride it" in a story, saved routes |
| **Route diagram** printed inside a coach: one line, stations as circles, small stops as ticks | **A train's stops** | Train view (the line); the ticket's strip between from and to |
| **Train window**: rounded, framed, the view sliding past | **Photos of where you're going**, and **waiting** | Place cover; the landscape passing while the timetable or a guide loads |
| **Railway poster**: flat inks, big condensed name | **Sharing a place** | The poster made when you share |
| **Postcards** | Places to visit, and journeys worth taking | Sights gallery, Discover, the bucket list |
| **Timetable notes**: the numbered footnotes of a timetable book | **Facts**, each with its source | Discover ("Note 17"), a place's own fact, the landing page |
| **Interchange symbol** of a line diagram: the line breaks, a linked pair of rings | **Changing trains** | Journeys with one change: the panel, the ticket strip, the map |
| **Railway map symbol**: a line with sleeper ties; stations as open circles | The network | Map (ties appear when zoomed in) |
| **Signals**: green, amber, red | State only, never decoration | "Next train" dot |

The map itself stays geographic: lines follow the real track. The schematic, time-spaced
language of the line diagram is kept for the side panel, where it explains one train.

## Palettes

Two times of day, not two "skins":

- **Day**: a printed timetable book. Paper land, pale blue-grey sea, ICF-blue ink, board yellow,
  Rajdhani red. The default.
- **Night**: a station after dark. Deep livery blue, lamp-yellow lines, warm cream text.
  The station boards stay the same yellow, the flap tiles and LED boards stay dark and amber,
  as they do at night.

Distance on the map is one hue getting lighter the further you'd travel, not a rainbow.
All colours are CSS variables in `src/ui/style.css`; the canvas map reads the same variables.
The poster uses its own five inks (navy, teal, terracotta, marigold, paper), because a printed
poster has its own palette.

## Type

- **Archivo** for everything. Condensed, heavy capitals for station boards, LED boards and
  posters (it has a width axis); regular width for reading.
- **Noto Sans** in each Indian script, for names in Hindi and the local language.
- Numbers are tabular so times line up like a printed timetable.

## Motion

Motion is the train's, and it's slow:

- things **arrive** (a cover photo glides in and stops, like a platform sliding into view),
  **depart**, and **spread outward** from where you are (the map's lines);
- flap tiles **fold** once when a time is shown, then stay still;
- the window's landscape **passes** only while you wait, with far hills slow and poles fast;
- the ticket's route strip **draws** from where you start to where you're going.

Nothing loops for attention. Everything stops for `prefers-reduced-motion`, and the trains
moving on the map (by the timetable, three minutes a second) have a pause button.

## Rules

1. Yellow means a place name. If it isn't a place, it isn't yellow.
2. Red means you or your choice. One red thing per view at most, ideally.
3. Dark tiles and amber dots mean departures: trains and their times. Nothing else glows.
   (A train in search results, or a leg of a journey, wears its number on the same dark board.)
4. Show little at first: about a dozen places as photo bubbles, more as you zoom in. A train's
   stops before you board and after you get off fold away until asked for.
5. Structure comes from rules and ruled lines, not from boxes. Cards only where a real object
   exists (a ticket, a postcard, a board, a window, a poster).
6. Photos are real (Wikimedia Commons) and always credited, on the poster too.
