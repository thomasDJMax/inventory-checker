import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import packageInfo from "../package.json";
import {
  Activity,
  AlertTriangle,
  BellRing,
  ChevronDown,
  Clock3,
  Download,
  Info,
  LoaderCircle,
  MapPin,
  PackageCheck,
  PackageX,
  Pause,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Settings2,
  Search,
  Smartphone,
  SquareTerminal,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import { Combobox } from "@/components/Combobox";
import { MultiCombobox } from "@/components/MultiCombobox";
import { CollapsiblePanel } from "@/components/CollapsiblePanel";
import { CheckoutSettings } from "@/components/CheckoutSettings";
import { NetworkSettings } from "@/components/NetworkSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  changeLocale,
  connect,
  loadDeliveryLocalities,
  loadWatchBandChoices,
  loadWatchBandSizes,
  openProjectPage,
  openReleasePage,
  openTargetProduct,
  refreshProducts,
  removeTarget,
  retryWatchingNow,
  saveSettings,
  setCategory,
  setIntervalSeconds,
  setProductBarkUrl,
  setTargets,
  startWatching,
  stopWatching,
  testNotify,
  watcherStore,
} from "@/lib/store";
import {
  type Availability,
  type DeliveryLocalities,
  type DeliveryRegion,
  type PickupDetails,
  type Category,
  type OpenOnHit,
  describeAdvice,
  formatTime,
  isUntrusted,
  type StatusTone,
  type Target,
  type WatchBandChoice,
  type WatchBandSize,
  targetKey,
} from "@/lib/types";

import { describeBrowserFailure, describeBrowserRecovery, describeDelivery, describeMonitorStatus, describePickupDate, type DeliveryTone } from "@/lib/monitorLog";
import { compareNewestProducts, sortMonitorsNewestFirst } from "@/lib/productOrder";
import { filterMonitorRows } from "@/lib/monitorFilter";
import { groupMonitorRows, prioritizeInStockGroups } from "@/lib/monitorGroups";
import { isMonitorGroupExpanded, MONITOR_EXPANSION_STORAGE_KEY, parseMonitorExpansion, type MonitorExpansionPreferences } from "@/lib/monitorExpansion";

const EMPTY_DELIVERY_LOCALITIES: DeliveryLocalities = {
  states: [],
  cities: [],
  districts: [],
};

function compactProductName(name: string): string {
  if (!name.startsWith("Apple Watch ")) return name;
  return name
    .replace(/^Apple Watch\s+/, "")
    .replace(/\s+新外观(?=\s|$)/g, "")
    .replace(/(\d+)\s*毫米/g, "$1mm")
    .replace(/\s+/g, " ")
    .trim();
}

function watchBandDescription(companionPart?: string): string | undefined {
  return companionPart ? `送货查询使用目录默认表带 ${companionPart}` : undefined;
}

function GithubBrandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.589 2 12.253c0 4.53 2.865 8.374 6.839 9.731.5.094.682-.222.682-.494 0-.244-.009-.888-.014-1.744-2.782.62-3.369-1.374-3.369-1.374-.455-1.184-1.11-1.499-1.11-1.499-.908-.636.069-.623.069-.623 1.004.073 1.532 1.057 1.532 1.057.892 1.568 2.341 1.115 2.91.853.091-.663.349-1.115.635-1.371-2.221-.259-4.555-1.14-4.555-5.067 0-1.119.389-2.034 1.029-2.751-.103-.26-.446-1.302.098-2.713 0 0 .84-.276 2.75 1.051A9.33 9.33 0 0 1 12 7.992a9.31 9.31 0 0 1 2.504.346c1.909-1.327 2.748-1.051 2.748-1.051.545 1.411.202 2.453.1 2.713.64.717 1.027 1.632 1.027 2.751 0 3.937-2.337 4.805-4.565 5.059.359.317.679.944.679 1.903 0 1.374-.012 2.482-.012 2.819 0 .275.18.593.688.493C19.14 20.625 22 16.783 22 12.253 22 6.589 17.523 2 12 2Z" clipRule="evenodd" />
    </svg>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  inStock: "bg-in-stock/12 text-in-stock border-in-stock/25",
  outOfStock: "bg-out-of-stock/12 text-out-of-stock border-out-of-stock/30",
  presale: "bg-presale/12 text-presale border-presale/30",
  comingSoon: "bg-coming-soon/12 text-coming-soon border-coming-soon/30",
  pickupUnsupported: "bg-pickup-unsupported/12 text-pickup-unsupported border-pickup-unsupported/30",
  notForSale: "bg-not-for-sale/12 text-not-for-sale border-not-for-sale/30",
  unknown: "bg-unknown/12 text-unknown border-unknown/30",
  pending: "bg-transparent text-muted-foreground/70 border-border border-dashed",
};

function StatusBadge({ availability, pickupDetails }: { availability: Availability; pickupDetails?: PickupDetails }) {
  const { label, tone, detail } = describeMonitorStatus({ availability, pickupDetails });
  const pickupDate = availability.kind === "in_stock" ? describePickupDate(pickupDetails?.pickupQuote) : null;
  const StatusIcon = tone === "inStock" ? PackageCheck
    : tone === "outOfStock" || tone === "pickupUnsupported" || tone === "notForSale" ? PackageX
      : tone === "unknown" ? AlertTriangle : Clock3;
  const badge = (
    <span className="inline-flex min-w-0 max-w-full flex-col items-center gap-0.5">
      <Badge
        variant="outline"
        className={`h-auto min-h-7 min-w-0 max-w-full justify-center gap-1.5 whitespace-normal px-2 py-1 font-semibold ${TONE_CLASS[tone]}`}
      >
        <StatusIcon className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 text-center [overflow-wrap:anywhere]">{label}</span>
      </Badge>
      {pickupDate ? <span className="max-w-full whitespace-normal text-center text-[10px] leading-3 text-in-stock tabular-nums [overflow-wrap:anywhere]">{pickupDate} 可取</span> : null}
    </span>
  );
  if (!detail) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex min-w-0 max-w-full cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-90">{detail}</TooltipContent>
    </Tooltip>
  );
}

const DELIVERY_CLASS: Record<DeliveryTone, string> = {
  fast: "border-delivery-fast/30 bg-delivery-fast/12 text-delivery-fast",
  soon: "border-delivery-soon/30 bg-delivery-soon/12 text-delivery-soon",
  standard: "border-delivery-standard/30 bg-delivery-standard/12 text-delivery-standard",
  later: "border-delivery-later/35 bg-delivery-later/12 text-delivery-later",
  unavailable: "border-border bg-muted/35 text-muted-foreground",
  unknown: "border-delivery-unknown/30 bg-delivery-unknown/10 text-delivery-unknown",
};

function DeliveryBadge({ pickupDetails, lastCheckedMs }: { pickupDetails?: PickupDetails; lastCheckedMs: number | null }) {
  const delivery = describeDelivery(pickupDetails, lastCheckedMs);
  if (!delivery) {
    return <span className="text-xs text-muted-foreground/60" title="Apple 本轮未返回预计送货时间">送货未返回</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={`inline-flex min-w-0 max-w-full cursor-help flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${DELIVERY_CLASS[delivery.tone]}`}
          aria-label={`预计送货：${delivery.detail}；${delivery.timing}`}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span className="min-w-0 whitespace-normal text-xs font-semibold leading-4 tabular-nums [overflow-wrap:anywhere]">{delivery.label}</span>
          <span className="min-w-0 whitespace-normal text-[10px] leading-4 opacity-80 [overflow-wrap:anywhere]">{delivery.timing}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-90">Apple 预计送货：{delivery.detail}</TooltipContent>
    </Tooltip>
  );
}

