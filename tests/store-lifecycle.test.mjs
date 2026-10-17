import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

let invoke;
let listen;
globalThis.__lifecycleInvoke = (...args) => invoke(...args);
globalThis.__lifecycleListen = (...args) => listen(...args);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const stubs = {
      "@tauri-apps/api/core": "export const invoke = (...args) => globalThis.__lifecycleInvoke(...args);",
      "@tauri-apps/api/event": "export const listen = (...args) => globalThis.__lifecycleListen(...args);",
      "@tauri-apps/plugin-opener": "export const openUrl = async () => {};",
    };
    if (specifier in stubs) {
      return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("./") && !specifier.endsWith(".ts") && context.parentURL?.includes("/src/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
let generation = 0;
async function setup() {
  const store = await import(`../src/lib/store.ts?lifecycle=${++generation}`);
  const settings = structuredClone(store.watcherStore.getSnapshot().settings);
  const subscriptions = new Set();
  const handlers = new Map();
  const calls = [];
  listen = async (channel, callback) => {
    const subscription = { channel, callback };
    subscriptions.add(subscription);
    return () => subscriptions.delete(subscription);
  };
  invoke = async (command, args) => {
    calls.push(command);
    if (handlers.has(command)) return handlers.get(command)(args);
    if (command === "get_settings") return settings;
    if (command === "save_settings") return Object.assign(settings, args.settings);
    if (command === "is_running") return false;
    if (command === "check_for_update") return null;
    return [];
  };
  return { store, settings, subscriptions, calls, handlers };
}

test("initial IPC failure releases subscriptions and a subsequent connect can retry", async () => {
  const ctx = await setup();
  ctx.handlers.set("get_settings", () => { throw new Error("IPC not ready"); });
  await assert.rejects(ctx.store.connect(), /IPC not ready/);
  assert.equal(ctx.subscriptions.size, 0);
  ctx.handlers.delete("get_settings");
  await ctx.store.connect();
  assert.equal(ctx.store.watcherStore.getSnapshot().ready, true);
  assert.equal(ctx.subscriptions.size, 3);
  ctx.store.disconnect();
});

test("disconnect while listeners register cleans late subscriptions and ignores stale startup", async () => {
  const ctx = await setup();
  const registration = deferred();
  const normalListen = listen;
  listen = async (...args) => {
    await registration.promise;
    return normalListen(...args);
  };
  const connection = ctx.store.connect();
  ctx.store.disconnect();
  registration.resolve();
  await connection;
  assert.equal(ctx.subscriptions.size, 0);
  assert.equal(ctx.store.watcherStore.getSnapshot().ready, false);
});

test("one failed listener also cleans the other listeners that resolve later", async () => {
  const ctx = await setup();
  const registration = deferred();
  const normalListen = listen;
  listen = async (channel, callback) => {
    if (channel === "watcher://notice") throw new Error("listener unavailable");
    await registration.promise;
    return normalListen(channel, callback);
  };
  await assert.rejects(ctx.store.connect(), /listener unavailable/);
  registration.resolve();
  await tick();
  assert.equal(ctx.subscriptions.size, 0);
  assert.equal(ctx.store.watcherStore.getSnapshot().ready, false);
});

test("startup snapshots cannot overwrite newer backend events received while loading", async () => {
  const ctx = await setup();
  const initialSettings = deferred();
  ctx.handlers.set("get_settings", () => initialSettings.promise);
  const connection = ctx.store.connect();
  await tick();
  const emit = (channel, payload) => [...ctx.subscriptions].find((item) => item.channel === channel).callback({ payload });
  const updatedSettings = { ...ctx.settings, locale: "en_US", soundEnabled: false };
  emit("watcher://settings", updatedSettings);
  emit("watcher://event", { type: "runStateChanged", running: true });
  const rows = [{
    target: { locale: "en_US", storeNumber: "R1", storeTitle: "Test", partNumber: "TEST/A", productName: "Test" },
    availability: { kind: "out_of_stock" }, lastCheckedMs: 1000, consecutiveFailures: 0,
  }];
  emit("watcher://event", {
    type: "cycleComplete", healthy: true, snapshot: rows, nextCheckInSecs: 30,
    cooling: false, route: null, cycle: 1, elapsedMs: 10, requestCount: 1, reusedResponseCount: 0,
  });
  initialSettings.resolve(ctx.settings);
  await connection;
  const state = ctx.store.watcherStore.getSnapshot();
  assert.deepEqual(state.settings, updatedSettings);
  assert.deepEqual(state.rows, rows);
  assert.equal(state.running, true);
  ctx.store.disconnect();
});

test("an old settings save reply cannot re-enable checkout closed by a backend event", async () => {
  const ctx = await setup();
  ctx.settings.checkout.enabled = true;
  await ctx.store.connect();
  const reply = deferred();
  const saved = { ...ctx.settings, soundEnabled: false };
  ctx.handlers.set("save_settings", () => reply.promise);
  const saving = ctx.store.saveSettings({ soundEnabled: false });
  await tick();
  const settingsListener = [...ctx.subscriptions].find(({ channel }) => channel === "watcher://settings").callback;
  settingsListener({ payload: { ...saved, checkout: { ...saved.checkout, enabled: false } } });
  reply.resolve(saved);
  assert.equal(await saving, true);
  assert.equal(ctx.store.watcherStore.getSnapshot().settings.checkout.enabled, false);

  let nextSave;
  ctx.handlers.set("save_settings", ({ settings }) => { nextSave = settings; return settings; });
  await ctx.store.saveSettings({ stopOnHit: true });
  assert.equal(nextSave.checkout.enabled, false);
  ctx.store.disconnect();
});

test("an old product Bark save reply also preserves newer backend checkout settings", async () => {
  const ctx = await setup();
  ctx.settings.checkout.enabled = true;
  await ctx.store.connect();
  const target = { locale: "zh_CN", storeNumber: "R1", storeTitle: "Test", partNumber: "TEST/A", productName: "Test" };
  const reply = deferred();
  const saved = { ...ctx.settings, productBarkUrls: { "TEST/A": "https://example.invalid/bark" } };
  ctx.handlers.set("save_settings", () => reply.promise);
  const saving = ctx.store.setProductBarkUrl(target, "https://example.invalid/bark");
  await tick();
  const settingsListener = [...ctx.subscriptions].find(({ channel }) => channel === "watcher://settings").callback;
  settingsListener({ payload: { ...saved, checkout: { ...saved.checkout, enabled: false } } });
  reply.resolve(saved);
  assert.equal(await saving, true);
  const settings = ctx.store.watcherStore.getSnapshot().settings;
  assert.equal(settings.checkout.enabled, false);
  assert.deepEqual(settings.productBarkUrls, saved.productBarkUrls);
  ctx.store.disconnect();
});

test("a save reply from a disconnected session cannot overwrite reconnected settings", async () => {
  const ctx = await setup();
  ctx.settings.checkout.enabled = true;
  await ctx.store.connect();
  const reply = deferred();
  const oldSaved = structuredClone(ctx.settings);
  ctx.handlers.set("save_settings", () => reply.promise);
  const saving = ctx.store.saveSettings({ soundEnabled: false });
  await tick();
  ctx.store.disconnect();
  ctx.settings.checkout = { ...ctx.settings.checkout, enabled: false };
  await ctx.store.connect();
  reply.resolve(oldSaved);
  assert.equal(await saving, true);
  assert.equal(ctx.store.watcherStore.getSnapshot().settings.checkout.enabled, false);
  ctx.store.disconnect();
});

test("target and interval replies preserve checkout settings from a newer backend event", async () => {
  const ctx = await setup();
  ctx.settings.checkout.enabled = true;
  await ctx.store.connect();
  const settingsListener = [...ctx.subscriptions].find(({ channel }) => channel === "watcher://settings").callback;
  const target = { locale: "zh_CN", storeNumber: "R1", storeTitle: "Test", partNumber: "TEST/A", productName: "Test" };
  const targetsReply = deferred();
  ctx.handlers.set("set_targets", () => targetsReply.promise);
  const savingTargets = ctx.store.setTargets([target]);
  await tick();
  const updatedSettings = { ...ctx.settings, targets: [target], checkout: { ...ctx.settings.checkout, enabled: false } };
  settingsListener({ payload: updatedSettings });
  targetsReply.resolve([]);
  assert.equal(await savingTargets, true);
  assert.equal(ctx.store.watcherStore.getSnapshot().settings.checkout.enabled, false);

  const intervalReply = deferred();
  ctx.handlers.set("set_interval", () => intervalReply.promise);
  const savingInterval = ctx.store.setIntervalSeconds(15);
  await tick();
  settingsListener({ payload: { ...updatedSettings, intervalSeconds: 15, soundEnabled: false } });
  intervalReply.resolve(15);
  assert.equal(await savingInterval, true);
  const settings = ctx.store.watcherStore.getSnapshot().settings;
  assert.equal(settings.checkout.enabled, false);
  assert.equal(settings.soundEnabled, false);
  assert.equal(settings.intervalSeconds, 15);
  ctx.store.disconnect();
});

test("a failed locale save preserves the catalog for the current locale", async () => {
  const ctx = await setup();
  ctx.handlers.set("save_settings", () => { throw new Error("disk unavailable"); });
  await ctx.store.changeLocale("en_US");
  assert.equal(ctx.store.watcherStore.getSnapshot().settings.locale, "zh_CN");
  assert.deepEqual(ctx.calls, ["save_settings"]);
});

test("a slower catalog request cannot overwrite a newer locale selection", async () => {
  const ctx = await setup();
  const oldCatalog = deferred();
  ctx.handlers.set("list_stores", ({ locale }) => locale === "zh_CN" ? oldCatalog.promise : [{ number: "NEW" }]);
  ctx.handlers.set("list_products", ({ locale }) => [{ partNumber: locale }]);
  const older = ctx.store.loadCatalog("zh_CN");
  await ctx.store.saveSettings({ locale: "en_US" });
  await ctx.store.loadCatalog("en_US");
  oldCatalog.resolve([{ number: "OLD" }]);
  await older;
  assert.deepEqual(ctx.store.watcherStore.getSnapshot().stores, [{ number: "NEW" }]);
  assert.deepEqual(ctx.store.watcherStore.getSnapshot().products, [{ partNumber: "en_US" }]);
});

test("an older locale refresh cannot cancel the selected locale catalog still loading", async () => {
  const ctx = await setup();
  const refresh = deferred();
  const newStores = deferred();
  ctx.handlers.set("list_stores", ({ locale }) => locale === "zh_CN" ? [{ number: "CN" }] : newStores.promise);
  ctx.handlers.set("list_products", ({ locale }) => [{ partNumber: locale }]);
  ctx.handlers.set("refresh_products", () => refresh.promise);
  await ctx.store.connect();
  const refreshing = ctx.store.refreshProducts();
  const changingLocale = ctx.store.changeLocale("en_US");
  await tick();
  assert.equal(ctx.store.watcherStore.getSnapshot().settings.locale, "en_US");

  refresh.resolve({ stores: 1, products: 1, errors: [] });
  await refreshing;
  newStores.resolve([{ number: "US" }]);
  await changingLocale;

  const state = ctx.store.watcherStore.getSnapshot();
  assert.deepEqual(state.stores, [{ number: "US" }]);
  assert.deepEqual(state.products, [{ partNumber: "en_US" }]);
  ctx.store.disconnect();
});

test("overlapping locale changes keep the catalog of the last saved locale", async () => {
  const ctx = await setup();
  const firstStores = deferred();
  const secondStores = deferred();
  ctx.handlers.set("list_stores", ({ locale }) => locale === "en_US" ? firstStores.promise : secondStores.promise);
  ctx.handlers.set("list_products", ({ locale }) => [{ partNumber: locale }]);
  const firstChange = ctx.store.changeLocale("en_US");
  await tick();
  const secondChange = ctx.store.changeLocale("ja_JP");
  await tick();
  secondStores.resolve([{ number: "JP" }]);
  await secondChange;
  firstStores.resolve([{ number: "US" }]);
  await firstChange;
  const state = ctx.store.watcherStore.getSnapshot();
  assert.equal(state.settings.locale, "ja_JP");
  assert.deepEqual(state.stores, [{ number: "JP" }]);
  assert.deepEqual(state.products, [{ partNumber: "ja_JP" }]);
});

test("starting waits for pending settings and start/stop commands run in click order", async () => {
  const ctx = await setup();
  const save = deferred();
  const start = deferred();
  ctx.handlers.set("save_settings", async () => { await save.promise; return ctx.settings; });
  ctx.handlers.set("start_watching", () => start.promise);
  const pendingSave = ctx.store.saveSettings({ soundEnabled: false });
  await tick();
  const starting = ctx.store.startWatching();
  const stopping = ctx.store.stopWatching();
  await tick();
  assert.deepEqual(ctx.calls, ["save_settings"]);
  save.resolve();
  await pendingSave;
  await tick();
  assert.deepEqual(ctx.calls, ["save_settings", "start_watching"]);
  start.resolve();
  await Promise.all([starting, stopping]);
  assert.deepEqual(ctx.calls, ["save_settings", "start_watching", "is_running", "stop_watching", "is_running"]);
});

test("a stopped snapshot clears its countdown even if no run-state event arrives", async () => {
  const ctx = await setup();
  await ctx.store.connect();
  const eventListener = [...ctx.subscriptions].find(({ channel }) => channel === "watcher://event").callback;
  eventListener({ payload: { type: "runStateChanged", running: true } });
  eventListener({ payload: {
    type: "cycleComplete", healthy: true, snapshot: [], nextCheckInSecs: 30,
    cooling: true, route: null, cycle: 1, elapsedMs: 10, requestCount: 0, reusedResponseCount: 0,
  } });
  await ctx.store.stopWatching();
  const state = ctx.store.watcherStore.getSnapshot();
  assert.equal(state.running, false);
  assert.equal(state.nextCheckAtMs, null);
  assert.equal(state.cooling, false);
  ctx.store.disconnect();
});
