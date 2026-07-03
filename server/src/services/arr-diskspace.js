import { fetchExternal } from "./external-error.js";

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function fetchDiskSpace(name, config) {
  if (!config?.Enabled) {
    return { enabled: false, disks: [], warnings: [] };
  }

  if (!config.Url || !config.ApiKey) {
    return {
      enabled: true,
      disks: [],
      warnings: [`${name} disk space unavailable: missing URL or API key.`],
    };
  }

  try {
    const response = await fetchExternal({
      service: name,
      operation: "disk space",
      url: `${trimUrl(config.Url)}/api/v3/diskspace`,
      timeoutMs: 10000,
      options: {
        headers: { "X-Api-Key": config.ApiKey },
      },
    });

    const data = await response.json();
    return {
      enabled: true,
      disks: Array.isArray(data)
        ? data.map((disk) => ({
            ...disk,
            source: name,
          }))
        : [],
      warnings: [],
    };
  } catch (error) {
    return {
      enabled: true,
      disks: [],
      warnings: [`${name} disk space unavailable: ${error.message}`],
    };
  }
}

export async function getArrDiskSpace(settings) {
  const [radarr, sonarr] = await Promise.all([
    fetchDiskSpace("Radarr", settings?.Radarr),
    fetchDiskSpace("Sonarr", settings?.Sonarr),
  ]);

  return {
    enabled: radarr.enabled || sonarr.enabled,
    disks: [...radarr.disks, ...sonarr.disks],
    warnings: [...radarr.warnings, ...sonarr.warnings],
  };
}
