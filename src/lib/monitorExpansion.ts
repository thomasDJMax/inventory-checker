export type MonitorExpansionPreferences = Record<string, boolean>;

export const MONITOR_EXPANSION_STORAGE_KEY = "apw.monitor.expansion.v1";

/** 分组键必须与 JSON.stringify([locale, storeNumber]) 的输出一致。 */
function isMonitorGroupKey(key: string): boolean {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value)
      && value.length === 2
      && value.every((part) => typeof part === "string")
      && JSON.stringify(value) === key;
  } catch {
    return false;
  }
}

/** 忽略损坏或过期的记录，不让本地显示偏好阻止监控列表渲染。 */
export function parseMonitorExpansion(raw: string | null): MonitorExpansionPreferences {
  if (raw === null) return {};

  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};

    const preferences: MonitorExpansionPreferences = {};
    for (const [key, expanded] of Object.entries(value)) {
      if (typeof expanded === "boolean" && isMonitorGroupKey(key)) {
        preferences[key] = expanded;
      }
    }
    return preferences;
  } catch {
    return {};
  }
}

/** 搜索期间单独维护临时偏好，清除搜索即可恢复平时的折叠状态。 */
export function isMonitorGroupExpanded(
  key: string,
  inStockCount: number,
  preferences: Readonly<MonitorExpansionPreferences>,
  searching: boolean,
  searchPreferences: Readonly<MonitorExpansionPreferences>,
): boolean {
  const activePreferences = searching ? searchPreferences : preferences;
  if (Object.prototype.hasOwnProperty.call(activePreferences, key)) {
    const expanded = activePreferences[key];
    if (typeof expanded === "boolean") return expanded;
  }

  return searching || inStockCount > 0;
}
