import { isUntrusted, type TargetState } from "./types.ts";

export interface MonitorGroup {
  key: string;
  locale: string;
  storeNumber: string;
  storeTitle: string;
  rows: TargetState[];
  counts: {
    inStock: number;
    unavailable: number;
    /** 未查询、等待查询或门店暂停取货；不表示查询失败或无货。 */
    pending: number;
    /** 查询结果不可信，与全局未确认统计使用同一判定。 */
    unconfirmed: number;
  };
}

/** 按地区和门店编号分组；传入筛选后的行时，计数也只包含当前可见型号。 */
export function groupMonitorRows(rows: readonly TargetState[]): MonitorGroup[] {
  const groups = new Map<string, MonitorGroup>();

  for (const row of rows) {
    const { locale, storeNumber, storeTitle } = row.target;
    const key = JSON.stringify([locale, storeNumber]);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        locale,
        storeNumber,
        storeTitle,
        rows: [],
        counts: { inStock: 0, unavailable: 0, pending: 0, unconfirmed: 0 },
      };
      groups.set(key, group);
    }

    group.rows.push(row);
    switch (row.availability.kind) {
      case "in_stock":
        group.counts.inStock += 1;
        break;
      case "out_of_stock":
        group.counts.unavailable += 1;
        break;
      case "unknown":
        if (isUntrusted(row.availability)) {
          group.counts.unconfirmed += 1;
        } else {
          group.counts.pending += 1;
        }
        break;
    }
  }

  return [...groups.values()];
}
