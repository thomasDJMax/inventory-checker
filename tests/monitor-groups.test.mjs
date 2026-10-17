import test from "node:test";
import assert from "node:assert/strict";
import { groupMonitorRows } from "../src/lib/monitorGroups.ts";
import { filterMonitorRows } from "../src/lib/monitorFilter.ts";
import { isUntrusted } from "../src/lib/types.ts";

function row(overrides = {}, availability = { kind: "unknown", reason: "not_yet_checked" }) {
  return Object.freeze({
    target: Object.freeze({
      locale: "zh_CN",
      storeNumber: "R359",
      storeTitle: "上海-南京东路",
      partNumber: "PHONE-A",
      productName: "iPhone 17 Pro 256GB",
      ...overrides,
    }),
    availability: Object.freeze(availability),
    lastCheckedMs: null,
    consecutiveFailures: 0,
  });
}

test("同地区同门店的型号归为一组，使用首条门店名称", () => {
  const first = row();
  const second = row({ partNumber: "PHONE-B", productName: "iPhone 17 Pro 512GB", storeTitle: "南京东路" });
  const groups = groupMonitorRows([first, second]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, JSON.stringify(["zh_CN", "R359"]));
  assert.equal(groups[0].locale, "zh_CN");
  assert.equal(groups[0].storeNumber, "R359");
  assert.equal(groups[0].storeTitle, "上海-南京东路");
  assert.deepEqual(groups[0].rows, [first, second]);
});

test("同名不同门店编号和跨地区的相同编号保持独立", () => {
  const first = row();
  const otherStore = row({ storeNumber: "R389" });
  const otherRegion = row({ locale: "zh_HK" });
  const groups = groupMonitorRows([first, otherStore, otherRegion]);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.key)).size, 3);
  assert.deepEqual(groups.map((group) => group.rows), [[first], [otherStore], [otherRegion]]);
});

test("地区和门店编号中的分隔符不会造成分组键碰撞", () => {
  const first = row({ locale: "a|b", storeNumber: "c" });
  const second = row({ locale: "a", storeNumber: "b|c" });
  assert.equal(groupMonitorRows([first, second]).length, 2);
});

test("保持门店首次出现顺序、组内行顺序及原行引用，不修改冻结输入", () => {
  const first = row({ storeNumber: "R389", storeTitle: "上海-浦东" });
  const second = row();
  const third = row({ storeNumber: "R389", storeTitle: "上海-浦东", partNumber: "PHONE-B" });
  const fourth = row({ partNumber: "PHONE-C" });
  const input = Object.freeze([first, second, third, fourth]);
  const groups = groupMonitorRows(input);
  assert.deepEqual(groups.map((group) => group.storeNumber), ["R389", "R359"]);
  assert.equal(groups[0].rows[0], first);
  assert.equal(groups[0].rows[1], third);
  assert.equal(groups[1].rows[0], second);
  assert.equal(groups[1].rows[1], fourth);
  assert.deepEqual(input, [first, second, third, fourth]);
  assert.notEqual(groups[0].rows, input);
});

test("有货、无货、待确认和查询异常分别计数，未知原因不会被视为无货", () => {
  const groups = groupMonitorRows([
    row({}, { kind: "in_stock" }),
    row({}, { kind: "in_stock" }),
    row({}, { kind: "out_of_stock" }),
    row({}, { kind: "unknown", reason: "not_yet_checked" }),
    row({}, { kind: "unknown", reason: "pickup_pending" }),
    row({}, { kind: "unknown", reason: "blocked", detail: "HTTP 403" }),
    row({}, { kind: "unknown", reason: "store_pickup_unavailable", store_number: "R359" }),
  ]);
  assert.deepEqual(groups[0].counts, { inStock: 2, unavailable: 1, pending: 3, unconfirmed: 1 });
});

