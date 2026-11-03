import { Select } from '@serve/web-shared';
import { minutesToParts, partsToMinutes, type DayPeriod } from '../lib/time';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

export function TimeSelect({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: number;
  onChange: (minutes: number) => void;
  'aria-label': string;
}) {
  const parts = minutesToParts(value);
  const minuteOptions = MINUTES.includes(parts.minute) ? MINUTES : [...MINUTES, parts.minute].sort((a, b) => a - b);

  return (
    <span className="time-select" role="group" aria-label={ariaLabel}>
      <Select
        id={id}
        aria-label={`${ariaLabel} hour`}
        value={parts.hour12}
        onChange={(e) => onChange(partsToMinutes(Number(e.target.value), parts.minute, parts.period))}
      >
        {HOURS.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </Select>
      <Select
        aria-label={`${ariaLabel} minutes`}
        value={parts.minute}
        onChange={(e) => onChange(partsToMinutes(parts.hour12, Number(e.target.value), parts.period))}
      >
        {minuteOptions.map((minute) => (
          <option key={minute} value={minute}>
            {String(minute).padStart(2, '0')}
          </option>
        ))}
      </Select>
      <Select
        aria-label={`${ariaLabel} AM or PM`}
        value={parts.period}
        onChange={(e) =>
          onChange(partsToMinutes(parts.hour12, parts.minute, e.target.value as DayPeriod))
        }
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </Select>
    </span>
  );
}
