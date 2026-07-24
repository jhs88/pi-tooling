import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerAskUser from "./ask-user/index.ts";
import registerBackgroundTerminals from "./background-terminals/index.ts";
import registerFileSearch from "./file-search/index.ts";
import registerFirecrawl from "./firecrawl/index.ts";
import registerWorkflows from "./workflows/index.ts";

/** Compose the selectively adapted Pi tooling extensions as one package. */
export default function registerPiTooling(pi: ExtensionAPI): void {
  registerFileSearch(pi);
  registerFirecrawl(pi);
  registerAskUser(pi);
  registerBackgroundTerminals(pi);
  registerWorkflows(pi);
}
