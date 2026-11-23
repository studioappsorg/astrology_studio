# AstrologyStudio server

The API and the web app's server: Python 3.12, FastAPI and SQLite. Every calculation
and every chart lives in [ephemeralREST](https://github.com/gmelh/ephemeralREST); this
server keeps people, sessions, each person's ephemeralREST key (encrypted) and their
display preferences, and works out aspects, midpoints and the other chart arithmetic.

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
astrologystudio serve            # http://localhost:8080, API docs at /api/docs
pytest -q && ruff check . && ruff format --check . && mypy astrologystudio
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `ASTROLOGYSTUDIO_DATA_DIR` | `./data` | Database, secret key and backups |
| `ASTROLOGYSTUDIO_BASE_URL` | `http://localhost:8080` | Public address of the install |
| `ASTROLOGYSTUDIO_EPHEMERAL_URL` | *(empty)* | ephemeralREST address until one is set in Settings |
| `ASTROLOGYSTUDIO_WEB_DIR` | `../web/dist` | The built web app |
