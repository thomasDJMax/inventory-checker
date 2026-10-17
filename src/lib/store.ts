/**
 * 界面状态的唯一入口。
 *
 * 有一条铁律：**前端不持有真源**。这里存的每一样东西要么是 Rust 推过来的原样
 * 副本，要么是纯粹的展示状态（比如日志文本）。绝不在前端自己判断「这个型号
 * 到底有没有货」—— 一旦前端有了自己的一份判断，那条花大力气在 Rust 里守住的
 * 不变量就会从前门溜回来。
 *
 * 用 `useSyncExternalStore` 而不是 Context 或状态库：它就是为「订阅外部数据源」
 * 设计的，而我们的数据源正是 Rust。再套一层状态库只会制造「再存一份」的诱惑。
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  CatalogRefresh,
  Category,
  CategoryOption,
  ClashRouteCheck,
  ClashSettings,
  DeliveryLocalities,
  Product,
  Region,
  RouteList,
  Settings,
  Store,
  Target,
  TargetState,
  Trouble,
  WatchBandChoice,
  WatchBandSize,
  WatcherEvent,
} from "./types";
import { assertNever, targetKey } from "./types";
import { describeBrowserFailure, describeCycleRows, describeCycleSummary } from "./monitorLog";


const EVENT_CHANNEL = "watcher://event";
const NOTICE_CHANNEL = "watcher://notice";
const SETTINGS_CHANNEL = "watcher://settings";
const MAX_LOG_LINES = 300;

export interface UiState {
  rows: TargetState[];
  running: boolean;
  /** 调度器给出的真实下一轮时间；保护冷却会反映在这里。 */
  nextCheckAtMs: number | null;
  /** 当前目标地区中是否仍有 Apple 请求保护冷却。 */
  cooling: boolean;
  /** 最近一轮实际使用的出口线路；跟随系统代理或尚未查询时为 null。 */
  route: string | null;
  /** 非 null 表示「当前的状态不可信」，界面要挂一条持续可见的告警。 */
  trouble: Trouble | null;
  logs: string[];
  regions: Region[];
  categories: CategoryOption[];
  stores: Store[];
  products: Product[];
  /**
   * 当前正在挑选的品类。
   *
   * 只是个筛选器，所以不进设置、不落盘：它决定型号下拉框里显示哪一批商品，
   * 以及刷新按钮去抓哪几页。已经加进监控列表的目标不受它影响 —— 列表里
   * 四个品类是混在一起的，不然用户切一下品类就以为自己的监控项没了。
   */
  category: Category;
  settings: Settings;
  /** 正在从 Apple 官网刷新型号列表。 */
  refreshing: boolean;
  ready: boolean;

}

const DEFAULT_SETTINGS: Settings = {
  locale: "zh_CN",
  targets: [],
  deliveryRegion: null,
  intervalSeconds: 30,
  barkUrl: "",
  productBarkUrls: {},
  soundEnabled: true,
  openOnHit: "bag",
  stopOnHit: false,
  network: {
    mode: "system",
    clash: {
      controller: "http://127.0.0.1:9097",
      secret: "",
      group: "果探雷达",
      proxyPort: 7899,
      nodeFilter: "",
      pinnedNode: "DIRECT",
    },
  },
  checkout: {
    enabled: false,
    nationalIdSuffix: "",
    payment: "alipay",
    installmentBank: "招商银行",
    installmentPeriods: 24,
    placeOrder: false,
    acceptNearestStore: false,
    product: "",
    fillContact: false,
    contactLastName: "",
    contactFirstName: "",
    contactEmail: "",
    contactPhone: "",
  },
};

let state: UiState = {
  rows: [],
  running: false,
  nextCheckAtMs: null,
  cooling: false,
  route: null,
  trouble: null,
  logs: [],
  regions: [],
  categories: [],
  stores: [],
  products: [],
  category: "iphone",
  settings: DEFAULT_SETTINGS,
  refreshing: false,
  ready: false,
};

const listeners = new Set<() => void>();

/**
 * 返回缓存的引用。
 *
 * `useSyncExternalStore` 用 `Object.is` 比较，每次返回新对象会导致无限重渲染，
 * 所以只在真正变更时才替换 `state`。
 */
