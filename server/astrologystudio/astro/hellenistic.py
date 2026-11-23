"""
AstrologyStudio ·
server/astrologystudio/astro/hellenistic.py

Hellenistic astrology:

sect, lots, dignities, solar phase, joys, aspects by sign, annual profections and zodiacal
releasing.

Everything here is worked out from positions ephemeralREST already returns (the planets and
the Ascendant): nothing new is asked of it. The rule tables are constants with their sources
noted, since the ancient authors don't all agree and a typo is easy to make and hard to spot.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Final

SIGNS: Final = (
    "aries", "taurus", "gemini", "cancer", "leo", "virgo",
    "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
)  # fmt: skip
SEVEN: Final = ("sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn")
"""The traditional planets, in Chaldean-free catalog order."""

# Domicile rulers by sign (traditional rulerships).
DOMICILE: Final = (
    "mars", "venus", "mercury", "moon", "sun", "mercury",
    "venus", "mars", "jupiter", "saturn", "saturn", "jupiter",
)  # fmt: skip
# Exaltation sign of each planet.
EXALTATION: Final = {"sun": 0, "moon": 1, "mercury": 5, "venus": 11, "mars": 9, "jupiter": 3, "saturn": 6}

# Triplicity rulers (Dorothean): element -> (day, night, participating).
# Element of a sign is its index mod 4: fire, earth, air, water.
TRIPLICITY: Final = (
    ("sun", "jupiter", "saturn"),  # fire
    ("venus", "moon", "mars"),  # earth
    ("saturn", "mercury", "jupiter"),  # air
    ("venus", "mars", "moon"),  # water
)
ELEMENTS: Final = ("fire", "earth", "air", "water")

# Egyptian bounds (terms), Ptolemy, Tetrabiblos I.21: for each sign, (ruler, end degree).
BOUNDS: Final = (
    (("jupiter", 6), ("venus", 12), ("mercury", 20), ("mars", 25), ("saturn", 30)),  # Aries
    (("venus", 8), ("mercury", 14), ("jupiter", 22), ("saturn", 27), ("mars", 30)),  # Taurus
    (("mercury", 6), ("jupiter", 12), ("venus", 17), ("mars", 24), ("saturn", 30)),  # Gemini
    (("mars", 7), ("venus", 13), ("mercury", 19), ("jupiter", 26), ("saturn", 30)),  # Cancer
    (("jupiter", 6), ("venus", 11), ("saturn", 18), ("mercury", 24), ("mars", 30)),  # Leo
    (("mercury", 7), ("venus", 17), ("jupiter", 21), ("mars", 28), ("saturn", 30)),  # Virgo
    (("saturn", 6), ("mercury", 14), ("jupiter", 21), ("venus", 28), ("mars", 30)),  # Libra
    (("mars", 7), ("venus", 11), ("mercury", 19), ("jupiter", 24), ("saturn", 30)),  # Scorpio
    (("jupiter", 12), ("venus", 17), ("mercury", 21), ("saturn", 26), ("mars", 30)),  # Sagittarius
    (("mercury", 7), ("jupiter", 14), ("venus", 22), ("saturn", 26), ("mars", 30)),  # Capricorn
    (("mercury", 7), ("venus", 13), ("jupiter", 20), ("mars", 25), ("saturn", 30)),  # Aquarius
    (("venus", 12), ("jupiter", 16), ("mercury", 19), ("mars", 28), ("saturn", 30)),  # Pisces
)

# Decans (faces) in Chaldean order from Aries 0° (Mars), 10° each.
CHALDEAN: Final = ("mars", "sun", "venus", "mercury", "moon", "saturn", "jupiter")

# Joys, by whole-sign house.
JOYS: Final = {"mercury": 1, "moon": 3, "venus": 5, "mars": 6, "sun": 9, "jupiter": 11, "saturn": 12}

# Solar phase limits, in degrees from the Sun.
CAZIMI: Final = 17 / 60
COMBUST: Final = 8.5
BEAMS: Final = 15.0

# Minor years of the planets, giving each sign's period in zodiacal releasing (Valens).
# Saturn's sign Capricorn takes 27 and Aquarius 30.
RELEASING_YEARS: Final = (15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12)

LOTS: Final = (
    "part_of_fortune",
    "lot_spirit",
    "lot_eros",
    "lot_necessity",
    "lot_courage",
    "lot_victory",
    "lot_nemesis",
)


def norm(x: float) -> float:
    return x % 360.0


def sign_of(lon: float) -> int:
    return int(norm(lon) // 30) % 12


def separation(a: float, b: float) -> float:
    d = abs(norm(a - b))
    return 360.0 - d if d > 180.0 else d


# ---------------------------------------------------------------------------
# Sect


def is_day(sun: float, asc: float) -> bool:
    """The Sun above the horizon: from the Descendant through the MC to the Ascendant, that
    is, more than 180° on from the Ascendant in zodiacal order (houses 7 to 12)."""
    return norm(sun - asc) >= 180.0


def sect(sun: float, asc: float) -> dict[str, Any]:
    day = is_day(sun, asc)
    off = norm(sun - asc)
    near = min(off, abs(off - 180.0), 360.0 - off) < 1.0
    return {
        "sect": "day" if day else "night",
        "sect_light": "sun" if day else "moon",
        "benefic_of_sect": "jupiter" if day else "venus",
        "malefic_of_sect": "saturn" if day else "mars",
        "sect_near_horizon": near,
    }


# ---------------------------------------------------------------------------
# Lots (Paulus Alexandrinus). A night chart swaps the two planets.


def lots(points: dict[str, float], day: bool, fortune_by_sect: bool = True) -> dict[str, float]:
    """The seven lots from the Ascendant and the planets. `fortune_by_sect=False` keeps
    Fortune's day formula by night too (common in modern practice); Spirit and the others
    always follow sect. Lots needing a missing planet are left out."""
    asc = points.get("asc")
    sun, moon = points.get("sun"), points.get("moon")
    if asc is None or sun is None or moon is None:
        return {}

    def lot(a: float, b: float, by_day: bool = day) -> float:
        return norm(asc + a - b) if by_day else norm(asc + b - a)

    fortune = lot(moon, sun, day if fortune_by_sect else True)
    spirit = lot(sun, moon)
    out = {"part_of_fortune": fortune, "lot_spirit": spirit}
    for key, planet, base in (
        ("lot_eros", "venus", spirit),
        ("lot_necessity", "mercury", fortune),
        ("lot_courage", "mars", fortune),
        ("lot_victory", "jupiter", spirit),
        ("lot_nemesis", "saturn", fortune),
    ):
        p = points.get(planet)
        if p is None:
            continue
        # Eros and Victory: Asc + planet - Spirit by day; Necessity, Courage and Nemesis:
        # Asc + Fortune - planet by day.
        out[key] = lot(p, base) if key in ("lot_eros", "lot_victory") else lot(base, p)
    return out


# ---------------------------------------------------------------------------
# Dignities


def bound_lord(lon: float) -> str:
    within = norm(lon) - sign_of(lon) * 30
    for ruler, end in BOUNDS[sign_of(lon)]:
        if within < end:
            return ruler
    return BOUNDS[sign_of(lon)][-1][0]


def decan_lord(lon: float) -> str:
    return CHALDEAN[int(norm(lon) // 10) % 7]


def triplicity_lords(lon: float) -> tuple[str, str, str]:
    day, night, participating = TRIPLICITY[sign_of(lon) % 4]
    return day, night, participating


def dignity_of(body: str, lon: float, day: bool) -> dict[str, Any]:
    """The lords of a place, and which of them (if any) the body at that place is itself."""
    s = sign_of(lon)
    trip_day, trip_night, trip_part = triplicity_lords(lon)
    trip = trip_day if day else trip_night
    lords = {
        "domicile": DOMICILE[s],
        "triplicity": trip,
        "bound": bound_lord(lon),
        "decan": decan_lord(lon),
    }
    own: list[str] = []
    if DOMICILE[s] == body:
        own.append("domicile")
    if EXALTATION.get(body) == s:
        own.append("exaltation")
    if body in (trip_day, trip_night, trip_part) and body == trip:
        own.append("triplicity")
    if lords["bound"] == body:
        own.append("bound")
    if lords["decan"] == body:
        own.append("decan")
    if DOMICILE[(s + 6) % 12] == body:
        own.append("detriment")
    if EXALTATION.get(body) == (s + 6) % 12:
        own.append("fall")
    return {**lords, "element": ELEMENTS[s % 4], "own": own}


# ---------------------------------------------------------------------------
# Solar phase


def solar_phase(lon: float, sun: float) -> dict[str, str]:
    d = separation(lon, sun)
    if d <= CAZIMI:
        phase = "cazimi"
    elif d <= COMBUST:
        phase = "combust"
    elif d <= BEAMS:
        phase = "beams"
    else:
        phase = "free"
    # A morning star rises before the Sun: it is behind the Sun in the zodiac.
    orientation = "morning" if norm(sun - lon) < 180.0 else "evening"
    return {"phase": phase, "orientation": orientation}


# ---------------------------------------------------------------------------
# Houses by whole sign


def whole_sign_house(lon: float, asc: float) -> int:
    return (sign_of(lon) - sign_of(asc)) % 12 + 1


def whole_sign_cusps(asc: float) -> list[float]:
    first = sign_of(asc) * 30.0
    return [norm(first + 30.0 * i) for i in range(12)]


def angularity(house: int) -> str:
    return ("angular", "succedent", "cadent")[(house - 1) % 3]


# ---------------------------------------------------------------------------
# Everything for one chart


def analyse(points: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """The `hellenistic` block of a chart: sect, then for each body its lords and own dignities,
    solar phase (planets only), whole-sign house, angularity and joy."""
    if "asc" not in points or "sun" not in points:
        return None
    asc = points["asc"]["lon"]
    sun = points["sun"]["lon"]
    day = is_day(sun, asc)
    result: dict[str, Any] = sect(sun, asc)
    dignities: dict[str, Any] = {}
    phase: dict[str, Any] = {}
    houses: dict[str, Any] = {}
    joys: list[str] = []
    for key, point in points.items():
        lon = point["lon"]
        dignities[key] = dignity_of(key, lon, day)
        house = whole_sign_house(lon, asc)
        houses[key] = {"house": house, "angularity": angularity(house)}
        if key in SEVEN and key != "sun":
            phase[key] = solar_phase(lon, sun)
        if JOYS.get(key) == house:
            joys.append(key)
    result.update(dignities=dignities, phase=phase, houses=houses, joys=joys)
    return result


# ---------------------------------------------------------------------------
# Aspects by whole sign


SIGN_ASPECTS: Final = {0: "conjunction", 2: "sextile", 10: "sextile", 3: "square", 9: "square",
                       4: "trine", 8: "trine", 6: "opposition"}  # fmt: skip
ANGLE: Final = {"conjunction": 0.0, "sextile": 60.0, "square": 90.0, "trine": 120.0, "opposition": 180.0}


@dataclass(frozen=True, slots=True)
class SignAspect:
    a: str
    b: str
    aspect: str
    degrees_apart: float
    overcoming: str | None
    """In a square, which of the two ("a" or "b") overcomes the other."""
    superior: str | None
    """In a sextile, square or trine, which body casts from the earlier sign."""

    def as_dict(self) -> dict[str, Any]:
        return {
            "a": self.a,
            "b": self.b,
            "aspect": self.aspect,
            "orb": round(abs(self.degrees_apart - ANGLE[self.aspect]), 4),
            "applying": None,
            "by_sign": True,
            "degrees_apart": round(self.degrees_apart, 4),
            "overcoming": self.overcoming,
            "superior": self.superior,
        }


def sign_aspects(points: dict[str, dict[str, Any]]) -> list[SignAspect]:
    """Aspects by the number of signs between two bodies, whatever the degrees. Pairs in
    aversion (1, 5, 7 or 11 signs apart) have none and aren't listed."""
    keys = list(points)
    found: list[SignAspect] = []
    for i, a in enumerate(keys):
        for b in keys[i + 1 :]:
            la, lb = points[a]["lon"], points[b]["lon"]
            steps = (sign_of(lb) - sign_of(la)) % 12  # b is this many signs after a
            aspect = SIGN_ASPECTS.get(steps)
            if aspect is None:
                continue
            superior: str | None = None
            if aspect in ("sextile", "square", "trine"):
                # The earlier sign casts onto the later one: a is earlier if b is 2-4 signs on.
                superior = "a" if steps in (2, 3, 4) else "b"
            found.append(
                SignAspect(
                    a, b, aspect, separation(la, lb), superior if aspect == "square" else None, superior
                )
            )
    return found


