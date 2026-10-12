import type { DiagnosticDto, HistoryEntryDto, TokenDto, VariableDto } from '../api-types.ts';

const END_MARKER = '‸';

function overlaps(token: TokenDto, diagnostic: DiagnosticDto): boolean {
  return diagnostic.start < token.end && diagnostic.end > token.start;
}

function tokenClasses(token: TokenDto, diagnostics: readonly DiagnosticDto[]): string {
  const classes = [`tok-${token.kind}`];
  const hit = diagnostics.filter((d) => overlaps(token, d));
  if (hit.some((d) => d.severity === 'error')) classes.push('tok-error');
  else if (hit.length > 0) classes.push('tok-warning');
  return classes.join(' ');
}

export function formatNumber(value: number): string {
  return String(value);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Colors the typed expression by token kind and marks errors; only text nodes are created. */
export function renderPreview(
  container: HTMLElement,
  source: string,
  tokens: readonly TokenDto[],
  diagnostics: readonly DiagnosticDto[],
): void {
  const nodes: Node[] = [];
  let position = 0;
  for (const token of tokens) {
    if (token.start > position) nodes.push(document.createTextNode(source.slice(position, token.start)));
    nodes.push(element('span', tokenClasses(token, diagnostics), source.slice(token.start, token.end)));
    position = token.end;
  }
  if (position < source.length) nodes.push(document.createTextNode(source.slice(position)));
  if (diagnostics.some((d) => d.severity === 'error' && d.start >= source.length)) {
    nodes.push(element('span', 'tok-end-marker', END_MARKER));
  }
  container.replaceChildren(...nodes);
}

export type InputStatus = 'empty' | 'valid' | 'warning' | 'error';

export function statusOf(source: string, diagnostics: readonly DiagnosticDto[]): InputStatus {
  if (source.trim() === '') return 'empty';
  if (diagnostics.some((d) => d.severity === 'error')) return 'error';
  return diagnostics.length > 0 ? 'warning' : 'valid';
}

export function renderDiagnostic(target: HTMLElement, status: InputStatus, diagnostics: readonly DiagnosticDto[]): void {
  const first = diagnostics.find((d) => d.severity === 'error') ?? diagnostics[0];
  target.className = `diagnostic ${status}`;
  if (status === 'empty') target.textContent = '';
  else if (first === undefined) target.textContent = 'Valid expression';
  else target.textContent = first.message;
}

export function renderVariables(
  list: HTMLElement,
  emptyNote: HTMLElement,
  variables: readonly VariableDto[],
  handlers: { onInsert: (name: string) => void; onDelete: (name: string) => void },
): void {
  emptyNote.hidden = variables.length > 0;
  list.replaceChildren(
    ...variables.map(({ name, value }) => {
      const item = element('li');
      const insert = element('button', 'var-name', `${name} = ${formatNumber(value)}`);
      insert.type = 'button';
      insert.title = `Insert ${name} into the expression`;
      insert.addEventListener('click', () => handlers.onInsert(name));
      const remove = element('button', 'var-delete', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Delete variable ${name}`);
      remove.addEventListener('click', () => handlers.onDelete(name));
      item.append(insert, remove);
      return item;
    }),
  );
}

export function renderHistory(
  list: HTMLElement,
  emptyNote: HTMLElement,
  entries: readonly HistoryEntryDto[],
  onRecall: (input: string) => void,
): void {
  emptyNote.hidden = entries.length > 0;
  const newestFirst = [...entries].reverse();
  list.replaceChildren(
    ...newestFirst.map((entry) => {
      const item = element('li');
      const button = element('button', 'entry');
      button.type = 'button';
      button.title = 'Load this input into the expression field';
      button.append(
        element('span', 'entry-input', entry.input),
        element('span', 'entry-result', `= ${formatNumber(entry.result)}`),
        element('span', 'entry-time', new Date(entry.timestamp).toLocaleString()),
      );
      button.addEventListener('click', () => onRecall(entry.input));
      item.append(button);
      return item;
    }),
  );
}

export function renderResult(output: HTMLElement, text: string, isError: boolean): void {
  output.className = isError ? 'result error' : 'result';
  output.textContent = text;
}
