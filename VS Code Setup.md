# Working on AstrologyStudio

This guide gets you from a fresh clone to running AstrologyStudio under the debugger. It works
the same way as every Studio app: open the folder and press **F5**.
For installing AstrologyStudio on a server, see [install/](install/README.md); for using it,
see the [user guide](docs/user-guide.md); for the API, see [server/README.md](server/README.md).

## What you need

- **Python 3.12** or newer. On Windows, tick *Add python.exe to PATH* when installing.
- **Node 22** or newer (for building the web app).
- **Git**.
- **VS Code**, with the extensions it recommends.
- **An ephemeralREST server and API key.** Every chart is calculated and stored there.
- **Docker** is optional: only for building the image.

## Getting started

1. Unzip, and open the `astrologystudio` folder in VS Code (the one that contains `server`,
   `web` and `.vscode`). Trust the folder when asked.
2. Install the extensions VS Code recommends: **Python**, **Python Debugger** and **Ruff**
   (it offers them in a pop-up; or Extensions view → search `@recommended`).
3. Press **F5**.

The first F5 makes the Python environment in `.venv`, installs the server with its development
tools, and installs the web app's packages: a minute or two, shown in the Terminal panel. After
that, F5 checks in about a second and goes straight on. It reinstalls by itself when
`server/pyproject.toml` or `web/package-lock.json` changes. (F5 runs `scripts/dev.mjs`, which
runs `scripts/dev_setup.py` and then the server. It's a Node script because VS Code can always
run Node, whereas the Python debugger won't start until `.venv` exists.)

## Running and debugging

F5 runs the configuration selected in **Run and Debug** (Ctrl+Shift+D), which is
**AstrologyStudio** unless you pick another.

The server builds the web app, starts, and opens **http://localhost:8100** in your browser.
Everything it prints, including the web build (lines starting `[web]`), appears in the
**Debug Console**. There's no other terminal to watch. A fresh install asks you to create
the owner account; then enter the ephemeralREST address in **Settings** and your API key on
**Your account**.

| Configuration | What it does |
| --- | --- |
| **AstrologyStudio** | The whole app, opened in your usual browser. Sets things up first if needed. |
| **Server (Python breakpoints)** | The same, under the Python debugger, so breakpoints in `server/` work. Use it once the first F5 has made `.venv`. |
| **Server + debug the web app in Edge** | The same, but opens Edge with VS Code attached, so breakpoints in `web/src` work too. |
| **Tests: this file** | Runs the open test file under the debugger. |

- Web changes rebuild as you save: refresh the browser.
- Python changes need a restart: the green circular arrow in the debug toolbar (**Ctrl+Shift+F5**).
- To stop: the red square (**Shift+F5**). The web build stops with the server.
- Local data (the database, the secret key that encrypts API keys, and backups) lives in
  `./data`, which Git ignores. Stop the server and delete that folder for a fresh start.
  Your charts aren't there: they're in ephemeralREST.

### ephemeralREST address

Either enter it in **Settings** once you've signed in (it's kept in `./data`), or set
`ASTROLOGYSTUDIO_EPHEMERAL_URL` in your environment before starting VS Code, and F5 passes it on.

### Ports

Each Studio app has its own port in VS Code, so they can all run at once:
MailStudio 8080, LedgerStudio 8090, **AstrologyStudio 8100**, FormStudio 8110. To change it for
F5, set `ASTROLOGYSTUDIO_PORT` in your environment before starting VS Code; for the Server
configurations, edit `8100` in `.vscode/launch.json` (the `--port` argument and
`ASTROLOGYSTUDIO_BASE_URL`).

### Without VS Code

```sh
ASTROLOGYSTUDIO_WEB_WATCH=1 .venv/bin/astrologystudio serve --port 8100   # Windows: see below
```

On Windows PowerShell: `$env:ASTROLOGYSTUDIO_WEB_WATCH=1; .venv\Scripts\astrologystudio serve --port 8100`.

`astrologystudio --help` lists the other commands: `migrate`, `backup` and `reset-password`.

### Settings for local runs

| Variable | Default | Meaning |
| --- | --- | --- |
| `ASTROLOGYSTUDIO_DATA_DIR` | `./data` | Database, secret key and backups |
| `ASTROLOGYSTUDIO_BASE_URL` | `http://localhost:8080` | The public address of the install |
| `ASTROLOGYSTUDIO_EPHEMERAL_URL` | *(empty)* | ephemeralREST address until one is set in Settings |
| `ASTROLOGYSTUDIO_WEB_DIR` | `web/dist` in the repository | The built web app |
| `ASTROLOGYSTUDIO_TRUSTED_PROXIES` | `127.0.0.1` | Proxies whose `X-Forwarded-For` is trusted |

The VS Code configurations set the first three, plus `ASTROLOGYSTUDIO_WEB_WATCH=1`, which
makes the server build the web app and rebuild it on save (for development only).

## Checks and tests

Everything below runs on GitHub for every push. Run it locally first with
**Terminal → Run Task… → check: everything (as on GitHub)**, or:

```sh
cd server
ruff check . && ruff format --check .
mypy astrologystudio
pytest -q
cd ../web
npm run typecheck && npm run build
```

- The **Testing** view (beaker icon) lists every test, to run or debug one at a time.
- Ruff formats Python on save.
- Tests use a fake ephemeralREST (`server/tests/fake_ephemeral.py`), so they never need a real server.

## When something goes wrong

| Problem | Fix |
| --- | --- |
| *Debug Stopped* with *Open 'launch.json'* | Choose **AstrologyStudio** in Run and Debug, not a Server configuration, for the first run. |
| *No module named astrologystudio* | The setup step didn't finish: look in the Terminal panel for why, fix it, and press F5 again. To force a full reinstall, delete the `.venv` folder. |
| *Python 3.12 or newer* / *Node.js isn't installed* | Install it, restart VS Code so it sees the new PATH, and press F5 again. |
| *Address already in use* | Something else has port 8100. Stop it, or change the port as above. |
| The page is blank, or says the web app hasn't been built | Look for `[web]` lines with `[ERROR]` in the Debug Console. If it says to run the setup task, do that. |
| Changes don't show | Refresh with Ctrl+F5, which bypasses the cache. |
| VS Code doesn't list the AstrologyStudio tasks | You opened the wrong folder: it must contain `.vscode`. Then Developer: Reload Window. |
| Charts don't load | Check the ephemeralREST address in Settings and your API key on Your account. |
| *Python was not found* (Windows) | Install Python 3.12+ from python.org with *Add to PATH* ticked, and turn off the `python.exe` App execution alias in Windows settings. |
