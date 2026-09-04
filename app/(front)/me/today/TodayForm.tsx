"use client";

/**
 * /me/today client wrapper around FormRenderer (PLAN T15; CLAUDE.md §8).
 *
 * Block one 「昨日計畫結算」: above each `result.item{i}.status` question
 * (matched by slot, not by key, so a future version keeps working) the
 * yesterday item is shown as 「昨日項目一：{text}（預計 {expect}）」; when
 * there is no previous log the block opens with 「昨天沒有計畫，請選『昨日無此項』」
 * and the three status questions stay required (§11 9/2 case). When the
 * previous log exists but its version cannot be loaded
 * (`previousVersionMissing`) the page shows the error alert, no per-item
 * hint is rendered and the submit button is disabled. Block two
 * 「今日回報與明日計畫」 is the rest of the version, unchanged.
 *
 * 「最重要」 badge: `plan.top_priority` stores an option label, and the label
 * is mapped to an item by INDEX in that question's options
 * (items[i] ↔ options[i]) — never by the literal 「項目一／二／三」. Yesterday's
 * plan uses the options of ITS version (`YesterdayInfo.topOptions`, from the
 * page); tomorrow's list uses the active version's. No question or no
 * matching index → no badge.
 *
 * Saving: the Server Action (`submitDailyLog`) is wrapped client-side only to
 * observe its result. On `ok` the wrapper swallows the renderer's message and
 * shows a success card — 「已儲存今日日誌」 plus tomorrow's three items
 * (`plan.item1–3.text`, the `plan.top_priority` one marked). The items come
 * from `savedPlan`, which the page re-reads from today's row after the
 * action's `revalidatePath` (DECISIONS D-27); the just-submitted FormData is
 * the fallback for the first paint. The form stays below, still editable.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { FormRenderer, type FormAction, type FormActionState } from "@/components/forms/FormRenderer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { readYesterdayPlan, type YesterdayPlan } from "@/lib/forms/resolve";
import { sortByOrder, type Answers, type Question } from "@/lib/forms/schema";
import type { Slot } from "@/lib/forms/slots";

export const NO_YESTERDAY_PLAN_MESSAGE = "昨天沒有計畫，請選『昨日無此項』";
export const SAVED_TITLE = "已儲存今日日誌";
export const TOMORROW_TITLE = "明日該做的三件事";

type ItemNo = 1 | 2 | 3;

/** `result.item{i}.status` slot → item number. */
const RESULT_STATUS_SLOTS: Partial<Record<Slot, ItemNo>> = {
  "result.item1.status": 1,
  "result.item2.status": 2,
  "result.item3.status": 3,
};

/** Every slot that belongs to block one (status + reason of the three items). */
const BLOCK_ONE_SLOTS = new Set<Slot>([
  "result.item1.status",
  "result.item1.reason",
  "result.item2.status",
  "result.item2.reason",
  "result.item3.status",
  "result.item3.reason",
]);

const CN_NUMERALS: Record<ItemNo, string> = { 1: "一", 2: "二", 3: "三" };

/** Options of a version's (enabled) `plan.top_priority` question; null when it has none. */
export function topPriorityOptions(questions: readonly Question[]): readonly string[] | null {
  return questions.find((q) => !q.disabled && q.slot === "plan.top_priority")?.options ?? null;
}

/** The item `top` points at: `options[i - 1] === top`; null when there is no question / no match. */
export function topItemNo(top: string | null, options: readonly string[] | null): ItemNo | null {
  if (top === null || !options) return null;
  const index = options.indexOf(top);
  return index === 0 || index === 1 || index === 2 ? ((index + 1) as ItemNo) : null;
}

export interface YesterdayInfo {
  /** Display label of the previous log's date (page-formatted, e.g. 9/3). */
  dateLabel: string;
  plan: YesterdayPlan;
  /** `plan.top_priority` options of the previous log's OWN version (badge index mapping). */
  topOptions: readonly string[] | null;
}

export interface TodayFormProps {
  questions: readonly Question[];
  /** Today's saved answers (edit mode) or null for a fresh form. */
  initialAnswers: Answers | null;
  /** Previous log's plan, or null when the newcomer has no earlier log. */
  yesterday: YesterdayInfo | null;
  /**
   * The previous log exists but its form version could not be loaded: the
   * page shows the error alert; here no per-item hint is rendered and the
   * submit button is disabled.
   */
  previousVersionMissing?: boolean;
  /** Plan read from today's saved row (null until something is saved today). */
  savedPlan: YesterdayPlan | null;
  action: FormAction;
}

function isBlockOne(question: Question): boolean {
  return question.slot != null && BLOCK_ONE_SLOTS.has(question.slot);
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-t pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function YesterdayItem({
  no,
  yesterday,
}: {
  no: ItemNo;
  yesterday: YesterdayInfo | null;
}) {
  if (!yesterday) return null;
  const item = yesterday.plan.items[no - 1];
  if (item.text === null) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        昨日沒有項目{CN_NUMERALS[no]}，請選『昨日無此項』
      </p>
    );
  }
  const isTop = topItemNo(yesterday.plan.top, yesterday.topOptions) === no;
  return (
    <div className="rounded-md bg-muted px-3 py-2 text-sm" data-testid={`yesterday-item-${no}`}>
      <span className="font-medium">昨日項目{CN_NUMERALS[no]}：</span>
      <span className="break-words">{item.text}</span>
      {item.expect !== null ? <span>（預計 {item.expect}）</span> : null}
      {isTop ? (
        <Badge variant="secondary" className="ml-2 align-middle">
          最重要
        </Badge>
      ) : null}
    </div>
  );
}

