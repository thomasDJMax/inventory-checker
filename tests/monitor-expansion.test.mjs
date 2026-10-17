import test from "node:test";
import assert from "node:assert/strict";
import {
  MONITOR_EXPANSION_STORAGE_KEY,
  isMonitorGroupExpanded,
  parseMonitorExpansion,
} from "../src/lib/monitorExpansion.ts";

const mainlandKey = JSON.stringify(["zh_CN", "R359"]);
const hongKongKey = JSON.stringify(["zh_HK", "R359"]);

test("门店展开偏好使用独立且带版本的存储键", () => {
  assert.equal(MONITOR_EXPANSION_STORAGE_KEY, "apw.monitor.expansion.v1");
});

test("缺失、损坏和非对象存储安全返回空偏好", () => {
  for (const raw of [null, "", "{broken", "null", "[]", "true", "false", "123", '"text"']) {
    assert.deepEqual(parseMonitorExpansion(raw), {}, String(raw));
  }
});

test("混合存储只保留规范的地区门店键与布尔值，保留显式 false", () => {
  const raw = JSON.stringify({
    [mainlandKey]: false,
    [hongKongKey]: true,
    [JSON.stringify(["zh_CN", "R389"])]: "false",
    [JSON.stringify(["zh_CN", "R390"])]: null,
    [JSON.stringify(["zh_CN", "R391"])]: 1,
    "zh_CN|R359": true,
    '["zh_CN", "R359"]': true,
    '["zh_CN","R359","extra"]': true,
    '["zh_CN",359]': true,
    '["zh_CN",["R359"]]': true,
    '{"locale":"zh_CN","storeNumber":"R359"}': true,
    "null": true,
    "__proto__": true,
  });

  assert.deepEqual(parseMonitorExpansion(raw), { [mainlandKey]: false, [hongKongKey]: true });
});

test("同编号跨地区门店的偏好互不覆盖", () => {
  const preferences = parseMonitorExpansion(JSON.stringify({ [mainlandKey]: false, [hongKongKey]: true }));
  assert.equal(isMonitorGroupExpanded(mainlandKey, 2, preferences, false, {}), false);
  assert.equal(isMonitorGroupExpanded(hongKongKey, 0, preferences, false, {}), true);
});

test("首次显示有货门店默认展开，无货或尚无库存的门店默认折叠", () => {
  assert.equal(isMonitorGroupExpanded(mainlandKey, 1, {}, false, {}), true);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, {}, false, {}), false);
});

test("手动展开和折叠优先于后续库存变化", () => {
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, { [mainlandKey]: true }, false, {}), true);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 3, { [mainlandKey]: false }, false, {}), false);
});

test("搜索默认展开匹配门店，忽略平时的折叠偏好和库存数量", () => {
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, { [mainlandKey]: false }, true, {}), true);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, { [mainlandKey]: true }, true, {}), true);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 3, {}, true, {}), true);
});

test("搜索临时偏好支持展开及折叠，清除搜索后恢复平时状态", () => {
  const preferences = Object.freeze({ [mainlandKey]: false, [hongKongKey]: true });
  const searchPreferences = Object.freeze({ [mainlandKey]: true, [hongKongKey]: false });
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, preferences, true, searchPreferences), true);
  assert.equal(isMonitorGroupExpanded(hongKongKey, 2, preferences, true, searchPreferences), false);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 2, preferences, false, searchPreferences), false);
  assert.equal(isMonitorGroupExpanded(hongKongKey, 0, preferences, false, searchPreferences), true);
  assert.equal(isMonitorGroupExpanded(hongKongKey, 0, preferences, true, {}), true);
});

test("忽略继承的偏好并且不修改冻结输入", () => {
  const preferences = Object.freeze({ [mainlandKey]: false });
  const searchPreferences = Object.freeze({ [mainlandKey]: true });
  const inherited = Object.freeze(Object.create({ [mainlandKey]: false }));
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, preferences, true, searchPreferences), true);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 1, preferences, false, searchPreferences), false);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 1, inherited, false, {}), true);
  assert.equal(isMonitorGroupExpanded(mainlandKey, 0, {}, true, inherited), true);
  assert.deepEqual(preferences, { [mainlandKey]: false });
  assert.deepEqual(searchPreferences, { [mainlandKey]: true });
});
