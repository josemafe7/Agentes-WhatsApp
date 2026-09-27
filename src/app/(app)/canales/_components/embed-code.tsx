import { ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { webchatEmbedSnippet, widgetDemoHref } from "../_lib/webchat";

type EmbedCodeProps = { appUrl: string; channelId: string };

/**
 * The web chat's code to paste in the business's site, with «Copiar código» ([WEB-01]), and its test page in the app
 * ([WEB-12]). Data to copy, as DESIGN.md says: read-only, mono, with its copy button.
 */
export function EmbedCode({ appUrl, channelId }: EmbedCodeProps) {
  const snippet = webchatEmbedSnippet(appUrl, channelId);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Pega esta línea en tu web, justo antes de <code className="font-mono text-xs">&lt;/body&gt;</code>. Si usas WordPress, Wix u otro editor, va en
        el apartado de «código personalizado» o «scripts».
      </p>
      <pre className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all" aria-label="Código del chat web">
        {snippet}
      </pre>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={snippet} label="Copiar código" />
        <Button asChild variant="outline">
          <a href={widgetDemoHref(channelId)} target="_blank" rel="noopener">
            <ExternalLink aria-hidden />
            Abrir en /widget-demo
          </a>
        </Button>
      </div>
    </div>
  );
}