# ---------------------------------------------------------------------------
# Annual profections


def birthday(birth: date, years: int) -> date:
    try:
        return birth.replace(year=birth.year + years)
    except ValueError:  # 29 February in a common year
        return date(birth.year + years, 2, 28)


def profections(
    points: dict[str, dict[str, Any]], birth_local: date, today: date, ages: range = range(0, 101)
) -> dict[str, Any]:
    """The profected sign and lord of the year for each age, with the natal planets in that
    sign and which house it is from the Ascendant, Fortune and Spirit."""
    asc_sign = sign_of(points["asc"]["lon"])
    fortune = points.get("part_of_fortune")
    spirit = points.get("lot_spirit")
    current = None
    rows = []
    for age in ages:
        start = birthday(birth_local, age)
        end = birthday(birth_local, age + 1)
        s = (asc_sign + age) % 12
        if start <= today < end:
            current = age
        rows.append(
            {
                "age": age,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "sign": SIGNS[s],
                "lord": DOMICILE[s],
                "house": age % 12 + 1,
                "planets": [k for k in SEVEN if k in points and sign_of(points[k]["lon"]) == s],
                "from_fortune": (s - sign_of(fortune["lon"])) % 12 + 1 if fortune else None,
                "from_spirit": (s - sign_of(spirit["lon"])) % 12 + 1 if spirit else None,
            }
        )
    return {"current_age": current, "years": rows}


