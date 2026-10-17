import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { noPermissionDescription } from "@/components/app-shell/navigation";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { NoPermission } from "@/components/no-permission";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAgendaSettings, listResources, listServices } from "@/data/agenda-config";
import { countTestBookings, getAgendaFrame, getBooking, listBookings, type BookingView } from "@/data/bookings";
import { listTimeOff } from "@/data/bookings-time-off";
import { getContact } from "@/data/contacts";
import { formatDateTime } from "@/lib/format";
import { can, channelFilter, PERMISSIONS } from "@/lib/permissions";
import { addDays, isLocalDate } from "@/server/booking/time";
import { NotFoundError, ValidationError } from "@/server/errors";
import { requirePageActor } from "@/server/session";
import { AgendaFilters, FilterChips } from "./_components/agenda-filters";
import { AgendaProvider } from "./_components/agenda-provider";
import { BookingPanel } from "./_components/booking-panel";
import { CalendarToolbar } from "./_components/calendar-toolbar";
import { HeaderActions, type TestBookingItem } from "./_components/header-actions";
import { MonthView } from "./_components/month-view";
import { TimeGrid } from "./_components/time-grid";
import { nowLocal, viewRange } from "./_lib/calendar";
import {
  busyRanges,
  dayColumns,
  drawnTimeOff,
  monthDays,
  panelBooking,
  placeItems,
  resourceColumns,
  timeOffWhen,
  toCalendarBooking,
  toCalendarTimeOff,
  visibleResources,
  workingResources,
} from "./_lib/calendar-data";
import { foldedStretches, gridBounds } from "./_lib/grid";
import { agendaWords } from "./_lib/labels";
import { AGENDA_PATH, AGENDA_SETTINGS_PATH, agendaHref, bookingFilters, hasActiveFilters, matchesViewFilters, occupyingFilters, parseAgendaQuery, withoutFilters } from "./_lib/search-params";
import type { AgendaSetup, NewBookingPrefill } from "./_lib/types";

