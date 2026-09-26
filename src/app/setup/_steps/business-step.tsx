import { MAX_LOGO_BYTES } from "@/data/business";
import { getBusinessStepData } from "@/data/setup";
import { SECTOR_OPTIONS } from "@/lib/sectors";
import { BusinessForm } from "../_components/business-form";
import { stepActor, type SetupStepProps } from "./types";

const BYTES_PER_KB = 1024;

/** Step 2 ([ASI-03]–[ASI-05]): business name, sector (loads its preset), colour and logo. */
export async function BusinessStep({ actor }: SetupStepProps) {
  const data = await getBusinessStepData(stepActor(actor));
  return <BusinessForm initial={data} sectors={SECTOR_OPTIONS} logoMaxKb={MAX_LOGO_BYTES / BYTES_PER_KB} />;
}
