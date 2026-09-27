"use client";

// The data of a chart as a table («Ver datos», DESIGN.md «Informes»): headings in caption weight 500, numbers on the
// right with tabular figures, long texts cut with their full text on hover, and a total row. On phones it becomes a list
// of cards (DESIGN.md «Tablas y listas»: no sideways scrolling).
import { Fragment } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { NO_DATA } from "../_lib/labels";
import type { ReportTable as ReportTableModel, TableCell as Cell, TableColumn } from "../_lib/tables";

const TEXT_CELL = "max-w-[22rem] truncate";

function cellClass(column: TableColumn | undefined): string {
  return column?.numeric ? "text-right tabular-nums" : TEXT_CELL;
}

export function ReportTable({ table }: { table: ReportTableModel }) {
  return (
    <>
      <Table className="hidden md:table">
        <caption className="sr-only">{table.title}</caption>
        <TableHeader>
          <TableRow>
            {table.columns.map((column) => (
              <TableHead key={column.label} scope="col" className={cn("text-xs font-medium text-muted-foreground", column.numeric && "text-right")}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={table.columns.length} className="text-center text-muted-foreground">
                {NO_DATA}
              </TableCell>
            </TableRow>
          ) : (
            table.rows.map((row, index) => <DataRow key={`${row[0]?.text}-${index}`} row={row} columns={table.columns} />)
          )}
        </TableBody>
        {table.footer && table.rows.length > 0 ? (
          <TableFooter>
            <DataRow row={table.footer} columns={table.columns} />
          </TableFooter>
        ) : null}
      </Table>
      <CardList table={table} />
    </>
  );
}

function DataRow({ row, columns }: { row: Cell[]; columns: TableColumn[] }) {
  return (
    <TableRow>
      {row.map((cell, index) =>
        index === 0 ? (
          <TableHead key={index} scope="row" className={cn("font-medium", TEXT_CELL)} title={cell.text}>
            {cell.text}
          </TableHead>
        ) : (
          <TableCell key={index} className={cellClass(columns[index])} title={columns[index]?.numeric ? undefined : cell.text}>
            {cell.text}
          </TableCell>
        ),
      )}
    </TableRow>
  );
}

/** Phones: one card per row with its figures, and the total last. */
function CardList({ table }: { table: ReportTableModel }) {
  if (table.rows.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground md:hidden">{NO_DATA}</p>;
  const rows = table.footer ? [...table.rows, table.footer] : table.rows;
  return (
    <ul className="grid gap-2 md:hidden" aria-label={table.title}>
      {rows.map((row, index) => (
        <li key={`${row[0]?.text}-${index}`} className="rounded-lg border p-3">
          <p className="font-medium break-words">{row[0]?.text}</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {table.columns.slice(1).map((column, columnIndex) => {
              const cell = row[columnIndex + 1];
              if (!cell?.text) return null;
              return (
                <Fragment key={column.label}>
                  <dt className="text-muted-foreground">{column.label}</dt>
                  <dd className={column.numeric ? "text-right tabular-nums" : "text-right break-words"}>{cell.text}</dd>
                </Fragment>
              );
            })}
          </dl>
        </li>
      ))}
    </ul>
  );
}
