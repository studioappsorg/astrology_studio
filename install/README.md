# Installing AstrologyStudio

On a fresh Ubuntu or Debian server, with a domain pointed at it:

```sh
curl -fsSL https://astro.getstudioapps.com | sudo bash
```

AstrologyStudio runs behind the server's **shared Caddy** (the `studioapps` command, from
studio-edge), which every Studio app on the server uses. It holds ports 80 and 443 and gets each
app's certificate, so other Studio apps can be installed on the same server, in any order. New
installs go in `/opt/studioapps/astrologystudio`; an install from before 1.22.0 stays in
`/opt/astrologystudio`, and running the installer again moves it onto the shared Caddy.

Add `--ephemeral https://your-ephemeralrest-server` to set the ephemeralREST address
straight away, or enter it in Settings after creating the owner account. Run with
`--help` for every option. Running it again keeps your data and updates the setup.

The installer adds an `astrologystudio` command: `status`, `logs`, `update`, `backup`,
`restore`, `restart`, `reset-password` and `version`. A backup holds the database and
the secret key that encrypts everyone's stored ephemeralREST keys; keep them together.
`studioapps sites` lists what the shared Caddy serves, and `astrologystudio logs caddy` follows
its log.

## The shared Caddy's script

The installer pins the version of studio-edge's `edge.sh` it was tested with (`EDGE_VERSION` and
`EDGE_SHA256` near its top) and downloads it from `https://getstudioapps.com/edge/`. To move to a
newer one, run the server test below with it, then change both values.

## Testing the installer

`install/server-test.sh` runs the real installer against Docker and the shared Caddy. It takes
over ports 80 and 443, `/opt/studioapps` and `/opt/astrologystudio`, so run it only on a
throwaway VM, as root:

```sh
sudo install/server-test.sh --edge-script ../studio-edge/edge.sh --i-understand
```

The image is `ghcr.io/studioappsorg/astrologystudio`, built for Intel/AMD and ARM servers and
published by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed:

```sh
git tag -a v1.21.6 -m 1.21.6 && git push origin v1.21.6
```

Each release is tagged `1.21.6`, `1.21`, `1` and `latest`; installs follow `latest`. The same
workflow attaches `install.sh` to the GitHub release.
