# Security

Scrubarr can delete media through Radarr and Sonarr. Treat the web UI like an
admin tool.

This project is provided for personal use only. There are no guarantees,
warranties, support commitments, or promises that Scrubarr will behave correctly
in every environment. Review your own settings, backups, logs, pending queue,
and media-server behaviour before enabling live deletion.

## Internet Exposure

Do not expose Scrubarr directly to the internet without HTTPS and strong
authentication.

Built-in basic authentication is available, but it is intended as simple local
protection. For internet-facing access, put Scrubarr behind a reverse proxy,
VPN, or external access-control service you trust.

If you forget the built-in basic-auth password, see
[Reset Built-In Basic Authentication](INSTALL.md#reset-built-in-basic-authentication).

Recommended baseline:

- Use HTTPS.
- Use external authentication for internet-facing access.
- Limit Scrubarr to trusted networks where possible.
- Keep Preview only mode enabled until you have reviewed the queue and Leaving
  Soon libraries.
- Keep direct file deletion fallback disabled unless Arr deletion is not
  possible and you fully understand the filesystem risk.
- Store backups exported with secrets privately.

## Secrets

Scrubarr masks saved API keys, Telegram bot tokens, and basic-auth password
hashes in normal settings responses and backups exported without secrets.

Backups exported with secrets are for private migration or recovery only. They
include API keys, Telegram token, and the basic-auth password hash.

Do not share:

- backups exported with secrets
- app logs that you have not reviewed
- screenshots showing URLs, tokens, keys, or private hostnames
- update signing private keys

## Updates

Scrubarr trusts only the configured update manifest source. Official update
manifests are signed with an Ed25519 key, and Scrubarr verifies the signature
before trusting the version, release URL, or Docker image name.

Scrubarr should not be given access to the Docker socket. The update checker is
read-only; the admin applies Docker updates from the host machine.

## Public Endpoints

`/api/health` is intentionally public so Docker and reverse proxies can check
whether the container is alive.

Detailed app status, settings, logs, backups, scans, queue management, and
state-changing API routes are protected when Scrubarr basic authentication is
enabled.

## Reporting Issues

If you find a security issue, report it privately to the repository owner. Do
not open a public issue containing secrets, tokens, private URLs, or exploit
details.
