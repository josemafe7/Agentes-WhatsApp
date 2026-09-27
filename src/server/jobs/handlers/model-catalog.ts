// Job "ai.model_catalog_refresh" ([MOD-01], [MOD-06]): every 12 h the model list is downloaded again with the business's
// key, so a model in use that announces its retirement or leaves the list is noticed, and the team told ([AJU-08]), even
// when nobody opens a model list. Without a key it asks nothing ([MOD-08]) and waits for its next turn. The recurring job
// is asked for after a download with the installation's key (ensureModelCatalogRefreshJob, src/server/ai/models.ts).
import "server-only";
import { isAiConfigured } from "@/data/settings";
import { getModelCatalog, MODEL_CATALOG_REFRESH_JOB } from "@/server/ai/models";
import { registerJobHandler } from "../registry";

registerJobHandler(MODEL_CATALOG_REFRESH_JOB, async () => {
  if (!(await isAiConfigured())) return;
  await getModelCatalog({ refresh: true });
});
