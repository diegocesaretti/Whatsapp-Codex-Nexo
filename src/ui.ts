import { renderAdminPageV5 } from "./ui-v5.js";

export function renderAdminPage(): string {
  // ui-v5 is emitted from a TypeScript template literal. Preserve the two
  // JavaScript regex escapes that would otherwise be consumed by that outer
  // template before the browser receives the embedded script.
  return renderAdminPageV5()
    .replace("replace(/D/g,'')", "replace(/\\D/g,'')")
    .replace("split(/s+/)[0]", "split(/\\s+/)[0]");
}
