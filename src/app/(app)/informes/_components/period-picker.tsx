"use client";

// «Otro periodo» ([INF-01]): a month of the list, or a first and a last day (a year at most, checked on the server).
// Both only change the URL; the channel chosen stays.
import { CalendarRange } from "lucide-react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REPORTS_PATH, reportsHref, withMonth, type ReportsQuery } from "../_lib/search-params";

/** Days the date fields accept (the server accepts the same years). */
const FIRST_DAY = "2000-01-01";
const LAST_DAY = "2100-12-31";

type PeriodPickerProps = {
  query: ReportsQuery;
  months: { value: string; label: string }[];
  /** The month on screen, when the period is a month. */
  selectedMonth: string | null;
  /** First and last days on screen, to start the date fields from them. */
  firstDay: string;
  lastDay: string;
};

export function PeriodPicker({ query, months, selectedMonth, firstDay, lastDay }: PeriodPickerProps) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);

  function chooseMonth(month: string) {
    setOpen(false);
    router.push(reportsHref(withMonth(query, month)));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          <CalendarRange aria-hidden />
          Otro periodo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-month`}>Mes</Label>
            <Select value={selectedMonth ?? undefined} onValueChange={chooseMonth}>
              <SelectTrigger id={`${id}-month`} className="w-full">
                <SelectValue placeholder="Elige un mes" />
              </SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Form action={REPORTS_PATH} onSubmit={() => setOpen(false)} className="grid gap-3 border-t pt-4">
            <fieldset className="grid gap-3">
              <legend className="mb-3 text-sm font-medium">O unas fechas</legend>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-from`}>Desde</Label>
                  <Input id={`${id}-from`} name="desde" type="date" required min={FIRST_DAY} max={LAST_DAY} defaultValue={firstDay} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${id}-to`}>Hasta</Label>
                  <Input id={`${id}-to`} name="hasta" type="date" required min={FIRST_DAY} max={LAST_DAY} defaultValue={lastDay} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Los dos días incluidos, un año como mucho.</p>
            </fieldset>
            {query.channelId ? <input type="hidden" name="canal" value={query.channelId} /> : null}
            <Button type="submit">Ver estas fechas</Button>
          </Form>
        </div>
      </PopoverContent>
    </Popover>
  );
}
