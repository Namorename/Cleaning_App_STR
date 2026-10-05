import type { ReactNode } from 'react';

interface LabelledFieldProps {
  /** The control's id: the label points at it. */
  id: string;
  label: string;
  children: ReactNode;
}

/**
 * A filter's control with its name written above it, small, as the filters
 * of the comparison page have (5.4): two date fields side by side say which
 * end is which.
 */
export function LabelledField({ id, label, children }: LabelledFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
