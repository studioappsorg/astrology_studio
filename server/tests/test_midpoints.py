"""
AstrologyStudio ·
server/tests/test_midpoints.py

Tests:

midpoints, the midpoint sort, midpoint trees and the dial's axes.

Copyright (c) 2026 Gavin Melhuish
MIT License; see LICENSE in the project root.
SPDX-License-Identifier: MIT
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from astrologystudio.astro import midpoints as mp


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [(10, 30, 20), (350, 10, 0), (10, 350, 0), (0, 180, 90), (100, 300, 20), (300, 100, 20)],
)
def test_nearer_midpoint(a: float, b: float, expected: float) -> None:
    assert mp.midpoint(a, b) == pytest.approx(expected)


def test_dial_distance() -> None:
    assert mp.dial_distance(10, 100, 90) == pytest.approx(0)  # square: same axis on the 90° dial
    assert mp.dial_distance(10, 190, 90) == pytest.approx(0)  # opposition
    assert mp.dial_distance(10, 55, 90) == pytest.approx(45)
    assert mp.dial_distance(10, 55, 90, include_half=True) == pytest.approx(0)  # semi-square
    assert mp.dial_distance(1, 89, 90) == pytest.approx(2)  # across 0°


def test_tree_finds_axes() -> None:
    points = {"sun": 10.0, "moon": 50.0, "mars": 150.0, "venus": 230.0, "saturn": 190.5}
    # moon/mars = 100 (square the Sun), mars/venus = 190 (opposite it), Saturn alone 0.5° from opposite
    tree = mp.near(points, points["sun"], 1.0, exclude="sun")
    pairs = {(r["a"], r["b"]) for r in tree}
    assert ("moon", "mars") in pairs
    assert ("mars", "venus") in pairs
    assert ("saturn", None) in pairs
    assert all(r["orb"] <= 1.0 for r in tree)
    assert tree == sorted(tree, key=lambda r: r["orb"])


def test_sort_is_in_dial_order() -> None:
    rows = mp.sort({"sun": 10.0, "moon": 95.0, "mars": 200.0})
    dials = [r["dial"] for r in rows]
    assert dials == sorted(dials)
    assert len(rows) == 3 + 3


def test_endpoint(client: TestClient, ready: dict[str, str]) -> None:
    new = {"name": "Jane", "date": "1985-06-12", "time": "14:30", "place": "Perth"}
    chart = client.post("/api/v1/charts", json=new, headers=ready).json()
    url = f"/api/v1/charts/{chart['id']}/midpoints"
    body = client.get(url, params={"factor": "sun", "degree": 12.5, "orb": 2}).json()
    assert body["modulus"] == 90
    assert body["tree"]["factor"] == "sun"
    assert "search" in body
    assert "true_node" not in body["points"]  # off in Your view by default
    only = client.get(url, params={"bodies": "sun,moon,mars"}).json()
    assert len(only["sort"]) == 6
    assert client.get(url, params={"modulus": 45}).json()["modulus"] == 45
    assert client.get(url, params={"modulus": 50}).status_code == 422
    assert client.get(url, params={"factor": "earth"}).status_code == 422
