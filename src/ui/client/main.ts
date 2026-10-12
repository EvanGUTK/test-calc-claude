import type { AngleModeDto, DiagnosticDto, HistoryEntryDto, StateResponse, TokenDto } from '../api-types.ts';
import { ApiError, clearHistory, deleteVariable, evaluate, fetchState, validate } from './api.ts';
import {
  formatNumber,
  renderDiagnostic,
  renderHistory,
  renderPreview,
  renderResult,
  renderVariables,
  statusOf,
} from './render.ts';

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`Page is missing #${id}`);
  return found;
}

const form = requireElement('calc-form', HTMLFormElement);
const input = requireElement('expression', HTMLInputElement);
const preview = requireElement('preview', HTMLElement);
const diagnosticLine = requireElement('diagnostic', HTMLElement);
const resultOutput = requireElement('result', HTMLElement);
const variablesList = requireElement('variables', HTMLElement);
const variablesEmpty = requireElement('variables-empty', HTMLElement);
const historyList = requireElement('history', HTMLElement);
const historyEmpty = requireElement('history-empty', HTMLElement);
const clearButton = requireElement('clear-history', HTMLButtonElement);

let history: readonly HistoryEntryDto[] = [];
let recallPosition = -1;
let validationCounter = 0;
let lastTokens: readonly TokenDto[] = [];

function angleMode(): AngleModeDto {
  const selected = document.querySelector<HTMLInputElement>('input[name="angle-mode"]:checked');
  return selected?.value === 'deg' ? 'deg' : 'rad';
}

function showValidation(tokens: readonly TokenDto[], diagnostics: readonly DiagnosticDto[]): void {
  const source = input.value;
  const status = statusOf(source, diagnostics);
  lastTokens = tokens;
  renderPreview(preview, source, tokens, diagnostics);
  renderDiagnostic(diagnosticLine, status, diagnostics);
  input.classList.toggle('is-invalid', status === 'error');
  input.classList.toggle('is-warning', status === 'warning');
  input.setAttribute('aria-invalid', String(status === 'error'));
}

async function refreshValidation(): Promise<void> {
  const source = input.value;
  const ticket = (validationCounter += 1);
  if (source.trim() === '') {
    showValidation([], []);
    return;
  }
  try {
    const response = await validate(source);
    if (ticket === validationCounter) showValidation(response.tokens, response.diagnostics);
  } catch (error) {
    if (ticket !== validationCounter) return;
    console.error('Validation request failed', error);
    renderDiagnostic(diagnosticLine, 'warning', [
      { severity: 'warning', message: 'Live validation is unavailable (cannot reach the server)', start: 0, end: 0 },
    ]);
  }
}

function applyState(state: StateResponse): void {
  history = state.history;
  renderVariables(variablesList, variablesEmpty, state.variables, {
    onInsert: (name) => {
      input.setRangeText(name, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
      input.focus();
      void refreshValidation();
    },
    onDelete: (name) => void run(async () => applyState(await deleteVariable(name))),
  });
  renderHistory(historyList, historyEmpty, state.history, (text) => {
    input.value = text;
    input.focus();
    void refreshValidation();
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs a UI action and reports any failure in the result area instead of dropping it. */
async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error);
    renderResult(resultOutput, describeError(error), true);
  }
}

async function submit(): Promise<void> {
  const source = input.value;
  if (source.trim() === '') return;
  try {
    const response = await evaluate(source, angleMode());
    const { entry } = response;
    const label = entry.kind === 'assignment' && entry.variable !== null ? entry.variable : entry.input;
    renderResult(resultOutput, `${label} = ${formatNumber(entry.result)}`, false);
    applyState(response.state);
    input.value = '';
    recallPosition = -1;
    await refreshValidation();
  } catch (error) {
    if (!(error instanceof ApiError) || error.detail.start === null || error.detail.end === null) throw error;
    renderResult(resultOutput, error.message, true);
    const marker: DiagnosticDto = { severity: 'error', message: error.message, start: error.detail.start, end: error.detail.end };
    renderPreview(preview, source, lastTokens, [marker]);
  }
}

function recall(direction: 1 | -1): void {
  const next = recallPosition + direction;
  if (next < -1 || next >= history.length) return;
  recallPosition = next;
  const entry = next === -1 ? undefined : history[history.length - 1 - next];
  input.value = entry?.input ?? '';
  void refreshValidation();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(submit);
});

input.addEventListener('input', () => {
  recallPosition = -1;
  void refreshValidation();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    recall(1);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    recall(-1);
  }
});

clearButton.addEventListener('click', () => void run(async () => applyState(await clearHistory())));

void run(async () => {
  applyState(await fetchState());
  await refreshValidation();
});
