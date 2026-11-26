"""
AstrologyStudio ·
server/astrologystudio/api/charts.py

/api/v1/charts:

your chart list, new charts, edits and shared charts.

The list and the charts are ephemeralREST's; folders, tags, ratings and notes are kept here.
Correcting a chart's birth data recalculates it in ephemeralREST under the same id, so
everyone who has it sees the correction.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import re
from datetime import date as Date
from datetime import datetime, timedelta
from datetime import time as Time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Response
from pydantic import Field, field_validator

from .. import catalog, charts
from .. import preferences as prefs
from ..appearance import MIN_DIAL, valid_modulus
from ..astro import aspects, events, hellenistic, midpoints, moving, relationships, zodiac
from ..astro.ephemeris import Ephemeris
from ..db import now as _now
from ..db import transaction
from ..deps import Db, Eph, UserPrincipal
from ..errors import ProblemError
from ..schemas import Strict

router = APIRouter(prefix="/charts", tags=["Charts"])

Name = Annotated[str, Field(min_length=1, max_length=120)]
Place = Annotated[str, Field(min_length=1, max_length=200)]


def _valid_system(value: str) -> str:
    if value and value not in charts.HOUSE_SYSTEMS:
        raise ValueError(f"Use one of: {', '.join(charts.HOUSE_SYSTEMS)}")
    return value


def _system(conn: Db, user_id: str, chart_id: str) -> str:
    """The house system a chart is worked out in: its own, or the one in use."""
    return prefs.chart_house_system(conn, user_id, chart_id)


class NoteFields(Strict):
    folder_id: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=30)
    rating: str = ""
    source: Annotated[str, Field(max_length=300)] = ""
    notes: Annotated[str, Field(max_length=5000)] = ""

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str]) -> list[str]:
        return charts.clean_tags(value)

    @field_validator("rating")
    @classmethod
    def _rating(cls, value: str) -> str:
        if value not in charts.RATINGS:
            raise ValueError(f"Use one of: {', '.join(r for r in charts.RATINGS if r)}")
        return value


class ChartCreate(NoteFields):
    name: Name
    date: Date
    time: Time | None = None
    """Leave out when the birth time isn't known: the chart is set for noon."""
    place: Place
    utc_offset: str = ""
    """'+10:00' to set the offset by hand; leave empty to have it looked up for the place."""
    house_system: str = ""
    """The chart's own house system; leave empty to use your default."""

    @field_validator("utc_offset")
    @classmethod
    def _offset(cls, value: str) -> str:
        return charts.valid_offset(value)

    @field_validator("house_system")
    @classmethod
    def _system(cls, value: str) -> str:
        return _valid_system(value)

    def birth(self) -> charts.BirthData:
        return charts.BirthData(self.name, self.date, self.time, self.place, self.utc_offset)


class ChartUpdate(Strict):
    """Send only what changes. Changing date, time, place or offset recalculates the chart."""

    name: Name | None = None
    date: Date | None = None
    time: Time | None = None
    time_unknown: bool | None = None
    place: Place | None = None
    utc_offset: str | None = None
    folder_id: str | None = None
    tags: list[str] | None = None
    rating: str | None = None
    source: Annotated[str, Field(max_length=300)] | None = None
    notes: Annotated[str, Field(max_length=5000)] | None = None
    house_system: str | None = None
    """The chart's own house system, or "" to use your default."""

    @field_validator("utc_offset")
    @classmethod
    def _offset(cls, value: str | None) -> str | None:
        return None if value is None else charts.valid_offset(value)

    @field_validator("house_system")
    @classmethod
    def _system(cls, value: str | None) -> str | None:
        return None if value is None else _valid_system(value)

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else charts.clean_tags(value)

    @field_validator("rating")
    @classmethod
    def _rating(cls, value: str | None) -> str | None:
        if value is not None and value not in charts.RATINGS:
            raise ValueError(f"Use one of: {', '.join(r for r in charts.RATINGS if r)}")
        return value


class DerivedCreate(Strict):
    """A chart worked out from another: transits for a moment, secondary progressions or solar
    arc directions to a date, or a solar or lunar return. ephemeralREST keeps it, and it's added
    to your list under its parent chart."""

    kind: Literal[
        "transits", "progressed", "solar_arc", "solar_return", "lunar_return", "composite", "davison"
    ]
    date: Date | None = None
    """Transits, progressed and solar arc: the date."""
    time: Time | None = None
    """Transits: the time of day, local to the place (noon if left out)."""
    year: Annotated[int, Field(ge=1800, le=2199)] | None = None
    """Returns: the year."""
    month: Annotated[int, Field(ge=1, le=12)] | None = None
    """Lunar returns: the month."""
    place: Annotated[str, Field(max_length=200)] = ""
    """Where the person is, for the houses. Leave empty for your default place (Settings) for
    transits and returns, or the birth place. Davison: a named place instead of the midpoint."""
    other: Annotated[str, Field(max_length=100)] | None = None
    """Composite and Davison: the second chart."""


class ChartImport(Strict):
    chart: Annotated[str, Field(min_length=8, max_length=500)]
    """A chart id, or a link containing one."""