# ---------------------------------------------------------------------------
# Zodiacal releasing


@dataclass(slots=True)
class Period:
    level: int
    sign: int
    start: datetime
    end: datetime
    loosing: bool = False
    children: list[Period] | None = None


def _sub_periods(
    parent_sign: int, start: datetime, end: datetime, unit_days: float, level: int
) -> list[Period]:
    """Divide a period into the next level: from the same sign, each sign lasting its years in
    `unit_days`, in zodiacal order, cut short at the end. When the sub-periods have been through
    all twelve signs and would come back to the first, they jump to the sign opposite it instead
    (the loosing of the bond) and carry on from there."""
    out: list[Period] = []
    sign = parent_sign
    at = start
    count = 0
    loosed = False
    while at < end:
        loosing = False
        if count == 12 and not loosed:
            sign = (parent_sign + 6) % 12
            loosing = loosed = True
        length = timedelta(days=RELEASING_YEARS[sign] * unit_days)
        stop = min(at + length, end)
        out.append(Period(level, sign, at, stop, loosing))
        at = stop
        sign = (sign + 1) % 12
        count += 1
    return out


def releasing(
    lot_lon: float,
    fortune_lon: float,
    birth: datetime,
    start: datetime,
    end: datetime,
    levels: int = 2,
    year_days: float = 360.0,
) -> list[dict[str, Any]]:
    """Zodiacal releasing from a lot. Level 1 periods last each sign's years; level 2 the same
    numbers in months (a twelfth of a year); level 3 in a twelfth of that (2.5 days with the
    360-day year). Only periods that overlap start..end are returned, nested by level."""
    fortune_sign = sign_of(fortune_lon)
    first = sign_of(lot_lon)

    def shape(p: Period) -> dict[str, Any]:
        house = (p.sign - fortune_sign) % 12 + 1
        item: dict[str, Any] = {
            "level": p.level,
            "sign": SIGNS[p.sign],
            "start": p.start.isoformat(),
            "end": p.end.isoformat(),
            "loosing": p.loosing,
            "angular_from_fortune": house if house in (1, 4, 7, 10) else None,
        }
        if p.children is not None:
            item["periods"] = [shape(c) for c in p.children if c.end > start and c.start < end]
        return item

    out = []
    sign = first
    at = birth
    # Level 1 runs on from birth until past the end of the range.
    while at < end:
        length = timedelta(days=RELEASING_YEARS[sign] * year_days)
        period = Period(1, sign, at, at + length)
        if period.end > start and levels >= 2:
            period.children = _sub_periods(sign, period.start, period.end, year_days / 12, 2)
            if levels >= 3:
                for child in period.children:
                    if child.end > start and child.start < end:
                        child.children = _sub_periods(child.sign, child.start, child.end, year_days / 144, 3)
        if period.end > start:
            out.append(shape(period))
        at = period.end
        sign = (sign + 1) % 12
    return out
