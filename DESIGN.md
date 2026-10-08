# Railgaddi design: India's trains, with a little masti

Railgaddi is for deciding where to go by train, and enjoying the deciding. It should feel like
India and its railways: the painted land, a station's yellow name board, a jharokha window, an
old railway poster, phulkari embroidery. It looks simple and asks one thing at a time; it goes
as deep as you want behind that.

(The first version, September 2026, borrowed the journey's objects as motion: split-flap times,
LED boards, trains moving on the map. Charming, but slow. The second, plain and white, was quick
but had no character. This one, October 2026, keeps the speed and brings the character back
through the look and the words, not through movement.)

## The heart

Pick your station and the map lights up every line you can ride from it, without changing.
Choose how long you'll sit in the train (2 h, 4 h, 8 h, 12 h, a day, any) and the lines grow out
from your station to that far, the places worth going to rising on the map as photos in arches.
Lenses narrow it further: quick getaways, overnight (wake up there), weekends (Friday night or
Saturday morning). Then a place: its photo in an arch, the ride on a ticket, and the depth
behind pills (what to see, every train, a quicker way with a change, the weather, close by).

## Layout

- **The painted land** fills the window: Natural Earth's relief, reprojected to the map's own
  conic (`pipeline/build_relief.py`), softened when you zoom in close.
- **One ivory panel** floats over it (a sheet you pull up on phones): the name and a few icons,
  a strip of phulkari, then one thing: the question (landing), the places from your station, a
  place, a train, a trip, the stories, what you saved.
- **Over the map**, top right: the weather layer (Mausam) and zoom. Nothing else floats.

## On the map

- **Your station** wears its name board, yellow with a black rim, in the local script, Hindi
  and English, standing on two posts. "Use where I am" adds the blue dot.
- **The lines** are drawn as track, rails with sleepers: cream across the land for the whole
  network, and from your station madder (near) to turmeric (far). At night they glow amber.
- **Places** are photos in a cusped Rajput arch with a turmeric rim, a few at first, more as you
  zoom in; a place without a photo yet is its initial in an empty arch.

## Colour

- **Day** is an old poster: ivory paper, indigo ink, madder and turmeric, peacock for links.
- **Night** is the night train: deep indigo, lamp-lit ivory, the lines glowing.
- **Rani pink** is you and what you picked (the selected place, the train you're on). The
  phulkari brights (marigold, rani, parrot green) are for decoration only, in the band.
- Ride time is one ramp, madder to turmeric, never a rainbow. The weather layer is the one full
  scale, because temperature has one.

All colours are CSS variables in `src/ui/style.css`; the canvas map reads the same variables.

## Type

Tiro Devanagari Hindi for names (places, trains, headings), Hind for reading, Rozha One for the
big numbers (times, durations, kilometres), as a railway poster sets them. Noto Sans for Indian
scripts on boards. No Gurmukhi in the interface: the Punjabi flavour is in the words.

## Voice

Fun, warm, a bit Punjabi, always clear: Roman letters that everyone can read, with the English
alongside or obvious from context. "Chalo! Where's the gaddi taking you?", "No station? Koi gal
nahi.", "Balle balle!", "Gaddi aa rahi hai… loading the timetable". Facts stay exact: the jokes
never change a time, a day or a distance. It's Railgaddi, never Railgaadi.

## Motion

Calm, and only in answer to you: lines spread out from your station over about a second, the
view moves to what you picked in about half a second, panels rise, photos fade in as they
load. Nothing loops, nothing moves on its own, and `prefers-reduced-motion` makes it instant.

## Rules

1. One place for everything: if it isn't the map, it's in the panel.
2. Show little at first: six places, one train on the ticket, the stops around yours; more
   behind a pill or a "see all".
3. Say where facts come from (the timetable, Wikipedia, Open-Meteo) and when they're estimates
   (road times, small stops placed between printed ones).
4. A ticket only for a real ride; a board only for a real station; an arch only for a real photo
   of a real place.
5. Photos are real (Wikimedia Commons) and always credited.
6. Every view has an address, so it can be shared and the Back button works.
