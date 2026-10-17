import test from "node:test";
import assert from "node:assert/strict";
import { filterMonitorRows } from "../src/lib/monitorFilter.ts";

const phone = Object.freeze({
  target: Object.freeze({
    storeTitle: "上海-南京东路",
    storeNumber: "R359",
    productName: "iPhone 17 Pro 256GB",
    partNumber: "MJTJ4CH/A",
  }),
});
const watch = Object.freeze({
  target: Object.freeze({
    storeTitle: "上海-浦东",
    storeNumber: "R389",
    productName: "Apple Watch Ultra 4",
    partNumber: "MKTJ4CH/A",
    companionName: "黑色钛金属米兰尼斯表带",
  }),
});
const secondPhone = Object.freeze({
  target: Object.freeze({
    ...phone.target,
    storeTitle: "无锡-恒隆广场",
    storeNumber: "R574",
  }),
});
const rows = Object.freeze([phone, watch, secondPhone]);

test("空查询和仅空白的查询返回原数组", () => {
  for (const query of ["", "   ", "\t\n", "　"]) {
    assert.equal(filterMonitorRows(rows, query), rows);
  }
});

test("全半角和英文字母大小写不影响匹配", () => {
  assert.deepEqual(filterMonitorRows(rows, "ＩＰＨＯＮＥ　ＰＲＯ"), [phone, secondPhone]);
  assert.deepEqual(filterMonitorRows(rows, "ｍｊｔｊ４ｃｈ／ａ"), [phone, secondPhone]);
});

test("多词需要全部命中，可以跨门店和商品字段匹配", () => {
  assert.deepEqual(filterMonitorRows(rows, "上海 iPhone Pro"), [phone]);
  assert.deepEqual(filterMonitorRows(rows, "上海 iPhone Ultra"), []);
});

test("检索词能忽略字段内的空白差异", () => {
  assert.deepEqual(filterMonitorRows(rows, "iphone17"), [phone, secondPhone]);
  assert.deepEqual(filterMonitorRows(rows, "watchultra4"), [watch]);
  assert.deepEqual(filterMonitorRows(rows, "iPhone 17"), [phone, secondPhone]);
});

test("门店编号和商品 SKU 都能独立或组合检索", () => {
  assert.deepEqual(filterMonitorRows(rows, "r359"), [phone]);
  assert.deepEqual(filterMonitorRows(rows, "MKTJ4CH/A"), [watch]);
  assert.deepEqual(filterMonitorRows(rows, "r574 mjtj"), [secondPhone]);
});

test("表带名称参与检索，未设置表带的商品正常排除", () => {
  assert.deepEqual(filterMonitorRows(rows, "米兰尼斯"), [watch]);
  assert.deepEqual(filterMonitorRows(rows, "浦东 黑色 ultra"), [watch]);
  assert.deepEqual(filterMonitorRows(rows, "iPhone 米兰尼斯"), []);
});

test("无匹配和空列表返回空结果", () => {
  assert.deepEqual(filterMonitorRows(rows, "不存在的门店"), []);
  assert.deepEqual(filterMonitorRows([], "iPhone"), []);
});

test("筛选保留原顺序和对象引用，不修改冻结的输入数据", () => {
  const result = filterMonitorRows(rows, "pro");
  assert.equal(result.length, 2);
  assert.equal(result[0], phone);
  assert.equal(result[1], secondPhone);
  assert.deepEqual(rows, [phone, watch, secondPhone]);
  assert.equal(phone.target.productName, "iPhone 17 Pro 256GB");
});

test("一个检索词不能通过拼接多个字段而意外命中", () => {
  assert.deepEqual(filterMonitorRows(rows, "南京东路r359"), []);
  assert.deepEqual(filterMonitorRows(rows, "r359iphone17"), []);
  assert.deepEqual(filterMonitorRows(rows, "南京东路 r359 iphone17"), [phone]);
});