function getSnapshot(): UiState {
  return state;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function update(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  for (const cb of listeners) cb();
}

function pushLog(line: string): void {
  pushLogs([line]);
}

function pushLogs(lines: string[]): void {
  if (lines.length === 0) return;
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const next = [...state.logs, ...lines.map((line) => `[${stamp}] ${line}`)];
  // 定长保留。上游把日志无限拼进一个字符串，跑一整天能有几 MB，
  // 每次刷新都要重新排版，界面越用越卡。
  update({ logs: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next });
}

function formatElapsed(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))} 毫秒`;
  return `${(ms / 1_000).toFixed(1)} 秒`;
}

function applyEvent(event: WatcherEvent): void {
  switch (event.type) {
    case "stateChanged": {
      // 列表本身以 cycleComplete 带来的快照为准，不拿这条事件去增量改 ——
      // 它是可丢弃的，用它做增量会让界面和引擎慢慢对不上。
      // 每轮逐项日志统一由 CycleComplete 的完整快照生成，避免首轮状态变化事件
      // 与轮次日志重复，后续库存不变时也仍能保持完全相同的展示格式。
      break;
    }

    case "inStock":
      // 到货动作由 Rust 宿主执行；逐项查询结果在 CycleComplete 时统一写日志。
      break;

    case "cycleStarted":
      update({ nextCheckAtMs: null, cooling: false });
      pushLog(
        `第 ${event.cycle} 轮开始查询：${event.storeCount} 家门店、${event.targetCount} 项监控。${event.cycle === 1 ? "首次使用时会先建立 Apple 查询会话，通常需要几秒。" : ""}`,
      );
      break;

    case "cycleComplete": {
      const recovered = event.healthy && state.trouble !== null;
      const previousBrowserFailure = describeBrowserFailure(state.rows);
      update({
        rows: event.snapshot,
        nextCheckAtMs: Date.now() + event.nextCheckInSecs * 1_000,
        cooling: event.cooling,
        route: event.route ?? null,
        // 只有引擎明说本轮健康，才收起告警。用「所有行都没错误」去反推是
        // 不可靠的：某些故障路径下状态压根没被更新。
        trouble: event.healthy ? null : state.trouble,
      });
      const lines = describeCycleRows(event.cycle, event.snapshot, previousBrowserFailure);
      if (previousBrowserFailure !== null && event.requestCount > 0 && describeBrowserFailure(event.snapshot) === null) {
        lines.unshift("浏览器启动故障已解除。");
      }
      if (recovered) lines.unshift("查询已恢复正常。");
      lines.push(
        `第 ${event.cycle} 轮完成（${formatElapsed(event.elapsedMs)}，实际请求 ${event.requestCount} 次` +
        `${event.reusedResponseCount > 0 ? `，批量响应覆盖 ${event.reusedResponseCount} 家门店` : ""}` +
        `${event.route ? `，线路：${event.route}` : ""}）：` +
        `${describeCycleSummary(event.snapshot)}。约 ${event.nextCheckInSecs} 秒后查询` +
        `${event.cooling ? "（当前保护冷却中，可选择立即重试）" : ""}。`,
      );
      pushLogs(lines);
      break;
    }

    case "trouble":
      update({ trouble: { reason: event.reason, advice: event.advice } });
      pushLog(`告警：${event.reason}`);
      break;

    case "runStateChanged":
      if (state.running !== event.running) {
        update({
          running: event.running,
          nextCheckAtMs: event.running ? state.nextCheckAtMs : null,
          cooling: event.running ? state.cooling : false,
        });
        pushLog(event.running ? "已开始监控。" : "已暂停监控。");
      }
      break;

    default:
      assertNever(event);
  }
}

let unlisteners: UnlistenFn[] = [];
let starting: Promise<void> | null = null;
let connectionGeneration = 0;
let catalogGeneration = 0;
let settingsEventRevision = 0;

/**
 * 连接后端。重复调用是安全的。
 *
 * React 开发模式下 StrictMode 会把 effect 执行两次，如果每次都注册监听器，
 * 会得到两份 —— 日志每行打两遍、提醒重复触发。这个问题只在 dev 复现、生产不会，
 * 最容易漏到很后面才发现，所以这里用一个进行中的 Promise 做去重。
 */
export function connect(): Promise<void> {
  if (starting) return starting;
  const generation = ++connectionGeneration;
  const current = () => generation === connectionGeneration;
  let rowsRevision = 0;
  let runningRevision = 0;
  // Registration itself is asynchronous. A failed sibling or disconnect can happen
  // before it finishes, so each late result must release its own subscription.
  async function register<T>(channel: string, callback: (payload: T) => void): Promise<void> {
    const unlisten = await listen<T>(channel, (event) => {
      if (current()) callback(event.payload);
    });
    if (current()) unlisteners.push(unlisten);
    else unlisten();
  }
  starting = (async () => {
    try {
      await Promise.all([
        register<WatcherEvent>(EVENT_CHANNEL, (event) => {
          if (event.type === "cycleComplete") rowsRevision++;
          if (event.type === "runStateChanged") runningRevision++;
          applyEvent(event);
        }),
        register<string>(NOTICE_CHANNEL, pushLog),
        // 后端自己改了设置（结账完成后关闭自动结账）时同步过来，否则界面上的开关
        // 还显示开启，下一次保存会把它重新打开。
        register<Settings>(SETTINGS_CHANNEL, (settings) => {
          settingsEventRevision++;
          update({ settings });
        }),
      ]);
      if (!current()) return;

      const initialRevisions = { settingsRevision: settingsEventRevision, rowsRevision, runningRevision };
      const [regions, categories, settings, rows, running] = await Promise.all([
        invoke<Region[]>("list_regions"),
        invoke<CategoryOption[]>("list_categories"),
        invoke<Settings>("get_settings"),
        invoke<TargetState[]>("get_snapshot"),
        invoke<boolean>("is_running"),
      ]);
      if (!current()) return;
      // Initial IPC replies may arrive after a newer event. Preserve that event's
      // value instead of replacing it with an older startup snapshot.
      update({
        regions, categories, ready: true,
        ...(settingsEventRevision === initialRevisions.settingsRevision ? { settings } : {}),
        ...(rowsRevision === initialRevisions.rowsRevision ? { rows } : {}),
        ...(runningRevision === initialRevisions.runningRevision ? { running } : {}),
      });
      await loadCatalog(state.settings.locale);
      if (!current()) return;
    } catch (err) {
      if (!current()) return;
      // A rejected startup must not remain cached: retry needs a fresh IPC session.
      disconnect();
      throw err;
    }
  })();
  return starting;
}

export function disconnect(): void {
  connectionGeneration++;
  catalogGeneration++;
  for (const un of unlisteners) un();
  unlisteners = [];
  starting = null;
  update({ ready: false });
}

export const watcherStore = { subscribe, getSnapshot };

// ---- 命令。全部只是转发，不含任何业务判断。

/** 载入某地区的门店与型号目录。 */
export async function loadCatalog(locale: string): Promise<void> {
  // A refresh may finish after the user selected another locale. It must not
  // invalidate that locale's in-flight request by allocating a newer generation.
  if (locale !== state.settings.locale) return;
  const generation = ++catalogGeneration;
  const current = () => generation === catalogGeneration && locale === state.settings.locale;
  try {
    const [stores, products] = await Promise.all([
      invoke<Store[]>("list_stores", { locale }),
      invoke<Product[]>("list_products", { locale }),
    ]);
    if (current()) update({ stores, products });
  } catch (err) {
    if (!current()) return;
    // 目录读不出来不该让整个界面挂掉，但必须让用户知道下拉为什么是空的。
    update({ stores: [], products: [] });
    pushLog(`载入 ${locale} 的门店与型号失败：${String(err)}`);
  }
}

/**
 * 从 Apple 中国大陆官网读取送货地区的三级联动选项。
 *
 * 送货地址是中国大陆监控的全局设置，不应跟随“新建监控”里当前浏览的地区切换。
 */
export function loadDeliveryLocalities(
  selectedState = "",
  selectedCity = "",
): Promise<DeliveryLocalities> {
  return invoke<DeliveryLocalities>("list_delivery_localities", {
    locale: "zh_CN",
    stateName: selectedState,
    cityName: selectedCity,
  });
}

/** 从 Apple 官网读取指定 Watch 表壳可搭配的表带款式与颜色。 */
export function loadWatchBandChoices(locale: string, casePart: string): Promise<WatchBandChoice[]> {
  return invoke<WatchBandChoice[]>("list_watch_band_choices", { locale, casePart });
}

/** 从 Apple 官网读取指定表带款式、颜色的尺码与精确零件号。 */
export function loadWatchBandSizes(
  locale: string,
  casePart: string,
  styleKey: string,
  colorKey: string,
): Promise<WatchBandSize[]> {
  return invoke<WatchBandSize[]>("list_watch_band_sizes", {
    locale,
    casePart,
    styleKey,
    colorKey,
  });
}

// 所有修改设置的命令按顺序执行，查询间隔和目标列表也不能被旧设置覆盖。
let settingsWrite: Promise<unknown> = Promise.resolve();

function enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = settingsWrite.then(operation);
  settingsWrite = next.catch(() => undefined);
  return next;
}

export function saveSettings(
  patch: Partial<Settings> | ((settings: Settings) => Partial<Settings>),
): Promise<boolean> {
  return enqueueSettingsWrite(async () => {
    try {
      const changes = typeof patch === "function" ? patch(state.settings) : patch;
      const revision = settingsEventRevision;
      const generation = connectionGeneration;
      const saved = await invoke<Settings>("save_settings", {
        settings: { ...state.settings, ...changes },
      });
      // The backend can close checkout while the command finishes syncing its
      // engine. Its newer event must survive an older full-settings reply.
      if (revision === settingsEventRevision && generation === connectionGeneration) {
        update({ settings: saved });
      }
      return true;
    } catch (err) {
      pushLog(`保存设置失败：${String(err)}`);
      return false;
    }
  });
}

export function setCategory(category: Category): void {
  update({ category });
}

export async function changeLocale(locale: string): Promise<void> {
  if (await saveSettings({ locale })) await loadCatalog(locale);
}

/** 用一句话描述一次目录刷新，例如「更新目录：门店 49 家、型号 73 个」。 */
function describeCatalogRefresh(result: CatalogRefresh): string {
  const parts = [
    result.stores === null ? "门店未更新" : `门店 ${result.stores} 家`,
    `型号 ${result.products} 个`,
  ];
  const notes = result.errors.length > 0 ? `（${result.errors.join("；")}）` : "";
  return `从 Apple 官网更新目录：${parts.join("、")}${notes}。`;
}

async function writeTargets(targets: Target[]): Promise<boolean> {
  try {
    const rows = await invoke<TargetState[]>("set_targets", { targets });
    const activeParts = new Set(targets.map((target) => target.partNumber));
    const productBarkUrls = Object.fromEntries(
      Object.entries(state.settings.productBarkUrls).filter(([partNumber]) =>
        activeParts.has(partNumber),
      ),
    );
    update({ rows, settings: { ...state.settings, targets, productBarkUrls } });
    return true;
  } catch (err) {
    pushLog(`更新监控列表失败：${String(err)}`);
    return false;
  }
}

export function setTargets(targets: Target[] | ((current: Target[]) => Target[])): Promise<boolean> {
  return enqueueSettingsWrite(() =>
    writeTargets(typeof targets === "function" ? targets(state.settings.targets) : targets),
  );
}

/**
 * 删除单条监控。
 *
 * 必须在设置写队列开始执行时才读取最新列表：用户连续点击两个删除按钮时，
 * 后一次操作不能带着点击时的旧快照，把前一次已经删掉的项目重新写回去。
 */
export function removeTarget(target: Target): Promise<boolean> {
  const key = targetKey(target);
  return enqueueSettingsWrite(() =>
    writeTargets(state.settings.targets.filter((item) => targetKey(item) !== key)),
  );
}

/** 为一个型号设置专属 Bark；空地址表示恢复使用默认 Bark。 */
export function setProductBarkUrl(target: Target, barkUrl: string): Promise<boolean> {
  return enqueueSettingsWrite(async () => {
    const productBarkUrls = { ...state.settings.productBarkUrls };
    const normalized = barkUrl.trim();
    if (normalized) productBarkUrls[target.partNumber] = normalized;
    else delete productBarkUrls[target.partNumber];

    try {
      const revision = settingsEventRevision;
      const generation = connectionGeneration;
      const saved = await invoke<Settings>("save_settings", {
        settings: { ...state.settings, productBarkUrls },
      });
      if (revision === settingsEventRevision && generation === connectionGeneration) {
        update({ settings: saved });
      }
      pushLog(
        normalized
          ? `已为 ${target.productName} 设置专属 Bark。`
          : `${target.productName} 已恢复使用默认 Bark。`,
      );
      return true;
    } catch (err) {
      pushLog(`保存型号专属 Bark 失败：${String(err)}`);
      return false;
    }
  });
}

let runStateWrite: Promise<void> = Promise.resolve();

function enqueueRunStateWrite(operation: () => Promise<void>): Promise<void> {
  const next = runStateWrite.then(operation);
  runStateWrite = next.catch(() => undefined);
  return next;
}

export function startWatching(): Promise<void> {
  return enqueueRunStateWrite(async () => {
    try {
      await settingsWrite;
      await invoke("start_watching");
      const running = await invoke<boolean>("is_running");
      if (state.running !== running) {
        update({ running });
        pushLog(running ? "已开始监控。" : "启动命令已返回，但监控引擎没有进入运行状态。");
      }
    } catch (err) {
      pushLog(`启动监控失败：${String(err)}`);
    }
  });
}

export function stopWatching(): Promise<void> {
  return enqueueRunStateWrite(async () => {
    try {
      await invoke("stop_watching");
      const running = await invoke<boolean>("is_running");
      if (!running) update({ nextCheckAtMs: null, cooling: false });
      if (state.running !== running) {
        update({ running });
        pushLog(running ? "暂停命令已返回，但监控引擎仍在运行。" : "已暂停监控。");
      }
    } catch (err) {
      pushLog(`暂停监控失败：${String(err)}`);
    }
  });
}

export async function retryWatchingNow(): Promise<boolean> {
  try {
    const accepted = await invoke<boolean>("retry_watching_now");
    if (accepted) {
      update({ nextCheckAtMs: null, cooling: false });
      pushLog("已按你的选择立即重新查询。");
      return true;
    }
    pushLog("监控当前未运行，无法立即重试。");
  } catch (err) {
    pushLog(`立即重试失败：${String(err)}`);
  }
  return false;
}

export async function setIntervalSeconds(seconds: number): Promise<boolean> {
  return enqueueSettingsWrite(async () => {
    try {
      const applied = await invoke<number>("set_interval", { seconds });
      update({ settings: { ...state.settings, intervalSeconds: applied } });
      return true;
    } catch (err) {
      pushLog(`设置查询间隔失败：${String(err)}`);
      return false;
    }
  });
}

/**
 * 从 Apple 官网抓最新型号。
 *
 * 只抓当前品类的那几页。全部品类加起来有二十页、几十兆 HTML，用户想看新出的
 * Mac 没有理由等着 iPhone、iPad、Watch 一起抓完。
 */
export async function refreshProducts(): Promise<void> {
  if (state.refreshing) return;
  update({ refreshing: true });
  const locale = state.settings.locale;
  const category = state.category;
  try {
    const result = await invoke<CatalogRefresh>("refresh_products", { locale, category });
    // 型号数是本轮成功抓下来的不同零件号数，不等于目录里真的多了或改了多少行。
    pushLog(`已${describeCatalogRefresh(result)}`);
  } catch (err) {
    // 抓取失败仍可继续用缓存或内置目录，只是可能缺最新机型或门店。
    pushLog(`更新门店与型号失败（继续使用已有目录）：${String(err)}`);
  } finally {
    // 无论成败都重载一次目录。**失败时也必须重载**：后端是一页一页安装的，
    // 一个品类有八页，其中几页成功、几页失败是常事，成功那几页的新数据此刻
    // 已经在后端生效了。不重载的话界面还停在旧目录上，等到下一次因为别的
    // 原因重载时，这批变更才悄悄冒出来 —— 那时候已经没有任何提示说明它们
    // 是哪来的了。
    await loadCatalog(locale);
    update({ refreshing: false });
  }
}

/** 检查本机 Clash 控制接口、专用策略组和端口；不向 Apple 发请求。 */
export async function testClashRoute(clash: ClashSettings): Promise<ClashRouteCheck | string> {
  try {
    const result = await invoke<ClashRouteCheck>("test_clash_route", { clash });
    pushLog(
      `Clash 线路检查：${result.version}，可用节点 ${result.nodes.length} 个` +
      `${result.skipped > 0 ? `（已排除 ${result.skipped} 个）` : ""}，测速超时 ${result.timeoutCount} 个，` +
      `当前 ${result.now ?? "未选择"}；` +
      `端口 ${clash.proxyPort} ${result.portOpen ? "可连接" : "无法连接"}。`,
    );
    return result;
  } catch (err) {
    const message = String(err);
    pushLog(`Clash 线路检查失败：${message}`);
    return message;
  }
}

/** 读取专用策略组的节点和测速结果。 */
export async function listClashNodes(): Promise<RouteList | string> {
  try {
    return await invoke<RouteList>("list_clash_nodes");
  } catch (err) {
    return String(err);
  }
}

/** 手动指定查询节点；之后被拒或连不通时仍会自动切换。 */
export async function selectClashNode(node: string): Promise<boolean> {
  try {
    const delay = await invoke<number | null>("select_clash_node", { node });
    pushLog(
      `已手动切换到节点 ${node}` +
      `${node === "DIRECT" ? "" : delay === null ? "（测速未通过，仍按指定切换）" : `（测速 ${delay} ms）`}` +
      "，下一次查询生效。",
    );
    return true;
  } catch (err) {
    pushLog(`手动切换节点失败：${String(err)}`);
    return false;
  }
}

/** 打开下单浏览器，供用户登录、加购并手动走一次结账。 */
export async function openCheckoutBrowser(): Promise<void> {
  try {
    await invoke("open_checkout_browser");
    pushLog("已打开下单浏览器。请在里面登录 Apple 账户，把要买的商品加入购物袋，并手动走一次结账。");
  } catch (err) {
    pushLog(`打开下单浏览器失败：${String(err)}`);
  }
}

/** 试跑自动结账到「查看订单」页，不提交订单。 */
export async function testCheckout(): Promise<void> {
  try {
    await settingsWrite;
    pushLog(await invoke<string>("test_checkout"));
  } catch (err) {
    pushLog(`试跑自动结账没有完成：${String(err)}`);
  }
}

export async function testNotify(): Promise<void> {
  try {
    await settingsWrite;
    await invoke("test_notify");
    const jump =
      state.settings.openOnHit === "bag"
        ? "，并打开购物袋"
        : state.settings.openOnHit === "education_bag"
          ? "，并打开教育商店购物袋"
          : state.settings.openOnHit === "product" && state.settings.targets.length > 0
            ? "，并打开第一个监控目标的商品详情"
            : "";
    const firstTarget = state.settings.targets[0];
    const bark = firstTarget && state.settings.productBarkUrls[firstTarget.partNumber]
      ? "，并向第一个监控型号的专属 Bark 推送"
      : state.settings.barkUrl
        ? "，并向默认 Bark 推送"
        : "";
    pushLog(`已执行测试提醒${bark}${jump}（不代表有货）。`);
  } catch (err) {
    pushLog(`测试提醒失败：${String(err)}`);
  }
}

export async function openTargetProduct(target: Target): Promise<void> {
  try {
    await invoke("open_target_product", { target });
  } catch (err) {
    pushLog(`打开商品页失败：${String(err)}`);
  }
}

// ---- 项目与下载入口。此派生版通过 GitHub Releases 手动更新。

/** 打开本项目的完整安装包下载页。 */
export async function openReleasePage(): Promise<void> {
  try {
    await openUrl("https://github.com/thomasDJMax/guotan-radar/releases/latest");
  } catch (err) {
    pushLog(`无法打开下载页：${String(err)}`);
  }
}

/** 打开本派生项目的源码与问题反馈页。 */
export async function openProjectPage(): Promise<void> {
  try {
    await openUrl("https://github.com/thomasDJMax/guotan-radar");
  } catch (err) {
    pushLog(`无法打开 GitHub 项目页：${String(err)}`);
  }
}
