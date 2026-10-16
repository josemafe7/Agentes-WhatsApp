// What a row of the services list says ([AGD-04]): the facts of a service grouped as the list shows them, one column per
// group when there is room and all of them in one line when the row is stacked. Pure.
import type { ServiceItem } from "@/data/agenda-config";
import { formatNumber } from "@/lib/format";
import { formatMinutes } from "./service-form";

type ServiceNumbers = Pick<ServiceItem, "durationMin" | "bufferBeforeMin" | "bufferAfterMin" | "price" | "minPeople" | "maxPeople" | "minAdvanceMin" | "maxAdvanceDays">;

export type ServiceFacts = {
  /** «1 h 30 min» and the margins the service has: «10 min antes», «10 min después». */
  duration: string[];
  /** «22» or «18,5», without a currency (the business writes the amount as it quotes it); null without a price. */
  price: string | null;
  /** «1 persona» or «de 2 a 8 personas», and the notices that are set: «con 2 h de antelación», «hasta 60 días antes». */
  booking: string[];
};

export function serviceFacts(service: ServiceNumbers): ServiceFacts {
  const duration = [formatMinutes(service.durationMin)];
  if (service.bufferBeforeMin > 0) duration.push(`${formatMinutes(service.bufferBeforeMin)} antes`);
  if (service.bufferAfterMin > 0) duration.push(`${formatMinutes(service.bufferAfterMin)} después`);
  const booking = [
    service.minPeople === service.maxPeople ? `${service.maxPeople} ${service.maxPeople === 1 ? "persona" : "personas"}` : `de ${service.minPeople} a ${service.maxPeople} personas`,
  ];
  if (service.minAdvanceMin > 0) booking.push(`con ${formatMinutes(service.minAdvanceMin)} de antelación`);
  if (service.maxAdvanceDays !== null) booking.push(`hasta ${service.maxAdvanceDays} días antes`);
  return { duration, price: service.price === null ? null : formatNumber(service.price, { maximumFractionDigits: 2 }), booking };
}
