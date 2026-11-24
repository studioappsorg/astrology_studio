# Installing AstrologyStudio

On a fresh Ubuntu or Debian server, with a domain pointed at it:

```sh
curl -fsSL https://astro.getstudioapps.com | sudo bash
```

Add `--ephemeral https://your-ephemeralrest-server` to set the ephemeralREST address
straight away, or enter it in Settings after creating the owner account. Run with
`--help` for every option. Running it again keeps your data and updates the setup.

The installer adds an `astrologystudio` command: `status`, `logs`, `update`, `backup`,
`restore`, `restart`, `reset-password` and `version`. A backup holds the database and
the secret key that encrypts everyone's stored ephemeralREST keys; keep them together.

The image is `ghcr.io/studioappsorg/astrologystudio`, built for Intel/AMD and ARM servers and
published by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed:

```sh
git tag -a v1.21.6 -m 1.21.6 && git push origin v1.21.6
```

Each release is tagged `1.21.6`, `1.21`, `1` and `latest`; installs follow `latest`. The same
workflow attaches `install.sh` to the GitHub release.
