# Install Scrubarr

This guide gives copy-and-paste install steps for a normal Docker install.

You need:

- Docker installed on the machine that will run Scrubarr.
- Emby or Jellyfin already running.
- Radarr and Sonarr already running.
- API keys for the services you want Scrubarr to use.
- A folder where Scrubarr can store its settings, logs, backups, and Leaving
  Soon queue files.

## Windows Docker Install

Use this when Docker is running on Windows. Scrubarr itself runs in Docker, even
though Emby or Jellyfin may be installed directly on Windows.

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
         - D:/Scrubarr/Leaving Soon/Movies:/queue/movies
         - D:/Scrubarr/Leaving Soon/Shows:/queue/series
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

5. Change the two `D:/Scrubarr/Leaving Soon/...` volume paths if you want the
   Leaving Soon queue folders somewhere else.

   These are example Windows paths. They must point to folders that your
   Windows-installed Emby or Jellyfin server can read.

   Keep the `:/queue/movies` and `:/queue/series` parts at the end. Those are
   the paths Scrubarr uses inside Docker.

   In Scrubarr settings, set **Leaving Soon queue root path** to the matching
   Windows parent folder:

   ```text
   D:\Scrubarr\Leaving Soon
   ```

6. Start Scrubarr:

   ```powershell
   docker compose up -d
   ```

7. Open Scrubarr:

   ```text
   http://localhost:8098
   ```

## Linux Docker Install

Use this when Docker is running on Linux. Scrubarr itself runs in Docker.

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

5. Check the Leaving Soon queue folders.

   With the default Linux example, the host folders are:

   ```text
   /opt/scrubarr/leaving-soon/movies
   /opt/scrubarr/leaving-soon/series
   ```

   If Emby or Jellyfin can read those host paths, set **Leaving Soon queue root
   path** in Scrubarr settings to:

   ```text
   /opt/scrubarr/leaving-soon
   ```

   If Emby or Jellyfin also runs in Docker, mount the same host folders into the
   media-server container and use the paths that media-server container sees.
   See [Leaving Soon Queue Folders](#leaving-soon-queue-folders).

6. Start Scrubarr:

   ```bash
   docker compose up -d
   ```

7. Open Scrubarr:

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

You need two matching paths for the same real folders:

1. The **Docker volume path** tells the Scrubarr container where it can write the
   `.strm` files.
2. The **Leaving Soon queue root path** in Scrubarr settings tells Emby or
   Jellyfin where it can read those same files.

If these do not point to the same real location, Scrubarr may create `.strm`
files successfully, but the Leaving Soon libraries can appear empty.

If Emby or Jellyfin is installed directly on Windows, use absolute Windows paths
in the Windows Docker install example and change them to suit your system.

### Example: media server installed directly on Windows

Use this when Emby or Jellyfin is installed directly on Windows and its
libraries point to Windows paths.

Create a folder on the Windows host, for example:

```text
D:\Scrubarr\Leaving Soon
```

Set the Scrubarr Docker volume paths to use that folder:

```yaml
volumes:
  - D:/Scrubarr/Leaving Soon/Movies:/queue/movies
  - D:/Scrubarr/Leaving Soon/Shows:/queue/series
```

In each line, the path on the left is the Windows folder. The path on the right
is only the path inside the Scrubarr Docker container.

In Scrubarr settings, set **Leaving Soon queue root path** to:

```text
D:\Scrubarr\Leaving Soon
```

Scrubarr will create:

```text
D:\Scrubarr\Leaving Soon\Movies
D:\Scrubarr\Leaving Soon\Shows
```

Emby or Jellyfin will then scan those Windows folders as the Leaving Soon
libraries. Do not use `/queue/movies` or `/queue/series` in Emby/Jellyfin when
the media server is installed directly on Windows; those paths only exist inside
the Scrubarr container.

### Example: media server running in Docker

Use this when Emby or Jellyfin is also running in Docker and its libraries point
to paths inside that media-server container.

Mount the same host folder into both containers. The folder can have a different
path inside each container, but it must still be the same real folder on the
host.

For example:

```text
Host folder:         /srv/scrubarr/leaving-soon/movies
Scrubarr sees:       /queue/movies
Emby/Jellyfin sees:  /media/leaving-soon/movies
```

And for series:

```text
Host folder:         /srv/scrubarr/leaving-soon/series
Scrubarr sees:       /queue/series
Emby/Jellyfin sees:  /media/leaving-soon/series
```

In Scrubarr settings, set **Leaving Soon queue root path** to the path the media
server container sees:

```text
/media/leaving-soon
```

Scrubarr writes the files through its own Docker mounts, but it tells Emby or
Jellyfin to scan the paths visible inside the media-server container.

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

## Reset Built-In Basic Authentication

If you forget the built-in Scrubarr username or password, you can temporarily
turn basic authentication off from the mounted config file.

Only do this from a trusted network. While basic authentication is disabled,
anyone who can reach Scrubarr can access it unless you have external
authentication in front of it.

1. Stop Scrubarr:

   ```bash
   docker compose stop scrubarr
   ```

2. Open the Scrubarr config file in your mounted data folder.

   With the example installs, this is usually:

   ```text
   Windows Docker install: C:\ProgramData\Scrubarr\data\config.json
   Linux Docker install:   /opt/scrubarr/data/config.json
   ```

   If you changed the data volume path, open `config.json` from that custom data
   folder instead.

3. Find the `Auth` section and change only `Enabled` to `false`:

   ```json
   "Auth": {
     "Enabled": false,
     "Username": "admin",
     "PasswordHash": "..."
   }
   ```

4. Start Scrubarr again:

   ```bash
   docker compose up -d scrubarr
   ```

5. Open Scrubarr, go to **Settings > Access control**, set a new username and
   password, enable basic authentication, and save settings.

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
