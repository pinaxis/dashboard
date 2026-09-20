export interface ChipItem {
  id: string;
  label: string;
  color: string;
  count?: number;
}

interface Props {
  label: string;
  items: ChipItem[];
  active: Set<string>;
  onToggle: (id: string) => void;
}

export function Chips({ label, items, active, onToggle }: Props) {
  return (
    <div className="chip-group">
      <span className="chip-group-label">{label}</span>
      <div className="filter" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
        {items.map((item) => {
          const on = active.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`chip ${on ? "chip-on" : "chip-off"}`}
              aria-pressed={on}
              disabled={item.count === 0}
              onClick={() => onToggle(item.id)}
            >
              <span className="chip-dot" style={{ background: item.color }} />
              {item.label}
              {item.count != null && <span className="chip-count">{item.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
