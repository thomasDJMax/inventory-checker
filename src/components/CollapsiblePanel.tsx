import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const STORAGE_PREFIX = "apw.panel.";

/** null 表示还没有本机偏好，交由面板按当前配置决定默认状态。 */
function readOpen(id: string): boolean | null {
  try {
    const value = localStorage.getItem(STORAGE_PREFIX + id);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, open ? "1" : "0");
  } catch {
    // 私密窗口或存储被禁用时只影响记忆，不影响折叠本身。
  }
}

interface CollapsiblePanelProps {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  /** 折叠后在标题下显示的当前状态摘要。 */
  summary: ReactNode;
  /** 只在没有已保存的折叠偏好时使用。 */
  defaultOpen?: boolean;
  /** 精简标题区；展开时把副标题留给辅助技术读取。 */
  compact?: boolean;
  children: ReactNode;
}

/** 侧栏可折叠面板。折叠后只保留标题和摘要，把空间让给活动日志。 */
export function CollapsiblePanel({ id, icon, title, subtitle, summary, defaultOpen = true, compact = false, children }: CollapsiblePanelProps) {
  const [preferredOpen, setPreferredOpen] = useState(() => readOpen(id));
  // 设置异步载入时继续采用真实配置；用户操作正文或标题后锁定当前状态。
  const open = preferredOpen ?? defaultOpen;
  const lockOpen = () => setPreferredOpen((current) => current ?? open);
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const descriptionId = `${id}-description`;

  return (
    <section className="surface-panel min-w-0 shrink-0" aria-labelledby={titleId}>
      {/* 标准折叠面板结构：标题包住按钮，按钮内只放行内元素。 */}
      <h2 id={titleId} className="m-0">
        <button
          type="button"
          className={`flex w-full min-w-0 items-center gap-3 rounded-2xl text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${compact ? "min-h-14 px-4 py-2" : "px-5 py-4"} ${open ? "rounded-b-none border-b border-border/60" : ""}`}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-describedby={compact ? descriptionId : undefined}
          onClick={() => {
            setPreferredOpen(!open);
            writeOpen(id, !open);
          }}
        >
          <span className="section-icon" aria-hidden="true">{icon}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`text-sm font-semibold leading-5 ${compact ? "truncate" : ""}`}>{title}</span>
            {!compact || !open ? (
              <span className={`mt-0.5 text-xs font-normal text-muted-foreground ${compact ? "truncate leading-4" : "line-clamp-2 leading-5"}`}>{open ? subtitle : summary}</span>
            ) : null}
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </h2>
      {compact ? <span id={descriptionId} className="sr-only">{subtitle}</span> : null}
      {open ? (
        <div
          id={bodyId}
          className={compact ? "min-w-0 px-4 pt-3 pb-4" : "min-w-0 px-5 pt-4 pb-5"}
          onFocusCapture={lockOpen}
          onPointerDownCapture={lockOpen}
          onClickCapture={lockOpen}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