export const metadata: Metadata = { title: "Agenda" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Test bookings listed in «Citas de prueba»: from today, as many days as one request allows. */
const TEST_LIST_DAYS = 61;
const MINUTE_MS = 60_000;

/**
 * Agenda ([AGD-14]–[AGD-19], [AGD-28], [PRU-04]): day, week, month and resources views in the business's words and
 * time zone, with filters, the booking's card, «Nueva cita», drag and drop, blocked slots and the test bookings.
 * Every read and every action checks the person's permission on the server ([PER-01]).
 */
export default async function AgendaPage({ searchParams }: PageProps) {
  const actor = await requirePageActor({ next: AGENDA_PATH });
  if (!can(actor, PERMISSIONS.agenda.view)) return <NoPermission description={noPermissionDescription(actor.role)} />;
  const query = parseAgendaQuery(await searchParams);
  const [settings, services, resources] = await Promise.all([getAgendaSettings(actor), listServices(actor), listResources(actor)]);
  const words = agendaWords(settings.terminology);
  const abilities = {
    manage: can(actor, PERMISSIONS.agenda.bookings),
    block: can(actor, PERMISSIONS.agenda.block),
    deleteTests: can(actor, PERMISSIONS.agenda.deleteTestBookings),
    configure: can(actor, PERMISSIONS.agenda.configure),
    createContacts: can(actor, PERMISSIONS.contacts.edit) && channelFilter(actor) === null,
  };
  const readOnly = !abilities.manage ? <Badge variant="outline">Solo lectura</Badge> : null;
  const description = `Las ${words.bookings} del negocio por día, semana, mes o ${words.resource}.`;

  if (services.length === 0 || resources.length === 0) {
    return (
      <>
        <PageHeader title="Agenda" description={description} actions={readOnly} />
        <div className="rounded-xl border">
          <EmptyState
            icon={CalendarDays}
            title="Configura la agenda"
            description={`Añade al menos un servicio y un ${words.resource}.`}
            action={
              abilities.configure ? (
                <Button asChild>
                  <Link href={AGENDA_SETTINGS_PATH}>Configurar la agenda</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      </>
    );
  }

  const now = new Date();
  const current = nowLocal(settings.timezone, now);
  const date = query.date && isLocalDate(query.date) ? query.date : current.date;
  const range = viewRange(query.view, date);

  let loaded: Loaded | null = null;
  try {
    const resourceFilter = query.resourceIds.length ? { resourceIds: query.resourceIds } : {};
    const occupying = occupyingFilters(query, range);
    const [list, timeOff, frame, occupyingList] = await Promise.all([
      listBookings(actor, bookingFilters(query, range)),
      listTimeOff(actor, { from: range.from, to: range.to, ...resourceFilter }),
      getAgendaFrame(actor, range),
      // Free time ([AGD-29]) counts every booking that takes its slot, also those hidden by the view's filters.
      query.view !== "mes" && occupying ? listBookings(actor, occupying) : Promise.resolve(null),
    ]);
    const bookings = list.bookings.filter((booking) => matchesViewFilters(booking, query));
    loaded = { bookings, timeOff, frame, occupying: occupyingList?.bookings ?? bookings };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }

  const [detail, testCount, prefillContact] = await Promise.all([
    query.bookingId ? getBooking(actor, query.bookingId).catch(notFoundAsNull) : Promise.resolve(null),
    countTestBookings(actor),
    // Only fills in the dialog: a contact that is not found or not the person's to see is simply not filled in.
    query.newBooking?.contactId && abilities.manage ? getContact(actor, query.newBooking.contactId).catch(() => null) : Promise.resolve(null),
  ]);
  const testItems = testCount > 0 ? await testBookingItems(actor, query, current.date, settings.timezone) : [];

  const serviceOptions = services.map((service) => ({
    id: service.id,
    name: service.name,
    durationMin: service.durationMin,
    minPeople: service.minPeople,
    maxPeople: service.maxPeople,
    requiresManualConfirmation: service.requiresManualConfirmation,
    active: service.active,
    resourceIds: service.resourceIds,
  }));
  const resourceOptions = resources.map((resource) => ({ id: resource.id, name: resource.name, color: resource.color, capacity: resource.capacity, active: resource.active }));
  const setup: AgendaSetup = { words, mode: settings.mode, step: settings.slotIntervalMin, timezone: settings.timezone, services: serviceOptions, resources: resourceOptions, abilities };
  const initialNewBooking: NewBookingPrefill | null =
    query.newBooking && abilities.manage
      ? {
          date,
          ...(prefillContact ? { contact: { id: prefillContact.id, name: prefillContact.name ?? prefillContact.phone ?? prefillContact.email ?? "Sin nombre" } } : {}),
          ...(query.newBooking.conversationId ? { conversationId: query.newBooking.conversationId } : {}),
        }
      : null;

  const scoped = channelFilter(actor);
  const panel = detail
    ? panelBooking(detail, {
        timezone: settings.timezone,
        words,
        resourceNames: new Map(resources.map((resource) => [resource.id, resource.name])),
        contactHref: detail.contactId && can(actor, PERMISSIONS.contacts.view) ? `/contactos/${detail.contactId}` : null,
        conversationHref:
          detail.conversationId && can(actor, PERMISSIONS.inbox.view) && (scoped === null || (detail.channel !== null && scoped.includes(detail.channel.id)))
            ? `/bandeja/${detail.conversationId}`
            : null,
      })
    : null;

  const clearFilters = (
    <Button asChild variant="outline">
      <Link href={agendaHref(withoutFilters(query))}>Quitar filtros</Link>
    </Button>
  );
  const filterProps = { query, resources: resourceOptions, services: services.map((service) => ({ id: service.id, name: service.name })), words };

  return (
    <AgendaProvider setup={setup} defaultDate={date} initialNewBooking={initialNewBooking} closeNewBookingHref={agendaHref(query)}>
      <PageHeader
        title="Agenda"
        description={description}
        actions={
          <>
            {readOnly}
            <HeaderActions date={date} testBookings={{ count: testCount, items: testItems }} />
          </>
        }
      />
      <CalendarToolbar query={query} date={date} today={current.date} words={words} filters={<AgendaFilters {...filterProps} />} />
      <FilterChips {...filterProps} />
      {!loaded ? (
        <ErrorState title="Algún filtro no es válido" description="Revisa los filtros o quítalos." retry={clearFilters} />
      ) : (
        <>
          {loaded.bookings.length === 0 && hasActiveFilters(query) ? (
            <p className="pb-3 text-sm text-muted-foreground">Nada coincide con estos filtros en estas fechas.</p>
          ) : null}
          <CalendarBody query={query} date={date} today={current.date} now={now} timezone={settings.timezone} loaded={loaded} resources={resources} setup={setup} />
        </>
      )}
      <BookingPanel open={query.bookingId !== undefined} booking={panel} closeHref={agendaHref(query, { bookingId: undefined })} />
    </AgendaProvider>
  );
}

type Loaded = {
  bookings: BookingView[];
  timeOff: Awaited<ReturnType<typeof listTimeOff>>;
  frame: Awaited<ReturnType<typeof getAgendaFrame>>;
  /** Bookings that take their slot (pending and confirmed, tests included), whatever the view's filters. */
  occupying: BookingView[];
};

function notFoundAsNull(error: unknown): null {
  if (error instanceof NotFoundError) return null;
  throw error;
}

/** «Citas de prueba»: those from today on, as far as one request reaches; the count covers all of them. */
async function testBookingItems(actor: Parameters<typeof listBookings>[0], query: ReturnType<typeof parseAgendaQuery>, today: string, timezone: string): Promise<TestBookingItem[]> {
  const { bookings } = await listBookings(actor, { from: today, to: addDays(today, TEST_LIST_DAYS), includeTest: true, includeCancelled: true });
  return bookings
    .filter((booking) => booking.isTest)
    .map((booking) => ({
      id: booking.id,
      href: agendaHref(query, { bookingId: booking.id }),
      when: formatDateTime(booking.startsAt, timezone, { pattern: "EEE d MMM, HH:mm" }),
      service: booking.service.name,
      resource: booking.resource.name,
    }));
}

type CalendarBodyProps = {
  query: ReturnType<typeof parseAgendaQuery>;
  date: string;
  today: string;
  now: Date;
  timezone: string;
  loaded: Loaded;
  resources: Awaited<ReturnType<typeof listResources>>;
  setup: AgendaSetup;
};

/** The view asked for: month grid, or the time grid by days or by resources. */
function CalendarBody({ query, date, today, now, timezone, loaded, resources, setup }: CalendarBodyProps) {
  const bookings = loaded.bookings.map(toCalendarBooking);
  const timeOff = loaded.timeOff.map(toCalendarTimeOff);
  const hrefOf = (bookingId: string) => agendaHref(query, { bookingId });

  if (query.view === "mes") {
    const weeks = monthDays(date, bookings, {
      frame: loaded.frame,
      today,
      resources,
      timeOff,
      mode: setup.mode,
      resourceIds: query.resourceIds,
      serviceIds: query.serviceIds,
      words: setup.words,
    }).map((week) => week.map((day) => ({ ...day, dayHref: agendaHref(query, { view: "dia", date: day.date, bookingId: undefined }) })));
    const hrefs = Object.fromEntries(weeks.flat().flatMap((day) => day.previews.map((booking) => [booking.id, hrefOf(booking.id)])));
    return <MonthView weeks={weeks} hrefs={hrefs} words={setup.words} />;
  }

  const hrefs = Object.fromEntries(bookings.map((booking) => [booking.id, hrefOf(booking.id)]));
  const byResource = query.view === "recursos";
  const range = viewRange(query.view, date);
  const occupying = loaded.occupying.map(toCalendarBooking);
  const shown = byResource ? visibleResources(resources, query.resourceIds, bookings) : workingResources(resources, query.resourceIds);
  const columns = (
    byResource ? resourceColumns(date, shown, loaded.frame, today, setup.mode) : dayColumns(range, loaded.frame, today)
  ).map((column) => ({
    ...column,
    busy: column.closedLabel
      ? []
      : busyRanges(column.date, column.open, column.resourceId ? shown.filter((resource) => resource.id === column.resourceId) : shown, occupying, timeOff, loaded.frame, setup.mode),
  }));
  const bookingPlacements = placeItems(columns, bookings);
  const timeOffPlacements = placeItems(columns, drawnTimeOff(timeOff, byResource, query.resourceIds));
  const bounds = gridBounds(
    columns.flatMap((column) => column.open),
    bookingPlacements.filter((placement) => placement.endMin - placement.startMin < 1_440),
  );
  const folds = byResource ? [] : foldedStretches(columns, bounds, bookingPlacements, timeOffPlacements);
  const current = nowLocal(timezone, now);

  return (
    <TimeGrid
      columns={columns}
      bookings={Object.fromEntries(bookings.map((booking) => [booking.id, booking]))}
      bookingPlacements={bookingPlacements}
      timeOff={Object.fromEntries(timeOff.map((item) => [item.id, item]))}
      timeOffPlacements={timeOffPlacements}
      timeOffText={Object.fromEntries(loaded.timeOff.map((item) => [item.id, timeOffWhen(item, timezone)]))}
      bounds={bounds}
      folds={folds}
      capLanes={query.view === "semana"}
      hrefs={hrefs}
      byResource={byResource}
      now={{ ...current, epochMinute: Math.floor(now.getTime() / MINUTE_MS) }}
    />
  );
}