function ProductBarkRoute({
  target,
  customUrl,
  disabled,
  compact = false,
}: {
  target: Target;
  customUrl?: string;
  disabled: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const hasCustomUrl = Boolean(customUrl);

  async function save() {
    setSaving(true);
    try {
      if (await setProductBarkUrl(target, draft)) setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(customUrl ?? "");
        setOpen(nextOpen);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size={compact ? "icon-sm" : "sm"}
              className={`relative ${hasCustomUrl ? "bg-primary/8 text-primary" : "text-muted-foreground"}`}
              aria-label={`${target.productName}：${hasCustomUrl ? "已设置专属 Bark" : "使用默认 Bark"}`}
              disabled={disabled}
            >
              <BellRing aria-hidden="true" />
              {compact ? (
                hasCustomUrl ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-background" aria-hidden="true" /> : null
              ) : hasCustomUrl ? "专属" : "默认"}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{hasCustomUrl ? "已设置专属 Bark，点击修改" : "使用默认 Bark，点击设置专属地址"}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl">
        <PopoverHeader>
          <PopoverTitle>此型号的 Bark 推送</PopoverTitle>
          <PopoverDescription className="break-words leading-5">
            {target.productName}。同一型号在不同门店共用此地址；留空则沿用右侧监控设置里的默认 Bark。
          </PopoverDescription>
        </PopoverHeader>
        <div className="field-group">
          <Label htmlFor={`product-bark-${targetKey(target)}`} className="control-label">
            专属 Bark 地址
          </Label>
          <Input
            id={`product-bark-${targetKey(target)}`}
            type="url"
            className="control-surface select-text"
            placeholder="https://api.day.app/对方的BarkKey"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
            }}
            disabled={saving}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : draft.trim() ? "保存专属地址" : "使用默认地址"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function watchBandSizeLabel(text: string): string {
  return /^\d+$/.test(text.trim()) ? `${text.trim()} 号` : text.trim();
}

function WatchBandPicker({
  target,
  defaultCompanionPart,
  disabled,
}: {
  target: Target;
  defaultCompanionPart?: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<WatchBandChoice[]>([]);
  const [sizes, setSizes] = useState<WatchBandSize[]>([]);
  const [choiceValue, setChoiceValue] = useState("");
  const [selectedPart, setSelectedPart] = useState("");
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [loadingSizes, setLoadingSizes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentLabel = target.companionName
    ? target.companionName
    : `目录默认表带 ${target.companionPart ?? "未设置"}`;

  async function openPicker(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || choices.length > 0 || loadingChoices) return;
    setLoadingChoices(true);
    setError(null);
    try {
      setChoices(await loadWatchBandChoices(target.locale, target.partNumber));
    } catch (reason) {
      setError(`读取 Apple 表带选项失败：${String(reason)}`);
    } finally {
      setLoadingChoices(false);
    }
  }

  async function chooseBand(value: string) {
    setChoiceValue(value);
    setSelectedPart("");
    setSizes([]);
    const choice = choices.find((item) => `${item.styleKey}::${item.colorKey}` === value);
    if (!choice) return;
    setLoadingSizes(true);
    setError(null);
    try {
      const nextSizes = await loadWatchBandSizes(
        target.locale,
        target.partNumber,
        choice.styleKey,
        choice.colorKey,
      );
      setSizes(nextSizes);
      const onlySize = nextSizes.length === 1 ? nextSizes.at(0) : undefined;
      if (onlySize) setSelectedPart(onlySize.partNumber);
    } catch (reason) {
      setError(`读取 Apple 表带尺码失败：${String(reason)}`);
    } finally {
      setLoadingSizes(false);
    }
  }

  async function applyBand() {
    const choice = choices.find((item) => `${item.styleKey}::${item.colorKey}` === choiceValue);
    const size = sizes.find((item) => item.partNumber === selectedPart);
    if (!choice || !size) return;
    setSaving(true);
    const companionName = `${choice.styleName} · ${choice.colorName} · ${watchBandSizeLabel(size.text)}`;
    const saved = await setTargets((current) => current.map((item) => (
      item.locale === target.locale && item.partNumber === target.partNumber
        ? { ...item, companionPart: size.partNumber, companionName }
        : item
    )));
    setSaving(false);
    if (saved) setOpen(false);
  }

  async function restoreAutomaticBand() {
    if (!defaultCompanionPart) return;
    setSaving(true);
    const saved = await setTargets((current) => current.map((item) => (
      item.locale === target.locale && item.partNumber === target.partNumber
        ? { ...item, companionPart: defaultCompanionPart, companionName: undefined }
        : item
    )));
    setSaving(false);
    if (saved) setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => void openPicker(nextOpen)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-0.5 block min-w-0 max-w-full whitespace-normal rounded-sm text-left text-[11px] leading-4 text-muted-foreground/75 outline-none [overflow-wrap:anywhere] hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          title={`${currentLabel}；点击按官网款式、颜色和尺码修改`}
          disabled={disabled}
        >
          送货表带：{currentLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] space-y-4 rounded-xl">
        <PopoverHeader>
          <PopoverTitle>选择精确送货表带</PopoverTitle>
          <PopoverDescription className="leading-5">
            同一表壳在所有门店共用这条表带。送货日期取决于表壳、表带和尺码的完整组合。
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid gap-3">
          <div className="field-group">
            <Label className="control-label">款式与颜色</Label>
            <Select value={choiceValue} onValueChange={(value) => void chooseBand(value)} disabled={loadingChoices || saving}>
              <SelectTrigger className="control-surface w-full">
                <SelectValue placeholder={loadingChoices ? "正在读取 Apple 选项…" : "选择表带款式和颜色"} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((choice) => (
                  <SelectItem
                    key={`${choice.styleKey}::${choice.colorKey}`}
                    value={`${choice.styleKey}::${choice.colorKey}`}
                  >
                    {choice.styleName} · {choice.colorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="field-group">
            <Label className="control-label">尺码</Label>
            <Select value={selectedPart} onValueChange={setSelectedPart} disabled={!choiceValue || loadingSizes || saving}>
              <SelectTrigger className="control-surface w-full">
                <SelectValue placeholder={loadingSizes ? "正在读取 Apple 尺码…" : "选择尺码"} />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((size) => (
                  <SelectItem key={size.partNumber} value={size.partNumber}>
                    {watchBandSizeLabel(size.text)} · {size.partNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => void restoreAutomaticBand()} disabled={!defaultCompanionPart || saving}>
            恢复自动搭配
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>取消</Button>
            <Button size="sm" onClick={() => void applyBand()} disabled={!selectedPart || saving}>
              {saving ? "保存中…" : "应用到同型号"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function App() {
  const ui = useSyncExternalStore(watcherStore.subscribe, watcherStore.getSnapshot);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [watcherBusy, setWatcherBusy] = useState(false);
  const [monitorQuery, setMonitorQuery] = useState("");
  const [monitorExpansionPreferences, setMonitorExpansionPreferences] = useState<MonitorExpansionPreferences>(() => {
    try {
      return parseMonitorExpansion(localStorage.getItem(MONITOR_EXPANSION_STORAGE_KEY));
    } catch {
      return {};
    }
  });
  const [searchMonitorExpansion, setSearchMonitorExpansion] = useState<MonitorExpansionPreferences>({});
  const monitorSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MONITOR_EXPANSION_STORAGE_KEY, JSON.stringify(monitorExpansionPreferences));
    } catch {
      // 本机存储不可用时仍可折叠，只是不记忆重启后的展开状态。
    }
  }, [monitorExpansionPreferences]);

  async function connectEngine() {
    setConnecting(true);
    setConnectionError(null);
    try {
      await connect();
    } catch (error) {
      setConnectionError(`无法连接本地监控引擎：${String(error)}`);
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    void connectEngine();
  }, []);

  useEffect(() => {
    if (!ui.running) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ui.running]);

  const [storeNumbers, setStoreNumbers] = useState<string[]>([]);
  const [partNumbers, setPartNumbers] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [localeChanging, setLocaleChanging] = useState(false);
  const [removingTargetKeys, setRemovingTargetKeys] = useState<Set<string>>(() => new Set());
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [barkDraft, setBarkDraft] = useState<string | null>(null);
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null);
  const [barkError, setBarkError] = useState(false);
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [deliveryDraft, setDeliveryDraft] = useState<DeliveryRegion>({ state: "", city: "", district: "" });
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryLocalities>(EMPTY_DELIVERY_LOCALITIES);
  const [deliveryOptionsLoading, setDeliveryOptionsLoading] = useState(false);
  const [deliveryDirty, setDeliveryDirty] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const deliveryRequestId = useRef(0);

  useEffect(() => {
    if (!ui.ready || deliveryDirty) return;
    setDeliveryDraft(ui.settings.deliveryRegion ?? { state: "", city: "", district: "" });
  }, [ui.ready, ui.settings.deliveryRegion, deliveryDirty]);

  useEffect(() => {
    if (!ui.ready) return;
    const selected = ui.settings.deliveryRegion;
    const requestId = ++deliveryRequestId.current;
    setDeliveryOptionsLoading(true);
    void loadDeliveryLocalities(selected?.state, selected?.city)
      .then((options) => {
        if (deliveryRequestId.current !== requestId) return;
        setDeliveryOptions(options);
        if (selected && (
          !options.states.some((option) => option.value === selected.state)
          || !options.cities.some((option) => option.value === selected.city)
          || !options.districts.some((option) => option.value === selected.district)
        )) {
          setDeliveryDraft({ state: "", city: "", district: "" });
          setDeliveryDirty(true);
          setDeliveryError("此前保存的地址不是 Apple 官方选项，请重新选择。");
        } else {
          setDeliveryError(null);
        }
      })
      .catch((error) => {
        if (deliveryRequestId.current !== requestId) return;
        setDeliveryOptions(EMPTY_DELIVERY_LOCALITIES);
        setDeliveryError(`加载 Apple 地区选项失败：${String(error)}`);
      })
      .finally(() => {
        if (deliveryRequestId.current === requestId) setDeliveryOptionsLoading(false);
      });
  }, [ui.ready, ui.settings.deliveryRegion]);

  async function refreshDeliveryOptions(stateName: string, cityName = "") {
    const requestId = ++deliveryRequestId.current;
    setDeliveryOptionsLoading(true);
    setDeliveryError(null);
    try {
      const options = await loadDeliveryLocalities(stateName, cityName);
      if (deliveryRequestId.current === requestId) setDeliveryOptions(options);
    } catch (error) {
      if (deliveryRequestId.current === requestId) {
        setDeliveryError(`加载 Apple 地区选项失败：${String(error)}`);
      }
    } finally {
      if (deliveryRequestId.current === requestId) setDeliveryOptionsLoading(false);
    }
  }

  async function persistDeliveryRegion(region: DeliveryRegion) {
    setDeliverySaving(true);
    setDeliveryError(null);
    const saved = await saveSettings({ deliveryRegion: region });
    if (saved) {
      setDeliveryDirty(false);
    } else {
      setDeliveryError("送货地区保存失败，请重新选择区或稍后重试。");
    }
    setDeliverySaving(false);
  }

  const barkValue = barkDraft ?? ui.settings.barkUrl;
  const intervalValue = intervalDraft ?? String(ui.settings.intervalSeconds);

  async function persistBark() {
    if (barkDraft === null) return;
    const submitted = barkDraft;
    const saved = await saveSettings({ barkUrl: submitted.trim() });
    setBarkError(!saved);
    if (saved) setBarkDraft((current) => current === submitted ? null : current);
  }

  async function persistInterval() {
    if (intervalDraft === null) return;
    const submitted = intervalDraft;
    const seconds = Number(submitted);
    if (!submitted.trim() || !Number.isFinite(seconds) || seconds < 5) {
      setIntervalError("请输入至少 5 秒的查询间隔。");
      return;
    }
    const saved = await setIntervalSeconds(Math.round(seconds));
    setIntervalError(saved ? null : "查询间隔保存失败，输入已保留。失去焦点时会重试。");
    if (saved) setIntervalDraft((current) => current === submitted ? null : current);
  }

  async function toggleWatching() {
    if (watcherBusy) return;
    setWatcherBusy(true);
    try {
      if (ui.running) await stopWatching();
      else await startWatching();
    } finally {
      setWatcherBusy(false);
    }
  }
  const deliverySelectionValid =
    deliveryOptions.states.some((option) => option.value === deliveryDraft.state)
    && deliveryOptions.cities.some((option) => option.value === deliveryDraft.city)
    && deliveryOptions.districts.some((option) => option.value === deliveryDraft.district);
  const secondsUntilNextCheck = ui.nextCheckAtMs
    ? Math.max(0, Math.ceil((ui.nextCheckAtMs - clockMs) / 1_000))
    : null;
  const runningLabel =
    secondsUntilNextCheck === null || secondsUntilNextCheck === 0
      ? `查询中 · 完成后倒计时 ${ui.settings.intervalSeconds} 秒`
      : ui.cooling
        ? `保护冷却中 · 约 ${secondsUntilNextCheck} 秒后检查`
        : `约 ${secondsUntilNextCheck} 秒后检查`;

  const storeOptions = useMemo(
    () => ui.stores.map((store) => ({ value: store.number, label: store.title })),
    [ui.stores],
  );
  const productOptions = useMemo(
    () =>
      ui.products
        .filter((product) => product.category === ui.category)
        .sort(compareNewestProducts)
        .map((product) => ({
          value: product.partNumber,
          label: compactProductName(product.title),
          description: product.category === "watch"
            ? watchBandDescription(product.companionPart)
            : undefined,
        })),
    [ui.products, ui.category],
  );

  const sortedRows = useMemo(() => sortMonitorsNewestFirst(ui.rows), [ui.rows]);
  const visibleRows = useMemo(() => filterMonitorRows(sortedRows, monitorQuery), [sortedRows, monitorQuery]);
  const monitorGroups = useMemo(() => prioritizeInStockGroups(groupMonitorRows(visibleRows)), [visibleRows]);
  const hasMonitorQuery = monitorQuery.trim().length > 0;
  const expandedMonitorGroups = useMemo(() => new Map(monitorGroups.map((group) => [
    group.key,
    isMonitorGroupExpanded(group.key, group.counts.inStock, monitorExpansionPreferences, hasMonitorQuery, searchMonitorExpansion),
  ])), [monitorGroups, monitorExpansionPreferences, hasMonitorQuery, searchMonitorExpansion]);
  const anyMonitorGroupExpanded = monitorGroups.some((group) => expandedMonitorGroups.get(group.key));

  function updateMonitorQuery(value: string) {
    setMonitorQuery(value);
    setSearchMonitorExpansion({});
  }

  function setMonitorGroupOpen(key: string, open: boolean) {
    const update = (previous: MonitorExpansionPreferences) => previous[key] === open
      ? previous : { ...previous, [key]: open };
    if (hasMonitorQuery) setSearchMonitorExpansion(update);
    else setMonitorExpansionPreferences(update);
  }

  function setAllMonitorGroupsOpen(open: boolean) {
    const update = (previous: MonitorExpansionPreferences) => ({
      ...previous,
      ...Object.fromEntries(monitorGroups.map((group) => [group.key, open])),
    });
    if (hasMonitorQuery) setSearchMonitorExpansion(update);
    else setMonitorExpansionPreferences(update);
  }
  const browserFailure = describeBrowserFailure(ui.rows);
  const browserRunningLabel = secondsUntilNextCheck !== null && secondsUntilNextCheck > 0
    ? `浏览器未连接 · 约 ${secondsUntilNextCheck} 秒后重试`
    : "浏览器未连接 · 正在重新连接";

  const targets = useMemo(() => ui.rows.map((row) => row.target), [ui.rows]);

  useEffect(() => {
    const valid = new Set(storeOptions.map((option) => option.value));
    setStoreNumbers((previous) => {
      const next = previous.filter((value) => valid.has(value));
      return next.length === previous.length ? previous : next;
    });
  }, [storeOptions]);

  useEffect(() => {
    const valid = new Set(productOptions.map((option) => option.value));
    setPartNumbers((previous) => {
      const next = previous.filter((value) => valid.has(value));
      return next.length === previous.length ? previous : next;
    });
  }, [productOptions]);

  const summary = useMemo(() => {
    let inStock = 0;
    let outOfStock = 0;
    let untrusted = 0;
    for (const row of ui.rows) {
      if (row.availability.kind === "in_stock") inStock += 1;
      else if (row.availability.kind === "out_of_stock") outOfStock += 1;
      if (isUntrusted(row.availability)) untrusted += 1;
    }
    return { inStock, outOfStock, untrusted };
  }, [ui.rows]);

  const pendingTargets = useMemo(() => {
    const existing = new Set(targets.map(targetKey));
    const stores = new Map(ui.stores.map((store) => [store.number, store]));
    const products = new Map(ui.products.map((product) => [product.partNumber, product]));
    const pending: Target[] = [];

    for (const storeNumber of storeNumbers) {
      const store = stores.get(storeNumber);
      if (!store) continue;
      for (const partNumber of partNumbers) {
        const product = products.get(partNumber);
        if (!product || product.category !== ui.category) continue;
        const target: Target = {
          locale: ui.settings.locale,
          storeNumber: store.number,
          storeTitle: store.title,
          partNumber: product.partNumber,
          productName: product.title,
          ...(product.companionPart ? { companionPart: product.companionPart } : {}),
          ...(product.kitPart ? { kitPart: product.kitPart } : {}),
        };
        if (!existing.has(targetKey(target))) {
          existing.add(targetKey(target));
          pending.push(target);
        }
      }
    }
    return pending;
  }, [partNumbers, storeNumbers, targets, ui.category, ui.products, ui.settings.locale, ui.stores]);

  const hasCompleteSelection = storeNumbers.length > 0 && partNumbers.length > 0;
  const canAdd = ui.ready && pendingTargets.length > 0 && !isAdding && !localeChanging;
  const duplicateCount = storeNumbers.length * partNumbers.length - pendingTargets.length;

  async function onAdd() {
    if (!canAdd) return;
    setIsAdding(true);
    try {
      if (await setTargets((current) => [...current, ...pendingTargets])) setPartNumbers([]);
    } finally {
      setIsAdding(false);
    }
  }

  async function onRemove(target: Target) {
    const key = targetKey(target);
    setRemoveError(null);
    setRemovingTargetKeys((current) => new Set(current).add(key));
    try {
      const removed = await removeTarget(target);
      if (!removed) {
        setRemoveError(`未能删除“${compactProductName(target.productName)}”，请查看活动日志中的具体原因后重试。`);
      }
    } finally {
      setRemovingTargetKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function onRetryNow() {
    setIsRetrying(true);
    try {
      if (ui.running) await retryWatchingNow();
      else await startWatching();
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="app-canvas min-h-screen text-foreground">
        <main className="flex min-h-screen w-full max-w-none flex-col gap-4 overflow-x-hidden px-5 py-5 min-[900px]:h-screen min-[900px]:overflow-y-auto">
          <header className="app-toolbar flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-1 pt-1 pb-3 sm:gap-5">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="brand-mark" aria-hidden="true">
                <img src="/icon.png" alt="" width={48} height={48} draggable={false} className="size-full object-contain" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg leading-6 font-semibold tracking-[-0.025em]">
                    库存查询器
                  </h1>
                  <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
                    v{packageInfo.version}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
                  Apple 直营店取货库存监控
                </p>
              </div>
            </div>

            <div className="toolbar-actions flex min-w-0 flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-xl text-muted-foreground hover:text-foreground"
                    aria-label="在 GitHub 查看开源项目并下载最新版"
                    onClick={() => void openProjectPage()}
                  >
                    <GithubBrandIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>GitHub 项目与最新版下载</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-xl" aria-label="在 GitHub 下载库存查询器更新" onClick={() => void openReleasePage()}>
                    <Download aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>下载更新</TooltipContent>
              </Tooltip>
              <div className="status-pill max-w-full" role="status" aria-live="polite">
                <span
                  className={`size-2 rounded-full ${ui.running ? browserFailure !== null ? "bg-destructive" : "bg-in-stock shadow-[0_0_12px_var(--in-stock)]" : "bg-muted-foreground/55"}`}
                  aria-hidden="true"
                />
                <span className="hidden text-xs text-muted-foreground sm:inline">监控状态</span>
                <span className="min-w-0 truncate text-sm font-medium">{ui.running ? browserFailure !== null ? browserRunningLabel : runningLabel : "已暂停"}</span>
              </div>
              {ui.running && ui.cooling && (
                <Button
                  variant="outline"
                  className="h-10 rounded-xl px-4"
                  onClick={() => void onRetryNow()}
                  disabled={isRetrying}
                  aria-busy={isRetrying}
                >
                  <RefreshCw className={isRetrying ? "animate-spin" : ""} aria-hidden="true" />
                  {isRetrying ? "正在重试" : "立即重试"}
                </Button>
              )}
              {ui.running ? (
                <Button
                  variant="secondary"
                  className="h-10 rounded-xl px-4"
                  onClick={() => void toggleWatching()}
                  disabled={watcherBusy}
                  aria-busy={watcherBusy}
                >
                  <Pause aria-hidden="true" /> 暂停
                </Button>
              ) : (
                <Button
                  className="h-10 rounded-xl px-4 shadow-[0_8px_24px_-12px_var(--primary)]"
                  onClick={() => void toggleWatching()}
                  disabled={!ui.ready || ui.rows.length === 0 || watcherBusy}
                  aria-busy={watcherBusy}
                >
                  <Play aria-hidden="true" /> 开始监控
                </Button>
              )}
            </div>
          </header>

          {connectionError !== null && (
            <Alert variant="destructive" className="shrink-0 rounded-2xl border-destructive/25 bg-destructive/8 px-4 py-3">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>本地监控引擎连接失败</AlertTitle>
              <AlertDescription>
                <span className="break-words">{connectionError}</span>
                <Button variant="outline" size="sm" disabled={connecting} onClick={() => void connectEngine()}>
                  <RefreshCw className={connecting ? "animate-spin" : undefined} aria-hidden="true" />
                  {connecting ? "正在连接…" : "重新连接"}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {browserFailure !== null && (
            <Alert variant="destructive" className="shrink-0 rounded-2xl border-destructive/25 bg-destructive/8 px-4 py-3">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>查询浏览器未连接</AlertTitle>
              <AlertDescription>
                <span>{browserFailure.split("。")[0]}。</span>
                <span>当前库存尚未更新，请按以下步骤处理：</span>
                <ol className="list-decimal space-y-1 pl-5">
                  {describeBrowserRecovery(browserFailure).map((step) => <li key={step}>{step}</li>)}
                </ol>
                <span className="text-xs">仍无法恢复时，请把“查看详情”中的错误信息、库存查询器版本和浏览器版本通过项目的 GitHub Issues 反馈。{ui.running ? "运行中仍会按设置的间隔尝试连接。" : "当前监控已暂停。"}</span>
                <div className="flex flex-wrap items-center gap-4">
                  <Button variant="outline" size="sm" onClick={() => void onRetryNow()} disabled={isRetrying} aria-busy={isRetrying}>
                    <RefreshCw className={isRetrying ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" />
                    {isRetrying ? "正在连接…" : ui.running ? "处理后重试" : "开始监控"}
                  </Button>
                  <details className="min-w-0 text-xs">
                    <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">查看详情</summary>
                    <p className="mt-2 break-words">{browserFailure}</p>
                    <p className="mt-1 break-words">启动诊断（如已生成）位于查询浏览器专属目录的 browser-startup.log 中。</p>
                  </details>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {ui.trouble !== null && browserFailure === null && (
            <Alert variant="destructive" className="shrink-0 rounded-2xl border-destructive/25 bg-destructive/8 px-4 py-3">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>监控结果暂不可信</AlertTitle>
              <AlertDescription>
                {ui.trouble.reason}
                <span>列表状态可能不代表真实库存，请先排查后再继续等待。</span>
                {ui.trouble.advice !== null && (
                  <span className="font-medium">{describeAdvice(ui.trouble.advice)}</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className={`workspace-grid grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_22.5rem] min-[1080px]:grid-cols-[minmax(0,1fr)_25rem] min-[1440px]:grid-cols-[minmax(0,1fr)_26.25rem] ${connectionError !== null || browserFailure !== null || ui.trouble !== null ? "min-[900px]:min-h-[34rem]" : ""}`}>
            <div className="flex min-h-0 min-w-0 flex-col gap-4">
              <section className="surface-panel create-monitor-panel shrink-0 p-4" aria-labelledby="create-monitor-title">
                <div className="create-monitor-heading mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="section-icon text-primary" aria-hidden="true">
                      <Plus className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 id="create-monitor-title" className="text-sm font-semibold">新建监控</h2>
                      <p className="create-monitor-description mt-0.5 text-xs leading-5 text-muted-foreground">选择想要追踪的门店与型号</p>
                    </div>
                  </div>
                  {hasCompleteSelection && (
                    <Badge className="border-primary/20 bg-primary/10 text-primary" variant="outline">
                      {storeNumbers.length} × {partNumbers.length}
                    </Badge>
                  )}
                </div>

                <div className="create-monitor-fields grid grid-cols-1 items-start gap-3 min-[540px]:grid-cols-2 min-[1600px]:grid-cols-[0.9fr_0.9fr_1.3fr_2fr]">
                  <div className="field-group">
                    <Label className="control-label">
                      <MapPin className="size-3.5" aria-hidden="true" /> 地区
                    </Label>
                    <Combobox
                      className="control-surface w-full"
                      options={ui.regions.map((region) => ({ value: region.locale, label: region.title }))}
                      value={ui.settings.locale}
                      onChange={async (locale) => {
                        if (locale === ui.settings.locale) return;
                        setLocaleChanging(true);
                        setStoreNumbers([]);
                        setPartNumbers([]);
                        try {
                          await changeLocale(locale);
                        } finally {
                          setLocaleChanging(false);
                        }
                      }}
                      placeholder="选择地区"
                      searchPlaceholder="搜索地区…"
                      emptyText="没有匹配的地区"
                      disabled={!ui.ready || isAdding || localeChanging}
                    />
                  </div>

                  <div className="field-group">
                    <Label className="control-label">
                      <Smartphone className="size-3.5" aria-hidden="true" /> 品类
                    </Label>
                    <Combobox
                      className="control-surface w-full"
                      options={ui.categories.map((category) => ({ value: category.value, label: category.title }))}
                      value={ui.category}
                      onChange={(value) => {
                        setPartNumbers([]);
                        setCategory(value as Category);
                      }}
                      placeholder="选择品类"
                      searchPlaceholder="搜索品类…"
                      emptyText="没有匹配的品类"
                      disabled={!ui.ready || isAdding || localeChanging || ui.categories.length === 0}
                    />
                  </div>

                  <div className="field-group">
                    <Label className="control-label">
                      <MapPin className="size-3.5" aria-hidden="true" /> 门店
                      <span className="font-normal text-muted-foreground">可多选</span>
                    </Label>
                    <MultiCombobox
                      key={`stores-${ui.settings.locale}`}
                      className="control-surface w-full"
                      options={storeOptions}
                      values={storeNumbers}
                      onChange={setStoreNumbers}
                      placeholder="选择自提门店"
                      searchPlaceholder="搜索门店…"
                      emptyText="没有匹配的门店"
                      selectionUnit="家门店"
                      disabled={!ui.ready || isAdding || localeChanging || storeOptions.length === 0}
                    />
                  </div>

                  <div className="field-group">
                    <Label className="control-label">
                      <PackageCheck className="size-3.5" aria-hidden="true" /> 型号
                      <span className="font-normal text-muted-foreground">可多选</span>
                    </Label>
                    <MultiCombobox
                      key={`products-${ui.settings.locale}-${ui.category}`}
                      className="control-surface w-full"
                      options={productOptions}
                      values={partNumbers}
                      onChange={setPartNumbers}
                      placeholder="选择型号"
                      searchPlaceholder="搜索型号…"
                      emptyText="没有匹配的型号"
                      selectionUnit="个型号"
                      disabled={!ui.ready || isAdding || localeChanging || productOptions.length === 0}
                    />
                    {ui.category === "watch" ? (
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        Watch 先使用默认表带查询，也可在监控列表中选择款式、颜色和尺码。
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="create-monitor-actions mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/55 pt-3">
                  <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground" role="status">
                    {hasCompleteSelection
                      ? `将新增 ${pendingTargets.length} 条监控${duplicateCount > 0 ? `，跳过 ${duplicateCount} 条已有组合` : ""}`
                      : localeChanging ? "正在切换地区，读取门店与型号…" : "选择门店与型号，即可添加监控。"}
                  </p>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon-lg"
                          className="rounded-xl border-border/70 bg-background/40"
                          aria-label="从 Apple 官网更新门店列表和当前品类的型号"
                          disabled={ui.refreshing}
                          onClick={() => void refreshProducts()}
                        >
                          <RefreshCw className={ui.refreshing ? "animate-spin" : undefined} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>从 Apple 官网更新门店列表和当前品类的型号</TooltipContent>
                    </Tooltip>
                    <Button
                      className="h-10 min-w-28 rounded-xl px-4"
                      onClick={() => void onAdd()}
                      disabled={!canAdd}
                    >
                      <Plus aria-hidden="true" />
                      {isAdding
                        ? "添加中…"
                        : canAdd
                          ? `添加 ${pendingTargets.length} 项`
                          : hasCompleteSelection
                            ? "已在列表中"
                            : "添加监控"}
                    </Button>
                  </div>
                </div>
              </section>

              <section className="surface-panel monitor-list-panel flex min-h-[360px] min-w-0 flex-1 min-[900px]:min-h-0 flex-col overflow-hidden" aria-labelledby="monitor-list-title">
                <div className="monitor-list-toolbar flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="section-icon" aria-hidden="true">
                      <Activity className="size-4" />
                    </div>
                    <h2 id="monitor-list-title" className="text-sm font-semibold">监控列表</h2>
                    <span id="monitor-filter-summary" role="status" aria-live="polite" className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">
                      {hasMonitorQuery ? `${visibleRows.length} / ${ui.rows.length}` : ui.rows.length} 项
                      {ui.rows.length > 0 ? <span> · {hasMonitorQuery ? "匹配 " : ""}{monitorGroups.length} 家门店</span> : null}
                      {hasMonitorQuery ? <span className="sr-only">，仅筛选显示，不影响后台监控。</span> : null}
                    </span>
                  </div>
                  {ui.rows.length > 0 || monitorQuery.length > 0 ? (
                    <div className="monitor-list-controls flex min-w-0 basis-full items-center gap-2 min-[720px]:basis-auto">
                      {monitorGroups.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 rounded-lg px-2 text-xs text-muted-foreground"
                          aria-label={`全部${anyMonitorGroupExpanded ? "收起" : "展开"}${hasMonitorQuery ? "匹配" : ""}门店`}
                          onClick={() => setAllMonitorGroupsOpen(!anyMonitorGroupExpanded)}
                        >
                          <ChevronDown className={`size-3.5 ${anyMonitorGroupExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                          {anyMonitorGroupExpanded ? "全部收起" : "全部展开"}
                        </Button>
                      ) : null}
                      <div className="relative min-w-0 flex-1 min-[720px]:w-32 min-[720px]:flex-none min-[1080px]:w-40 min-[1280px]:w-44">
                        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                          ref={monitorSearchRef}
                          role="searchbox"
                          aria-label="查找监控"
                          aria-describedby="monitor-filter-summary"
                          placeholder="门店 / 型号"
                          autoComplete="off"
                          spellCheck={false}
                          className={`h-9 rounded-lg bg-background/50 pl-9 text-xs shadow-none md:text-xs ${monitorQuery ? "pr-9" : "pr-3"}`}
                          value={monitorQuery}
                          onChange={(event) => updateMonitorQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape" && !event.nativeEvent.isComposing && monitorQuery) {
                              event.preventDefault();
                              updateMonitorQuery("");
                            }
                          }}
                        />
                        {monitorQuery ? (
                          <button type="button" aria-label="清除监控筛选" className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { updateMonitorQuery(""); monitorSearchRef.current?.focus(); }}>
                            <X className="size-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                {removeError ? (
                  <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/8 px-4 py-2.5 text-xs leading-5 text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{removeError}</span>
                  </div>
                ) : null}

                {ui.rows.length === 0 ? (
                  <div className="monitor-empty-state flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-5 text-center" role="status">
                    <div className="monitor-empty-icon mb-3 flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/6 text-primary shadow-[0_4px_18px_-8px_var(--primary)]">
                      <Radar className="size-6" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {connectionError ? "监控引擎尚未连接" : ui.ready ? "还没有监控项目" : "正在载入目录…"}
                    </p>
                    <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                      {connectionError ? "请点击上方重新连接，恢复门店与型号目录。" : ui.ready ? "从上方选择门店和型号，添加后即可开始监控。" : "正在连接本地监控引擎，请稍候。"}
                    </p>
                  </div>
                ) : visibleRows.length === 0 ? (
                  <div className="monitor-empty-state flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-5 text-center" role="status">
                    <Search className="size-6 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                    <p className="text-sm font-medium">没有匹配的监控</p>
                    <p className="text-xs leading-5 text-muted-foreground">试试其他关键词，或清除筛选查看全部监控。</p>
                    <Button variant="ghost" size="sm" className="h-8 text-primary" onClick={() => { updateMonitorQuery(""); monitorSearchRef.current?.focus(); }}>清除筛选</Button>
                  </div>
                ) : (
                  <ScrollArea aria-label="监控列表内容，可上下滚动" className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:overflow-visible">
                    <Table className="monitor-table w-full table-fixed">
                      <caption className="sr-only">按门店分组的监控列表，有货门店和有货型号优先。点击门店标题展开或收起，折叠不影响后台监控。查找期间默认展开匹配门店，摘要仅统计当前匹配型号。待确认包括待查询、待开放或暂停取货；查询异常对应右侧未确认项目。</caption>
                      <colgroup>
                        <col />
                        <col className="monitor-status-column" />
                        <col className="monitor-actions-column" />
                      </colgroup>
                      <TableHeader className="sticky top-0 z-10 bg-card/95">
                        <TableRow className="hover:bg-transparent">
                          <TableHead scope="col" className="px-3 text-[11px] text-muted-foreground">型号与送货</TableHead>
                          <TableHead scope="col" className="px-2 text-center text-[11px] text-muted-foreground">取货状态</TableHead>
                          <TableHead scope="col" className="px-0 text-center text-[11px] text-muted-foreground">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      {monitorGroups.map((storeGroup) => {
                        const groupId = `monitor-store-${encodeURIComponent(storeGroup.key)}`;
                        const expanded = expandedMonitorGroups.get(storeGroup.key) ?? false;
                        const regionTitle = ui.regions.find((region) => region.locale === storeGroup.locale)?.title ?? storeGroup.locale;
                        return (
                          <Fragment key={storeGroup.key}>
                            <TableBody aria-labelledby={`${groupId}-name ${groupId}-meta`}>
                              <TableRow className="monitor-store-heading border-t border-border/70 bg-muted/55 hover:bg-muted/55">
                                <TableHead scope="row" colSpan={3} className="h-auto whitespace-normal p-0">
                                  <h3 className="m-0">
                                    <button
                                      type="button"
                                      className="monitor-store-toggle monitor-store-heading-layout flex min-h-14 w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 text-left outline-none hover:bg-primary/4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                      aria-expanded={expanded}
                                      aria-controls={`${groupId}-models`}
                                      aria-describedby={`${groupId}-summary`}
                                      aria-label={`${expanded ? "收起" : "展开"}门店：${storeGroup.storeTitle}（${regionTitle} · ${storeGroup.storeNumber}）`}
                                      onClick={() => setMonitorGroupOpen(storeGroup.key, !expanded)}
                                    >
                                      <span className="flex min-w-0 flex-1 items-start gap-2">
                                        <ChevronDown className={`mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />
                                        <span className="flex min-w-0 flex-col">
                                          <span id={`${groupId}-name`} className="monitor-store-name text-[13px] font-semibold leading-5 [overflow-wrap:anywhere]">{storeGroup.storeTitle}</span>
                                          <span id={`${groupId}-meta`} className="mt-0.5 text-[10px] font-normal leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                                            {regionTitle} · {storeGroup.storeNumber} · {hasMonitorQuery ? "匹配 " : ""}{storeGroup.rows.length} 型号
                                          </span>
                                        </span>
                                      </span>
                                      <span id={`${groupId}-summary`} className="monitor-store-summary flex min-w-0 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-medium leading-4 tabular-nums">
                                        {storeGroup.counts.inStock > 0 ? <span className="inline-flex items-center gap-1 rounded-md bg-in-stock/12 px-1.5 py-1 font-semibold text-in-stock"><PackageCheck className="size-3 shrink-0" aria-hidden="true" />{storeGroup.counts.inStock} 有货</span> : null}
                                        {storeGroup.counts.unavailable > 0 ? <span className="text-muted-foreground">{storeGroup.counts.unavailable} 不可取货</span> : null}
                                        {storeGroup.counts.pending > 0 ? <span className="text-muted-foreground">{storeGroup.counts.pending} 待确认</span> : null}
                                        {storeGroup.counts.unconfirmed > 0 ? <span className="text-unknown">{storeGroup.counts.unconfirmed} 查询异常</span> : null}
                                      </span>
                                    </button>
                                  </h3>
                                </TableHead>
                              </TableRow>
                            </TableBody>
                            <TableBody
                              id={`${groupId}-models`}
                              aria-labelledby={`${groupId}-name ${groupId}-meta`}
                              hidden={!expanded}
                              onFocusCapture={() => setMonitorGroupOpen(storeGroup.key, true)}
                              onPointerDownCapture={() => setMonitorGroupOpen(storeGroup.key, true)}
                            >
                              {expanded ? storeGroup.rows.map((row) => {
                                const rowKey = targetKey(row.target);
                                const removing = removingTargetKeys.has(rowKey);
                                return (
                                  <TableRow key={rowKey} data-availability={row.availability.kind} className="monitor-model-row group hover:bg-primary/4 focus-within:bg-muted/25">
                                    <TableCell className="monitor-product-cell min-w-0 align-top whitespace-normal px-3 py-2.5">
                                      <button
                                        className="monitor-product-name block max-w-full rounded-sm text-left text-[13px] font-medium leading-5 text-foreground/90 outline-none [overflow-wrap:anywhere] hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                        aria-label={`打开商品页：${row.target.productName}`}
                                        title={row.target.productName}
                                        onClick={() => void openTargetProduct(row.target)}
                                      >
                                        {row.target.productName}
                                      </button>
                                      {row.target.companionPart && row.target.kitPart ? (
                                        <WatchBandPicker
                                          target={row.target}
                                          defaultCompanionPart={ui.products.find((product) => product.partNumber === row.target.partNumber)?.companionPart}
                                          disabled={isAdding}
                                        />
                                      ) : null}
                                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] leading-4 text-muted-foreground">
                                        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                                          <Truck className="size-3 shrink-0" aria-hidden="true" />
                                          <DeliveryBadge pickupDetails={row.pickupDetails} lastCheckedMs={row.lastCheckedMs} />
                                        </span>
                                        <span className="inline-flex min-w-0 items-center gap-1.5 tabular-nums" aria-label={row.lastCheckedMs !== null ? `最后检查：${formatTime(row.lastCheckedMs)}` : "尚未检查"}>
                                          <Clock3 className="size-3 shrink-0" aria-hidden="true" />
                                          {row.lastCheckedMs !== null ? `检查 ${formatTime(row.lastCheckedMs)}` : "尚未检查"}
                                        </span>
                                      </div>
                                    </TableCell>
                                    <TableCell className="monitor-status-cell min-w-0 align-top whitespace-normal px-2 py-2.5 text-center">
                                      <StatusBadge availability={row.availability} pickupDetails={row.pickupDetails} />
                                    </TableCell>
                                    <TableCell className="monitor-actions-cell align-top px-0 py-2.5">
                                      <div className="monitor-row-actions">
                                        <ProductBarkRoute
                                          target={row.target}
                                          customUrl={ui.settings.productBarkUrls[row.target.partNumber]}
                                          disabled={isAdding}
                                          compact
                                        />
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon-sm"
                                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                              aria-label={`${removing ? "正在删除监控" : "删除监控"}：${row.target.storeTitle} · ${row.target.productName}`}
                                              aria-busy={removing}
                                              disabled={isAdding || removing}
                                              onClick={() => void onRemove(row.target)}
                                            >
                                              {removing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>删除这条监控</TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              }) : null}
                            </TableBody>
                          </Fragment>
                        );
                      })}
                    </Table>
                  </ScrollArea>
                )}
              </section>
            </div>

            <aside
              className="workspace-sidebar flex min-h-0 min-w-0 flex-col gap-3 min-[900px]:overflow-y-auto min-[900px]:overscroll-contain min-[900px]:pr-2"
              aria-label="监控概览、设置与活动日志"
            >
              <fieldset disabled={!ui.ready} className="contents" aria-label="监控设置与活动日志">
              <section className="surface-panel summary-strip grid shrink-0 grid-cols-4 divide-x divide-border/60 overflow-hidden" aria-label="监控概览">
                <div className="metric-tile">
                  <Radar className="size-4 text-primary" aria-hidden="true" />
                  <span className="metric-value">{ui.rows.length}</span>
                  <span className="metric-label">监控</span>
                </div>
                <div className="metric-tile">
                  <PackageCheck className="size-4 text-in-stock" aria-hidden="true" />
                  <span className="metric-value text-in-stock">{summary.inStock}</span>
                  <span className="metric-label">有货</span>
                </div>
                <div className="metric-tile">
                  <PackageX className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="metric-value">{summary.outOfStock}</span>
                  <span className="metric-label">不可取货</span>
                </div>
                <div className="metric-tile">
                  <AlertTriangle className={`size-4 ${summary.untrusted > 0 ? "text-unknown" : "text-muted-foreground"}`} aria-hidden="true" />
                  <span className={`metric-value ${summary.untrusted > 0 ? "text-unknown" : ""}`}>{summary.untrusted}</span>
                  <span className="metric-label">未确认</span>
                </div>
              </section>

              <CollapsiblePanel
                id="preferences"
                icon={<Settings2 className="size-4" />}
                title="监控设置"
                subtitle="查询频率与提醒方式"
                compact
                summary={[
                  `每 ${ui.settings.intervalSeconds} 秒`,
                  ui.settings.soundEnabled ? "提示音开" : "提示音关",
                  ui.settings.barkUrl ? "Bark 已设置" : "未设 Bark",
                ].join(" · ")}
              >
                <div className="space-y-3">
                  <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
                    <Label htmlFor="interval" className="text-sm font-normal">查询间隔</Label>
                    <div className="relative min-w-0">
                      <Input
                        id="interval"
                        type="number"
                        min={5}
                        className="control-surface select-text pr-12 tabular-nums"
                        value={intervalValue}
                        aria-invalid={intervalError !== null}
                        aria-describedby={intervalError ? "interval-error" : undefined}
                        onChange={(event) => {
                          setIntervalDraft(event.target.value);
                          setIntervalError(null);
                        }}
                        onBlur={() => void persistInterval()}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">秒</span>
                    </div>
                    {intervalError ? <p id="interval-error" role="alert" className="col-span-2 text-xs leading-5 text-destructive">{intervalError}</p> : null}
                  </div>

                  <div className="field-group">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <Label htmlFor="bark" className="text-sm font-normal">默认 Bark 推送</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" aria-label="Bark 推送说明" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <Info className="size-3.5" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 leading-5">监控列表可为某个型号指定其他人的 Bark 地址。</TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      id="bark"
                      className="control-surface select-text"
                      placeholder="https://api.day.app/你的BarkKey"
                      value={barkValue}
                      aria-invalid={barkError}
                      aria-describedby={barkError ? "bark-error" : undefined}
                      onChange={(event) => {
                        setBarkDraft(event.target.value);
                        setBarkError(false);
                      }}
                      onBlur={() => void persistBark()}
                    />
                    {barkError ? <p id="bark-error" role="alert" className="text-xs leading-5 text-destructive">Bark 地址保存失败，输入已保留。失去焦点时会重试。</p> : null}
                  </div>

                  <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
                    <Label htmlFor="open-on-hit" className="text-sm font-normal">到货后打开</Label>
                    <Select
                      value={ui.settings.openOnHit}
                      onValueChange={(value) => void saveSettings({ openOnHit: value as OpenOnHit })}
                    >
                      <SelectTrigger id="open-on-hit" className="control-surface w-full min-w-0" aria-label="到货后打开">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="none">不自动打开</SelectItem>
                        <SelectItem value="bag">购物袋</SelectItem>
                        <SelectItem value="education_bag">跳转至教育商店购物袋</SelectItem>
                        <SelectItem value="product">商品详情</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="divide-y divide-border/50 border-y border-border/50">
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <Label htmlFor="sound" className="text-sm font-normal">提示音</Label>
                      <Switch
                        id="sound"
                        aria-label="提示音"
                        checked={ui.settings.soundEnabled}
                        onCheckedChange={(value) => void saveSettings({ soundEnabled: value })}
                      />
                    </div>
                    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Label htmlFor="stop-on-hit" className="text-sm font-normal">到货后暂停监控</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" aria-label="到货后暂停监控说明" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              <Info className="size-3.5" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64 leading-5">
                            {ui.settings.stopOnHit
                              ? "任意一条监控到有货后暂停监控，提醒和自动结账只执行这一轮，需要时再手动开始。"
                              : "持续有货时，每一轮查询都会重新提醒；开启了自动结账且上一次没有成功时，也会再次尝试。"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Switch
                        id="stop-on-hit"
                        aria-label="到货后暂停监控"
                        checked={ui.settings.stopOnHit}
                        onCheckedChange={(value) => void saveSettings({ stopOnHit: value })}
                      />
                    </div>
                  </div>

                  <Button variant="outline" className="h-10 w-full rounded-xl border-border/70 bg-background/30" onClick={() => void testNotify()}>
                    <BellRing aria-hidden="true" /> 测试提醒与跳转
                  </Button>
                </div>
              </CollapsiblePanel>

              <CollapsiblePanel
                id="delivery"
                icon={<MapPin className="size-4" />}
                title="送货地区"
                subtitle="可选；选完省、市、区后自动保存，仅用于中国大陆送货日期查询"
                compact
                defaultOpen={false}
                summary={
                  deliveryError ? <span role="alert" className="text-destructive">{deliveryError}</span>
                  : deliverySaving ? "正在保存送货地区…"
                  : deliveryOptionsLoading ? "正在读取地区…"
                  : deliveryDirty ? deliverySelectionValid ? "即将保存送货地区" : "继续选择省、市、区"
                  : ui.settings.deliveryRegion ? `${ui.settings.deliveryRegion.city} · ${ui.settings.deliveryRegion.district}`
                  : "未设置 · 送货日期未启用"
                }
              >
                <div className="field-group">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted-foreground">中国大陆</span>
                    <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
                      {deliverySaving
                        ? "保存中…"
                        : deliveryOptionsLoading
                        ? "读取官网…"
                        : deliveryDirty
                          ? deliverySelectionValid ? "即将保存" : "继续选择"
                          : ui.settings.deliveryRegion ? "已生效" : "未设置"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <Select
                      value={deliveryOptions.states.some((option) => option.value === deliveryDraft.state) ? deliveryDraft.state : ""}
                      disabled={deliveryOptionsLoading || deliveryOptions.states.length === 0}
                      onValueChange={(value) => {
                        setDeliveryDirty(true);
                        setDeliveryError(null);
                        setDeliveryDraft({ state: value, city: "", district: "" });
                        void refreshDeliveryOptions(value);
                      }}
                    >
                      <SelectTrigger aria-label="省份" className="control-surface w-full min-w-0">
                        <SelectValue placeholder="省份" />
                      </SelectTrigger>
                      <SelectContent>
                        {deliveryOptions.states.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.text}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={deliveryOptions.cities.some((option) => option.value === deliveryDraft.city) ? deliveryDraft.city : ""}
                      disabled={deliveryOptionsLoading || !deliveryDraft.state || deliveryOptions.cities.length === 0}
                      onValueChange={(value) => {
                        setDeliveryDirty(true);
                        setDeliveryError(null);
                        setDeliveryDraft((previous) => ({ ...previous, city: value, district: "" }));
                        void refreshDeliveryOptions(deliveryDraft.state, value);
                      }}
                    >
                      <SelectTrigger aria-label="城市" className="control-surface w-full min-w-0">
                        <SelectValue placeholder="城市" />
                      </SelectTrigger>
                      <SelectContent>
                        {deliveryOptions.cities.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.text}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={deliveryOptions.districts.some((option) => option.value === deliveryDraft.district) ? deliveryDraft.district : ""}
                      disabled={deliveryOptionsLoading || !deliveryDraft.city || deliveryOptions.districts.length === 0}
                      onValueChange={(value) => {
                        const next = { ...deliveryDraft, district: value };
                        setDeliveryDirty(true);
                        setDeliveryError(null);
                        setDeliveryDraft(next);
                        void persistDeliveryRegion(next);
                      }}
                    >
                      <SelectTrigger aria-label="区" className="control-surface w-full min-w-0">
                        <SelectValue placeholder="区" />
                      </SelectTrigger>
                      <SelectContent>
                        {deliveryOptions.districts.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.text}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] leading-4 text-muted-foreground">
                      与上方当前地区无关，仅用于中国大陆监控；选完“区”后自动保存。{ui.running ? "下轮会更新送货日期。" : "启动监控后会查询送货日期。"}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 rounded-lg px-2 text-muted-foreground"
                      disabled={deliverySaving || (!ui.settings.deliveryRegion && !deliveryDirty)}
                      onClick={async () => {
                        setDeliverySaving(true);
                        const saved = await saveSettings({ deliveryRegion: null });
                        if (saved) {
                          setDeliveryDraft({ state: "", city: "", district: "" });
                          setDeliveryDirty(false);
                          setDeliveryError(null);
                        } else {
                          setDeliveryError("清除送货地区失败，请稍后重试。");
                        }
                        setDeliverySaving(false);
                      }}
                    >
                      清除
                    </Button>
                  </div>
                  {deliveryError ? (
                    <p role="alert" className="text-[11px] leading-4 text-destructive">{deliveryError}</p>
                  ) : null}
                </div>

              </CollapsiblePanel>

              <CheckoutSettings checkout={ui.settings.checkout} targets={ui.settings.targets} />

              <NetworkSettings network={ui.settings.network} running={ui.running} route={ui.route} />

              <CollapsiblePanel
                id="activity-log"
                icon={<SquareTerminal className="size-4" />}
                title="活动日志"
                subtitle="最近的查询与提醒记录"
                summary={ui.logs.length ? `最新 ${ui.logs.length} 条记录` : "暂无活动记录"}
                compact
                defaultOpen={false}
              >
                <ScrollArea className="h-48 min-w-0" aria-label="活动日志内容">
                  <pre className="pr-3 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words text-foreground/80 select-text">
                    {ui.logs.length === 0 ? "等待监控活动…" : ui.logs.join("\n")}
                  </pre>
                </ScrollArea>
              </CollapsiblePanel>
              </fieldset>
            </aside>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