test("所有未知原因的待确认及查询异常分类与全局 isUntrusted 语义一致", () => {
  const cases = [
    [{ kind: "unknown", reason: "not_yet_checked" }, false],
    [{ kind: "unknown", reason: "pickup_pending" }, false],
    [{ kind: "unknown", reason: "store_pickup_unavailable", store_number: "R359" }, false],
    [{ kind: "unknown", reason: "browser_unavailable", detail: "未连接浏览器" }, true],
    [{ kind: "unknown", reason: "blocked", detail: "HTTP 403" }, true],
    [{ kind: "unknown", reason: "rate_limited" }, true],
    [{ kind: "unknown", reason: "cooling_down", remaining_seconds: 30, detail: "稍后重试" }, true],
    [{ kind: "unknown", reason: "schema_drift", field: "stores", raw: "null" }, true],
    [{ kind: "unknown", reason: "no_pickup_data", store_number: "R359" }, true],
    [{ kind: "unknown", reason: "product_not_returned", part_number: "PHONE-A" }, true],
    [{ kind: "unknown", reason: "apple_error", message: "服务不可用" }, true],
    [{ kind: "unknown", reason: "transport", detail: "timeout" }, true],
  ];

  for (const [availability, untrusted] of cases) {
    assert.equal(isUntrusted(availability), untrusted, availability.reason);
    assert.deepEqual(groupMonitorRows([row({}, availability)])[0].counts, {
      inStock: 0,
      unavailable: 0,
      pending: untrusted ? 0 : 1,
      unconfirmed: untrusted ? 1 : 0,
    }, availability.reason);
  }

  const rows = cases.map(([availability]) => row({}, availability));
  const { counts } = groupMonitorRows(rows)[0];
  assert.deepEqual(counts, { inStock: 0, unavailable: 0, pending: 3, unconfirmed: 9 });
  assert.equal(counts.unconfirmed, rows.filter(({ availability }) => isUntrusted(availability)).length);
});

test("每家门店的库存计数彼此独立", () => {
  const groups = groupMonitorRows([
    row({}, { kind: "in_stock" }),
    row({ storeNumber: "R389" }, { kind: "out_of_stock" }),
    row({}, { kind: "unknown", reason: "transport", detail: "timeout" }),
  ]);
  assert.deepEqual(groups.map((group) => group.counts), [
    { inStock: 1, unavailable: 0, pending: 0, unconfirmed: 1 },
    { inStock: 0, unavailable: 1, pending: 0, unconfirmed: 0 },
  ]);
});

test("查找后只分组并统计可见型号，隐藏的门店不保留空组", () => {
  const matching = row({}, { kind: "in_stock" });
  const input = Object.freeze([
    matching,
    row({ partNumber: "WATCH-A", productName: "Apple Watch Ultra 4" }, { kind: "out_of_stock" }),
    row({ storeNumber: "R389", partNumber: "IPAD-A", productName: "iPad Pro" }),
  ]);
  const filtered = filterMonitorRows(input, "iPhone");
  const groups = groupMonitorRows(filtered);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 1);
  assert.equal(groups[0].rows[0], matching);
  assert.deepEqual(groups[0].counts, { inStock: 1, unavailable: 0, pending: 0, unconfirmed: 0 });
  assert.equal(input.length, 3);
});

test("空输入和无匹配筛选结果没有门店分组", () => {
  assert.deepEqual(groupMonitorRows(Object.freeze([])), []);
  assert.deepEqual(groupMonitorRows(filterMonitorRows([row()], "不存在的型号")), []);
});

test("重复调用创建独立的分组和计数，保留原行引用", () => {
  const first = row({}, { kind: "in_stock" });
  const previous = groupMonitorRows([first]);
  const next = groupMonitorRows([first]);
  assert.notEqual(previous, next);
  assert.notEqual(previous[0], next[0]);
  assert.notEqual(previous[0].rows, next[0].rows);
  assert.notEqual(previous[0].counts, next[0].counts);
  assert.equal(previous[0].rows[0], next[0].rows[0]);
  assert.deepEqual(next[0].counts, { inStock: 1, unavailable: 0, pending: 0, unconfirmed: 0 });
});
