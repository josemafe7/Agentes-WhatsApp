"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgendaField, fieldDescribedBy } from "./agenda-field";

type Option = { id: string; name: string };

type OptionSelectProps = {
  id: string;
  label: string;
  value: string;
  options: Option[];
  /** A first choice such as «Cualquier profesional». */
  first?: { value: string; label: string };
  errors?: string[];
  onChange: (value: string) => void;
};

/** A labelled select of the booking dialog (service or resource). */
export function OptionSelect({ id, label, value, options, first, errors, onChange }: OptionSelectProps) {
  return (
    <AgendaField id={id} label={label} errors={errors}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full" aria-invalid={errors?.length ? true : undefined} aria-describedby={fieldDescribedBy(id, { errors })}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {first ? <SelectItem value={first.value}>{first.label}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </AgendaField>
  );
}

type WholeNumberFieldProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  errors?: string[];
  onChange: (value: number) => void;
};

/** People or minutes: a whole number, never below `min`. */
export function WholeNumberField({ id, label, value, min, max, step, errors, onChange }: WholeNumberFieldProps) {
  return (
    <AgendaField id={id} label={label} errors={errors}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={fieldDescribedBy(id, { errors })}
        onChange={(event) => onChange(Math.max(min, Math.trunc(Number(event.target.value) || min)))}
      />
    </AgendaField>
  );
}

/** «Confirmada» or «Pendiente de confirmar» for a new booking ([AGD-14], [AGD-22]). */
export function StatusChoice({ id, value, onChange }: { id: string; value: "confirmed" | "pending"; onChange: (value: "confirmed" | "pending") => void }) {
  return (
    <div className="grid gap-2">
      <p id={`${id}-label`} className="text-sm font-medium">
        Estado
      </p>
      <RadioGroup aria-labelledby={`${id}-label`} value={value} onValueChange={(next) => onChange(next === "pending" ? "pending" : "confirmed")} className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-confirmed`} value="confirmed" />
          <Label htmlFor={`${id}-confirmed`} className="font-normal">
            Confirmada
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-pending`} value="pending" />
          <Label htmlFor={`${id}-pending`} className="font-normal">
            Pendiente de confirmar
          </Label>
        </div>
      </RadioGroup>
    </div>
  );
}
