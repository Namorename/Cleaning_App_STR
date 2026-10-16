import type { ReactNode } from 'react';

export interface PolicyTableRow {
  readonly key: string;
  /** The first column: what the row is about, its header cell. */
  readonly header: ReactNode;
  /** The other columns, in the order of `columns` after the first. */
  readonly cells: readonly ReactNode[];
}

interface PolicyTableProps {
  /** The id of the section heading that names the table. */
  labelledBy: string;
  columns: readonly string[];
  rows: readonly PolicyTableRow[];
}

/**
 * A table of the policy: columns side by side from `sm` up; on a phone each
 * row stacks into a block, its cells under their column's name, so nothing
 * scrolls sideways at 320 px.
 *
 * The roles are spelled out because a browser may drop a table's semantics
 * once CSS changes its `display`; with them, a screen reader still hears the
 * column and row headers. The column names written into the stacked cells are
 * for the eye only — the reader already has the header cells.
 */
export function PolicyTable({ labelledBy, columns, rows }: PolicyTableProps) {
  return (
    <table
      role="table"
      aria-labelledby={labelledBy}
      className="w-full border-collapse text-left text-sm max-sm:block"
    >
      <thead role="rowgroup" className="max-sm:sr-only">
        <tr role="row" className="border-b">
          {columns.map((column) => (
            <th
              key={column}
              role="columnheader"
              scope="col"
              className="px-3 py-2 align-bottom font-semibold first:pl-0"
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-sm:block">
        {rows.map((row) => (
          <tr
            key={row.key}
            role="row"
            className="border-b last:border-0 max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:py-3"
          >
            <th
              role="rowheader"
              scope="row"
              className="px-3 py-2 align-top font-semibold first:pl-0 max-sm:p-0"
            >
              {row.header}
            </th>
            {row.cells.map((cell, index) => (
              <td
                key={columns[index + 1]}
                role="cell"
                className="px-3 py-2 align-top hyphens-auto max-sm:p-0"
              >
                <span aria-hidden="true" className="text-muted-foreground sm:hidden">
                  {columns[index + 1]}:{' '}
                </span>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
