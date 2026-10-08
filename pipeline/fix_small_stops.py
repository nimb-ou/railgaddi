"""Where the small stops the 2026 book doesn't print (kept from 2017, marked approximate) come out
at impossible times, place them by distance between the two printed halts around them instead, as
if the train ran at one steady speed between them, with a minute at each.

merge_tag.py first places them by scaling the 2017 schedule's times to the new run; where 2017's
times bunch up (a long halt, a slow stretch since rebuilt) that can put a small stop where the
train would have to fly to reach it (Dadar to Thane in nine minutes). Spread by distance, no
stretch is ever quicker than the printed run it's part of.

    python3 pipeline/fix_small_stops.py        # after merge_tag.py, before build_network.py
"""
from collections import defaultdict

from db import fmt_time, parse_time, read_table, write_table

halts = read_table("halts")
by_train = defaultdict(list)
for h in halts:
    by_train[h["number"]].append(h)

moved = runs = 0
for no, hs in by_train.items():
    hs.sort(key=lambda h: int(h["seq"]))
    j = 0
    while j < len(hs):
        if hs[j]["approx"] != "1":
            j += 1
            continue
        # a run of estimated halts between two printed ones
        start = j
        while j < len(hs) and hs[j]["approx"] == "1":
            j += 1
        a, b = start - 1, j
        if a < 0 or b >= len(hs):
            continue
        t0, t1 = parse_time(hs[a]["dep"]), parse_time(hs[b]["arr"])
        k0, k1 = float(hs[a]["km"] or 0), float(hs[b]["km"] or 0)
        if t0 is None or t1 is None or t1 <= t0:
            continue
        n = b - a - 1
        # only where the scaled times can't be right: a stretch more than one and a half times the
        # printed run's own speed, and quicker than 110 km/h (elsewhere 2017's rhythm, the slow
        # ghat and the quick plain, is the better guess)
        run_speed = (k1 - k0) / ((t1 - t0) / 60)
        pts = [(t0, k0)] + [(parse_time(h["arr"]), float(h["km"] or 0)) for h in hs[a + 1:b]] + [(t1, k1)]
        deps = [t0] + [parse_time(h["dep"]) for h in hs[a + 1:b]]
        def too_quick(i):
            mins = pts[i + 1][0] - deps[i] if pts[i + 1][0] is not None and deps[i] is not None else 0
            km = pts[i + 1][1] - pts[i][1]
            return km > 3 and (mins <= 0 or (km / (mins / 60) > max(110, 1.5 * run_speed)))
        if not any(too_quick(i) for i in range(n + 1)):
            continue
        dwell = 1 if t1 - t0 >= 2 * n + 1 else 0
        moving = t1 - t0 - n * dwell
        last = t0
        runs += 1
        for i, h in enumerate(hs[a + 1:b]):
            km = float(h["km"] or 0)
            frac = (km - k0) / (k1 - k0) if k1 > k0 and k0 <= km <= k1 else (i + 1) / (n + 1)
            arr = max(last + (1 if dwell else 0), t0 + round(frac * moving) + i * dwell)
            arr = min(arr, t1 - (n - i) * dwell - (1 if dwell else 0))
            dep = arr + dwell
            if fmt_time(arr) != h["arr"] or fmt_time(dep) != h["dep"]:
                moved += 1
            h["arr"], h["dep"] = fmt_time(arr), fmt_time(dep)
            last = dep

write_table("halts", sorted(halts, key=lambda h: (h["number"], int(h["seq"]))))
print(f"estimated small stops re-timed by distance: {moved} (in {runs} runs between printed halts)")
