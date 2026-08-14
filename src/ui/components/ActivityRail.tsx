import type { ActivityItem } from "../../core/chat/types.js";

function relativeTime(timestamp: string): string {
  const seconds = Math.round((new Date(timestamp).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function ActivityRail({
  items,
  onReview,
}: {
  items: ActivityItem[];
  onReview: (item: ActivityItem) => void;
}) {
  return (
    <aside className="activity-rail" aria-label="Background activity">
      <header className="activity-rail__header">
        <span className="eyebrow">While you were away</span>
        <span className="activity-rail__count">{items.length}</span>
      </header>
      <div className="activity-rail__list">
        {items.map((item) => (
          <article className={`activity-card activity-card--${item.kind}`} key={item.id}>
            <div className="activity-card__meta">
              <span>{item.kind.replace("_", " ")}</span>
              <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
            </div>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            {item.requiresReview ? (
              <button
                className="activity-card__review"
                type="button"
                onClick={() => onReview(item)}
              >
                Review with me
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