def _summary(
    entry: dict[str, Any], note: dict[str, Any], derived: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    return {
        "id": entry.get("uuid"),
        "derived": [
            {"id": d.get("uuid"), "name": d.get("name") or "Derived chart", "date": d.get("date")}
            for d in sorted(derived or [], key=lambda d: (str(d.get("date") or ""), str(d.get("name") or "")))
        ],
        "name": entry.get("name") or "Untitled",
        "date": entry.get("date"),
        "time": entry.get("time"),
        "place": entry.get("location"),
        "updated_at": entry.get("updated_at"),
        **note,
    }


def _matches(item: dict[str, Any], q: str) -> bool:
    words = q.lower().split()
    haystack = (
        " ".join(str(item.get(k) or "") for k in ("name", "date", "place", "source", "notes")).lower()
        + " "
        + " ".join(item["tags"])
    )
    return all(word in haystack for word in words)


@router.get("", summary="Your charts")
def list_charts(
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    q: Annotated[str, Query(max_length=200)] = "",
    folder: str | None = None,
    tag: str | None = None,
) -> dict[str, Any]:
    """Search matches name, date (e.g. `1985-06`), place, tags, source and notes.
    `folder=none` lists charts that aren't in a folder."""
    notes = charts.notes_for(conn, person.id)
    entries = charts.account_list(eph, None)
    children: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        if entry.get("type") == "derived" and entry.get("parent_uuid"):
            children.setdefault(str(entry["parent_uuid"]), []).append(entry)
    # Composite and Davison charts kept here, while both their charts are still in the list.
    listed = {str(e.get("uuid")) for e in entries if e.get("type", "main") == "main"}
    for parent, pairs in _kept_pairs(conn, person.id).items():
        children.setdefault(parent, []).extend(p for p in pairs if p["other"] in listed)
    items = [
        _summary(
            entry,
            notes.get(str(entry.get("uuid")), charts.empty_note()),
            children.get(str(entry.get("uuid"))),
        )
        for entry in entries
        if entry.get("type", "main") == "main"
    ]
    all_tags = sorted({t for item in items for t in item["tags"]})
    if q.strip():
        items = [i for i in items if _matches(i, q)]
    if folder == "none":
        items = [i for i in items if not i["folder_id"]]
    elif folder:
        items = [i for i in items if i["folder_id"] == folder]
    if tag:
        items = [i for i in items if tag in i["tags"]]
    items.sort(key=lambda i: (i["name"] or "").lower())
    return {"data": items, "tags": all_tags}


@router.post("", status_code=201, summary="Calculate and save a new chart")
def create_chart(body: ChartCreate, conn: Db, eph: Eph, person: UserPrincipal) -> dict[str, Any]:
    birth = body.birth()
    system = body.house_system or prefs.house_system(conn, person.id)
    chart = charts.calculate(eph, birth, system, extra=_zodiac(conn, person.id))
    if not chart.id:
        raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return a chart id", None)
    charts.save_to_list(eph, chart.id, birth, chart.location.get("name") or body.place)
    with transaction(conn):
        charts.save_note(
            conn,
            person.id,
            chart.id,
            {
                **body.model_dump(include={"folder_id", "tags", "rating", "source", "notes", "house_system"}),
                "time_unknown": body.time is None,
                "utc_offset": body.utc_offset,
            },
        )
    return _detail(conn, person.id, chart, charts.account_entry(eph, chart.id))


@router.post("/import", status_code=201, summary="Add a chart someone shared with you")
def import_chart(body: ChartImport, conn: Db, eph: Eph, person: UserPrincipal) -> dict[str, Any]:
    chart_id = charts.shared_id(body.chart)
    chart = charts.normalise(eph.get(f"/chart/{chart_id}"), chart_id, _sidereal(conn, person.id))
    local = chart.datetime_local or chart.datetime_utc
    when = local[:10] if len(local) >= 10 else None
    clock = local[11:16] if len(local) >= 16 else None
    eph.put(
        f"/account/charts/{chart_id}",
        {"type": "main", "name": chart.name, "date": when, "time": clock, "location": chart.location["name"]},
    )
    with transaction(conn):
        charts.save_note(conn, person.id, chart_id, {})
    return _detail(conn, person.id, chart, charts.account_entry(eph, chart_id))


HARMONIC_ID = re.compile(r"^harmonic-(\d{1,3})-(.+)$")
PAIR_ID = re.compile(r"^(composite|davison)~([^~/]+)~([^~/]+)(?:~([^~/]{1,200}))?$")


def harmonic_id(chart_id: str, n: int) -> str:
    """A harmonic chart's id: worked out whenever it's asked for, so nothing is stored."""
    return f"harmonic-{n}-{chart_id}"


@router.get("/derived/{derived_id}", summary="A derived chart with its positions")
def get_derived(
    derived_id: str, conn: Db, eph: Eph, person: UserPrincipal, mode: Mode = ""
) -> dict[str, Any]:
    """Also answers for charts worked out each time rather than kept (so they aren't in your chart
    list): harmonic charts, `harmonic-{n}-{chart id}`, and the composite and Davison charts of two
    charts, `composite~{chart id}~{other chart id}` and `davison~{chart id}~{other chart id}`
    (with `~{place}` after a Davison chart's ids for a place other than the midpoint)."""
    found = HARMONIC_ID.match(derived_id)
    if found:
        n = int(found.group(1))
        if not 1 <= n <= 180:
            raise ProblemError(422, "bad-harmonic", "Harmonics run from 1 to 180", str(n))
        return _harmonic(conn, eph, person.id, found.group(2), n, mode)
    pair = PAIR_ID.match(derived_id)
    if pair:
        kind, first, second, place = pair.groups()
        if kind == "composite":
            result = composite(first, conn, eph, person, second, mode)
        else:
            result = davison(first, conn, eph, person, second, mode, place or "")
        return {
            **result,
            "id": derived_id,
            "kind": kind,
            "parent_id": first,
            "other_id": second,
            "reference_date": None,
            "moment_utc": result.get("datetime_utc") if kind == "davison" else None,
            "arc": None,
        }
    try:
        data = eph.get(f"/derived/{derived_id}")
    except ProblemError as error:
        # Transits aren't in ephemeralREST's derived charts: they're an ordinary chart that
        # your list files under its parent.
        listed = charts.account_list(eph, "derived")
        entry = next((c for c in listed if str(c.get("uuid")) == derived_id), None)
        if error.status != 404 or entry is None:
            raise
        return _transits(conn, eph, person.id, derived_id, entry, mode)
    return _derived(data, derived_id, prefs.active_profile(conn, person.id), mode)


def _sidereal(conn: Db, user_id: str) -> str | None:
    """The active profile's ayanamsa if it's sidereal, else None."""
    found: str | None = _zodiac(conn, user_id).get(zodiac.SIDEREAL)
    return found


def _transits(
    conn: Db, eph: Eph, user_id: str, chart_id: str, entry: dict[str, Any], mode: str = ""
) -> dict[str, Any]:
    """A transits chart: an ordinary ephemeralREST chart for the moment, listed under its parent."""
    profile = prefs.active_profile(conn, user_id)
    system = _system(conn, user_id, str(entry.get("parent_uuid") or chart_id))
    chart = charts.load(eph, chart_id, system, _zodiac(conn, user_id))
    local = chart.datetime_local or chart.datetime_utc
    return {
        **chart.as_dict(),
        **analysis(chart, profile, mode),
        "name": chart.name or "Transits",
        "kind": "transits",
        "parent_id": entry.get("parent_uuid"),
        "reference_date": local[:16].replace("T", " ") if local else entry.get("date"),
        "moment_utc": None,
        "arc": None,
    }


@router.post("/{chart_id}/derived", status_code=201, summary="Work out and keep a derived chart")
def create_derived(
    chart_id: str, body: DerivedCreate, conn: Db, eph: Eph, person: UserPrincipal
) -> dict[str, Any]:
    profile = prefs.active_profile(conn, person.id)
    if body.kind == "transits":
        return _create_transits(chart_id, body, conn, eph, person.id)
    if body.kind in ("composite", "davison"):
        return _keep_pair(chart_id, body, conn, eph, person)
    endpoint, _ = charts.DERIVED_KINDS[body.kind]
    request: dict[str, Any] = {
        "house_system": _system(conn, person.id, chart_id),
        "output": charts.FULL_OUTPUT,
    }
    place = body.place.strip()
    if not place and body.kind in ("solar_return", "lunar_return"):
        place = prefs.defaults(conn, person.id)["place"]
    if place:
        request["location"] = place
    if body.kind in ("progressed", "solar_arc"):
        if body.date is None:
            raise ProblemError(422, "date-needed", "Choose the date to progress to", None)
        request["progression_date"] = body.date.isoformat()
    else:
        if body.year is None:
            raise ProblemError(422, "year-needed", "Choose the year of the return", None)
        request["return_year"] = body.year
        if body.kind == "lunar_return":
            if body.month is None:
                raise ProblemError(422, "month-needed", "Choose the month of the lunar return", None)
            request["return_month"] = body.month
    data = eph.post(f"/chart/{chart_id}/{endpoint}", request)
    derived_id = str(data.get("derived_chart_id") or "") if isinstance(data, dict) else ""
    if not derived_id:
        raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return a chart id", None)
    detail = _derived({**data, "id": derived_id}, derived_id, profile)
    charts.save_derived_to_list(
        eph,
        derived_id,
        chart_id,
        detail["name"],
        detail["reference_date"],
        detail["location"]["name"] or place,
    )
    return detail


def _keep_pair(
    chart_id: str, body: DerivedCreate, conn: Db, eph: Eph, person: UserPrincipal
) -> dict[str, Any]:
    """A composite or Davison chart, kept with the chart it was made from so it's listed under it.
    It's still worked out from the two charts each time it's shown."""
    other = (body.other or "").strip()
    if not other:
        raise ProblemError(422, "other-needed", "Choose the second chart", None)
    if other == chart_id:
        raise ProblemError(422, "same-chart", "Choose a different second chart", None)
    where = re.sub(r"[~/]", " ", body.place).strip() if body.kind == "davison" else ""
    pair_id = f"{body.kind}~{chart_id}~{other}" + (f"~{where}" if where else "")
    detail = get_derived(pair_id, conn, eph, person)  # checks both charts can be worked out
    with transaction(conn):
        conn.execute(
            "INSERT INTO kept_derived (user_id, id, parent_id, other_id, kind, name, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name",
            (person.id, pair_id, chart_id, other, body.kind, str(detail.get("name") or "")[:200], _now()),
        )
    return detail


def _kept_pairs(conn: Db, user_id: str) -> dict[str, list[dict[str, Any]]]:
    """Kept composite and Davison charts, by the chart they were made from."""
    found: dict[str, list[dict[str, Any]]] = {}
    for row in conn.execute(
        "SELECT id, parent_id, other_id, name, created_at FROM kept_derived WHERE user_id = ?", (user_id,)
    ):
        found.setdefault(row["parent_id"], []).append(
            {"uuid": row["id"], "name": row["name"], "date": row["created_at"][:10], "other": row["other_id"]}
        )
    return found


def _create_transits(chart_id: str, body: DerivedCreate, conn: Db, eph: Eph, user_id: str) -> dict[str, Any]:
    """ephemeralREST has no transits endpoint, so transits are an ordinary chart for the moment,
    filed in your list as derived from the chart they were worked out for."""
    if body.date is None:
        raise ProblemError(422, "date-needed", "Choose the date of the transits", None)
    system = _system(conn, user_id, chart_id)
    parent = charts.load(eph, chart_id, system)
    place = (
        body.place.strip() or prefs.defaults(conn, user_id)["place"] or str(parent.location.get("name") or "")
    )
    if not place:
        raise ProblemError(422, "place-needed", "Choose where the transits are for", None)
    moment = body.time or Time(12, 0)
    name = f"Transits {body.date.isoformat()} {moment.strftime('%H:%M')} for {parent.name or 'chart'}"
    birth = charts.BirthData(name[:200], body.date, moment, place)
    chart = charts.calculate(eph, birth, system, extra=_zodiac(conn, user_id))
    if not chart.id:
        raise ProblemError(502, "ephemeral-error", "ephemeralREST didn't return a chart id", None)
    entry = {
        "type": "derived",
        "parent_uuid": chart_id,
        "name": birth.name,
        "date": body.date.isoformat(),
        "time": moment.strftime("%H:%M"),
        "location": (chart.location.get("name") or place)[:200],
    }
    eph.put(f"/account/charts/{chart.id}", entry)
    return _transits(conn, eph, user_id, chart.id, entry)


def _derived(
    data: dict[str, Any], derived_id: str, profile: dict[str, Any], mode: str = ""
) -> dict[str, Any]:
    """A derived chart in the same shape as the rest, plus what it was worked out from."""
    chart = charts.normalise(
        data, derived_id, zodiac.selection(profile["zodiac"], profile["ayanamsa"]).get(zodiac.SIDEREAL)
    )
    chart_type = str(data.get("chart_type") or "")
    reference = (
        data.get("reference_date")
        or data.get("progression_date")
        or data.get("direction_date")
        or (str(data.get("return_datetime_utc") or "")[:10] or None)
    )
    return {
        **chart.as_dict(),
        **analysis(chart, profile, mode),
        "name": chart.name or "Derived chart",
        "kind": charts.KIND_OF_TYPE.get(chart_type, chart_type or "derived"),
        "parent_id": data.get("chart_id"),
        "reference_date": reference,
        "moment_utc": data.get("return_datetime_utc"),
        "arc": data.get("solar_arc_geo"),
    }


@router.get("/{chart_id}", summary="A chart with its positions")
def get_chart(chart_id: str, conn: Db, eph: Eph, person: UserPrincipal, mode: Mode = "") -> dict[str, Any]:
    chart = charts.load(eph, chart_id, _system(conn, person.id, chart_id), _zodiac(conn, person.id))
    return _detail(conn, person.id, chart, charts.account_entry(eph, chart_id), mode)


@router.get("/{chart_id}/moving", summary="Transits, progressions and solar arc for a moment")
def moving_chart(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    at: Annotated[str, Query(description="The moment, ISO 8601 (UTC if no offset)")],
    layers: Annotated[
        str, Query(description="Comma-separated: transits, progressions, solar_arc")
    ] = "transits",
) -> dict[str, Any]:
    """Read from ephemeralREST's daily ephemeris, so stepping through time saves nothing in
    ephemeralREST. Each layer comes with its aspects to the natal chart, with orbs capped at
    the profile's moving-chart orb."""
    wanted = [layer for layer in layers.split(",") if layer]
    unknown = set(wanted) - set(moving.LAYERS)
    if unknown:
        raise ProblemError(422, "unknown-layer", "Unknown layer", ", ".join(sorted(unknown)))
    try:
        moment = moving.parse_utc(at)
    except ValueError:
        raise ProblemError(422, "bad-moment", "Couldn't read that date and time", at) from None
    profile = prefs.active_profile(conn, person.id)
    chart = charts.load(eph, chart_id, _system(conn, person.id, chart_id), _zodiac(conn, person.id))
    natal = moving.parse_utc(chart.datetime_utc)
    lat, lon = chart.location.get("latitude"), chart.location.get("longitude")
    source = Ephemeris(eph, conn, _sidereal(conn, person.id))
    settings = moving.tight(profile["aspects"], profile["moving_orb"])
    targets = moving.fixed(chart.points)
    result: dict[str, Any] = {}
    for layer in wanted:
        if layer == "transits":
            data = moving.transits(source, moment, lat, lon)
        elif layer == "progressions":
            data = moving.progressions(source, chart.points, natal, moment, lat)
        else:
            data = moving.solar_arc(source, chart.points, natal, moment)
        data["label"] = moving.LABELS[layer]
        data["aspects"] = [a.as_dict() for a in aspects.find(data["points"], settings, second=targets)]
        result[layer] = data
    return {"at": moment.isoformat(), "natal_utc": natal.isoformat(), "layers": result}


def _hellenistic_chart(conn: Db, eph: Eph, user_id: str, chart_id: str) -> charts.Chart:
    """A chart with its lots by sect and Whole Sign houses, for the timing techniques."""
    profile = prefs.active_profile(conn, user_id)
    chart = charts.load(eph, chart_id, _system(conn, user_id, chart_id), _zodiac(conn, user_id))
    add_points(chart, profile, "hellenistic")
    if "asc" not in chart.points:
        raise ProblemError(
            422, "no-ascendant", "This chart has no Ascendant (is the birth time known?)", None
        )
    return chart


def _birth_local(chart: charts.Chart) -> tuple[datetime, Date]:
    """The birth moment (UTC) and the birth date where it happened."""
    birth = moving.parse_utc(chart.datetime_utc)
    local = chart.datetime_local[:10]
    try:
        return birth, Date.fromisoformat(local)
    except ValueError:
        offset = chart.location.get("utc_offset_seconds")
        shift = timedelta(seconds=offset) if isinstance(offset, int | float) else timedelta(0)
        return birth, (birth + shift).date()


@router.get("/{chart_id}/profections", summary="Annual profections")
def chart_profections(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    today: Annotated[Date | None, Query(description="Which year is current (default: today)")] = None,
) -> dict[str, Any]:
    """The profected sign and lord of the year for ages 0 to 100. Each year runs from one
    birthday to the next, in the birth time zone."""
    chart = _hellenistic_chart(conn, eph, person.id, chart_id)
    _, birth_date = _birth_local(chart)
    result = hellenistic.profections(chart.points, birth_date, today or Date.today())
    lons = {k: p["lon"] for k, p in chart.points.items()}
    return {
        **result,
        **hellenistic.sect(lons["sun"], lons["asc"]),
        "asc_sign": hellenistic.SIGNS[hellenistic.sign_of(lons["asc"])],
    }


@router.get("/{chart_id}/releasing", summary="Zodiacal releasing")
def chart_releasing(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    lot: Annotated[Literal["spirit", "fortune"], Query(alias="from")] = "spirit",
    year: Annotated[Literal["360", "365.25"], Query(description="Days in a year")] = "360",
    start: Date | None = None,
    end: Date | None = None,
    levels: Annotated[int, Query(ge=1, le=3)] = 2,
    to_age: Annotated[int | None, Query(ge=1, le=120, description="Instead of `end`: up to this age")] = None,
) -> dict[str, Any]:
    """Periods of zodiacal releasing from the Lot of Spirit or Fortune that overlap start..end
    (default: birth to 90 years), nested to `levels`. Each period says whether it's a loosing of
    the bond and whether its sign is angular from the Lot of Fortune (a peak period)."""
    chart = _hellenistic_chart(conn, eph, person.id, chart_id)
    birth, _ = _birth_local(chart)
    lot_key = "lot_spirit" if lot == "spirit" else "part_of_fortune"
    first = datetime.combine(start, datetime.min.time(), birth.tzinfo) if start else birth
    if end:
        last = datetime.combine(end, datetime.min.time(), birth.tzinfo) + timedelta(days=1)
    else:
        last = birth + timedelta(days=365.25 * (to_age or 90))
    if last <= first:
        raise ProblemError(422, "bad-range", "The end must come after the start", None)
    periods = hellenistic.releasing(
        chart.points[lot_key]["lon"],
        chart.points["part_of_fortune"]["lon"],
        birth,
        max(first, birth),
        last,
        levels,
        float(year),
    )
    return {
        "from": lot,
        "year_days": float(year),
        "lot_sign": hellenistic.SIGNS[hellenistic.sign_of(chart.points[lot_key]["lon"])],
        "fortune_sign": hellenistic.SIGNS[hellenistic.sign_of(chart.points["part_of_fortune"]["lon"])],
        "birth_utc": birth.isoformat(),
        "periods": periods,
    }


@router.get("/{chart_id}/midpoints", summary="Midpoint sort, trees and search")
def chart_midpoints(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    modulus: Annotated[float, Query()] = 90.0,
    orb: Annotated[float, Query(ge=0.1, le=5)] = 1.5,
    half: Annotated[bool, Query(description="Include the far end of the axis (45° on the 90° dial)")] = True,
    bodies: Annotated[
        str, Query(description="Comma-separated bodies; default: the bodies switched on in My View")
    ] = "",
    factor: str | None = None,
    degree: Annotated[float | None, Query(ge=0, lt=360)] = None,
    helio: bool = False,
) -> dict[str, Any]:
    """Always returns the midpoint sort. With `factor`, also that factor's tree; with
    `degree`, everything on that degree's axis (for directions and rectification)."""
    if not valid_modulus(modulus):
        detail = f"{modulus}° doesn't; the smallest is {MIN_DIAL}°"
        raise ProblemError(422, "bad-modulus", "A dial size must divide 360° evenly", detail)
    profile = prefs.active_profile(conn, person.id)
    chart = charts.load(eph, chart_id, _system(conn, person.id, chart_id), _zodiac(conn, person.id))
    add_points(chart, profile)
    source = chart.helio if helio else chart.points
    wanted = [b for b in bodies.split(",") if b] or [
        k for k, on in prefs.bodies(conn, person.id).items() if on
    ]
    lons = {k: float(source[k]["lon"]) for k in wanted if k in source}
    result: dict[str, Any] = {
        "modulus": modulus,
        "orb": orb,
        "points": lons,
        "sort": midpoints.sort(lons, modulus),
    }
    if factor is not None:
        if factor not in lons:
            raise ProblemError(422, "unknown-factor", "That body isn't in this chart", factor)
        result["tree"] = {
            "factor": factor,
            "items": midpoints.near(lons, lons[factor], orb, modulus, half, exclude=factor),
        }
    if degree is not None:
        result["search"] = {"degree": degree, "items": midpoints.near(lons, degree, orb, modulus, half)}
    return result


def _pair(
    conn: Db, eph: Eph, person: UserPrincipal, chart_id: str, other: str
) -> tuple[charts.Chart, charts.Chart]:
    extra = _zodiac(conn, person.id)
    first = charts.load(eph, chart_id, _system(conn, person.id, chart_id), extra)
    second = charts.load(eph, other, _system(conn, person.id, other), extra)
    return first, second


def _names(eph: Eph, *pairs: tuple[str, charts.Chart]) -> list[str]:
    entries = {str(e.get("uuid")): e for e in charts.account_list(eph)}
    return [str((entries.get(cid) or {}).get("name") or chart.name) for cid, chart in pairs]


def _lite(chart: charts.Chart, entry: dict[str, Any] | None) -> dict[str, Any]:
    return {**chart.as_dict(), "name": (entry or {}).get("name") or chart.name}


@router.get("/{chart_id}/synastry", summary="Two charts together, with aspects between them")
def synastry(
    chart_id: str, conn: Db, eph: Eph, person: UserPrincipal, other: Annotated[str, Query(alias="with")]
) -> dict[str, Any]:
    """`aspects`: each has `a` in this chart and `b` in the other."""
    first, second = _pair(conn, eph, person, chart_id, other)
    profile = prefs.active_profile(conn, person.id)
    return {
        "a": _lite(first, charts.account_entry(eph, chart_id)),
        "b": _lite(second, charts.account_entry(eph, other)),
        "aspects": [
            a.as_dict() for a in aspects.find(first.points, profile["aspects"], second=second.points)
        ],
    }


@router.get("/{chart_id}/composite", summary="The composite (midpoint) chart of two charts")
def composite(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    other: Annotated[str, Query(alias="with")],
    mode: Mode = "",
) -> dict[str, Any]:
    first, second = _pair(conn, eph, person, chart_id, other)
    names = [
        (charts.account_entry(eph, c) or {}).get("name") or ch.name
        for c, ch in ((chart_id, first), (other, second))
    ]
    chart = charts.Chart(
        id="",
        name=f"{names[0]} and {names[1]}: composite",
        datetime_utc="",
        datetime_local="",
        location={
            "name": "",
            "latitude": None,
            "longitude": None,
            "timezone": None,
            "utc_offset_seconds": None,
            "daylight_saving": None,
        },
        house_system=first.house_system,
        houses=relationships.composite_houses(first.houses, second.houses),
        points=relationships.composite_points(first.points, second.points),
        helio=relationships.composite_points(first.helio, second.helio),
    )
    if (
        first.zodiac == second.zodiac == "sidereal"
        and first.ayanamsa_value is not None
        and second.ayanamsa_value is not None
    ):
        chart.zodiac, chart.ayanamsa = "sidereal", first.ayanamsa
        chart.ayanamsa_value = (first.ayanamsa_value + second.ayanamsa_value) / 2.0
    return {**chart.as_dict(), **analysis(chart, prefs.active_profile(conn, person.id), mode)}


@router.get("/{chart_id}/davison", summary="The Davison chart: the midpoint in time and space")
def davison(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    other: Annotated[str, Query(alias="with")],
    mode: Mode = "",
    place: Annotated[str, Query(max_length=200)] = "",
) -> dict[str, Any]:
    """Worked out by ephemeralREST for the midpoint moment and place. ephemeralREST keeps every chart
    it calculates, so the result is kept here for a while rather than asked for on every view.
    `place` uses a named place instead of the midpoint: an ephemeralREST without Google geocoding
    only finds places by name, so it can't use the midpoint's coordinates."""
    first, second = _pair(conn, eph, person, chart_id, other)
    places = [(c.location.get("latitude"), c.location.get("longitude")) for c in (first, second)]
    if not all(isinstance(v, int | float) for place in places for v in place):
        raise ProblemError(422, "no-coordinates", "Both charts need a place with coordinates", None)
    moment = relationships.davison_moment(
        moving.parse_utc(first.datetime_utc), moving.parse_utc(second.datetime_utc)
    )
    lat, lon = relationships.davison_place(*places[0], *places[1])  # type: ignore[arg-type]
    names = [
        (charts.account_entry(eph, c) or {}).get("name") or ch.name
        for c, ch in ((chart_id, first), (other, second))
    ]
    profile = prefs.active_profile(conn, person.id)
    zodiac_fields = _zodiac(conn, person.id)
    where = place.strip()
    memo = f"davison:{chart_id}:{other}:{where}:{profile['house_system']}:{sorted(zodiac_fields.items())}"

    def work() -> dict[str, Any]:
        try:
            return charts.at_moment(
                eph,
                f"{names[0]} and {names[1]}: Davison",
                moment.isoformat(),
                lat,
                lon,
                profile["house_system"],
                zodiac_fields,
                place=where,
                coordinates=not where,
            ).as_dict()
        except ProblemError as problem:
            if problem.slug != "ephemeral-rejected" or where:
                raise
            raise ProblemError(
                422,
                "midpoint-place",
                "The midpoint place can't be looked up",
                f"This ephemeralREST finds places by name only, so it can't use the midpoint "
                f"({lat:.2f}, {lon:.2f}). Choose Change and enter the nearest town as the place.",
            ) from None

    data = eph.memo(memo, 3600.0, work)
    chart = charts.Chart.restore(data)
    return {**chart.as_dict(), **analysis(chart, profile, mode)}


class ReturnRequest(Strict):
    kind: Literal["solar", "lunar"]
    year: Annotated[int, Field(ge=1800, le=2199)]
    month: Annotated[int, Field(ge=1, le=12)] | None = None
    place: Annotated[str, Field(max_length=200)] = ""
    """Where the person is for the return. Leave empty for your default place (Settings), or the
    birth place if you have none."""


@router.post("/{chart_id}/returns", summary="A solar or lunar return")
def chart_return(
    chart_id: str, body: ReturnRequest, conn: Db, eph: Eph, person: UserPrincipal
) -> dict[str, Any]:
    profile = prefs.active_profile(conn, person.id)
    request: dict[str, Any] = {
        "house_system": _system(conn, person.id, chart_id),
        "output": charts.FULL_OUTPUT,
        "return_year": body.year,
    }
    place = body.place.strip() or prefs.defaults(conn, person.id)["place"]
    if place:
        request["location"] = place
    if body.kind == "lunar":
        if body.month is None:
            raise ProblemError(422, "month-needed", "Choose a month for the lunar return", None)
        request["return_month"] = body.month
        path = f"/chart/{chart_id}/lunar-return"
    else:
        path = f"/chart/{chart_id}/solar-return"
    data = eph.post(path, request)
    chart = charts.normalise(data, sidereal=_sidereal(conn, person.id))
    chart.name = chart.name or ("Solar return" if body.kind == "solar" else "Lunar return")
    return {
        **chart.as_dict(),
        **analysis(chart, profile),
        "kind": body.kind,
        "return_utc": data.get("return_datetime_utc") if isinstance(data, dict) else None,
    }


@router.get("/{chart_id}/events", summary="When moving bodies make exact aspects to this chart")
def chart_events(
    chart_id: str,
    conn: Db,
    eph: Eph,
    person: UserPrincipal,
    start: Date,
    end: Date,
    layer: Literal["transits", "progressions", "solar_arc"] = "transits",
    movers: Annotated[
        str, Query(description="Comma-separated moving bodies; default: all but the Moon")
    ] = "",
    targets: Annotated[
        str,
        Query(description="Comma-separated natal bodies to aspect; default: every body on in My View"),
    ] = "",
    majors_only: bool = True,
) -> dict[str, Any]:
    """Transits over up to two years; progressions and solar arc over up to 100 years. Targets
    are the bodies switched on in My View (or the ones in `targets`); aspects are the profile's (switched-on)
    aspects."""
    span = (end - start).days
    limit = 731 if layer == "transits" else 36525
    if span <= 0 or span > limit:
        raise ProblemError(422, "bad-range", "Choose a shorter range", f"Up to {limit} days for {layer}.")
    profile = prefs.active_profile(conn, person.id)
    chart = charts.load(eph, chart_id, _system(conn, person.id, chart_id), _zodiac(conn, person.id))
    shown = [k for k, on in prefs.bodies(conn, person.id).items() if on]
    natal_keys = [k for k in targets.split(",") if k] or shown
    if unknown := [k for k in natal_keys if k not in catalog.BODY_KEYS]:
        raise ProblemError(422, "bad-body", "Unknown body", f"Not a body: {', '.join(unknown)}.")
    aimed = {k: chart.points[k] for k in natal_keys if k in chart.points}
    wanted_aspects = [
        k
        for k, v in profile["aspects"].items()
        if v.get("on") and (aspects.BY_KEY[k].major or not majors_only)
    ]
    natal = moving.parse_utc(chart.datetime_utc)
    source = Ephemeris(eph, conn, _sidereal(conn, person.id))

    def at(moment: datetime) -> dict[str, dict[str, Any]]:
        if layer == "transits":
            return source.at(moment)
        if layer == "progressions":
            return source.at(moving.progressed_moment(natal, moment))
        points: dict[str, dict[str, Any]] = moving.solar_arc(source, chart.points, natal, moment)["points"]
        return points

    default_movers = [k for k in shown if k not in ("moon", "asc", "mc", "vertex", "east_point")]
    if layer != "transits":
        default_movers = shown
    chosen = [m for m in movers.split(",") if m] or default_movers
    if unknown := [k for k in chosen if k not in catalog.BODY_KEYS]:
        raise ProblemError(422, "bad-body", "Unknown body", f"Not a body: {', '.join(unknown)}.")
    step = timedelta(days=1) if layer == "transits" else timedelta(days=30)
    if "moon" in chosen and layer == "transits":
        step = timedelta(hours=6)
    found = events.exact_aspects(
        at,
        aimed,
        chosen,
        wanted_aspects,
        events.noon(start),
        events.noon(end),
        step,
        precision=timedelta(minutes=1) if layer == "transits" else timedelta(hours=6),
    )
    return {"layer": layer, "start": start.isoformat(), "end": end.isoformat(), "events": found}


@router.get("/{chart_id}/harmonic", summary="A harmonic chart")
def harmonic(
    chart_id: str, conn: Db, eph: Eph, person: UserPrincipal, n: Annotated[int, Query(ge=1, le=180)] = 5
) -> dict[str, Any]:
    """Every longitude multiplied by n (modulo 360). Conjunctions in the harmonic chart show the
    nth-harmonic aspects of the natal chart. The chart screen uses `GET /charts/derived/harmonic-{n}-{id}`,
    which gives the same chart in a derived chart's shape."""
    return _harmonic_chart(conn, eph, person.id, chart_id, n)


def _harmonic(conn: Db, eph: Eph, user_id: str, chart_id: str, n: int, mode: str = "") -> dict[str, Any]:
    """A harmonic chart in a derived chart's shape, for the chart screen."""
    result = _harmonic_chart(conn, eph, user_id, chart_id, n, mode)
    return {
        **result,
        "id": harmonic_id(chart_id, n),
        "kind": "harmonic",
        "parent_id": chart_id,
        "reference_date": None,
        "moment_utc": None,
        "arc": None,
    }


def _harmonic_chart(
    conn: Db, eph: Eph, user_id: str, chart_id: str, n: int, mode: str = ""
) -> dict[str, Any]:
    profile = prefs.active_profile(conn, user_id)
    chart = charts.load(eph, chart_id, _system(conn, user_id, chart_id), _zodiac(conn, user_id))
    points = {
        k: {**p, "lon": (p["lon"] * n) % 360.0, "speed": p["speed"] * n if p["speed"] is not None else None}
        for k, p in chart.points.items()
    }
    result = charts.Chart(
        id=chart.id,
        name=f"Harmonic {n}: {chart.name}" if chart.name else f"Harmonic {n}",
        datetime_utc=chart.datetime_utc,
        datetime_local=chart.datetime_local,
        location=chart.location,
        house_system=None,
        houses=None,
        points=points,
        helio={},
    )
    if chart.zodiac == "sidereal" and chart.ayanamsa_value is not None:
        # The ayanamsa is multiplied with everything else, so the Aries Point lands at -n times it.
        result.zodiac, result.ayanamsa = "sidereal", chart.ayanamsa
        result.ayanamsa_value = (chart.ayanamsa_value * n) % 360.0
    return {**result.as_dict(), **analysis(result, profile, mode), "harmonic": n}


@router.patch("/{chart_id}", summary="Change a chart")
def update_chart(
    chart_id: str, body: ChartUpdate, conn: Db, eph: Eph, person: UserPrincipal
) -> dict[str, Any]:
    entry = charts.account_entry(eph, chart_id)
    if entry is None:
        raise ProblemError(404, "not-found", "Chart not in your list", None)
    note = charts.note(conn, person.id, chart_id)
    changes = body.model_dump(exclude_unset=True)

    birth_fields = {"date", "time", "time_unknown", "place", "utc_offset"}
    current_time = (
        None if note["time_unknown"] or not entry.get("time") else Time.fromisoformat(entry["time"])
    )
    # Giving a time means the time is now known, unless told otherwise in the same change.
    time_unknown = changes.get("time_unknown", note["time_unknown"] and changes.get("time") is None)
    birth = charts.BirthData(
        name=changes.get("name") or entry.get("name") or "Untitled",
        date=changes.get("date") or Date.fromisoformat(str(entry.get("date"))),
        time=None if time_unknown else changes.get("time", current_time),
        place=changes.get("place") or str(entry.get("location") or ""),
        utc_offset=changes.get("utc_offset", note["utc_offset"]),
    )
    if "house_system" in changes:
        house_system = changes["house_system"] or prefs.house_system(conn, person.id)
    else:
        house_system = _system(conn, person.id, chart_id)
    if birth_fields & changes.keys():
        chart = charts.calculate(eph, birth, house_system, recalc_id=chart_id, extra=_zodiac(conn, person.id))
        place_name = chart.location.get("name") or birth.place
    else:
        chart = None
        place_name = str(entry.get("location") or birth.place)
    if {"name"} | birth_fields & changes.keys():
        charts.save_to_list(eph, chart_id, birth, place_name)

    note_changes = {k: v for k, v in changes.items() if k in charts.NOTE_FIELDS}
    if "time_unknown" in changes or "time" in changes:
        note_changes["time_unknown"] = birth.time is None
    with transaction(conn):
        charts.save_note(conn, person.id, chart_id, note_changes)
    chart = chart or charts.load(eph, chart_id, house_system, _zodiac(conn, person.id))
    return _detail(conn, person.id, chart, charts.account_entry(eph, chart_id))


@router.delete("/{chart_id}", status_code=204, summary="Remove a chart from your list")
def delete_chart(chart_id: str, conn: Db, eph: Eph, person: UserPrincipal) -> Response:
    """The chart itself stays in ephemeralREST for anyone else who has it. Removing a chart also
    removes the composite and Davison charts made with it; removing one of those removes only it."""
    if PAIR_ID.match(chart_id):
        with transaction(conn):
            conn.execute("DELETE FROM kept_derived WHERE user_id = ? AND id = ?", (person.id, chart_id))
        return Response(status_code=204)
    eph.delete(f"/account/charts/{chart_id}")
    with transaction(conn):
        charts.forget_note(conn, person.id, chart_id)
        conn.execute(
            "DELETE FROM kept_derived WHERE user_id = ? AND (parent_id = ? OR other_id = ?)",
            (person.id, chart_id, chart_id),
        )
    return Response(status_code=204)


def _detail(
    conn: Db, user_id: str, chart: charts.Chart, entry: dict[str, Any] | None, mode: str = ""
) -> dict[str, Any]:
    entry = entry or {}
    profile = prefs.active_profile(conn, user_id)
    return {
        **chart.as_dict(),
        **analysis(chart, profile, mode),
        "name": entry.get("name") or chart.name,
        "date": entry.get("date"),
        "time": entry.get("time"),
        "place": entry.get("location") or chart.location.get("name"),
        "in_list": bool(entry),
        "note": charts.note(conn, user_id, chart.id),
    }


Mode = Annotated[
    Literal["", "hellenistic"],
    Query(description='"hellenistic": Whole Sign houses, lots by sect, aspects by sign, Hellenistic details'),
]

# Points that take no part in aspects: a fixed point aspecting everything clutters the wheel.
NO_ASPECTS = frozenset({"aries_point"})


def add_points(chart: charts.Chart, profile: dict[str, Any], mode: str = "") -> None:
    """Points worked out here rather than by ephemeralREST: the lots (Fortune following the
    profile's formula, the others always by sect; all by sect in a Hellenistic chart) and the
    Aries Point. A Hellenistic chart's houses become Whole Sign houses from the Ascendant."""
    lons = {k: p["lon"] for k, p in chart.points.items()}
    if "asc" in lons and "sun" in lons:
        day = hellenistic.is_day(lons["sun"], lons["asc"])
        by_sect = mode == "hellenistic" or profile.get("lot_formula") == "sect"
        for key, lon in hellenistic.lots(lons, day, fortune_by_sect=by_sect).items():
            chart.points[key] = {
                "lon": lon,
                "lat": 0.0,
                "speed": None,
                "decl": None,
                "ra": None,
                "retro": False,
            }
        if mode == "hellenistic":
            chart.houses = hellenistic.whole_sign_cusps(lons["asc"])
            chart.house_system = "whole_sign"
    # 0° tropical Aries. In a sidereal chart that's the ayanamsa before 0° sidereal Aries.
    aries = (-chart.ayanamsa_value) % 360.0 if chart.zodiac == "sidereal" and chart.ayanamsa_value else 0.0
    chart.points["aries_point"] = {
        "lon": aries,
        "lat": 0.0,
        "speed": None,
        "decl": None,
        "ra": None,
        "retro": False,
    }


def analysis(chart: charts.Chart, profile: dict[str, Any], mode: str = "") -> dict[str, Any]:
    """Aspects (geocentric and heliocentric) under the active profile's settings, after adding
    the points worked out here. In a Hellenistic chart, aspects are by sign (those switched on
    in the profile) and the chart comes
    with its sect, dignities, solar phase and whole-sign houses (`hellenistic`)."""
    add_points(chart, profile, mode)
    aspected = {k: p for k, p in chart.points.items() if k not in NO_ASPECTS}
    if mode == "hellenistic":
        # By sign, whatever the orbs; aspects switched off in the profile aren't shown here either.
        on = {k for k, v in profile["aspects"].items() if v.get("on")}
        found = [a.as_dict() for a in hellenistic.sign_aspects(aspected) if a.aspect in on]
    else:
        found = [a.as_dict() for a in aspects.find(aspected, profile["aspects"])]
    return {
        "points": chart.points,
        "houses": chart.houses,
        "house_system": chart.house_system,
        "aspects": found,
        "aspects_helio": [a.as_dict() for a in aspects.find(chart.helio, profile["aspects"])],
        "profile": {
            k: profile[k] for k in ("id", "name", "house_system", "zodiac", "ayanamsa", "lot_formula")
        },
        # Sidereal was asked for but this chart couldn't be (an ephemeralREST without ayanamsas).
        "sidereal_pending": profile["zodiac"] == "sidereal" and chart.zodiac != "sidereal",
        "mode": mode or "standard",
        "hellenistic": hellenistic.analyse(chart.points) if mode == "hellenistic" else None,
    }


def _zodiac(conn: Db, user_id: str) -> dict[str, Any]:
    profile = prefs.active_profile(conn, user_id)
    return zodiac.selection(profile["zodiac"], profile["ayanamsa"])
