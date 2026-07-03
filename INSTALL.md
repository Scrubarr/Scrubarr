# Install Scrubarr

This guide gives copy-and-paste install steps for a normal Docker install.

You need:

- Docker installed on the machine that will run Scrubarr.
- Emby or Jellyfin already running.
- Radarr and Sonarr already running.
- API keys for the services you want Scrubarr to use.
- A folder where Scrubarr can store its settings, logs, backups, and Leaving
  Soon queue files.

If Scrubarr is still being shared privately, you may need to sign in to GitHub
Container Registry first:

```bash
docker login ghcr.io
```

Use your GitHub username and a token with package read access. If the package is
public, this step is not needed.

## Windows Install

1. Create the Scrubarr folder:

   ```powershell
   mkdir C:\ProgramData\Scrubarr
   cd C:\ProgramData\Scrubarr
   ```

2. Create a file named `docker-compose.yml` in that folder.

3. Paste this into `docker-compose.yml`:

   ```yaml
   name: scrubarr

   services:
     scrubarr:
       image: ghcr.io/scrubarr/scrubarr:v1.0.0
       restart: unless-stopped
       ports:
         - "8098:8098"
       environment:
         SCRUBARR_HOST: 0.0.0.0
         SCRUBARR_PORT: 8098
         SCRUBARR_DATA_DIR: /data
         SCRUBARR_LOG_DIR: /logs
         SCRUBARR_BACKUP_DIR: /data/backups
         SCRUBARR_TIMEZONE: Etc/UTC
         SCRUBARR_UPDATE_MANIFEST_URL: https://scrubarr.github.io/updates/stable.json
         SCRUBARR_MOVIE_QUEUE_WRITE_PATH: /queue/movies
         SCRUBARR_SERIES_QUEUE_WRITE_PATH: /queue/series
       volumes:
         - ./data:/data
         - ./logs:/logs
         - ./leaving-soon/movies:/queue/movies
         - ./leaving-soon/series:/queue/series
       healthcheck:
         test:
           [
             "CMD",
             "node",
             "-e",
             "fetch('http://127.0.0.1:8098/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))",
           ]
         interval: 30s
         timeout: 5s
         retries: 3
         start_period: 20s
   ```

4. Change `SCRUBARR_TIMEZONE` to your local timezone.

   Examples: `Pacific/Auckland`, `Europe/London`, `America/New_York`.

   Docker containers do not always detect the host timezone correctly, so set
   this value explicitly.

5. Start Scrubarr:

   ```powershell
   docker compose up -d
   ```

6. Open Scrubarr:

   ```text
   http://localhost:8098
   ```

## Linux Install

1. Create the Scrubarr folder:

   ```bash
   sudo mkdir -p /opt/scrubarr
   sudo chown "$USER":"$USER" /opt/scrubarr
   cd /opt/scrubarr
   ```

2. Create a file named `docker-compose.yml`.

3. Paste this into `docker-compose.yml`:

   ```yaml
   name: scrubarr

   services:
     scrubarr:
       image: ghcr.io/scrubarr/scrubarr:v1.0.0
       restart: unless-stopped
       ports:
         - "8098:8098"
       environment:
         SCRUBARR_HOST: 0.0.0.0
         SCRUBARR_PORT: 8098
         SCRUBARR_DATA_DIR: /data
         SCRUBARR_LOG_DIR: /logs
         SCRUBARR_BACKUP_DIR: /data/backups
         SCRUBARR_TIMEZONE: Etc/UTC
         SCRUBARR_UPDATE_MANIFEST_URL: https://scrubarr.github.io/updates/stable.json
         SCRUBARR_MOVIE_QUEUE_WRITE_PATH: /queue/movies
         SCRUBARR_SERIES_QUEUE_WRITE_PATH: /queue/series
       volumes:
         - ./data:/data
         - ./logs:/logs
         - ./leaving-soon/movies:/queue/movies
         - ./leaving-soon/series:/queue/series
       healthcheck:
         test:
           [
             "CMD",
             "node",
             "-e",
             "fetch('http://127.0.0.1:8098/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))",
           ]
         interval: 30s
         timeout: 5s
         retries: 3
         start_period: 20s
   ```

