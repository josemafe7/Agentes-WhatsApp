"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import type { ChannelOption } from "@/data/users";

type ChannelCheckboxesProps = { channels: ChannelOption[]; defaultSelected?: string[] };

/** Channels an Agent attends ([USU-17]); none ticked = every channel ([PER-02]). Submitted as `channelIds`. */
export function ChannelCheckboxes({ channels, defaultSelected = [] }: ChannelCheckboxesProps) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Canales que atiende</FieldLegend>
      {channels.length === 0 ? (
        <FieldDescription>Todavía no hay canales: verá todos los que crees.</FieldDescription>
      ) : (
        <>
          <FieldDescription>Si no marcas ninguno, verá todos los canales.</FieldDescription>
          {channels.map((channel) => (
            <Field key={channel.id} orientation="horizontal">
              <Checkbox
                id={`channel-${channel.id}`}
                name="channelIds"
                value={channel.id}
                defaultChecked={defaultSelected.includes(channel.id)}
              />
              <FieldLabel htmlFor={`channel-${channel.id}`} className="font-normal">
                {channel.name}
              </FieldLabel>
            </Field>
          ))}
        </>
      )}
    </FieldSet>
  );
}
