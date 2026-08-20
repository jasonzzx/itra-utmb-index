'use client';

import { useState } from 'react';
import {
  activeFilterCount,
  EMPTY_FILTERS,
  type FilterOptions,
  type FilterState,
} from '@/lib/filter';

/** Parse a bound, treating an empty box as "no bound" rather than 0. */
function parseBound(value: string): number | undefined {
  const n = Number(value);
  return value.trim() === '' || Number.isNaN(n) ? undefined : n;
}

function ChipRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="facet">
      <h4>{label}</h4>
      <div className="chips">
        {options.map((o) => (
          <button
            key={o.value}
            className="chip"
            data-on={selected.includes(o.value)}
            onClick={() => onToggle(o.value)}
          >
            {o.value} <span className="chip-count">{o.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SearchFilters({
  options,
  state,
  onChange,
  shown,
  total,
}: {
  options: FilterOptions;
  state: FilterState;
  onChange: (next: FilterState) => void;
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(state);

  function toggle(facet: 'countries' | 'ageGroups', value: string) {
    const current = state[facet];
    onChange({
      ...state,
      [facet]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    });
  }

  return (
    <div className="filters">
      <div className="filters-bar">
        <button className="text-btn" onClick={() => setOpen((v) => !v)}>
          Filters{active > 0 ? ` · ${active}` : ''}
        </button>
        <span className="filters-count">
          {active > 0 ? `Showing ${shown} of ${total}` : `${total} results`}
        </span>
        {active > 0 && (
          <button className="link-btn" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear
          </button>
        )}
      </div>

      {open && (
        <div className="filters-panel">
          <div className="facet">
            <h4>Index range</h4>
            <div className="range">
              <input
                inputMode="numeric"
                placeholder="min"
                value={state.minIndex ?? ''}
                onChange={(e) => onChange({ ...state, minIndex: parseBound(e.target.value) })}
              />
              <span aria-hidden>–</span>
              <input
                inputMode="numeric"
                placeholder="max"
                value={state.maxIndex ?? ''}
                onChange={(e) => onChange({ ...state, maxIndex: parseBound(e.target.value) })}
              />
            </div>
          </div>

          <ChipRow
            label="Country"
            options={options.countries}
            selected={state.countries}
            onToggle={(v) => toggle('countries', v)}
          />
          <ChipRow
            label="Age group"
            options={options.ageGroups}
            selected={state.ageGroups}
            onToggle={(v) => toggle('ageGroups', v)}
          />
        </div>
      )}
    </div>
  );
}