4. Change `SCRUBARR_TIMEZONE` to your local timezone.

   Examples: `Pacific/Auckland`, `Europe/London`, `America/New_York`.

   Docker containers do not always detect the host timezone correctly, so set
   this value explicitly.

5. Start Scrubarr:

   ```bash
   docker compose up -d
   ```

6. Open Scrubarr:

   ```text
   http://your-server-ip:8098
   ```

## First Setup

1. Open Scrubarr.
2. Go to **Settings**.
3. Choose **Emby** or **Jellyfin**.

   This selection locks the Scrubarr install to that media server type.

4. Add the media server URL and API key.
5. Click **Test connection**.
6. Select the media libraries Scrubarr should scan.
7. Select the media users Scrubarr should check for watch history.
8. Add Radarr and Sonarr URLs and API keys.
9. Click **Test connection** for Radarr and Sonarr.
10. Configure the Leaving Soon queue root path if you want a custom location.
11. Optional: configure Telegram notifications.
12. Go to **Cleanup Rules** and review the rules.
13. Keep **Preview only mode** enabled.
14. Run a preview scan.
15. Review pending items, exclusions, Leaving Soon libraries, and logs.
16. Enable scheduled runs only when everything looks correct.

## Service URLs

Enter full URLs including `http://` or `https://` and the port.

Common examples:

```text
Emby:     http://host.docker.internal:8096
Jellyfin: http://host.docker.internal:8096
Radarr:   http://host.docker.internal:7878
Sonarr:   http://host.docker.internal:8989
```

If `host.docker.internal` does not work, use the server LAN IP instead:

```text
http://192.168.0.10:8096
```

## Leaving Soon Queue Folders

Scrubarr writes `.strm` files into queue folders. Emby or Jellyfin reads those
folders as Leaving Soon libraries.

The default Docker folders are:

```text
./leaving-soon/movies
./leaving-soon/series
```

For a simple install, keep the defaults.

If Emby or Jellyfin runs outside the Scrubarr container, make sure the media
server can read the same queue folders. The paths shown inside Scrubarr must be
paths the media server can access.

The `.strm` files point back to the original media files. The original media
paths must also be playable by Emby or Jellyfin.

## Telegram Notifications

Telegram is optional.

To create a bot:

1. Open Telegram.
2. Start a chat with [@BotFather](https://t.me/BotFather).
3. Send `/newbot`.
4. Follow the prompts.
5. Copy the bot token.
6. Paste the token into **Settings > Telegram > Bot token**.
7. Start a chat with the new bot and send it any message.
8. To get the chat ID, message [@RawDataBot](https://t.me/RawDataBot) and copy
   the `chat.id` value.
9. Paste the chat ID into **Settings > Telegram > Chat ID**.
10. Click **Test connection**.
11. Click **Send test message**.

For a group or channel, add the Scrubarr bot to the chat first. You can
temporarily add RawDataBot to the same chat to read the group or channel ID,
then remove it again.

Keep the bot token private.

## Backups

Go to **Settings > Backup and restore**.

- **Export without secrets** is safest for diagnostics or sharing.
- **Export with secrets** includes API keys, Telegram token, and auth data.

Create a backup before changing major settings or updating Scrubarr.

## Updates

Scrubarr can check for signed updates and tell you when a newer Docker image is
available.

To update:

1. Open **Settings > About and updates**.
2. Click **Check for updates**.
3. Export a backup.
4. Disable scheduled runs while you test the update.
5. Change the image tag in `docker-compose.yml`.
6. Pull and recreate Scrubarr:

   ```bash
   docker compose pull scrubarr
   docker compose up -d --no-deps scrubarr
   ```

7. Open Scrubarr and check Settings, Scheduler, Logs, Safety, and Dashboard.
8. Re-enable scheduled runs when everything looks healthy.

Rollback uses the same steps with the previous image tag.