function TomorrowList({
  plan,
  topOptions,
}: {
  plan: YesterdayPlan;
  /** `plan.top_priority` options of the active version (badge index mapping). */
  topOptions: readonly string[] | null;
}) {
  const items = plan.items
    .map((item, index) => ({ no: (index + 1) as ItemNo, ...item }))
    .filter((item) => item.text !== null);
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">明日尚未安排項目。</p>;
  }
  const topNo = topItemNo(plan.top, topOptions);
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.no} className="flex items-start gap-2 text-sm">
          <span className="w-5 shrink-0 font-medium">{item.no}.</span>
          <span className="min-w-0 flex-1 break-words">
            {item.text}
            {item.expect !== null ? (
              <span className="text-muted-foreground">（預計 {item.expect}）</span>
            ) : null}
          </span>
          {topNo === item.no ? <Badge>最重要</Badge> : null}
        </li>
      ))}
    </ol>
  );
}

export function TodayForm({
  questions,
  initialAnswers,
  yesterday,
  previousVersionMissing = false,
  savedPlan,
  action,
}: TodayFormProps) {
  const [saved, setSaved] = useState(false);
  const [submittedPlan, setSubmittedPlan] = useState<YesterdayPlan | null>(null);
  const successRef = useRef<HTMLDivElement>(null);

  // Where the two section headings go: the first block-one question, and the
  // first question outside block one (preferring one without show_if so the
  // heading is never hidden together with a conditional question) — see
  // DECISIONS D-30 for the known limitation. Plus the active version's
  // `plan.top_priority` options for tomorrow's badge.
  const { firstBlockOneKey, firstBlockTwoKey, activeTopOptions } = useMemo(() => {
    const enabled = sortByOrder(questions).filter((q) => !q.disabled);
    const blockTwo = enabled.filter((q) => !isBlockOne(q));
    return {
      firstBlockOneKey: enabled.find(isBlockOne)?.key ?? null,
      firstBlockTwoKey: (blockTwo.find((q) => !q.show_if) ?? blockTwo[0])?.key ?? null,
      activeTopOptions: topPriorityOptions(questions),
    };
  }, [questions]);

  useEffect(() => {
    if (saved) successRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [saved]);

  const wrappedAction: FormAction = async (previous: FormActionState, formData: FormData) => {
    const result = await action(previous, formData);
    if (!result.ok) {
      setSaved(false);
      return result;
    }
    setSubmittedPlan(readYesterdayPlan(Object.fromEntries(formData), questions));
    setSaved(true);
    return { ok: true };
  };

  function beforeQuestion(question: Question): ReactNode {
    const parts: ReactNode[] = [];
    if (question.key === firstBlockOneKey) {
      parts.push(
        <SectionHeading
          key="h1"
          title="昨日計畫結算"
          description={yesterday ? `對照 ${yesterday.dateLabel} 日誌的明日計畫` : undefined}
        />,
      );
      if (!yesterday && !previousVersionMissing) {
        parts.push(
          <Alert key="no-plan">
            <AlertDescription>{NO_YESTERDAY_PLAN_MESSAGE}</AlertDescription>
          </Alert>,
        );
      }
    }
    const no = question.slot ? RESULT_STATUS_SLOTS[question.slot] : undefined;
    if (no && !previousVersionMissing) {
      parts.push(<YesterdayItem key={`y${no}`} no={no} yesterday={yesterday} />);
    }
    if (question.key === firstBlockTwoKey) {
      parts.push(<SectionHeading key="h2" title="今日回報與明日計畫" />);
    }
    return parts.length === 0 ? null : <>{parts}</>;
  }

  const shownPlan = savedPlan ?? submittedPlan;

  return (
    <div className="flex flex-col gap-6">
      {saved ? (
        <div
          ref={successRef}
          role="status"
          className="scroll-mt-16 rounded-xl border border-primary bg-card p-4"
          data-testid="saved-card"
        >
          <p className="text-base font-semibold">{SAVED_TITLE}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            今天 23:59 前都可以回到這頁修改。
          </p>
          <p className="mt-3 text-sm font-medium">{TOMORROW_TITLE}</p>
          <div className="mt-2">
            {shownPlan ? (
              <TomorrowList plan={shownPlan} topOptions={activeTopOptions} />
            ) : (
              <p className="text-sm text-muted-foreground">讀取中…</p>
            )}
          </div>
        </div>
      ) : null}
      <FormRenderer
        questions={questions}
        initialAnswers={initialAnswers}
        action={wrappedAction}
        submitLabel={initialAnswers ? "更新今日日誌" : "儲存今日日誌"}
        beforeQuestion={beforeQuestion}
        submitDisabled={previousVersionMissing}
      />
    </div>
  );
}
