import { CONSTANTS } from './constants.ts';
import { FUNCTIONS } from './functions.ts';

/** Name of the implicit variable holding the previous result. */
export const ANS_NAME = 'ans';

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Returns why `name` cannot be assigned, or null when it is a valid variable name. */
export function reservedNameReason(name: string): string | null {
  if (!VARIABLE_NAME_PATTERN.test(name)) return `'${name}' is not a valid variable name`;
  if (CONSTANTS.has(name)) return `Cannot assign to constant '${name}'`;
  if (name === ANS_NAME) return `'${ANS_NAME}' is reserved for the previous result`;
  if (FUNCTIONS.has(name)) return `'${name}' is a function name and cannot be used as a variable`;
  return null;
}
