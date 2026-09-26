# Railgaddi design: the journey itself

Railgaddi should feel like an Indian train trip, not like an app about one. Every visual
element is borrowed from something people see or hold on the journey: the station board, the
coach, the timetable, the ticket. Each borrowed thing has one job, and that job never changes.
That consistency is what makes the site feel calm and familiar.

## The vocabulary

| On the journey | Its one job in Railgaddi | Where |
|---|---|---|
| **Station name board**: yellow, black keyline, bold condensed capitals, local scripts above English | **Names of places**. Nothing else is ever yellow. | Logo, search box, "From" chip, map labels, place header, boarding/alighting stops |
| **Coach livery**: ICF blue | Railway lines, ink, structure | Routes, text, selected tabs |
| **Rajdhani red** | **You, and what you picked**. Used sparingly. | Selected place ring, your train on the map, section links, "Discover" eyebrow |
| **Printed timetable** (Trains at a Glance): ruled lines, small capitals, tabular figures | Facts and schedules | Train list, stop list, dock filters, section headings |
| **Ticket** with perforated edge | One journey's facts: from → to, fastest, trains, distance, next train | Place panel |
| **Route strip** printed inside coaches | A train's stops | Train view |
| **Railway map symbol**: a line with sleeper ties; stations as open circles | The network | Map (ties appear when zoomed in) |
| **Postcards** | Places to visit | Sights gallery |
| **Signals**: green, amber, red | State only, never decoration | "Next train" dot |

## Palettes

Two times of day, not two "skins":

- **Day**: a printed timetable book. Paper land, pale blue-grey sea, ICF-blue ink, board yellow,
  Rajdhani red. The default.
- **Night**: a sleeper coach after dark. Deep livery blue, lamp-yellow lines, warm cream text.
  The station boards stay the same yellow, as they do at night.

Distance on the map is one hue getting lighter the further you'd travel, not a rainbow.
All colours are CSS variables in `src/style.css`; the canvas map reads the same variables.

## Type

- **Archivo** for everything. Condensed, heavy capitals for station boards (it has a width axis);
  regular width for reading.
- **Noto Sans** in each Indian script, for names in Hindi and the local language.
- Numbers are tabular so times line up like a printed timetable.

## Rules

1. Yellow means a place name. If it isn't a place, it isn't yellow.
2. Red means you or your choice. One red thing per view at most, ideally.
3. Show little at first: about a dozen places as photo bubbles, more as you zoom in. Everything
   else is a quiet station circle until you ask for it.
4. Structure comes from rules and ruled lines, not from boxes. Cards only where a real object
   exists (a ticket, a postcard, a board).
5. Motion is the train's: things arrive, depart, spread outward from where you are. No glows,
   no neon, no gradients for their own sake.
6. Photos are real (Wikimedia Commons) and always credited.
