import { Fragment, type ReactNode } from "react";
import { headingAnchors, parseMarkdown, type Block, type Inline } from "@/lib/markdown";

const HEADING_CLASSES = {
  1: "mt-8 text-lg font-semibold",
  2: "mt-6 text-base font-semibold",
  3: "mt-4 text-sm font-semibold",
} as const;

function renderInline(inlines: Inline[]): ReactNode {
  return inlines.map((inline, index) => {
    switch (inline.type) {
      case "text":
        return <Fragment key={index}>{inline.text}</Fragment>;
      case "break":
        return <br key={index} />;
      case "strong":
        return (
          <strong key={index} className="font-semibold">
            {renderInline(inline.children)}
          </strong>
        );
      case "code":
        return (
          <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {inline.text}
          </code>
        );
      case "link": {
        const external = !inline.href.startsWith("mailto:");
        return (
          <a
            key={index}
            href={inline.href}
            rel="noopener noreferrer nofollow"
            className="text-primary-text underline underline-offset-4"
            {...(external ? { target: "_blank" } : {})}
          >
            {inline.text}
          </a>
        );
      }
    }
  });
}

function renderBlock(block: Block, index: number, anchor: string | undefined): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
      return (
        <Tag key={index} id={anchor} className={HEADING_CLASSES[block.level]}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={index} className="mt-4">
          {renderInline(block.children)}
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={index} start={block.start} className={`mt-4 ${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-6`}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </List>
      );
    }
    case "code":
      return (
        <pre key={index} className="mt-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm">
          <code>{block.text}</code>
        </pre>
      );
  }
}

type MarkdownTextProps =
  | { text: string; blocks?: undefined; anchors?: boolean }
  | { text?: undefined; blocks: Block[]; anchors?: boolean };

/**
 * A text in the simple format of src/lib/markdown.ts, rendered as escaped text (never HTML). With `anchors`, every
 * heading gets the id of headingAnchors(), so an index can link to it.
 */
export function MarkdownText({ text, blocks, anchors = false }: MarkdownTextProps) {
  const parsed = blocks ?? parseMarkdown(text ?? "");
  const ids = anchors ? headingAnchors(parsed) : [];
  let heading = 0;
  return (
    <>
      {parsed.map((block, index) => renderBlock(block, index, block.type === "heading" && anchors ? ids[heading++] : undefined))}
    </>
  );
}
