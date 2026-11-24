# The build server (optional)

> **Not used by default since 1.21.6.** Releases are now built by GitHub Actions and published to
> `ghcr.io/studioappsorg/astrologystudio`, which is what the installer uses. This build server is
> kept for anyone who'd rather build and host the image themselves; installs then use
> `--image registry.example.com/astrologystudio:latest`.

An Ubuntu server that builds the AstrologyStudio image and keeps it in its own registry.
Every install pulls the image from there: the installer on first install, and
`astrologystudio update` after that.

```
 your PC ──git push──▶  GitHub   ──git fetch──▶ build server ──docker pull──▶ installs
                                                  (builds, publishes to
                                                   registry.getstudioapps.com)
```

## What it runs

- **A container registry** (`registry:2`) holding the images, with **Caddy** in front for HTTPS.
- **Read-only from outside.** Anyone can pull; nothing can be pushed through the public address.
  The build server pushes straight to the registry on `127.0.0.1:5000`, so there are no push
  passwords to manage or leak.
- **`studio-build`**, the command that builds and publishes a release.
- **Optionally, a timer** that checks for new release tags every 10 minutes and builds them.

## Setting it up (once)

1. **A small Ubuntu server** (2 vCPU and 4 GB is comfortable for building; 1 vCPU and 2 GB
   works, just more slowly) with ports 80 and 443 free.
2. **DNS:** an A record for the registry's address, e.g. `registry.getstudioapps.com`, pointing
   at it. In Cloudflare, set it to **DNS only** (grey cloud). Caddy then gets its certificate
   directly, and the large image downloads go straight to the server.
3. **Read access to the code.** The repository is public, so nothing is needed. For a private
   copy over SSH, make a key with `sudo ssh-keygen -t ed25519` and add `/root/.ssh/id_ed25519.pub`
   to the repository as a read-only **deploy key**.
4. **Copy this folder to the server and run:**

   ```sh
   sudo bash setup.sh --domain registry.getstudioapps.com --email you@example.com --watch
   ```

   Leave out `--watch` if you'd rather build by hand. `--git URL` changes where the code is
   cloned from (the default is `https://github.com/studioappsorg/astrology_studio.git`), and
   `--keep N` sets how many versions the registry keeps (default 10).

## Releasing

1. **Bump the version** in the code (as each release already does): it's read from
   `server/astrologystudio/__init__.py`, and an already-published version isn't replaced unless
   you say `--force`.
2. Then either:
   - **Tag it and push the tag** (with `--watch` on): `git tag v1.16.0 && git push origin v1.16.0`.
     Within 10 minutes the build server builds and publishes it. A tag whose version doesn't
     match `__init__.py` is refused, so a forgotten bump can't publish the wrong thing.
   - **Or build by hand** on the build server: `sudo studio-build release` builds `main`;
     `sudo studio-build release v1.16.0` builds that tag (or any branch or commit).

Each release is published as `1.16.0`, `1.16`, `1` and `latest`. Installs follow `latest`.

## Other commands

| Command | What it does |
|---|---|
| `studio-build list` | The versions in the registry |
| `studio-build prune` | Keep the newest versions (10 by default), delete the rest and free the disk space |
| `studio-build release REF --no-latest` | Publish a test build without moving `latest` |
| `journalctl -u studio-build` | What the automatic builds did |

## Pointing installs at it

The installer's default image is `ghcr.io/studioappsorg/astrologystudio:latest` (set at the
top of `install/install.sh`). To use this registry instead, install with
`--image registry.example.com/astrologystudio:latest`. An existing install can switch by editing
`ASTROLOGYSTUDIO_IMAGE` in `/opt/astrologystudio/.env`, then running `astrologystudio update`.

## Notes

- **Intel/AMD only.** The build server builds for the kind of processor it has (almost always
  x86-64), which is what most VPSs use. ARM servers would need a multi-platform build; ask if you
  need that.
- **Tests aren't run here.** Run the tests before tagging (as in VS Code). The build server
  builds and publishes whatever the tag points at.
- **Back up** the registry's `images` volume if you want old versions kept safe. Everything in it
  can be rebuilt from the tags, so it's optional.
- The GitHub workflow in `.github/workflows/release.yml` publishes to GHCR, which installs use by
  default.
