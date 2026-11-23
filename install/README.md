# Installing AstrologyStudio

On a fresh Ubuntu or Debian server, with a domain pointed at it:

```sh
curl -fsSL https://get.getstudioapps.com/astrologystudio | sudo bash
```

Add `--ephemeral https://your-ephemeralrest-server` to set the ephemeralREST address
straight away, or enter it in Settings after creating the owner account. Run with
`--help` for every option. Running it again keeps your data and updates the setup.

The installer adds an `astrologystudio` command: `status`, `logs`, `update`, `backup`,
`restore`, `restart`, `reset-password` and `version`. A backup holds the database and
the secret key that encrypts everyone's stored ephemeralREST keys; keep them together.

The image comes from the build server's registry (`registry.getstudioapps.com`); see
`deploy/build-server/README.md` for how releases are built and published.
