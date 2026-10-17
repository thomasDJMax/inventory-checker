import type { Target } from "./types.ts";

type SearchableTarget = Pick<Target, "storeTitle" | "storeNumber" | "productName" | "partNumber"> &
  Partial<Pick<Target, "companionName">>;

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

/** 每个检索词须完整命中某个字段；多词可分别匹配门店、商品或表带。 */
export function filterMonitorRows<T extends { target: SearchableTarget }>(
  rows: readonly T[],
  query: string,
): readonly T[] {
  const terms = query.normalize("NFKC").trim().split(/\s+/u).filter(Boolean).map(normalizeSearchText);
  if (terms.length === 0) return rows;

  return rows.filter(({ target }) => {
    const fields = [
      target.storeTitle,
      target.storeNumber,
      target.productName,
      target.partNumber,
      target.companionName ?? "",
    ].map(normalizeSearchText);
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}
