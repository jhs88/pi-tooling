import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  ScrollView,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { sanitizeTerminalText } from "../shared/terminal-text.ts";

/** Read-only prompt viewer. ScrollView owns scrolling; Text owns wrapping. */
export class PromptPreview implements Component {
  private readonly text: Text;
  private readonly scroll: ScrollView;
  private readonly theme: Theme;
  private readonly keys: KeybindingsManager;
  private readonly rows: () => number;
  private readonly requestRender: () => void;
  private readonly done: () => void;

  constructor(
    content: string,
    theme: Theme,
    keys: KeybindingsManager,
    rows: () => number,
    requestRender: () => void,
    done: () => void,
  ) {
    this.theme = theme;
    this.keys = keys;
    this.rows = rows;
    this.requestRender = requestRender;
    this.done = done;
    this.text = new Text(sanitizeTerminalText(content), 0, 0);
    this.scroll = new ScrollView(this.text);
  }

  render(width: number): string[] {
    const height = Math.max(1, Math.floor(this.rows() * 0.8));
    const innerWidth = Math.max(1, width - 4);
    const lines = this.scroll.render(innerWidth);
    const viewportHeight = Math.max(1, height - 4);
    this.scroll.updateLayout(lines.length, viewportHeight, this.requestRender);
    const top = this.scroll.scrollTop;
    const bottom = Math.min(lines.length, top + viewportHeight);
    const frameWidth = Math.max(0, width - 2);
    const row = (value: string): string => {
      const text = truncateToWidth(` ${value}`, frameWidth);
      return truncateToWidth(
        `${this.theme.fg("border", "│")}${text}${" ".repeat(Math.max(0, frameWidth - visibleWidth(text)))}${this.theme.fg("border", "│")}`,
        width,
      );
    };
    return [
      this.theme.fg("border", `╭${"─".repeat(frameWidth)}╮`),
      row(
        this.theme.fg(
          "accent",
          `Prompt preview | lines ${top + 1}-${bottom}/${lines.length}`,
        ),
      ),
      ...lines.slice(top, bottom).map(row),
      row(
        this.theme.fg(
          "dim",
          "Scroll: arrows/PgUp/PgDn | Home/End | Esc or q closes",
        ),
      ),
      this.theme.fg("border", `╰${"─".repeat(frameWidth)}╯`),
    ]
      .slice(0, height)
      .map((line) => truncateToWidth(line, width));
  }

  handleInput(data: string): void {
    if (this.keys.matches(data, "tui.select.cancel") || data === "q") {
      this.done();
      return;
    }
    if (this.keys.matches(data, "tui.select.up")) this.scroll.scrollBy(-1);
    else if (this.keys.matches(data, "tui.select.down"))
      this.scroll.scrollBy(1);
    else if (this.keys.matches(data, "tui.select.pageUp"))
      this.scroll.scrollBy(-this.scroll.viewportHeight);
    else if (this.keys.matches(data, "tui.select.pageDown"))
      this.scroll.scrollBy(this.scroll.viewportHeight);
    else if (matchesKey(data, "home")) this.scroll.scrollToStart();
    else if (matchesKey(data, "end")) this.scroll.scrollToEnd();
    else return;
    this.requestRender();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel") return undefined;
    this.scroll.scrollBy(event.wheelDelta ?? 0);
    this.requestRender();
    return { handled: true };
  }

  invalidate(): void {
    this.text.invalidate();
  }
}
